import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import {
  mkdtemp,
  mkdir,
  readFile,
  realpath,
  rm,
  stat,
  symlink,
  writeFile,
} from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { trackedCompose } from "./compose.mjs";

// The Compose provider is fake; real temporary files exercise canonical artifact
// placement and privacy without allocating containers or depending on a product.
async function fixture(
  t,
  {
    portFree = false,
    failStartup = false,
    failBuild = false,
    imageDeclaredVolumes = null,
    builtDeclaredVolumes = null,
    onBuild,
    workspaceName,
    projectDirectoryName = "Mixed Project.Tools",
  } = {},
) {
  let workspace = await realpath(
    await mkdtemp(path.join(os.tmpdir(), "resource-compose-")),
  );
  const temporaryRoot = workspace;
  t.after(() => rm(temporaryRoot, { recursive: true, force: true }));
  if (workspaceName) {
    workspace = path.join(workspace, workspaceName);
    await mkdir(workspace);
  }
  const directory = path.join(workspace, projectDirectoryName);
  await mkdir(directory, { recursive: true });
  const artifacts = path.join(workspace, ".ai/artifacts/compose-task");
  await mkdir(artifacts, { recursive: true });
  const context = {
    workspace,
    plan: ".ai/plans/compose-task.md",
    executionId: "execution-id",
  };
  const secret = "compose-config-private-marker";
  const runtime = {
    PUBLIC_URL: "https://caller.example.test/published-path",
    CACHE_ENDPOINT: "cache:6379",
    PRIVATE_TOKEN: secret,
  };
  const config = {
    services: {
      "service-a": {
        build: { context: directory, tags: ["outside-image:shared"] },
        environment: runtime,
        ports: portFree
          ? []
          : [{ target: 8080, published: "8080", host_ip: "0.0.0.0" }],
      },
      cache: {
        image: "generic-cache:fixture",
        ports: portFree ? [] : [{ target: 6379, protocol: "udp" }],
      },
      "Worker.B": {
        build: { context: directory },
        environment: { ...runtime },
      },
    },
    volumes: { cache_data: {} },
    networks: { default: {} },
  };
  const records = [];
  const events = [];
  const checkedImages = new Map();
  const provider = {
    type: "docker",
    endpoint: "unix:///fixture.sock",
    daemonId: "fixture",
  };
  const execution = { root: workspace, mode: "main" };
  const manager = {
    context: async () => ({
      manifest: { taskId: "task-id", resources: records },
      execution,
    }),
    async reserve(_context, kind, _provider, dependencies, metadata) {
      assert.deepEqual(dependencies, []);
      assert.deepEqual(
        Object.keys(metadata).sort(),
        kind === "image" ? ["compose", "expectedTags"] : ["compose"],
      );
      if (kind === "image")
        assert.match(metadata.expectedTags[0], /^ai-[a-z0-9_.-]+:task$/);
      assert.equal(metadata.compose.directory, directory);
      events.push({ type: "reserve", kind });
      const entry = {
        id: `entry-${records.length}`,
        executionId: context.executionId,
        kind,
        state: "pending",
        ...metadata,
      };
      records.push(entry);
      return {
        entry,
        labels: {
          "ai.resource": entry.id,
          "ai.task": "task-id",
          "ai.execution": context.executionId,
          "ai.workspace": workspace,
        },
      };
    },
    docker: {
      identity: async () => provider,
      verifyIdentity: async () => {},
      async verify(entry) {
        events.push({ type: "verify", id: entry.id, kind: entry.kind });
        return { state: "present" };
      },
      async discover(entry) {
        events.push({ type: "capture", kind: entry.kind });
        const started = events.some((event) => event.type === "up");
        const built =
          entry.kind === "image" &&
          events.some((event) => event.type === "build");
        return built ||
          (started && (!failStartup || entry.id === records[0].id))
          ? [`native-${entry.id}`]
          : [];
      },
    },
    async captureDocker(_context, id, nativeId) {
      const entry = records.find((entry) => entry.id === id);
      entry.state = "present";
      entry.locator =
        entry.kind === "volume" ? { name: nativeId } : { id: nativeId };
      events.push({ type: "captured", id, nativeId });
    },
  };
  const files = [
    path.join(directory, "custom-compose.yaml"),
    path.join(directory, "local-override.yaml"),
  ];
  for (const file of files) await writeFile(file, "# Caller configuration\n");
  const options = {
    directory,
    files,
    environment: { PRIVATE_TOKEN: secret },
  };
  const dependencies = {
    manager,
    getContext: () => context,
    readRecord: async () => ({ taskId: "task-id", resources: records }),
    async disposeAllocations(actualContext, ids, { manager: actualManager }) {
      assert.equal(actualContext, context);
      assert.equal(actualManager, manager);
      events.push({ type: "dispose", ids });
      return { removed: ids, preserved: [] };
    },
    async validateImage(actual) {
      assert.equal(actual.manager, manager);
      assert.equal(actual.context, context);
      assert.equal(actual.provider, provider);
      events.push({ type: "image-policy", image: actual.image });
      const id = `sha256:${createHash("sha256").update(actual.image).digest("hex")}`;
      checkedImages.set(id, actual.image);
      return { id };
    },
    createDocker({ environment }) {
      assert.equal(environment.PRIVATE_TOKEN, secret);
      return {
        async command(args, endpoint, commandOptions) {
          assert.equal(endpoint, provider.endpoint);
          if (args[0] === "image") {
            assert.deepEqual(args.slice(0, 4), [
              "image",
              "inspect",
              "--format",
              "{{json .Config.Volumes}}",
            ]);
            assert.match(args[4], /^sha256:[a-f0-9]{64}$/);
            events.push({ type: "inspect-volumes", image: args[4] });
            const built = records.some((entry) =>
              entry.expectedTags?.includes(checkedImages.get(args[4])),
            );
            return JSON.stringify(
              built ? builtDeclaredVolumes : imageDeclaredVolumes,
            );
          }
          assert.equal(
            args[args.indexOf("--project-directory") + 1],
            directory,
          );
          const configuredFiles = args.flatMap((arg, index) =>
            arg === "--file" ? [args[index + 1]] : [],
          );
          const configAt = args.indexOf("config");
          if (configAt >= 0) {
            assert.deepEqual(configuredFiles, files);
            assert.equal(commandOptions, undefined);
            events.push({ type: "config", args });
            if (args.includes("--services"))
              return Object.keys(config.services).join("\n");
            if (args.includes("--volumes"))
              return Object.keys(config.volumes ?? {}).join("\n");
            return JSON.stringify(config);
          }
          const operation = args.includes("build") ? "build" : "up";
          assert.ok(
            args.includes(operation),
            "only build or startup is allowed",
          );
          assert.equal(commandOptions?.timeoutMs, 600_000);
          events.push({
            type: operation,
            args: args.slice(args.indexOf(operation)),
            source: await readFile(configuredFiles.at(-1), "utf8"),
            input: commandOptions?.input,
            files: configuredFiles,
          });
          if (operation === "build" && onBuild)
            await onBuild({ config, files, environment });
          if (operation === "build" && failBuild)
            throw new Error("Simulated build failure");
          if (operation === "up" && failStartup)
            throw new Error("Simulated startup failure");
          return "";
        },
      };
    },
  };
  return {
    workspace,
    artifacts,
    directory,
    context,
    options,
    dependencies,
    records,
    events,
    secret,
    config,
    execution,
  };
}

