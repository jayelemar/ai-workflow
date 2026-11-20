import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { randomBytes, randomUUID } from "node:crypto";
import {
  lstat,
  mkdir,
  mkdtemp,
  readFile,
  realpath,
  rm,
  writeFile,
} from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import test from "node:test";
import { DockerProvider, ownershipLabels } from "./docker.mjs";
import { trackedCompose } from "./compose.mjs";
import { disposeDockerAllocations } from "./disposal.mjs";
import { ResourceManager, environmentContext } from "./manager.mjs";
import { parseManifest } from "./schema.mjs";
import {
  initExecution,
  readAllManifests,
  readManifest,
  updateManifest,
  withResourceLock,
} from "./store.mjs";

// Deletion authority crosses the real Git/context and atomic manifest boundary.
// Stateful providers replace only native operations, so these tests can prove
// reservation, confirmation, isolation and retry outcomes without deleting a
// developer's Docker objects or Simulator devices.
const git = (root, ...args) =>
  execFileSync("rtk", ["proxy", "git", "-C", root, ...args], {
    encoding: "utf8",
    stdio: ["ignore", "pipe", "pipe"],
    env: {
      PATH: process.env.PATH,
      GIT_CONFIG_NOSYSTEM: "1",
      GIT_CONFIG_GLOBAL: "/dev/null",
    },
  }).trim();
const clone = (value) => structuredClone(value);
const identity = (kind, actual) =>
  kind === "volume" ? actual.name : actual.id;
const artifact = (context) =>
  path.join(
    context.workspace,
    ".ai/artifacts",
    path.basename(context.plan, ".md"),
    "resources.json",
  );
async function put(root, relative, content) {
  const file = path.join(root, relative);
  await mkdir(path.dirname(file), { recursive: true });
  await writeFile(file, content);
}
async function initGit(root) {
  await mkdir(root, { recursive: true });
  git(root, "init", "-b", "main");
  await put(root, "baseline", "disposable fixture\n");
  git(root, "add", "baseline");
  git(
    root,
    "-c",
    "user.email=fixture@example.invalid",
    "-c",
    "user.name=Fixture",
    "-c",
    "core.hooksPath=/dev/null",
    "commit",
    "-m",
    "fixture",
  );
}
class FakeDocker extends DockerProvider {
  constructor() {
    super();
    this.provider = {
      type: "docker",
      endpoint: "unix:///private/tmp/resource-test.sock",
      daemonId: "disposable-test-daemon",
    };
    this.objects = new Map();
    this.failRemoval = new Set();
    this.unavailable = false;
  }
  async identity() {
    if (this.unavailable)
      throw new Error("Provider unavailable; resource state unverified");
    return clone(this.provider);
  }
  async list(kind, provider, filters = []) {
    await this.verifyIdentity(provider);
    return [...this.objects.values()]
      .filter(
        (object) =>
          object.kind === kind &&
          filters.every((filter) => {
            const [key, value] = filter.slice("label=".length).split("=");
            return object.labels?.[key] === value;
          }),
      )
      .map((object) => identity(kind, object));
  }
  async inspect(kind, id, provider) {
    await this.verifyIdentity(provider);
    return clone(this.objects.get(`${kind}:${id}`) ?? null);
  }
  async containers(provider) {
    await this.verifyIdentity(provider);
    return [...this.objects.values()]
      .filter((object) => object.kind === "container")
      .map(clone);
  }
  create(kind, labels, overrides = {}) {
    const hex = randomBytes(32).toString("hex");
    const object = {
      kind,
      id: kind === "image" ? `sha256:${hex}` : hex,
      name: `disposable-${hex}`,
      created: new Date().toISOString(),
      labels: clone(labels),
      mounts: [],
      binds: [],
      requestedMounts: [],
      declaredVolumes: {},
      containers: {},
      tags: [],
      ...overrides,
    };
    this.objects.set(`${kind}:${identity(kind, object)}`, object);
    return object;
  }
  async remove(entry) {
    await this.verifyIdentity(entry.provider);
    const id = entry.kind === "volume" ? entry.locator.name : entry.locator.id;
    if (this.failRemoval.has(id))
      throw new Error("Injected native removal failure");
    this.objects.delete(`${entry.kind}:${id}`);
  }
}
class FakeIOS {
  constructor() {
    this.provider = {
      type: "ios",
      deviceSet: "/private/tmp/disposable-resource-device-set",
    };
    this.devices = new Map();
    this.verifyErrors = new Map();
    this.beforeCreate = null;
    this.failCreate = false;
  }
  async identity() {
    return clone(this.provider);
  }
  async create(configuration, provider) {
    if (this.beforeCreate) await this.beforeCreate();
    if (this.failCreate) throw new Error("Simulator allocation interrupted");
    assert.deepEqual(provider, this.provider);
    const locator = {
      ...configuration,
      udid: randomUUID(),
      name: "iPhone 17 — iOS 26",
    };
    this.devices.set(locator.udid, { locator, booted: false });
    return clone(locator);
  }
  async verify(entry) {
    if (this.verifyErrors.has(entry.locator.udid))
      throw this.verifyErrors.get(entry.locator.udid);
    assert.deepEqual(entry.provider, this.provider);
    const actual = this.devices.get(entry.locator.udid);
    if (!actual) return { state: "absent" };
    if (
      actual.locator.deviceType !== entry.locator.deviceType ||
      actual.locator.runtime !== entry.locator.runtime
    )
      throw new Error("Simulator identity changed");
    return { state: "present", booted: actual.booted, dataBytes: null };
  }
  async remove(entry) {
    this.devices.delete(entry.locator.udid);
  }
}
async function fixture(t) {
  const workspace = await realpath(
    await mkdtemp(path.join(tmpdir(), "resource-manager-")),
  );
  t.after(() => rm(workspace, { recursive: true, force: true }));
  await initGit(path.join(workspace, ".ai"));
  await initGit(path.join(workspace, "app"));
  const plan = ".ai/plans/sample-task.md";
  await put(workspace, plan, "# Disposable task\n");
  const context = await initExecution({ workspace, plan });
  const docker = new FakeDocker();
  const ios = new FakeIOS();
  const manager = new ResourceManager({ docker, ios });
  return { workspace, plan, context, docker, ios, manager };
}
async function allocate(
  f,
  kind = "container",
  context = f.context,
  overrides = {},
) {
  const tags =
    kind === "image"
      ? (overrides.tags ?? [`task-fixture:${randomUUID()}`])
      : undefined;
  const { entry, labels } = await f.manager.reserve(
    context,
    kind,
    await f.docker.identity(),
    [],
    tags ? { expectedTags: tags } : {},
  );
  const object = f.docker.create(kind, labels, {
    ...(tags ? { tags } : {}),
    ...overrides,
  });
  await f.manager.captureDocker(context, entry.id, identity(kind, object));
  return { entry, object };
}
const simulatorConfiguration = {
  deviceType: "com.apple.CoreSimulator.SimDeviceType.iPhone-17",
  runtime: "com.apple.CoreSimulator.SimRuntime.iOS-26-0",
};

