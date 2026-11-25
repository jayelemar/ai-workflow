import { randomUUID } from "node:crypto";
import { constants } from "node:fs";
import { access, lstat, open, realpath, unlink } from "node:fs/promises";
import path from "node:path";
import { ResourceManager, environmentContext } from "./manager.mjs";
import { DockerProvider, ownershipLabels } from "./docker.mjs";
import { readManifest } from "./store.mjs";
import { AbsolutePathSchema } from "./schema.mjs";
import { validateTaskImage } from "./images.mjs";
import { disposeDockerAllocations } from "./disposal.mjs";
import { dockerName, slug } from "./naming.mjs";

// Check all ancestors as well as the final file; generated overlays must never
// follow a symlink into a checkout or another task's artifact.
async function noSymlinks(target) {
  let current = path.parse(target).root;
  for (const segment of target.slice(current.length).split(path.sep)) {
    current = path.join(current, segment);
    const info = await lstat(current);
    if (info.isSymbolicLink()) throw new Error("Unsafe Compose resource path");
    if (current !== target && !info.isDirectory())
      throw new Error("Unsafe Compose resource directory");
  }
}

const inside = (root, target) =>
  target === root || target.startsWith(`${root}${path.sep}`);

export async function resolveComposeFiles(directory, requested, execution) {
  const permitted = (target) =>
    inside(execution.root, target) &&
    (execution.mode === "worktree" ||
      !path
        .relative(execution.root, target)
        .split(path.sep)
        .includes(".worktrees"));
  if (!permitted(directory))
    throw new Error("Compose directory must stay inside this execution");
  let files;
  if (requested?.length)
    files = requested.map((file) => path.resolve(directory, file));
  else {
    files = [];
    for (const name of [
      "compose.yaml",
      "compose.yml",
      "docker-compose.yaml",
      "docker-compose.yml",
    ]) {
      const file = path.join(directory, name);
      try {
        await lstat(file);
        files.push(file);
      } catch (error) {
        if (error.code !== "ENOENT") throw error;
      }
    }
    if (files.length !== 1)
      throw new Error(
        "Provide --file to select an unambiguous Compose configuration",
      );
  }
  if (new Set(files).size !== files.length)
    throw new Error("Duplicate Compose configuration");
  for (const file of files) {
    AbsolutePathSchema.parse(file);
    if (!permitted(file))
      throw new Error("Compose configuration must stay inside this execution");
    let current = path.parse(file).root;
    for (const segment of file.slice(current.length).split(path.sep)) {
      current = path.join(current, segment);
      const info = await lstat(current);
      if (
        info.isSymbolicLink() ||
        (current !== file && !info.isDirectory()) ||
        (current === file && !info.isFile())
      )
        throw new Error(
          "Compose configuration requires real directories and regular files",
        );
    }
    await access(file, constants.R_OK);
  }
  return files;
}

async function writeOverlay(file, source, previous) {
  await noSymlinks(path.dirname(file));
  const handle = await open(
    file,
    constants.O_RDWR |
      constants.O_NOFOLLOW |
      (previous === undefined ? constants.O_CREAT | constants.O_EXCL : 0),
    0o600,
  );
  try {
    const info = await handle.stat();
    if (!info.isFile() || info.nlink !== 1)
      throw new Error("Unsafe Compose overlay file");
    if (previous !== undefined && (await handle.readFile("utf8")) !== previous)
      throw new Error("Compose overlay changed; refusing replacement");
    await handle.truncate(0);
    await handle.write(source, 0, "utf8");
  } finally {
    await handle.close();
  }
}

function overlaySource(overlay) {
  // JSON quoting does not disable Compose interpolation. Escape every literal
  // dollar in generated values, without re-escaping the resolved caller input.
  const encode = (value) => JSON.stringify(value).replaceAll("$", () => "$$");
  // YAML flow-style JSON values allow Compose's tagged ports sequence.
  let source = "services:\n";
  for (const [service, configuration] of Object.entries(overlay.services)) {
    const { ports, build, ...rest } = configuration;
    source += `  ${encode(service)}:\n`;
    for (const [key, value] of Object.entries(rest))
      source += `    ${key}: ${encode(value)}\n`;
    if (build) {
      source += `    build:\n      labels: ${encode(build.labels)}\n`;
      // Extra caller tags could overwrite shared images during the build. The
      // isolated service image is the only tag reserved by this allocation.
      source += "      tags: !override []\n";
    }
    source += `    ports: !override ${encode(ports)}\n`;
  }
  return `${source}volumes: ${encode(overlay.volumes)}\nnetworks: ${encode(overlay.networks)}\n`;
}

