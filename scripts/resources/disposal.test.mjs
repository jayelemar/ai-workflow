import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { randomBytes, randomUUID } from "node:crypto";
import { mkdir, mkdtemp, realpath, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import test from "node:test";
import { DockerProvider } from "./docker.mjs";
import { disposeDockerAllocations } from "./disposal.mjs";
import { ResourceManager } from "./manager.mjs";
import { initExecution, readManifest, updateManifest } from "./store.mjs";

// Real canonical manifests and the actual disposal adapter exercise the trust
// boundary. Only native Docker inventory/mutation is replaced by a stateful fake.
class FakeDocker extends DockerProvider {
  constructor() {
    super();
    this.provider = {
      type: "docker",
      endpoint: "unix:///private/tmp/disposal-test.sock",
      daemonId: "disposal-test-daemon",
    };
    this.objects = new Map();
    this.removals = [];
    this.failRemoval = new Set();
  }
  async identity() {
    return structuredClone(this.provider);
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
      .map((object) => (kind === "volume" ? object.name : object.id));
  }
  async inspect(kind, id, provider) {
    await this.verifyIdentity(provider);
    return structuredClone(this.objects.get(`${kind}:${id}`) ?? null);
  }
  async containers(provider) {
    await this.verifyIdentity(provider);
    return [...this.objects.values()]
      .filter((object) => object.kind === "container")
      .map((object) => structuredClone(object));
  }
  create(kind, labels, overrides = {}) {
    const hex = randomBytes(32).toString("hex");
    const id = kind === "image" ? `sha256:${hex}` : hex;
    const object = {
      kind,
      id,
      name: hex,
      labels: structuredClone(labels),
      created: new Date().toISOString(),
      mounts: [],
      networks: {},
      containers: {},
      tags: [],
      ...overrides,
    };
    this.objects.set(`${kind}:${kind === "volume" ? object.name : id}`, object);
    return object;
  }
  async remove(entry) {
    await this.verifyIdentity(entry.provider);
    const id = entry.kind === "volume" ? entry.locator.name : entry.locator.id;
    this.removals.push({ kind: entry.kind, id });
    if (this.failRemoval.has(id))
      throw new Error("Injected native removal failure");
    this.objects.delete(`${entry.kind}:${id}`);
    if (entry.kind === "container")
      for (const object of this.objects.values())
        delete object.containers?.[id];
  }
}
async function fixture(t) {
  const workspace = await realpath(
    await mkdtemp(path.join(tmpdir(), "resource-disposal-")),
  );
  t.after(() => rm(workspace, { recursive: true, force: true }));
  await mkdir(path.join(workspace, ".ai/plans"), { recursive: true });
  execFileSync(
    "rtk",
    ["proxy", "git", "-C", path.join(workspace, ".ai"), "init", "-b", "main"],
    { stdio: "pipe" },
  );
  const plan = ".ai/plans/disposal-task.md";
  await writeFile(path.join(workspace, plan), "# Disposable fixture\n");
  const context = await initExecution({ workspace, plan });
  const docker = new FakeDocker();
  const manager = new ResourceManager({ docker });
  const allocate = async (
    kind,
    { pending = false, dependencies = [], ...overrides } = {},
  ) => {
    const { entry, labels } = await manager.reserve(
      context,
      kind,
      await docker.identity(),
      dependencies,
      kind === "image"
        ? { expectedTags: overrides.tags ?? ["disposal-owned:fixture"] }
        : {},
    );
    const object = docker.create(kind, labels, overrides);
    if (!pending)
      await manager.captureDocker(
        context,
        entry.id,
        kind === "volume" ? object.name : object.id,
      );
    return {
      entry,
      object,
      expectedTags: kind === "image" ? [...(overrides.tags ?? [])] : undefined,
    };
  };
  return { workspace, plan, context, docker, manager, allocate };
}
const dispose = (f, ...allocations) =>
  disposeDockerAllocations(
    f.context,
    allocations.map((allocation) => allocation.entry.id),
    { manager: f.manager },
  );

test("normal disposal reconciles only bound failed-start allocations and removes exact IDs in dependency order while execution is active", async (t) => {
  const f = await fixture(t);
  const network = await f.allocate("network", { pending: true });
  const volume = await f.allocate("volume", { pending: true });
  const image = await f.allocate("image", {
    pending: true,
    tags: ["disposal-owned:fixture"],
  });
  const container = await f.allocate("container", {
    pending: true,
    dependencies: [network.entry.id],
    mounts: [{ Type: "volume", Name: volume.object.name }],
    image: image.object.id,
    networks: { private: { NetworkID: network.object.id } },
  });
  network.object.containers[container.object.id] = {};
  const excluded = await f.allocate("network", { pending: true });
  const unrelated = f.docker.create("container", {});
  const result = await dispose(f, container, volume, network, image);
  assert.equal(result.preserved.length, 0);
  assert.deepEqual(
    f.docker.removals.map((item) => item.kind),
    ["container", "volume", "network", "image"],
  );
  assert.deepEqual(
    new Set(result.removed),
    new Set([container, volume, network, image].map((item) => item.entry.id)),
  );
  const manifest = await readManifest(f.context);
  assert.equal(manifest.executions[0].active, true);
  assert.equal(
    manifest.resources.find((entry) => entry.id === excluded.entry.id).state,
    "pending",
  );
  assert.ok(f.docker.objects.has(`network:${excluded.object.id}`));
  assert.ok(f.docker.objects.has(`container:${unrelated.id}`));
});

test("any selected provider or ownership failure refuses all native mutations without fallback", async (t) => {
  for (const failure of ["daemon", "ownership"]) {
    const f = await fixture(t);
    const container = await f.allocate("container");
    const volume = await f.allocate("volume", {
      name: "myuse-disposal-task-volume-0-a1b2c3d4e5f6",
    });
    if (failure === "daemon") f.docker.provider.daemonId = "replacement-daemon";
    else volume.object.labels["ai.task"] = randomUUID();
    await assert.rejects(dispose(f, container, volume));
    assert.deepEqual(f.docker.removals, []);
    assert.equal(f.docker.objects.size, 2);
    assert.ok(
      (await readManifest(f.context)).resources.every(
        (entry) => entry.state === "present",
      ),
    );
  }
});

test("outside volume and network attachments block the entire normal disposal scope", async (t) => {
  for (const kind of ["volume", "network"]) {
    const f = await fixture(t);
    const owned = await f.allocate("container");
    const resource = await f.allocate(kind);
    const unrelated = f.docker.create(
      "container",
      {},
      {
        mounts:
          kind === "volume"
            ? [{ Type: "volume", Name: resource.object.name }]
            : [],
      },
    );
    if (kind === "network") resource.object.containers[unrelated.id] = {};
    await assert.rejects(dispose(f, owned, resource), /another container/);
    assert.deepEqual(f.docker.removals, []);
  }
});

test("shared task images are reported and preserved with their ownership record", async (t) => {
  const f = await fixture(t);
  const image = await f.allocate("image", { tags: ["disposal-owned:fixture"] });
  image.object.tags.push("outside-alias:shared");
  const result = await dispose(f, image);
  assert.deepEqual(result.removed, []);
  assert.equal(result.preserved[0].entryId, image.entry.id);
  assert.deepEqual(f.docker.removals, []);
  assert.equal((await readManifest(f.context)).resources[0].state, "present");
});

test("partial failure persists completed removal and retry verifies known absent IDs", async (t) => {
  const f = await fixture(t);
  const container = await f.allocate("container");
  const volume = await f.allocate("volume");
  f.docker.failRemoval.add(volume.object.name);
  await assert.rejects(dispose(f, container, volume), (error) => {
    assert.deepEqual(error.removed, [container.entry.id]);
    return true;
  });
  const manifest = await readManifest(f.context);
  assert.equal(manifest.resources[0].state, "removed");
  assert.equal(manifest.resources[1].state, "present");
  f.docker.failRemoval.clear();
  await dispose(f, container, volume);
  assert.equal(f.docker.objects.size, 0);
  assert.ok(
    (await readManifest(f.context)).resources.every(
      (entry) => entry.state === "removed",
    ),
  );
  assert.equal(
    f.docker.removals.filter((item) => item.kind === "container").length,
    1,
  );
});

test("missing or foreign reservation IDs and duplicate ownership prevent all removals", async (t) => {
  const f = await fixture(t);
  const owned = await f.allocate("container");
  const otherPlan = ".ai/plans/other-disposal.md";
  await writeFile(path.join(f.workspace, otherPlan), "# Excluded fixture\n");
  const other = await initExecution({
    workspace: f.workspace,
    plan: otherPlan,
  });
  const foreign = await f.manager.reserve(
    other,
    "container",
    await f.docker.identity(),
  );
  for (const ids of [
    [randomUUID()],
    [foreign.entry.id],
    [owned.entry.id, owned.entry.id],
  ])
    await assert.rejects(
      disposeDockerAllocations(f.context, ids, { manager: f.manager }),
    );
  await updateManifest(other, (manifest) => {
    manifest.resources[0].locator = {
      id: owned.object.id,
      created: owned.object.created,
    };
    manifest.resources[0].state = "present";
  });
  await assert.rejects(dispose(f, owned), /multiple task records/);
  assert.deepEqual(f.docker.removals, []);
});

test("unallocated pending reservations become removed while pending known identities still require ownership", async (t) => {
  const f = await fixture(t);
  const empty = await f.manager.reserve(
    f.context,
    "image",
    await f.docker.identity(),
  );
  await disposeDockerAllocations(f.context, [empty.entry.id], {
    manager: f.manager,
  });
  assert.equal((await readManifest(f.context)).resources[0].state, "removed");
  const owned = await f.allocate("container");
  await updateManifest(f.context, (manifest) => {
    manifest.resources.find((entry) => entry.id === owned.entry.id).state =
      "pending";
  });
  owned.object.labels = {};
  await assert.rejects(dispose(f, owned), /Ownership mismatch/);
  assert.deepEqual(f.docker.removals, []);
  assert.equal((await readManifest(f.context)).resources[1].state, "pending");
});

test("pending container disposal never reconciles a pending mounted volume outside its bound scope", async (t) => {
  const f = await fixture(t);
  const volume = await f.allocate("volume", { pending: true });
  const container = await f.allocate("container", {
    pending: true,
    mounts: [{ Type: "volume", Name: volume.object.name }],
  });
  await assert.rejects(dispose(f, container), /unbound pending volume/);
  assert.deepEqual(f.docker.removals, []);
  assert.ok(
    (await readManifest(f.context)).resources.every(
      (entry) => entry.state === "pending",
    ),
  );
});

test("pending image reconciliation preserves outside aliases using its original reserved tag evidence", async (t) => {
  const f = await fixture(t);
  const image = await f.allocate("image", {
    pending: true,
    tags: ["original-build:task"],
  });
  image.object.tags.push("outside-alias:shared");
  const result = await dispose(f, image);
  assert.equal(result.preserved[0].entryId, image.entry.id);
  assert.deepEqual(f.docker.removals, []);
  assert.deepEqual((await readManifest(f.context)).resources[0].locator.tags, [
    "original-build:task",
  ]);
});