test("first Compose command refuses reconciled, released or changed-provider reservations", async (t) => {
  for (const build of [false, true]) {
    for (const change of ["reconciled", "released", "provider"]) {
      const f = await fixture(t);
      const directory = path.join(f.workspace, "app");
      const file = path.join(directory, "compose.yaml");
      await writeFile(file, "# Controlled Compose fixture\n");
      const config = {
        services: {
          app: build
            ? { build: { context: directory } }
            : { image: "fixture:public" },
        },
        networks: { default: {} },
      };
      const commands = [];
      const tracking = await trackedCompose(
        { directory, files: [file] },
        {
          manager: f.manager,
          getContext: () => f.context,
          validateImage: async () => ({ id: `sha256:${"f".repeat(64)}` }),
          createDocker: () => ({
            async command(args) {
              if (args.includes("config")) return JSON.stringify(config);
              if (args[0] === "image") return "null";
              const operation = args.includes("build") ? "build" : "up";
              commands.push(operation);
              const manifest = await readManifest(f.context);
              for (const entry of manifest.resources.filter((entry) =>
                operation === "build"
                  ? entry.kind === "image"
                  : ["container", "network"].includes(entry.kind),
              ))
                f.docker.create(
                  entry.kind,
                  ownershipLabels(f.context, manifest, entry),
                  entry.kind === "image" ? { tags: entry.expectedTags } : {},
                );
              return "";
            },
          }),
        },
      );
      if (change === "reconciled") await f.manager.reconcile(f.context);
      else if (change === "released") await f.manager.release(f.context);
      else f.docker.provider.daemonId = "replacement-daemon";
      const before = await readFile(artifact(f.context), "utf8");
      await assert.rejects(
        tracking.up(),
        /fresh allocation|released|identity changed/,
      );
      assert.deepEqual(commands, []);
      assert.equal(f.docker.objects.size, 0);
      assert.equal(await readFile(artifact(f.context), "utf8"), before);
    }
  }
});

test("locked file phase accepts only confirmed cleanup transitions and refuses a new inactive execution", async (t) => {
  const f = await fixture(t);
  await allocate(f);
  await f.manager.release(f.context);
  const preview = await f.manager.inventory(f.workspace, [f.plan]);
  const result = await f.manager.cleanup(preview, "PROCEED");
  await withResourceLock(f.workspace, async () => {
    const current = await f.manager.verifyFileCleanupUnlocked(preview, result);
    assert.ok(
      current.resources.every((resource) => resource.state === "absent"),
    );
  });
  const intervening = await initExecution({
    workspace: f.workspace,
    plan: f.plan,
  });
  await f.manager.release(intervening);
  let deleted = false;
  await assert.rejects(
    withResourceLock(f.workspace, async () => {
      await f.manager.verifyFileCleanupUnlocked(preview, result);
      deleted = true;
      await rm(path.join(f.workspace, f.plan));
    }),
    /changed after cleanup/,
  );
  assert.equal(deleted, false);
  assert.ok(await lstat(path.join(f.workspace, f.plan)));
  assert.equal((await readManifest(intervening)).executions.length, 2);
});

test("file cleanup refuses cancellation, incomplete results and resources appearing after the resource phase", async (t) => {
  const f = await fixture(t);
  await allocate(f);
  await f.manager.release(f.context);
  const preview = await f.manager.inventory(f.workspace, [f.plan]);
  const result = await f.manager.cleanup(preview, "PROCEED");
  for (const invalid of [
    { ...result, cancelled: true },
    { ...result, removed: [] },
    { ...result, preserved: [{}] },
  ])
    await assert.rejects(
      withResourceLock(f.workspace, () =>
        f.manager.verifyFileCleanupUnlocked(preview, invalid),
      ),
      /Complete confirmed/,
    );
  const current = await f.manager.resumeExecution({
    workspace: f.workspace,
    plan: f.plan,
    resume: f.context.executionId,
  });
  await f.manager.reserve(current, "network", await f.docker.identity());
  await f.manager.release(current);
  await assert.rejects(
    withResourceLock(f.workspace, () =>
      f.manager.verifyFileCleanupUnlocked(preview, result),
    ),
    /Unresolved resource creation/,
  );
  assert.ok(await lstat(path.join(f.workspace, f.plan)));
  assert.ok(await lstat(artifact(f.context)));
});

test("file phase holds the existing lock through record removal and later init cannot recreate evidence", async (t) => {
  const f = await fixture(t);
  const worktree = path.join(f.workspace, ".worktrees", "sample-task");
  await mkdir(path.dirname(worktree), { recursive: true });
  git(
    path.join(f.workspace, "app"),
    "worktree",
    "add",
    "-b",
    "file-phase-branch",
    worktree,
  );
  const worktreeContext = await initExecution({
    workspace: f.workspace,
    plan: f.plan,
    root: worktree,
  });
  await f.manager.release(worktreeContext);
  await f.manager.release(f.context);
  const preview = await f.manager.inventory(f.workspace, [f.plan]);
  const result = await f.manager.cleanup(preview, "PROCEED");
  await withResourceLock(f.workspace, async () => {
    await f.manager.verifyFileCleanupUnlocked(preview, result);
    await assert.rejects(
      withResourceLock(
        f.workspace,
        () => {
          throw new Error("writer entered file phase");
        },
        { waitMs: 0 },
      ),
      (error) => error.code === "RESOURCE_LOCK_BUSY",
    );
    git(path.join(f.workspace, "app"), "worktree", "remove", worktree);
    await f.manager.verifyFileCleanupUnlocked(preview, result);
    await rm(artifact(f.context));
    await rm(path.join(f.workspace, f.plan));
  });
  await assert.rejects(
    initExecution({ workspace: f.workspace, plan: f.plan }),
    { code: "ENOENT" },
  );
  await assert.rejects(lstat(artifact(f.context)), { code: "ENOENT" });
  assert.ok(await lstat(path.join(f.workspace, "app/baseline")));
  assert.match(
    git(path.join(f.workspace, "app"), "branch", "--list", "file-phase-branch"),
    /file-phase-branch/,
  );
  assert.doesNotMatch(
    git(path.join(f.workspace, "app"), "worktree", "list", "--porcelain"),
    /\.worktrees\/sample-task/,
  );
});