test("delegated Compose providers refuse before image resolution or reservations", async (t) => {
  for (const provider of [
    { type: "remote-plugin", options: { capability: "database" } },
    {},
    null,
  ]) {
    const f = await fixture(t);
    delete f.config.services.cache.image;
    f.config.services.cache.provider = provider;
    await assert.rejects(
      trackedCompose(f.options, f.dependencies),
      /delegated provider/,
    );
    assert.deepEqual(f.records, []);
    assert.ok(f.events.every((event) => event.type === "config"));
  }
});

test("first Compose startup revalidates reservations after its build completes", async (t) => {
  const f = await fixture(t, {
    onBuild: () => {
      for (const entry of f.records)
        if (entry.kind !== "image") entry.state = "removed";
    },
  });
  const tracking = await trackedCompose(f.options, f.dependencies);
  await assert.rejects(tracking.up(), /fresh allocation/);
  assert.equal(f.events.filter((event) => event.type === "build").length, 1);
  assert.equal(
    f.events.some((event) => event.type === "up"),
    false,
  );
  assert.ok(
    f.records
      .filter((entry) => entry.kind === "image")
      .every((entry) => entry.state === "present"),
  );
  assert.ok(
    f.records
      .filter((entry) => entry.kind !== "image")
      .every((entry) => entry.state === "removed"),
  );
});

