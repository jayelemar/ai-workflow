import { ResourceManager, environmentContext } from "./manager.mjs";
import { disposeDockerAllocations } from "./disposal.mjs";
import { ownershipLabels, requireLoopbackPublications } from "./docker.mjs";
import { readManifest } from "./store.mjs";
import { validateTaskImage } from "./images.mjs";
import { prepareContainerVolumes } from "./volumes.mjs";

const manager = new ResourceManager();
const bindingOption = "com.docker.network.bridge.host_binding_ipv4";
const loopbackNetwork = (actual) =>
  actual?.driver === "bridge" &&
  actual.options?.[bindingOption] === "127.0.0.1";

function labelArguments(labels) {
  return Object.entries(labels).flatMap(([key, value]) => [
    "--label",
    `${key}=${value}`,
  ]);
}

function requireContext(getContext) {
  const context = getContext();
  if (!context)
    throw new Error("Docker fixtures require a task resource context");
  return context;
}

async function executionNetwork(coordinator, context, requestedId) {
  const { manifest } = await coordinator.context(context);
  const ownContainers = new Set(
    manifest.resources
      .filter(
        (entry) =>
          entry.kind === "container" &&
          entry.executionId === context.executionId &&
          entry.locator,
      )
      .map((entry) => entry.locator.id),
  );
  const candidates = manifest.resources.filter(
    (entry) =>
      entry.kind === "network" &&
      entry.executionId === context.executionId &&
      entry.state === "present" &&
      (!requestedId || entry.locator.id === requestedId),
  );
  for (const entry of candidates) {
    const status = await coordinator.docker.verify(
      entry,
      ownershipLabels(context, manifest, entry),
      ownContainers,
    );
    if (
      status.state === "present" &&
      loopbackNetwork(
        await coordinator.docker.inspect(
          "network",
          entry.locator.id,
          entry.provider,
        ),
      )
    )
      return entry;
  }
  if (requestedId)
    throw new Error(
      "Explicit network does not belong to this active task execution",
    );
  const created = await startDockerNetwork({
    manager: coordinator,
    getContext: () => context,
  });
  return (await readManifest(context)).resources.find(
    (entry) =>
      entry.kind === "network" && entry.locator?.id === created.getId(),
  );
}

function containerConfiguration(configuration = {}) {
  if (
    !configuration ||
    typeof configuration !== "object" ||
    Array.isArray(configuration) ||
    Object.keys(configuration).some(
      (key) =>
        ![
          "image",
          "command",
          "environment",
          "ports",
          "volumeMounts",
          "networkId",
        ].includes(key),
    )
  )
    throw new Error("Unsupported container configuration field");
  const {
    image,
    command = [],
    environment = {},
    ports = [],
    volumeMounts = [],
    networkId,
  } = configuration;
  const boundedString = (value) =>
    typeof value === "string" && value.length <= 32768 && !value.includes("\0");
  if (
    typeof image !== "string" ||
    !/^[a-zA-Z0-9][a-zA-Z0-9._/:@-]{0,255}$/.test(image)
  )
    throw new Error("A bounded explicit image reference is required");
  if (
    !Array.isArray(command) ||
    command.length > 1024 ||
    !command.every(boundedString)
  )
    throw new Error("Invalid container command arguments");
  if (
    !environment ||
    typeof environment !== "object" ||
    Array.isArray(environment) ||
    Object.keys(environment).length > 1024 ||
    Object.entries(environment).some(
      ([key, value]) =>
        !/^[a-zA-Z_][a-zA-Z0-9_]{0,255}$/.test(key) || !boundedString(value),
    )
  )
    throw new Error("Invalid container environment");
  if (!Array.isArray(ports) || ports.length > 128)
    throw new Error("Invalid container ports");
  const validPort = (value) =>
    Number.isInteger(value) && value > 0 && value <= 65535;
  const publications = ports.map((value) => {
    const port = typeof value === "number" ? { containerPort: value } : value;
    if (
      !port ||
      !validPort(port.containerPort) ||
      (port.hostPort !== undefined && !validPort(port.hostPort)) ||
      ![undefined, "tcp", "udp"].includes(port.protocol) ||
      Object.keys(port).some(
        (key) => !["containerPort", "hostPort", "protocol"].includes(key),
      )
    )
      throw new Error(
        "Ports require a container port and optional loopback host port/protocol",
      );
    return { ...port, protocol: port.protocol ?? "tcp" };
  });
  if (
    new Set(
      publications.map((port) => `${port.containerPort}/${port.protocol}`),
    ).size !== publications.length
  )
    throw new Error("Duplicate container port publication");
  if (
    networkId !== undefined &&
    (typeof networkId !== "string" || !/^[a-f0-9]{64}$/.test(networkId))
  )
    throw new Error("Explicit network requires an exact Docker ID");
  return { image, command, environment, publications, volumeMounts, networkId };
}