test("interrupted image reconciliation never adopts outside tags as task ownership", async (t) => {
  const f = await fixture(t);
  const missing = await f.manager.reserve(
    f.context,
    "image",
    await f.docker.identity(),
  );
  const unknown = f.docker.create("image", missing.labels, {
    tags: ["personal:keep"],
  });
  await assert.rejects(f.manager.reconcile(f.context), /expected image tags/);
  assert.equal((await readManifest(f.context)).resources[0].state, "pending");
  // Old pending records can be captured only with independently known tags.
  await f.manager.captureDocker(f.context, missing.entry.id, unknown.id, {
    tags: ["task-fixture:old"],
  });
  const reserved = await f.manager.reserve(
    f.context,
    "image",
    await f.docker.identity(),
    [],
    { expectedTags: ["task-fixture:new"] },
  );
  const object = f.docker.create("image", reserved.labels, {
    tags: ["task-fixture:new", "personal:alias"],
  });
  await assert.rejects(
    f.manager.captureDocker(f.context, reserved.entry.id, object.id, {
      tags: ["task-fixture:new", "personal:alias"],
    }),
    /reserved image tags/,
  );
  await f.manager.reconcile(f.context);
  const manifest = await readManifest(f.context);
  assert.deepEqual(manifest.resources[1].locator.tags, ["task-fixture:new"]);
  await f.manager.release(f.context);
  const preview = await f.manager.inventory(f.workspace, [f.plan]);
  assert.ok(preview.resources.every((entry) => entry.state === "preserved"));
  assert.equal((await f.manager.cleanup(preview, "PROCEED")).removed.length, 0);
  assert.ok(f.docker.objects.has(`image:${object.id}`));
  assert.ok(f.docker.objects.has(`image:${unknown.id}`));
});

test("image tag reservation metadata cannot authorize another resource kind", async (t) => {
  const f = await fixture(t);
  const before = await readFile(artifact(f.context), "utf8");
  await assert.rejects(
    f.manager.reserve(f.context, "network", await f.docker.identity(), [], {
      expectedTags: ["task-fixture:owned"],
    }),
    /only valid for image/,
  );
  assert.equal(await readFile(artifact(f.context), "utf8"), before);
});

test("resume verifies live ownership, availability and provider identity before activation", async (t) => {
  const cases = [
    [
      "changed daemon",
      async (f) => {
        await allocate(f);
        f.docker.provider.daemonId = "replacement-daemon";
      },
      /identity changed/,
    ],
    [
      "unavailable provider",
      async (f) => {
        await allocate(f);
        f.docker.unavailable = true;
      },
      /unavailable/,
    ],
    [
      "changed ownership",
      async (f) => {
        const { object } = await allocate(f);
        f.docker.objects.get(`container:${object.id}`).labels = {};
      },
      /Ownership mismatch/,
    ],
    [
      "external volume attachment",
      async (f) => {
        const { object } = await allocate(f, "volume");
        f.docker.create(
          "container",
          {},
          {
            mounts: [{ Type: "volume", Name: object.name }],
          },
        );
      },
      /another container/,
    ],
    [
      "shared image",
      async (f) => {
        const { object } = await allocate(f, "image");
        f.docker.objects.get(`image:${object.id}`).tags.push("personal:keep");
      },
      /not available/,
    ],
    [
      "busy Simulator",
      async (f) => {
        const locator = await f.manager.createSimulator(
          f.context,
          simulatorConfiguration,
        );
        f.ios.verifyErrors.set(
          locator.udid,
          Object.assign(new Error("Simulator busy"), { code: "DEVICE_BUSY" }),
        );
      },
      /busy/,
    ],
    [
      "invalid Simulator proof",
      async (f) => {
        const locator = await f.manager.createSimulator(
          f.context,
          simulatorConfiguration,
        );
        f.ios.verifyErrors.set(
          locator.udid,
          new Error("Simulator proof mismatch"),
        );
      },
      /proof mismatch/,
    ],
    [
      "changed device set",
      async (f) => {
        await f.manager.createSimulator(f.context, simulatorConfiguration);
        f.ios.provider.deviceSet = "/private/tmp/replacement-device-set";
      },
      /device set changed/,
    ],
  ];
  for (const [name, prepare, message] of cases)
    await t.test(name, async (t) => {
      const f = await fixture(t);
      await prepare(f);
      await f.manager.release(f.context);
      const before = await readFile(artifact(f.context), "utf8");
      await assert.rejects(
        f.manager.resumeExecution({
          workspace: f.workspace,
          plan: f.plan,
          resume: f.context.executionId,
        }),
        message,
      );
      assert.equal(await readFile(artifact(f.context), "utf8"), before);
      assert.equal((await readManifest(f.context)).executions[0].active, false);
    });
});

test("resume allows owned attachments and known absence without changing resource evidence", async (t) => {
  const f = await fixture(t);
  const volume = await allocate(f, "volume");
  const container = await allocate(f, "container", f.context, {
    mounts: [{ Type: "volume", Name: volume.object.name }],
  });
  const network = await allocate(f, "network", f.context, {
    containers: { [container.object.id]: {} },
  });
  f.docker.objects.delete(`network:${network.object.id}`);
  await f.manager.release(f.context);
  const resources = (await readManifest(f.context)).resources;
  assert.deepEqual(
    await f.manager.resumeExecution({
      workspace: f.workspace,
      plan: f.plan,
      resume: f.context.executionId,
    }),
    f.context,
  );
  assert.deepEqual((await readManifest(f.context)).resources, resources);
  assert.equal((await readManifest(f.context)).executions[0].active, true);
});