test("repeat Compose startup refuses absent captured resources before recreating identities", async (t) => {
  for (const kind of ["container", "network", "volume", "image"]) {
    const f = await fixture(t);
    const tracking = await trackedCompose(f.options, f.dependencies);
    await tracking.up();
    const before = structuredClone(f.records);
    f.dependencies.manager.docker.verify = async (entry) => ({
      state: entry.kind === kind ? "absent" : "present",
    });
    await assert.rejects(tracking.up(), /fresh.*allocation/i);
    assert.deepEqual(f.records, before);
    assert.equal(f.events.filter((event) => event.type === "up").length, 1);
    assert.equal(f.events.filter((event) => event.type === "build").length, 1);
  }
});

test("execution containment ignores worktree-named ancestors outside the execution root", async (t) => {
  const f = await fixture(t, { workspaceName: ".worktrees" });
  const tracking = await trackedCompose(f.options, f.dependencies);
  await tracking.up();
  assert.ok(f.records.every((entry) => entry.state === "present"));
});

test("direct Compose API permits a valid worktree and revalidates unchanged startup", async (t) => {
  const f = await fixture(t, {
    projectDirectoryName: ".worktrees/current/project",
  });
  f.execution.root = path.join(f.workspace, ".worktrees", "current");
  f.execution.mode = "worktree";
  const tracking = await trackedCompose(f.options, f.dependencies);
  await tracking.up();
  const before = structuredClone(f.records);
  await tracking.up();
  assert.deepEqual(f.records, before);
  assert.deepEqual(
    new Set(
      f.events
        .filter((event) => event.type === "verify")
        .map((event) => event.kind),
    ),
    new Set(["container", "image", "network", "volume"]),
  );
  assert.equal(f.events.filter((event) => event.type === "build").length, 1);
});

test("direct Compose API rejects wrong execution roots and unsafe files before provisioning", async (t) => {
  for (const scenario of [
    "primary-from-worktree",
    "outside-file",
    "other-worktree",
    "file-link",
    "parent-link",
  ]) {
    const f = await fixture(t);
    if (scenario === "primary-from-worktree") {
      f.execution.root = path.join(f.workspace, ".worktrees", "current");
      f.execution.mode = "worktree";
      await mkdir(f.execution.root, { recursive: true });
    } else if (scenario === "outside-file") {
      f.execution.root = f.directory;
      f.options.files = [path.join(f.workspace, "outside.yaml")];
      await writeFile(f.options.files[0], "services: {}\n");
    } else if (scenario === "other-worktree") {
      const other = path.join(f.workspace, ".worktrees", "another");
      await mkdir(other, { recursive: true });
      f.options.files = [path.join(other, "compose.yaml")];
      await writeFile(f.options.files[0], "services: {}\n");
    } else if (scenario === "file-link") {
      const link = path.join(f.directory, "linked.yaml");
      await symlink(f.options.files[0], link);
      f.options.files = [link];
    } else {
      const link = path.join(f.directory, "linked");
      await symlink(f.directory, link);
      f.options.files = [path.join(link, "custom-compose.yaml")];
    }
    await assert.rejects(trackedCompose(f.options, f.dependencies));
    assert.deepEqual(f.records, []);
    assert.deepEqual(f.events, []);
  }
});

test("generated Compose ownership values escape literal dollars through build and startup", async (t) => {
  const f = await fixture(t, { workspaceName: "$HOME-${UNSET_LITERAL}-$$" });
  const tracking = await trackedCompose(f.options, f.dependencies);
  const expected = f.workspace.replaceAll("$", () => "$$");
  const initial = await readFile(tracking.overlayFile, "utf8");
  assert.ok(initial.includes(JSON.stringify(expected)));
  await tracking.up();
  for (const event of f.events.filter((item) =>
    ["build", "up"].includes(item.type),
  )) {
    assert.ok(event.source.includes(JSON.stringify(expected)));
    assert.ok(!event.source.includes(JSON.stringify(f.workspace)));
  }
});