// Creates fixtures using the Docker CLI alone. All IDs and image-declared
// storage are reserved and captured in the canonical source-workspace record.
export async function startDockerContainer(
  configuration,
  {
    manager: coordinator = manager,
    getContext = environmentContext,
    disposeAllocations = disposeDockerAllocations,
  } = {},
) {
  const config = containerConfiguration(configuration);
  const context = requireContext(getContext);
  await coordinator.context(context);
  const provider = await coordinator.docker.identity();
  const image = await validateTaskImage({
    manager: coordinator,
    context,
    provider,
    image: config.image,
  });
  const network = await executionNetwork(
    coordinator,
    context,
    config.networkId,
  );
  const { entry, labels } = await coordinator.reserve(
    context,
    "container",
    provider,
    [network.id],
  );
  const allocated = await prepareContainerVolumes({
    manager: coordinator,
    context,
    provider,
    parent: entry,
    image: image.id,
    volumeMounts: config.volumeMounts,
  });
  const id = await coordinator.docker.command(
    [
      "container",
      "create",
      "--network",
      network.locator.id,
      ...labelArguments(labels),
      ...Object.entries(config.environment).flatMap(([key, value]) => [
        "--env",
        `${key}=${value}`,
      ]),
      ...config.publications.flatMap((port) => [
        "--publish",
        `127.0.0.1:${port.hostPort ?? ""}:${port.containerPort}/${port.protocol}`,
      ]),
      ...allocated.mounts.flatMap((mount) => [
        "--mount",
        `type=volume,source=${mount.source},target=${mount.target}${mount.mode === "ro" ? ",readonly" : ""}`,
      ]),
      image.id,
      ...config.command,
    ],
    provider.endpoint,
  );
  if (!/^[a-f0-9]{64}$/.test(id))
    throw new Error("Docker did not return an exact container ID");
  // Docker can leave NetworkID empty until start. The pending labelled
  // reservation remains recoverable if creation or start is interrupted.
  await coordinator.docker.command(
    ["container", "start", id],
    provider.endpoint,
  );
  const actual = await coordinator.captureDocker(context, entry.id, id);
  if (!actual) throw new Error("Started fixture container is unavailable");
  requireLoopbackPublications(actual);
  const mappedPort = (port, protocol = "tcp") => {
    if (
      !Number.isInteger(port) ||
      port < 1 ||
      port > 65535 ||
      !["tcp", "udp"].includes(protocol)
    )
      throw new Error("Invalid mapped port lookup");
    const binding = actual.ports?.[`${port}/${protocol}`]?.[0];
    if (!binding) throw new Error("Container port has no verified publication");
    return Number(binding.HostPort);
  };
  for (const port of config.publications)
    mappedPort(port.containerPort, port.protocol);
  const stop = async (options = {}) => {
    if (
      !options ||
      typeof options !== "object" ||
      Array.isArray(options) ||
      Object.keys(options).some(
        (key) => !["remove", "removeVolumes"].includes(key),
      ) ||
      Object.values(options).some((value) => typeof value !== "boolean")
    )
      throw new Error("Invalid container stop options");
    if (options.remove === false) {
      const manifest = await readManifest(context);
      const recorded = manifest.resources.find((item) => item.id === entry.id);
      const status = await coordinator.docker.verify(
        recorded,
        ownershipLabels(context, manifest, recorded),
      );
      if (recorded.state === "removed" && status.state !== "absent")
        throw new Error(
          "Removed container reappeared; preserve its identity evidence",
        );
      if (status.state === "present")
        await coordinator.docker.command(
          ["container", "stop", id],
          provider.endpoint,
        );
      return;
    }
    await disposeAllocations(
      context,
      [
        entry.id,
        ...(options.removeVolumes === false
          ? []
          : allocated.entries.map((item) => item.id)),
      ],
      { manager: coordinator },
    );
  };
  return {
    getId: () => id,
    getHost: () => "127.0.0.1",
    getMappedPort: mappedPort,
    stop,
    [Symbol.asyncDispose]: stop,
  };
}