test("pending resume verifies the original provider and retains explicit reconciliation", async (t) => {
  const f = await fixture(t);
  const { entry, labels } = await f.manager.reserve(
    f.context,
    "network",
    await f.docker.identity(),
  );
  f.docker.create("network", labels);
  await f.manager.release(f.context);
  f.docker.provider.daemonId = "replacement-daemon";
  await assert.rejects(
    f.manager.resumeExecution({
      workspace: f.workspace,
      plan: f.plan,
      resume: f.context.executionId,
    }),
    /identity changed/,
  );
  assert.equal((await readManifest(f.context)).executions[0].active, false);
  f.docker.provider.daemonId = entry.provider.daemonId;
  await f.manager.resumeExecution({
    workspace: f.workspace,
    plan: f.plan,
    resume: f.context.executionId,
  });
  assert.equal((await readManifest(f.context)).resources[0].state, "pending");
  await f.manager.reconcile(f.context);
  assert.equal((await readManifest(f.context)).resources[0].state, "present");
});

test("new reservations reject changed historical providers even after resources are removed", async (t) => {
  for (const type of ["docker", "ios"])
    await t.test(type, async (t) => {
      const f = await fixture(t);
      const provider = type === "docker" ? f.docker : f.ios;
      const kind = type === "docker" ? "network" : "ios-simulator";
      await f.manager.reserve(f.context, kind, await provider.identity());
      await updateManifest(f.context, (manifest) => {
        manifest.resources[0].state = "removed";
      });
      if (type === "docker") provider.provider.daemonId = "replacement-daemon";
      else provider.provider.deviceSet = "/private/tmp/replacement-device-set";
      const before = await readFile(artifact(f.context), "utf8");
      await assert.rejects(
        f.manager.reserve(f.context, kind, await provider.identity()),
        /provider identity changed/,
      );
      assert.equal(await readFile(artifact(f.context), "utf8"), before);
      const fresh = await initExecution({
        workspace: f.workspace,
        plan: f.plan,
      });
      await f.manager.reserve(fresh, kind, await provider.identity());
      assert.equal((await readManifest(fresh)).resources.length, 2);
    });
});

test("Docker reservations persist before capture, record exact owned IDs and anonymous data volumes", async (t) => {
  const f = await fixture(t);
  const { entry, labels } = await f.manager.reserve(
    f.context,
    "container",
    await f.docker.identity(),
  );
  const reserved = (await readManifest(f.context)).resources[0];
  assert.equal(reserved.id, entry.id);
  assert.equal(reserved.state, "pending");
  assert.equal(reserved.locator, null);
  const anonymousName = randomBytes(32).toString("hex");
  const reservation = await f.manager.reserve(
    f.context,
    "volume",
    await f.docker.identity(),
    [entry.id],
  );
  const volume = f.docker.create("volume", reservation.labels, {
    name: anonymousName,
  });
  await f.manager.captureDocker(f.context, reservation.entry.id, volume.name);
  const object = f.docker.create("container", labels, {
    mounts: [
      { Type: "volume", Name: volume.name, Destination: "/data" },
      {
        Type: "bind",
        Source: "/private/tmp/preserved-host",
        Destination: "/host",
      },
    ],
    declaredVolumes: { "/data": {} },
  });
  await f.manager.captureDocker(f.context, entry.id, object.id);
  const manifest = await readManifest(f.context);
  assert.equal(manifest.resources.length, 2);
  assert.deepEqual(manifest.resources[0].locator, {
    id: object.id,
    created: object.created,
  });
  assert.deepEqual(manifest.resources[1].locator, {
    name: volume.name,
    created: volume.created,
    containerId: null,
  });
  assert.deepEqual(manifest.resources[1].dependencies, [entry.id]);
  assert.ok(
    manifest.resources.every((resource) => resource.state === "present"),
  );
  await f.manager.release(f.context);
  const preview = await f.manager.inventory(f.workspace, [f.plan]);
  await f.manager.cleanup(preview, "PROCEED");
  assert.equal(f.docker.objects.size, 0);
});

test("interrupted mounted-volume capture keeps the parent pending for reconciliation", async (t) => {
  const f = await fixture(t);
  const { entry, labels } = await f.manager.reserve(
    f.context,
    "container",
    await f.docker.identity(),
  );
  const volumeAllocation = await f.manager.reserve(
    f.context,
    "volume",
    await f.docker.identity(),
    [entry.id],
  );
  const volume = f.docker.create("volume", volumeAllocation.labels);
  await f.manager.captureDocker(
    f.context,
    volumeAllocation.entry.id,
    volume.name,
  );
  const object = f.docker.create("container", labels, {
    mounts: [{ Type: "volume", Name: volume.name, Destination: "/data" }],
  });
  const capture = f.manager.captureVolumes.bind(f.manager);
  f.manager.captureVolumes = async () => {
    throw new Error("Injected capture interruption");
  };
  await assert.rejects(
    f.manager.captureDocker(f.context, entry.id, object.id),
    /capture interruption/,
  );
  const interrupted = await readManifest(f.context);
  assert.equal(
    interrupted.resources.find((resource) => resource.id === entry.id).state,
    "pending",
  );
  f.manager.captureVolumes = capture;
  await f.manager.reconcile(f.context);
  assert.ok(
    (await readManifest(f.context)).resources.every(
      (resource) => resource.state === "present",
    ),
  );
  await f.manager.release(f.context);
  await f.manager.cleanup(
    await f.manager.inventory(f.workspace, [f.plan]),
    "PROCEED",
  );
  assert.equal(f.docker.objects.size, 0);
});