test("generic primary-directory Compose isolates resources and preserves caller configuration", async (t) => {
  const f = await fixture(t);
  const originalConfiguration = structuredClone(f.config);
  const tracking = await trackedCompose(f.options, f.dependencies);
  assert.equal(path.dirname(tracking.overlayFile), f.artifacts);
  assert.equal((await stat(tracking.overlayFile)).mode & 0o777, 0o600);
  assert.ok(
    f.records.every((entry) => entry.compose.project === tracking.project),
  );
  assert.ok(
    f.events
      .filter((event) => event.type === "config")
      .every(
        (event) =>
          event.args[event.args.indexOf("--project-name") + 1] ===
          "mixed-project-tools",
      ),
  );
  const source = await readFile(tracking.overlayFile, "utf8");
  assert.ok(source.includes('"host_ip":"127.0.0.1"'));
  assert.ok(source.includes('"published":"0"'));
  assert.ok(source.includes('"protocol":"udp"'));
  assert.ok(source.includes('"ai.task":"task-id"'));
  assert.ok(source.includes(`${tracking.project}_cache_data`));
  assert.ok(source.includes(`${tracking.project}_default`));
  assert.ok(source.includes('"Worker.B":'));
  assert.ok(source.includes("tags: !override []"));
  assert.ok(!source.includes("outside-image:shared"));
  const imageReservations = f.records.filter((entry) => entry.kind === "image");
  assert.equal(imageReservations.length, 2);
  assert.equal(
    new Set(imageReservations.map((entry) => entry.expectedTags[0])).size,
    2,
  );
  for (const image of imageReservations)
    assert.ok(source.includes(image.expectedTags[0]));
  await tracking.up();
  assert.deepEqual(f.config, originalConfiguration);
  assert.deepEqual(
    f.events.filter((event) => event.type === "up").map((event) => event.args),
    [
      [
        "up",
        "--no-build",
        "--pull",
        "never",
        "--wait",
        "--wait-timeout",
        "240",
      ],
    ],
  );
  const finalSource = await readFile(tracking.overlayFile, "utf8");
  assert.equal(f.events.find((event) => event.type === "build").source, source);
  assert.equal(
    f.events.find((event) => event.type === "up").source,
    finalSource,
  );
  for (const image of imageReservations)
    assert.ok(!finalSource.includes(image.expectedTags[0]));
  assert.ok(finalSource.includes('image: "sha256:'));
  for (const privateOrCallerValue of [
    f.secret,
    "environment:",
    "PUBLIC_URL",
    "CACHE_ENDPOINT",
    "caller.example.test",
  ])
    assert.ok(
      !source.includes(privateOrCallerValue) &&
        !finalSource.includes(privateOrCallerValue),
    );
  assert.ok(f.records.every((entry) => entry.state === "present"));
  assert.ok(!JSON.stringify(f.records).includes(f.secret));
  await tracking.dispose();
  assert.deepEqual(
    f.events.find((event) => event.type === "dispose").ids,
    f.records.map((entry) => entry.id),
  );
  await assert.rejects(readFile(tracking.overlayFile), { code: "ENOENT" });
});

test("startup uses the resolved private snapshot despite source and environment changes", async (t) => {
  let revision = 0;
  const mutate = async ({ config, files, environment }) => {
    config.services[`unreserved-${++revision}`] = { image: "outside:changed" };
    config.volumes.unreserved_data = {};
    config.services.cache.volumes = [
      { type: "volume", source: "unreserved_data", target: "/cache" },
    ];
    config.services["service-a"].environment.PRIVATE_TOKEN =
      `changed-after-preflight-${revision}`;
    environment.PRIVATE_TOKEN = `changed-child-environment-${revision}`;
    for (const file of files)
      await writeFile(
        file,
        "services:\n  unreserved:\n    image: outside:changed\n",
      );
  };
  const f = await fixture(t, { onBuild: mutate });
  const expected = JSON.stringify(f.config);
  const tracking = await trackedCompose(f.options, f.dependencies);
  await mutate({
    config: f.config,
    files: f.options.files,
    environment: f.options.environment,
  });
  await tracking.up();
  assert.equal(revision, 2);
  const allocations = f.events.filter(
    (event) => event.type === "build" || event.type === "up",
  );
  assert.equal(allocations.length, 2);
  for (const operation of allocations) {
    assert.equal(operation.input, expected);
    assert.deepEqual(operation.files, ["-", tracking.overlayFile]);
    assert.ok(!operation.source.includes(f.secret));
    assert.ok(!operation.source.includes("unreserved"));
  }
  assert.ok(!JSON.stringify(f.records).includes(f.secret));
  assert.ok(!(await readFile(tracking.overlayFile, "utf8")).includes(f.secret));
  await tracking.dispose();
});