export async function startDockerNetwork({
  manager: coordinator = manager,
  getContext = environmentContext,
  disposeAllocations = disposeDockerAllocations,
} = {}) {
  const context = requireContext(getContext);
  await coordinator.context(context);
  const provider = await coordinator.docker.identity();
  const { entry, labels } = await coordinator.reserve(
    context,
    "network",
    provider,
  );
  const name = `ai-${entry.id}`;
  const id = await coordinator.docker.command(
    [
      "network",
      "create",
      "--driver",
      "bridge",
      "--opt",
      `${bindingOption}=127.0.0.1`,
      ...labelArguments(labels),
      name,
    ],
    provider.endpoint,
  );
  const actual = await coordinator.captureDocker(context, entry.id, id);
  if (!loopbackNetwork(actual))
    throw new Error("Task network loopback binding is unverified");
  const stop = async () =>
    disposeAllocations(context, [entry.id], { manager: coordinator });
  return {
    getId: () => id,
    getName: () => name,
    stop,
    [Symbol.asyncDispose]: stop,
  };
}

export async function prepareTrackedImage(
  tag,
  {
    manager: coordinator = manager,
    getContext = environmentContext,
    disposeAllocations = disposeDockerAllocations,
  } = {},
) {
  const context = getContext();
  if (!context) return { labels: {}, complete: async () => undefined };
  await coordinator.context(context);
  const separator = typeof tag === "string" ? tag.lastIndexOf(":") : -1;
  if (
    typeof tag !== "string" ||
    !/^[a-zA-Z0-9][a-zA-Z0-9._/:-]{0,255}$/.test(tag) ||
    separator <= tag.lastIndexOf("/") ||
    !/^[a-zA-Z0-9_][a-zA-Z0-9_.-]{0,127}$/.test(tag.slice(separator + 1))
  )
    throw new Error(
      "An explicit task image tag is required, such as name:latest",
    );
  const provider = await coordinator.docker.identity();
  // Refuse overwriting an existing tag, including a previous task's image.
  const images = await coordinator.docker.list("image", provider, [
    `reference=${tag}`,
  ]);
  if (images.length)
    throw new Error(
      "Task image tag already exists; use a unique allocation tag",
    );
  const { entry, labels } = await coordinator.reserve(
    context,
    "image",
    provider,
    [],
    { expectedTags: [tag] },
  );
  return {
    labels,
    dispose: async () => {
      const result = await disposeAllocations(context, [entry.id], {
        manager: coordinator,
      });
      if (result.preserved.length)
        throw new Error(
          "Task image is shared; preserve the image and JSON evidence",
        );
    },
    complete: async () => {
      const ids = await coordinator.docker.list("image", provider, [
        `reference=${tag}`,
      ]);
      if (ids.length !== 1)
        throw new Error("Task build did not produce exactly one image");
      await coordinator.captureDocker(context, entry.id, ids[0], {
        tags: [tag],
      });
    },
  };
}

export { trackedCompose } from "./compose.mjs";