test("pending capture rejects replacement IDs and creation times without losing original evidence", async (t) => {
  for (const change of ["id", "created"]) {
    const f = await fixture(t);
    const { entry, labels } = await f.manager.reserve(
      f.context,
      "container",
      await f.docker.identity(),
    );
    const original = f.docker.create("container", labels);
    const capture = f.manager.captureVolumes.bind(f.manager);
    f.manager.captureVolumes = async () => {
      throw new Error("Injected capture interruption");
    };
    await assert.rejects(
      f.manager.captureDocker(f.context, entry.id, original.id),
      /capture interruption/,
    );
    const before = await readFile(artifact(f.context), "utf8");
    f.manager.captureVolumes = capture;
    f.docker.objects.delete(`container:${original.id}`);
    const replacement = f.docker.create(
      "container",
      labels,
      change === "id"
        ? {}
        : {
            id: original.id,
            created: "2020-01-01T00:00:00.000Z",
          },
    );
    await assert.rejects(
      f.manager.reconcile(f.context),
      /creation identity changed/,
    );
    await assert.rejects(
      f.manager.captureDocker(f.context, entry.id, replacement.id),
      /creation identity changed/,
    );
    assert.equal(await readFile(artifact(f.context), "utf8"), before);
    await f.manager.release(f.context);
    await assert.rejects(
      f.manager.inventory(f.workspace, [f.plan]),
      /Unresolved resource creation/,
    );
    assert.ok(
      await f.docker.inspect("container", replacement.id, f.docker.provider),
    );
  }
});

test("registration refuses unknown, unlabelled, and other-execution allocations", async (t) => {
  const f = await fixture(t);
  const other = await initExecution({ workspace: f.workspace, plan: f.plan });
  const { entry, labels } = await f.manager.reserve(
    f.context,
    "container",
    await f.docker.identity(),
  );
  const unowned = f.docker.create("container", {});
  await assert.rejects(
    f.manager.captureDocker(f.context, randomUUID(), unowned.id),
  );
  await assert.rejects(
    f.manager.captureDocker(f.context, entry.id, unowned.id),
  );
  assert.equal((await readManifest(f.context)).resources[0].state, "pending");
  const owned = f.docker.create("container", labels);
  await assert.rejects(f.manager.captureDocker(other, entry.id, owned.id));
  assert.equal((await readManifest(f.context)).resources[0].state, "pending");
  assert.equal(f.docker.objects.size, 2);
});

test("stopped containers with uninitialized networks recover for reconciliation and bound disposal", async (t) => {
  for (const route of ["reconcile", "dispose"]) {
    const f = await fixture(t);
    const network = await allocate(f, "network");
    const { entry, labels } = await f.manager.reserve(
      f.context,
      "container",
      f.docker.provider,
      [network.entry.id],
    );
    const object = f.docker.create("container", labels, {
      running: false,
      networkMode: network.object.id,
      networks: { private: { NetworkID: "" } },
    });
    if (route === "reconcile") {
      await f.manager.reconcile(f.context);
      const captured = (await readManifest(f.context)).resources.find(
        (item) => item.id === entry.id,
      );
      assert.equal(captured.state, "present");
      assert.deepEqual(captured.locator, {
        id: object.id,
        created: object.created,
      });
      await f.manager.release(f.context);
      await f.manager.cleanup(
        await f.manager.inventory(f.workspace, [f.plan]),
        "PROCEED",
      );
    } else {
      await disposeDockerAllocations(f.context, [entry.id, network.entry.id], {
        manager: f.manager,
      });
    }
    assert.equal(f.docker.objects.size, 0);
    assert.ok(
      (await readManifest(f.context)).resources.every(
        (item) => item.state === "removed",
      ),
    );
  }
});

test("uninitialized network capture refuses running, uncorroborated and foreign configurations", async (t) => {
  const f = await fixture(t);
  const network = await allocate(f, "network");
  for (const overrides of [
    { running: true, networkMode: network.object.id },
    { running: false, networkMode: "host" },
    { running: false, networkMode: "bridge" },
    { networkMode: network.object.id },
    {
      running: false,
      networkMode: network.object.id,
      networks: { other: { NetworkID: "f".repeat(64) } },
    },
  ]) {
    const { entry, labels } = await f.manager.reserve(
      f.context,
      "container",
      f.docker.provider,
      [network.entry.id],
    );
    const object = f.docker.create("container", labels, {
      networks: { private: { NetworkID: "" } },
      ...overrides,
    });
    const before = await readFile(artifact(f.context), "utf8");
    await assert.rejects(
      f.manager.captureDocker(f.context, entry.id, object.id),
      /not isolated/,
    );
    assert.equal(await readFile(artifact(f.context), "utf8"), before);
  }
});

test("container capture requires its recorded private network and preserves unrelated network records", async (t) => {
  const f = await fixture(t);
  const owned = await allocate(f, "network");
  const unrelated = await allocate(f, "network");
  const networksBefore = (await readManifest(f.context)).resources;
  const attachments = [
    { private: { NetworkID: owned.object.id } },
    { other: { NetworkID: unrelated.object.id } },
    undefined,
    { private: {} },
    {
      private: { NetworkID: owned.object.id },
      other: { NetworkID: unrelated.object.id },
    },
  ];
  for (const [index, networks] of attachments.entries()) {
    const { entry, labels } = await f.manager.reserve(
      f.context,
      "container",
      await f.docker.identity(),
      [owned.entry.id],
    );
    const object = f.docker.create("container", labels, { networks });
    if (index === 0) {
      await f.manager.captureDocker(f.context, entry.id, object.id);
    } else {
      await assert.rejects(
        f.manager.captureDocker(f.context, entry.id, object.id),
      );
    }
    const captured = (await readManifest(f.context)).resources.find(
      (resource) => resource.id === entry.id,
    );
    assert.equal(captured.state, index === 0 ? "present" : "pending");
    assert.deepEqual(
      captured.locator,
      index === 0 ? { id: object.id, created: object.created } : null,
    );
  }
  assert.deepEqual(
    (await readManifest(f.context)).resources.filter(
      (resource) => resource.kind === "network",
    ),
    networksBefore,
  );
  assert.ok(f.docker.objects.has(`network:${owned.object.id}`));
  assert.ok(f.docker.objects.has(`network:${unrelated.object.id}`));
});

test("invalid or missing explicit execution context fails before allocating authority", async (t) => {
  const f = await fixture(t);
  assert.equal(environmentContext({}), null);
  assert.deepEqual(
    environmentContext({ TASK_RESOURCES_CONTEXT: JSON.stringify(f.context) }),
    f.context,
  );
  for (const raw of [
    "",
    "null",
    "{}",
    "not-json",
    "x".repeat(8193),
    JSON.stringify({ ...f.context, executionId: "forged" }),
    JSON.stringify({ ...f.context, unexpected: true }),
  ]) {
    assert.throws(() => environmentContext({ TASK_RESOURCES_CONTEXT: raw }));
  }
  const before = await readFile(artifact(f.context), "utf8");
  for (const context of [
    null,
    undefined,
    {},
    { ...f.context, executionId: randomUUID() },
  ]) {
    await assert.rejects(
      f.manager.reserve(context, "container", await f.docker.identity()),
    );
    await assert.rejects(
      f.manager.createSimulator(context, simulatorConfiguration),
    );
  }
  await put(f.workspace, ".ai/plans/missing-record.md", "# Missing record\n");
  await assert.rejects(
    f.manager.reserve(
      { ...f.context, plan: ".ai/plans/missing-record.md" },
      "container",
      await f.docker.identity(),
    ),
  );
  assert.equal(await readFile(artifact(f.context), "utf8"), before);
  assert.equal(f.ios.devices.size, 0);
});