test("image-declared anonymous volumes are refused before reservations", async (t) => {
  const f = await fixture(t, { imageDeclaredVolumes: { "/cache": {} } });
  await assert.rejects(
    trackedCompose(f.options, f.dependencies),
    /image-declared volumes require explicit mounts/,
  );
  assert.deepEqual(f.records, []);
  assert.equal(
    f.events.some((event) => event.type === "up" || event.type === "build"),
    false,
  );
});

test("explicit named and bind mounts cover image-declared volumes without implicit allocation", async (t) => {
  for (const mount of [
    { type: "volume", source: "cache_data", target: "/cache" },
    { type: "bind", source: "/caller-owned", target: "/cache" },
  ]) {
    const f = await fixture(t, { imageDeclaredVolumes: { "/cache": {} } });
    f.config.services.cache.volumes = [mount];
    const tracking = await trackedCompose(f.options, f.dependencies);
    await tracking.up();
    assert.equal(f.events.filter((event) => event.type === "up").length, 1);
    assert.deepEqual(f.config.services.cache.volumes, [mount]);
    await tracking.dispose();
  }
});

test("built image volumes are inspected after tracked build and refused before container startup", async (t) => {
  const f = await fixture(t, { builtDeclaredVolumes: { "/build-data": {} } });
  const tracking = await trackedCompose(f.options, f.dependencies);
  await assert.rejects(
    tracking.up(),
    /image-declared volumes require explicit mounts/,
  );
  assert.equal(f.events.filter((event) => event.type === "build").length, 1);
  assert.equal(
    f.events.some((event) => event.type === "up"),
    false,
  );
  assert.ok(
    f.records
      .filter((entry) => entry.kind === "image")
      .every((entry) => entry.state === "present"),
  );
  assert.ok(
    f.records
      .filter((entry) => entry.kind !== "image")
      .every((entry) => entry.state === "pending"),
  );
  assert.ok(await readFile(tracking.overlayFile, "utf8"));
  await tracking.dispose();
});

test("failed tracked build captures images without starting containers", async (t) => {
  const f = await fixture(t, { failBuild: true });
  const tracking = await trackedCompose(f.options, f.dependencies);
  await assert.rejects(tracking.up(), /Simulated build failure/);
  assert.equal(
    f.events.some((event) => event.type === "up"),
    false,
  );
  assert.ok(
    f.records
      .filter((entry) => entry.kind === "image")
      .every((entry) => entry.state === "present"),
  );
  await tracking.dispose();
});