// Persist only task identity, ownership and isolated publications. Application
// configuration remains caller-owned; expanded environment is transient.
export async function trackedCompose(
  { directory, files, project, environment },
  {
    manager = new ResourceManager(),
    getContext = environmentContext,
    createDocker = (options) => new DockerProvider(options),
    readRecord = readManifest,
    validateImage = validateTaskImage,
    disposeAllocations = disposeDockerAllocations,
  } = {},
) {
  const context = getContext();
  if (!context)
    return {
      project,
      capture: async () => undefined,
      disposeImages: async () => undefined,
    };
  await noSymlinks(directory);
  if (
    !(await lstat(directory)).isDirectory() ||
    (await realpath(directory)) !== directory
  )
    throw new Error("Compose directory must be a canonical directory");
  const { execution, manifest } = await manager.context(context);
  files = await resolveComposeFiles(directory, files, execution);
  const isolatedProject = dockerName(manifest, "compose", randomUUID());
  project ??=
    path
      .basename(directory)
      .toLowerCase()
      .replace(/[^a-z0-9_-]+/g, "-")
      .replace(/^[-_]+/, "") || "task";
  const provider = await manager.docker.identity();
  const configDocker = createDocker({
    environment: { ...process.env, ...environment },
  });
  const parentArgs = [
    "compose",
    "--project-name",
    project,
    "--project-directory",
    directory,
  ];
  for (const file of files) parentArgs.push("--file", file);
  // Reading config in memory is necessary to distinguish external volumes and
  // image-only services. No expanded content is persisted, logged or reported.
  let config;
  try {
    config = JSON.parse(
      await configDocker.command(
        [...parentArgs, "config", "--format", "json"],
        provider.endpoint,
      ),
    );
  } catch {
    throw new Error(
      "Cannot resolve tracked Compose configuration; content omitted",
    );
  }
  const services = Object.keys(config.services);
  const volumes = Object.keys(config.volumes ?? {});
  // Keep caller keys and Compose's normal suffixes, but reject names that
  // cannot fit the recorded provider identity before pulling or building images.
  if (
    volumes.some((name) => `${isolatedProject}_${name}`.length > 255) ||
    services.some((name) => `${isolatedProject}-${name}-1`.length > 255)
  )
    throw new Error("Generated Compose resource name exceeds 255 characters");
  const buildTags = new Map();
  for (const [service, configuration] of Object.entries(config.services))
    if (configuration.build)
      buildTags.set(
        service,
        `${isolatedProject}-${slug(service)}-${buildTags.size}:task`,
      );
  // Allocation consumes this same resolved snapshot from stdin. Re-reading the
  // caller's files after validation could introduce resources without ownership
  // reservations; expanded configuration must never be written to an artifact.
  const resolvedInput = JSON.stringify(config);
  const requireExplicitImageVolumes = async (configuration, imageId) => {
    let declared;
    try {
      declared = JSON.parse(
        await configDocker.command(
          ["image", "inspect", "--format", "{{json .Config.Volumes}}", imageId],
          provider.endpoint,
        ),
      );
      if (
        declared !== null &&
        (typeof declared !== "object" || Array.isArray(declared))
      )
        throw new Error();
    } catch {
      throw new Error("Compose image volume declarations are unverified");
    }
    const explicitTargets = new Set(
      (configuration.volumes ?? [])
        .filter(
          (mount) =>
            (mount.type === "bind" ||
              (mount.type === "volume" && volumes.includes(mount.source))) &&
            typeof mount.target === "string",
        )
        .map((mount) => path.posix.normalize(mount.target).replace(/\/$/, "")),
    );
    if (
      Object.keys(declared ?? {}).some(
        (target) =>
          !explicitTargets.has(path.posix.normalize(target).replace(/\/$/, "")),
      )
    )
      throw new Error(
        "Compose image-declared volumes require explicit mounts; anonymous allocation refused",
      );
  };
  for (const [name, volume] of Object.entries(config.volumes ?? {})) {
    if (volume.external)
      throw new Error(`Tracked Compose cannot use an external volume: ${name}`);
  }
  for (const networkConfiguration of Object.values(config.networks ?? {})) {
    if (networkConfiguration.external)
      throw new Error("Tracked Compose cannot use external networks");
  }
  if (Object.keys(config.networks ?? {}).some((name) => name !== "default"))
    throw new Error(
      "Tracked Compose supports only its private default network",
    );
  for (const configuration of Object.values(config.services)) {
    if (Object.hasOwn(configuration, "provider"))
      throw new Error(
        "Tracked Compose does not support delegated provider services",
      );
    if (
      configuration.volumes_from?.length ||
      (configuration.scale !== undefined && configuration.scale !== 1) ||
      (configuration.deploy?.replicas !== undefined &&
        configuration.deploy.replicas !== 1)
    )
      throw new Error(
        "Tracked Compose requires one container per service and forbids inherited volumes",
      );
    if (
      configuration.container_name ||
      configuration.network_mode ||
      configuration.volumes?.some(
        (volume) =>
          volume.type === "volume" && !volumes.includes(volume.source),
      )
    )
      throw new Error(
        "Tracked Compose refuses fixed container identities, shared networks or unregistered volumes",
      );
  }
  // Pin image-only services to the exact native image that passed the shared
  // task-image ownership policy before reserving or starting Compose resources.
  const validatedImages = new Map();
  for (const [service, configuration] of Object.entries(config.services)) {
    if (!configuration.build && configuration.image) {
      const actual = await validateImage({
        manager,
        context,
        provider,
        image: configuration.image,
      });
      await requireExplicitImageVolumes(configuration, actual.id);
      validatedImages.set(service, actual.id);
    }
  }
  const overlay = {
    services: Object.create(null),
    volumes: Object.create(null),
    networks: Object.create(null),
  };
  const reservations = [];
  const reserve = async (kind, options = {}) => {
    const reservation = await manager.reserve(context, kind, provider, [], {
      compose: { project: isolatedProject, directory },
      ...options,
    });
    reservations.push(reservation.entry);
    return reservation;
  };
  for (const service of services) {
    const container = await reserve("container");
    // The default project's image/bind/network resources are not adopted.
    const serviceOverlay = { labels: container.labels };
    if (validatedImages.has(service))
      serviceOverlay.image = validatedImages.get(service);
    overlay.services[service] = serviceOverlay;
  }
  for (const volumeName of volumes) {
    const volume = await reserve("volume");
    overlay.volumes[volumeName] = {
      name: `${isolatedProject}_${volumeName}`,
      labels: volume.labels,
    };
  }
  const network = await reserve("network");
  overlay.networks.default = {
    name: `${isolatedProject}_default`,
    labels: network.labels,
  };
  for (const [service, configuration] of Object.entries(config.services)) {
    const target = overlay.services[service];
    if (configuration.build) {
      // Compose service identifiers may contain uppercase characters, while
      // Docker image repository names must be lowercase. Indices also avoid
      // collisions between service names that differ only by case.
      target.image = buildTags.get(service);
      const image = await reserve("image", { expectedTags: [target.image] });
      target.build = { labels: image.labels };
    }
    // Replace all fixed publications with loopback ephemeral host ports. !override
    // is written as YAML below, since plain JSON cannot express Compose tags.
    target.ports = (configuration.ports ?? []).map((port) => ({
      target: Number(port.target),
      published: "0",
      host_ip: "127.0.0.1",
      protocol: port.protocol ?? "tcp",
    }));
  }
  let source = overlaySource(overlay);
  const overlayFile = path.join(
    context.workspace,
    ".ai",
    "artifacts",
    path.basename(context.plan, ".md"),
    `compose-${context.executionId}-${randomUUID()}.yaml`,
  );
  await noSymlinks(directory);
  await writeOverlay(overlayFile, source);
  const capture = async () => {
    for (const reservation of [...reservations].sort(
      (left, right) =>
        (left.kind === "container") - (right.kind === "container"),
    )) {
      const current = (await readRecord(context)).resources.find(
        (item) => item.id === reservation.id,
      );
      if (current.state !== "pending") continue;
      const ids = await manager.docker.discover(current);
      if (ids.length > 1)
        throw new Error("Compose allocation has multiple matches");
      if (ids.length === 1)
        await manager.captureDocker(context, current.id, ids[0]);
    }
  };
  const removeOverlay = async () => {
    // This is a generated credential-free overlay owned by this allocation.
    await noSymlinks(path.dirname(overlayFile));
    const handle = await open(
      overlayFile,
      constants.O_RDONLY | constants.O_NOFOLLOW,
    ).catch((error) => {
      if (error.code === "ENOENT") return null;
      throw error;
    });
    if (!handle) return;
    try {
      const info = await handle.stat();
      const current = await lstat(overlayFile);
      if (
        info.isFile() &&
        info.nlink === 1 &&
        current.dev === info.dev &&
        current.ino === info.ino &&
        (await handle.readFile("utf8")) === source
      )
        await unlink(overlayFile);
    } finally {
      await handle.close();
    }
  };
  const dispose = async () => {
    const result = await disposeAllocations(
      context,
      reservations.map((entry) => entry.id),
      { manager },
    );
    if (result.preserved.length)
      throw new Error(
        "Compose disposal preserved shared task images; keep fixture and JSON evidence",
      );
    await removeOverlay();
  };
  const disposeImages = async () => {
    const result = await disposeAllocations(
      context,
      reservations
        .filter((entry) => entry.kind === "image")
        .map((entry) => entry.id),
      { manager },
    );
    if (result.preserved.length)
      throw new Error(
        "Compose image disposal preserved shared images; keep JSON evidence",
      );
    await removeOverlay();
  };
  const composeArgs = [
    "compose",
    "--project-name",
    isolatedProject,
    "--project-directory",
    directory,
  ];
  for (const file of ["-", overlayFile]) composeArgs.push("--file", file);
  const command = (args) =>
    configDocker.command([...composeArgs, ...args], provider.endpoint, {
      timeoutMs: 600_000,
      input: resolvedInput,
    });
  let buildsReady = false;
  let buildAttempted = false;
  let startupAttempted = false;
  const verifyReservations = async ({
    allowPending = false,
    building = false,
  } = {}) => {
    await manager.context(context);
    await manager.docker.verifyIdentity(provider);
    const manifest = await readRecord(context);
    const containers = new Set(
      manifest.resources
        .filter(
          (entry) =>
            entry.kind === "container" &&
            entry.executionId === context.executionId &&
            entry.state === "present" &&
            entry.locator,
        )
        .map((entry) => entry.locator.id),
    );
    for (const reservation of reservations) {
      const current = manifest.resources.find(
        (entry) => entry.id === reservation.id,
      );
      if (allowPending && current?.state === "pending" && !current.locator) {
        if ((await manager.docker.discover(current)).length)
          throw new Error(
            "Compose reservation already has native resources; reconcile it and prepare a fresh allocation",
          );
        continue;
      }
      if (current?.state !== "present" || !current.locator)
        throw new Error(
          "Compose allocation is incomplete or removed; prepare a fresh allocation",
        );
      if (building && current.kind === "image")
        throw new Error(
          "Compose image is already captured; prepare a fresh allocation",
        );
      const status = await manager.docker.verify(
        current,
        ownershipLabels(context, manifest, current),
        containers,
      );
      if (
        status.state !== "present" &&
        !(current.kind === "image" && status.state === "preserved")
      )
        throw new Error(
          "Captured Compose resource is missing; prepare a fresh allocation",
        );
    }
  };
  const up = async () => {
    try {
      await noSymlinks(overlayFile);
      const handle = await open(
        overlayFile,
        constants.O_RDONLY | constants.O_NOFOLLOW,
      );
      try {
        const info = await handle.stat();
        if (
          !info.isFile() ||
          info.nlink !== 1 ||
          (await handle.readFile("utf8")) !== source
        )
          throw new Error("Compose overlay changed; refusing startup");
      } finally {
        await handle.close();
      }
      const builds = Object.entries(config.services).filter(
        ([, service]) => service.build,
      );
      if (builds.length && !buildsReady) {
        if (buildAttempted)
          throw new Error(
            "Compose build was already attempted; dispose it and prepare a fresh allocation",
          );
        await verifyReservations({ allowPending: true, building: true });
        // A failed build can still create images. Reusing its labels/tags could
        // replace already captured IDs, leaving the new images unrecorded.
        buildAttempted = true;
        // Building allocates only the image reservations above. Inspect the
        // resulting image before Compose can allocate an anonymous volume.
        try {
          await command(["build"]);
        } finally {
          await capture();
        }
        const builtImages = new Map();
        for (const [service, configuration] of builds) {
          const actual = await validateImage({
            manager,
            context,
            provider,
            image: overlay.services[service].image,
          });
          await requireExplicitImageVolumes(configuration, actual.id);
          builtImages.set(service, actual.id);
        }
        for (const [service, image] of builtImages)
          overlay.services[service].image = image;
        const updated = overlaySource(overlay);
        await writeOverlay(overlayFile, updated, source);
        source = updated;
        buildsReady = true;
      }
      // Start only the exact inspected IDs, without a second build or pull.
      await verifyReservations({ allowPending: !startupAttempted });
      startupAttempted = true;
      await command([
        "up",
        "--no-build",
        "--pull",
        "never",
        "--wait",
        "--wait-timeout",
        "240",
      ]);
    } finally {
      await capture();
    }
  };
  return {
    project: isolatedProject,
    overlayFile,
    capture,
    disposeImages,
    up,
    dispose,
  };
}