test("Simulator provisioning reuses its verified device and retains interrupted new allocations", async (t) => {
  const f = await fixture(t);
  f.ios.beforeCreate = async () => {
    const resources = (await readManifest(f.context)).resources;
    assert.equal(resources.at(-1).kind, "ios-simulator");
    assert.equal(resources.at(-1).state, "pending");
    assert.equal(resources.at(-1).locator, null);
  };
  const locator = await f.manager.createSimulator(
    f.context,
    simulatorConfiguration,
  );
  assert.deepEqual(
    (await readManifest(f.context)).resources[0].locator,
    locator,
  );
  f.ios.failCreate = true;
  assert.deepEqual(
    await f.manager.createSimulator(f.context, simulatorConfiguration),
    locator,
  );
  assert.equal((await readManifest(f.context)).resources.length, 1);
  assert.equal(f.ios.devices.size, 1);
  await assert.rejects(
    f.manager.createSimulator(f.context, {
      ...simulatorConfiguration,
      deviceType: "com.apple.CoreSimulator.SimDeviceType.iPhone-17-Pro",
    }),
  );
  const resources = (await readManifest(f.context)).resources;
  assert.equal(resources[1].state, "pending");
  assert.equal(resources[1].locator, null);
  await f.manager.release(f.context);
  await assert.rejects(f.manager.inventory(f.workspace, [f.plan]));
  assert.equal(f.ios.devices.size, 1);
});

test("Simulator provisioning skips busy owned devices, reuses available candidates and fails closed on invalid proof", async (t) => {
  const f = await fixture(t);
  const busyLocator = await f.manager.createSimulator(
    f.context,
    simulatorConfiguration,
  );
  const busyRecord = (await readManifest(f.context)).resources[0];
  f.ios.verifyErrors.set(
    busyLocator.udid,
    Object.assign(new Error("Owned Simulator is in active use"), {
      code: "DEVICE_BUSY",
    }),
  );
  const availableLocator = await f.manager.createSimulator(
    f.context,
    simulatorConfiguration,
  );
  assert.notEqual(availableLocator.udid, busyLocator.udid);
  assert.equal(f.ios.devices.size, 2);
  assert.deepEqual(
    await f.manager.createSimulator(f.context, simulatorConfiguration),
    availableLocator,
  );
  const afterReuse = await readManifest(f.context);
  assert.equal(afterReuse.resources.length, 2);
  assert.deepEqual(afterReuse.resources[0], busyRecord);
  assert.deepEqual(f.ios.devices.get(busyLocator.udid).locator, busyLocator);
  assert.equal(f.ios.devices.size, 2);

  const invalidProof = new Error("Owned Simulator creation proof is invalid");
  f.ios.verifyErrors.set(busyLocator.udid, invalidProof);
  const bytes = await readFile(artifact(f.context), "utf8");
  await assert.rejects(
    f.manager.createSimulator(f.context, simulatorConfiguration),
    (error) => error === invalidProof,
  );
  assert.equal(await readFile(artifact(f.context), "utf8"), bytes);
  assert.equal(f.ios.devices.size, 2);
});

test("active execution blocks cleanup preview; release enables exact confirmation and CANCEL preserves everything", async (t) => {
  const f = await fixture(t);
  const { object } = await allocate(f);
  await assert.rejects(f.manager.inventory(f.workspace, [f.plan]));
  await f.manager.release(f.context);
  await assert.rejects(
    f.manager.reserve(f.context, "network", await f.docker.identity()),
  );
  const preview = await f.manager.inventory(f.workspace, [f.plan]);
  assert.equal(preview.resources[0].state, "present");
  const bytes = await readFile(artifact(f.context), "utf8");
  assert.equal((await f.manager.cleanup(preview, "CANCEL")).cancelled, true);
  for (const confirmation of [
    undefined,
    "proceed",
    "Proceed",
    " PROCEED",
    "PROCEED\n",
    "cancel",
  ]) {
    await assert.rejects(f.manager.cleanup(preview, confirmation));
  }
  assert.equal(await readFile(artifact(f.context), "utf8"), bytes);
  assert.ok(f.docker.objects.has(`container:${object.id}`));
  const result = await f.manager.cleanup(preview, "PROCEED");
  assert.equal(result.cancelled, false);
  assert.equal(f.docker.objects.size, 0);
  assert.equal((await readManifest(f.context)).resources[0].state, "removed");
});

test("new allocation invalidates a preview before any selected deletion", async (t) => {
  const f = await fixture(t);
  await allocate(f);
  await f.manager.release(f.context);
  const preview = await f.manager.inventory(f.workspace, [f.plan]);
  await f.manager.resumeExecution({
    workspace: f.workspace,
    plan: f.plan,
    resume: f.context.executionId,
  });
  await allocate(f, "network");
  await f.manager.release(f.context);
  await assert.rejects(f.manager.cleanup(preview, "PROCEED"));
  assert.equal(f.docker.objects.size, 2);
  assert.ok(
    (await readManifest(f.context)).resources.every(
      (entry) => entry.state === "present",
    ),
  );
});

test("manifest and live provider changes each invalidate previously confirmed previews", async (t) => {
  const f = await fixture(t);
  await allocate(f);
  const simulator = await f.manager.createSimulator(
    f.context,
    simulatorConfiguration,
  );
  await f.manager.release(f.context);
  const preview = await f.manager.inventory(f.workspace, [f.plan]);
  await updateManifest(f.context, (manifest) => {
    manifest.resources[0].createdAt = "2000-01-01T00:00:00Z";
  });
  await assert.rejects(f.manager.cleanup(preview, "PROCEED"));
  const fresh = await f.manager.inventory(f.workspace, [f.plan]);
  f.ios.devices.get(simulator.udid).booted = true;
  await assert.rejects(f.manager.cleanup(fresh, "PROCEED"));
  assert.equal(f.docker.objects.size, 1);
  assert.equal(f.ios.devices.size, 1);
  await f.manager.cleanup(
    await f.manager.inventory(f.workspace, [f.plan]),
    "PROCEED",
  );
  assert.equal(f.docker.objects.size + f.ios.devices.size, 0);
});