test("partial build retries refuse before replacing captured images and require fresh reservations", async (t) => {
  const f = await fixture(t, { failBuild: true });
  const discover = f.dependencies.manager.docker.discover;
  f.dependencies.manager.docker.discover = async (entry) => {
    const firstImage = f.records.find((record) => record.kind === "image");
    if (entry.kind === "image" && entry.id !== firstImage.id) return [];
    return discover(entry);
  };
  const tracking = await trackedCompose(f.options, f.dependencies);
  await assert.rejects(tracking.up(), /Simulated build failure/);
  const images = f.records.filter((entry) => entry.kind === "image");
  assert.deepEqual(
    images.map((entry) => entry.state),
    ["present", "pending"],
  );
  const before = structuredClone(f.records);
  const overlay = await readFile(tracking.overlayFile, "utf8");
  await writeFile(
    path.join(f.directory, "Dockerfile"),
    "# Corrected build input\n",
  );
  await assert.rejects(tracking.up(), /fresh.*allocation/i);
  assert.deepEqual(f.records, before);
  assert.equal(await readFile(tracking.overlayFile, "utf8"), overlay);
  assert.equal(f.events.filter((event) => event.type === "build").length, 1);
  assert.equal(
    f.events.some((event) => event.type === "up"),
    false,
  );
  await tracking.dispose();
  const fresh = await trackedCompose(f.options, f.dependencies);
  const newImages = f.records
    .slice(before.length)
    .filter((entry) => entry.kind === "image");
  assert.equal(newImages.length, images.length);
  assert.ok(
    newImages.every(
      (entry) =>
        !images.some(
          (old) =>
            old.id === entry.id ||
            old.expectedTags[0] === entry.expectedTags[0],
        ),
    ),
  );
  await fresh.dispose();
});