test("selected task deletion preserves excluded task records, resources, primary checkouts and branches", async (t) => {
  const f = await fixture(t);
  await allocate(f, "network");
  const excludedPlan = ".ai/plans/excluded-task.md";
  await put(f.workspace, excludedPlan, "# Excluded task\n");
  const excluded = await initExecution({
    workspace: f.workspace,
    plan: excludedPlan,
  });
  const { object } = await allocate(f, "container", excluded);
  const bytes = await readFile(artifact(excluded), "utf8");
  const branches = git(path.join(f.workspace, "app"), "branch", "--list");
  await f.manager.release(f.context);
  const preview = await f.manager.inventory(f.workspace, [f.plan]);
  assert.deepEqual(
    preview.manifests.map((manifest) => manifest.plan),
    [f.plan],
  );
  await f.manager.cleanup(preview, "PROCEED");
  assert.equal(await readFile(artifact(excluded), "utf8"), bytes);
  assert.ok(f.docker.objects.has(`container:${object.id}`));
  assert.equal(f.docker.objects.size, 1);
  assert.ok((await lstat(path.join(f.workspace, "app"))).isDirectory());
  assert.equal(
    git(path.join(f.workspace, "app"), "branch", "--list"),
    branches,
  );
  assert.ok((await lstat(path.join(f.workspace, f.plan))).isFile());
});

test("root and native worktree allocations use distinct execution ownership in one source record", async (t) => {
  const f = await fixture(t);
  const worktree = path.join(f.workspace, ".worktrees/sample-task/app");
  await mkdir(path.dirname(worktree), { recursive: true });
  git(
    path.join(f.workspace, "app"),
    "worktree",
    "add",
    "-b",
    "task-manager-fixture",
    worktree,
  );
  const work = await initExecution({
    workspace: f.workspace,
    plan: f.plan,
    root: path.dirname(worktree),
  });
  const mainResource = await allocate(f);
  const workResource = await allocate(f, "container", work);
  const manifest = await readManifest(work);
  assert.notEqual(mainResource.object.id, workResource.object.id);
  assert.notEqual(
    mainResource.object.labels["ai.execution"],
    workResource.object.labels["ai.execution"],
  );
  assert.equal(
    mainResource.object.labels["ai.task"],
    workResource.object.labels["ai.task"],
  );
  assert.deepEqual(
    new Set(manifest.resources.map((entry) => entry.executionId)),
    new Set([f.context.executionId, work.executionId]),
  );
  assert.equal((await readAllManifests(f.workspace)).length, 1);
  await assert.rejects(
    lstat(
      path.join(
        path.dirname(worktree),
        ".ai/artifacts/sample-task/resources.json",
      ),
    ),
    { code: "ENOENT" },
  );
  await f.manager.release(f.context);
  await assert.rejects(f.manager.inventory(f.workspace, [f.plan]));
  await f.manager.release(work);
  assert.equal(
    (await f.manager.inventory(f.workspace, [f.plan])).resources.length,
    2,
  );
});

test("partial native deletion preserves durable progress and retries exact already absent IDs", async (t) => {
  const f = await fixture(t);
  const container = await allocate(f);
  const volume = await allocate(f, "volume");
  f.docker.failRemoval.add(volume.object.name);
  await f.manager.release(f.context);
  await assert.rejects(
    f.manager.cleanup(
      await f.manager.inventory(f.workspace, [f.plan]),
      "PROCEED",
    ),
    (error) => {
      assert.deepEqual(error.removed, [container.entry.id]);
      return true;
    },
  );
  const partial = await readManifest(f.context);
  assert.equal(partial.resources[0].state, "removed");
  assert.equal(partial.resources[1].state, "present");
  assert.ok((await lstat(path.join(f.workspace, f.plan))).isFile());
  assert.ok((await lstat(artifact(f.context))).isFile());
  assert.ok(!f.docker.objects.has(`container:${container.object.id}`));
  assert.ok(f.docker.objects.has(`volume:${volume.object.name}`));
  f.docker.failRemoval.clear();
  // A normal fixture teardown may have removed a recorded object before retry.
  f.docker.objects.delete(`volume:${volume.object.name}`);
  await f.manager.cleanup(
    await f.manager.inventory(f.workspace, [f.plan]),
    "PROCEED",
  );
  assert.ok(
    (await readManifest(f.context)).resources.every(
      (entry) => entry.state === "removed",
    ),
  );
  assert.equal(f.docker.objects.size, 0);
});

test("duplicate exact provider identity across task manifests blocks all selected deletion", async (t) => {
  const f = await fixture(t);
  const { object } = await allocate(f);
  const otherPlan = ".ai/plans/other-task.md";
  await put(f.workspace, otherPlan, "# Conflicting record\n");
  const other = await initExecution({
    workspace: f.workspace,
    plan: otherPlan,
  });
  const { entry } = await f.manager.reserve(
    other,
    "container",
    await f.docker.identity(),
  );
  await updateManifest(other, (manifest) => {
    const target = manifest.resources.find(
      (resource) => resource.id === entry.id,
    );
    target.state = "present";
    target.locator = { id: object.id, created: object.created };
  });
  await f.manager.release(f.context);
  await f.manager.release(other);
  await assert.rejects(f.manager.inventory(f.workspace, [f.plan]));
  assert.ok(f.docker.objects.has(`container:${object.id}`));
  assert.equal((await readManifest(f.context)).resources[0].state, "present");
});

test("unresolved Docker reservations block preview until corroborated reconciliation", async (t) => {
  const f = await fixture(t);
  const { entry, labels } = await f.manager.reserve(
    f.context,
    "network",
    await f.docker.identity(),
  );
  const object = f.docker.create("network", labels);
  await f.manager.release(f.context);
  await assert.rejects(f.manager.inventory(f.workspace, [f.plan]));
  await f.manager.resumeExecution({
    workspace: f.workspace,
    plan: f.plan,
    resume: f.context.executionId,
  });
  await f.manager.reconcile(f.context);
  assert.deepEqual((await readManifest(f.context)).resources[0].locator, {
    id: object.id,
    created: object.created,
  });
  assert.equal((await readManifest(f.context)).resources[0].id, entry.id);
  await f.manager.release(f.context);
  assert.equal(
    (await f.manager.inventory(f.workspace, [f.plan])).resources[0].state,
    "present",
  );
});

test("wrong ownership, changed daemon and provider failures never become absence", async (t) => {
  const f = await fixture(t);
  const { object } = await allocate(f);
  await f.manager.release(f.context);
  const preview = await f.manager.inventory(f.workspace, [f.plan]);
  const bytes = await readFile(artifact(f.context), "utf8");
  const ownTask = object.labels["ai.task"];
  object.labels["ai.task"] = randomUUID();
  await assert.rejects(f.manager.cleanup(preview, "PROCEED"));
  object.labels["ai.task"] = ownTask;
  const daemonId = f.docker.provider.daemonId;
  f.docker.provider.daemonId = "replacement-daemon";
  await assert.rejects(f.manager.cleanup(preview, "PROCEED"));
  f.docker.provider.daemonId = daemonId;
  f.docker.unavailable = true;
  await assert.rejects(f.manager.cleanup(preview, "PROCEED"));
  assert.equal(await readFile(artifact(f.context), "utf8"), bytes);
  assert.ok(f.docker.objects.has(`container:${object.id}`));
});

test("external attachments block deletion while shared task images are explicitly preserved", async (t) => {
  const f = await fixture(t);
  const network = await allocate(f, "network");
  const image = await allocate(f, "image", f.context, {
    tags: ["task-fixture:owned"],
  });
  const unrelated = f.docker.create(
    "container",
    {},
    { image: image.object.id },
  );
  network.object.containers[unrelated.id] = {};
  await f.manager.release(f.context);
  await assert.rejects(f.manager.inventory(f.workspace, [f.plan]));
  delete network.object.containers[unrelated.id];
  const preview = await f.manager.inventory(f.workspace, [f.plan]);
  assert.equal(
    preview.resources.find((resource) => resource.entry.kind === "image").state,
    "preserved",
  );
  const result = await f.manager.cleanup(preview, "PROCEED");
  assert.deepEqual(
    result.preserved.map((resource) => resource.entry.id),
    [image.entry.id],
  );
  assert.ok(f.docker.objects.has(`image:${image.object.id}`));
  assert.ok(f.docker.objects.has(`container:${unrelated.id}`));
  assert.ok(!f.docker.objects.has(`network:${network.object.id}`));
  assert.equal(
    (await readManifest(f.context)).resources.find(
      (entry) => entry.id === image.entry.id,
    ).state,
    "present",
  );
});

// Compose may run from a temporary checkout copy while the execution still
// belongs to the original application repository. Descriptive provenance must retain
// both identities without turning the temporary directory into a deletion target.
test("Compose provenance persists project and actual directory without replacing the execution root", async (t) => {
  const f = await fixture(t);
  const root = path.join(f.workspace, "app");
  const context = await initExecution({
    workspace: f.workspace,
    plan: f.plan,
    root,
  });
  const directory = await realpath(
    await mkdtemp(path.join(tmpdir(), "compose-actual-directory-")),
  );
  t.after(() => rm(directory, { recursive: true, force: true }));
  const compose = { project: "ai-disposable-project", directory };
  for (const kind of ["container", "volume", "network", "image"]) {
    await f.manager.reserve(context, kind, await f.docker.identity(), [], {
      compose,
    });
  }
  const legacy = await f.manager.reserve(
    context,
    "network",
    await f.docker.identity(),
  );
  const manifest = await readManifest(context);
  assert.equal(
    manifest.executions.find(
      (execution) => execution.id === context.executionId,
    ).root,
    root,
  );
  assert.notEqual(root, directory);
  assert.deepEqual(
    manifest.resources.slice(0, 4).map((entry) => entry.compose),
    Array(4).fill(compose),
  );
  assert.equal(Object.hasOwn(manifest.resources.at(-1), "compose"), false);
  assert.equal(manifest.resources.at(-1).id, legacy.entry.id);
  assert.deepEqual(
    parseManifest(JSON.parse(await readFile(artifact(context), "utf8"))),
    manifest,
  );
  assert.ok((await lstat(directory)).isDirectory());
});

test("Compose provenance rejects invalid and unknown metadata and is unavailable on iOS records", async (t) => {
  const f = await fixture(t);
  const compose = {
    project: "ai-disposable-project",
    directory: path.join(f.workspace, "app"),
  };
  const bytes = await readFile(artifact(f.context), "utf8");
  for (const metadata of [
    { compose: { ...compose, project: "Uppercase" } },
    { compose: { ...compose, project: "a".repeat(129) } },
    { compose: { ...compose, project: "-leading" } },
    { compose: { ...compose, directory: "relative/path" } },
    { compose: { ...compose, directory: `${f.workspace}/app/../app` } },
    { compose: { ...compose, deleteDirectory: true } },
    { compose, unrecognized: true },
  ]) {
    await assert.rejects(
      f.manager.reserve(
        f.context,
        "container",
        await f.docker.identity(),
        [],
        metadata,
      ),
    );
    assert.equal(await readFile(artifact(f.context), "utf8"), bytes);
  }
  await assert.rejects(
    f.manager.reserve(f.context, "ios-simulator", await f.ios.identity(), [], {
      compose,
    }),
    /only valid for Docker/,
  );
  await f.manager.createSimulator(f.context, simulatorConfiguration);
  const manifest = await readManifest(f.context);
  const withIOSProvenance = clone(manifest);
  withIOSProvenance.resources[0].compose = compose;
  assert.throws(() => parseManifest(withIOSProvenance));
  const reservation = await f.manager.reserve(
    f.context,
    "container",
    await f.docker.identity(),
    [],
    { compose },
  );
  const dockerManifest = await readManifest(f.context);
  const entry = dockerManifest.resources.find(
    (resource) => resource.id === reservation.entry.id,
  );
  entry.compose.unrecognized = true;
  assert.throws(() => parseManifest(dockerManifest));
});