test("covered built-image volumes start only inspected image IDs and keep named-volume ownership", async (t) => {
  const f = await fixture(t, { builtDeclaredVolumes: { "/build-data": {} } });
  for (const service of ["service-a", "Worker.B"])
    f.config.services[service].volumes = [
      { type: "volume", source: "cache_data", target: "/build-data" },
    ];
  const tracking = await trackedCompose(f.options, f.dependencies);
  await tracking.up();
  const buildAt = f.events.findIndex((event) => event.type === "build");
  const upAt = f.events.findIndex((event) => event.type === "up");
  assert.ok(buildAt > 0 && upAt > buildAt);
  assert.equal(
    f.events.filter((event) => event.type === "inspect-volumes").length,
    3,
  );
  assert.ok(
    f.events
      .slice(buildAt + 1, upAt)
      .filter((event) => event.type === "image-policy")
      .every((event) =>
        f.records.some(
          (entry) =>
            entry.expectedTags?.includes(event.image) &&
            entry.state === "present",
        ),
      ),
  );
  const source = await readFile(tracking.overlayFile, "utf8");
  assert.equal((source.match(/image: "sha256:/g) ?? []).length, 3);
  assert.ok(source.includes('"ai.resource":'));
  await tracking.up();
  assert.equal(f.events.filter((event) => event.type === "build").length, 1);
  await tracking.dispose();
});

test("explicit project and port-free service configuration keep generic startup and capture", async (t) => {
  const f = await fixture(t, { portFree: true });
  f.options.project = "caller-project";
  const tracking = await trackedCompose(f.options, f.dependencies);
  assert.ok(
    f.events
      .filter((event) => event.type === "config")
      .every(
        (event) =>
          event.args[event.args.indexOf("--project-name") + 1] ===
          "caller-project",
      ),
  );
  await tracking.up();
  assert.ok(
    (await readFile(tracking.overlayFile, "utf8")).includes(
      "ports: !override []",
    ),
  );
  assert.equal(f.events.filter((event) => event.type === "up").length, 1);
  assert.ok(f.events.some((event) => event.type === "captured"));
});

test("failed generic startup retains partial allocation evidence and credential-free overlay", async (t) => {
  const f = await fixture(t, { failStartup: true });
  const tracking = await trackedCompose(f.options, f.dependencies);
  await assert.rejects(tracking.up(), /Simulated startup failure/);
  assert.equal(f.records[0].state, "present");
  assert.ok(
    f.records
      .slice(1)
      .every(
        (entry) =>
          entry.state === (entry.kind === "image" ? "present" : "pending"),
      ),
  );
  assert.ok(!(await readFile(tracking.overlayFile, "utf8")).includes(f.secret));
  await tracking.dispose();
});

test("external resources, fixed identities and unregistered volumes fail before reservations or startup", async (t) => {
  const cases = [
    (config) => {
      config.volumes.cache_data.external = true;
    },
    (config) => {
      config.networks.default.external = true;
    },
    (config) => {
      config.networks.shared = {};
    },
    (config) => {
      config.services.cache.container_name = "shared-cache";
    },
    (config) => {
      config.services.cache.network_mode = "host";
    },
    (config) => {
      config.services.cache.volumes = [
        { type: "volume", source: "unregistered", target: "/cache" },
      ];
    },
    (config) => {
      config.services.cache.volumes = [{ type: "volume", target: "/cache" }];
    },
    (config) => {
      config.services.cache.volumes_from = ["container:existing"];
    },
    ...[0, 2].flatMap((count) => [
      (config) => {
        config.services.cache.scale = count;
      },
      (config) => {
        config.services.cache.deploy = { replicas: count };
      },
    ]),
  ];
  for (const change of cases) {
    const f = await fixture(t);
    change(f.config);
    await assert.rejects(
      trackedCompose(f.options, f.dependencies),
      /external|private default network|fixed container identities|one container per service/,
    );
    assert.deepEqual(f.records, []);
    assert.equal(
      f.events.some((event) => event.type === "up"),
      false,
    );
  }
});

test("image-only services apply shared image policy before reservations and pin exact native images", async (t) => {
  for (const image of ["public-base:fixture", "foreign-execution:task"]) {
    const f = await fixture(t);
    delete f.config.services["service-a"].build;
    f.config.services["service-a"].image = image;
    const checked = [];
    f.dependencies.validateImage = async (actual) => {
      checked.push(actual.image);
      if (actual.image === "foreign-execution:task")
        throw new Error("Task image belongs to another execution");
      return { id: `sha256:${"b".repeat(64)}` };
    };
    if (image === "foreign-execution:task") {
      await assert.rejects(
        trackedCompose(f.options, f.dependencies),
        /another execution/,
      );
      assert.equal(f.records.length, 0);
    } else {
      const tracking = await trackedCompose(f.options, f.dependencies);
      const source = await readFile(tracking.overlayFile, "utf8");
      assert.ok(source.includes(`image: "sha256:${"b".repeat(64)}"`));
      assert.ok(!source.includes(image));
      await tracking.up();
    }
    assert.equal(checked[0], image);
  }
});

test("canonical overlay paths and immutable startup refuse symlinks or changed content", async (t) => {
  const f = await fixture(t);
  const tracking = await trackedCompose(f.options, f.dependencies);
  await writeFile(tracking.overlayFile, "other allocation");
  await assert.rejects(tracking.up(), /overlay changed/);
  assert.equal(f.events.filter((event) => event.type === "up").length, 0);
  await tracking.dispose();
  assert.equal(
    await readFile(tracking.overlayFile, "utf8"),
    "other allocation",
  );
  const second = await fixture(t);
  await rm(second.artifacts, { recursive: true });
  await symlink(second.directory, second.artifacts);
  await assert.rejects(
    trackedCompose(second.options, second.dependencies),
    /Unsafe Compose resource path/,
  );
  const third = await fixture(t);
  const linked = await trackedCompose(third.options, third.dependencies);
  await rm(linked.overlayFile);
  await symlink(third.options.files[0], linked.overlayFile);
  await assert.rejects(linked.up(), /Unsafe Compose resource path/);
  assert.equal(third.events.filter((event) => event.type === "up").length, 0);
});

test("normal disposal binds every reservation and preserves overlay on ownership or shared-image refusal", async (t) => {
  for (const failure of ["ownership", "shared-image"]) {
    const f = await fixture(t);
    f.dependencies.disposeAllocations = async (actualContext, ids) => {
      assert.equal(actualContext, f.context);
      assert.deepEqual(
        ids,
        f.records.map((entry) => entry.id),
      );
      if (failure === "ownership") throw new Error("Ownership refused");
      return { removed: [], preserved: [{ entryId: ids.at(-1) }] };
    };
    const tracking = await trackedCompose(f.options, f.dependencies);
    await assert.rejects(
      tracking.dispose(),
      /Ownership refused|preserved shared task images/,
    );
    assert.ok(await readFile(tracking.overlayFile, "utf8"));
  }
});

test("image-only teardown binds only image reservations", async (t) => {
  const f = await fixture(t);
  const tracking = await trackedCompose(f.options, f.dependencies);
  await tracking.disposeImages();
  assert.deepEqual(
    f.events.find((event) => event.type === "dispose").ids,
    f.records
      .filter((entry) => entry.kind === "image")
      .map((entry) => entry.id),
  );
  await assert.rejects(readFile(tracking.overlayFile), { code: "ENOENT" });
});
