import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { randomBytes } from "node:crypto";
import { mkdir, mkdtemp, realpath, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import test from "node:test";
import { DockerProvider } from "./docker.mjs";
import { ResourceManager } from "./manager.mjs";
import { initExecution, readManifest, updateManifest } from "./store.mjs";
import {
  cleanupContainerVolumes,
  prepareContainerVolumes,
} from "./volumes.mjs";

const imageId = `sha256:${"a".repeat(64)}`;
const clone = (value) => structuredClone(value);
const git = (root, ...args) =>
  execFileSync("rtk", ["proxy", "git", "-C", root, ...args], {
    stdio: "pipe",
  });

class FakeDocker extends DockerProvider {
  constructor() {
    super();
    this.provider = {
      type: "docker",
      endpoint: "unix:///private/tmp/volume-test.sock",
      daemonId: "volume-test-daemon",
    };
    this.objects = new Map();
    this.commands = [];
    this.images = [imageId];
    this.imageLabels = {};
    this.declared = { "/data": {}, "/logs": {} };
    this.failCreate = 0;
    this.failRemoval = false;
  }
  async identity() {
    return clone(this.provider);
  }
  async list(kind, provider, filters = []) {
    await this.verifyIdentity(provider);
    if (kind === "image") {
      assert.ok(filters.length === 0 || filters[0] === "reference=fixture:1");
      return this.images;
    }
    return [...this.objects.values()]
      .filter((object) => object.kind === kind)
      .map((object) => (kind === "volume" ? object.name : object.id));
  }
  async inspect(kind, id, provider) {
    await this.verifyIdentity(provider);
    if (kind === "image")
      return this.images.includes(id)
        ? { id, labels: clone(this.imageLabels), tags: ["fixture:1"] }
        : null;
    return clone(this.objects.get(`${kind}:${id}`) ?? null);
  }
  async containers(provider) {
    await this.verifyIdentity(provider);
    return [...this.objects.values()]
      .filter((object) => object.kind === "container")
      .map(clone);
  }
  async command(args, endpoint) {
    assert.equal(endpoint, this.provider.endpoint);
    this.commands.push(clone(args));
    if (args[0] === "image" && args[1] === "pull") {
      assert.equal(args[2], "fixture:1");
      this.images = [imageId];
      return "safe output";
    }
    if (args[0] === "image") {
      assert.deepEqual(args.slice(0, 4), [
        "image",
        "inspect",
        "--format",
        '{{json (index .Config "Volumes")}}',
      ]);
      assert.equal(args.at(-1), imageId);
      return JSON.stringify(this.declared);
    }
    assert.deepEqual(args.slice(0, 2), ["volume", "create"]);
    const resources = (await readManifest(this.context)).resources;
    const labels = {};
    for (let i = 2; i < args.length; i += 2) {
      assert.equal(args[i], "--label");
      const equal = args[i + 1].indexOf("=");
      labels[args[i + 1].slice(0, equal)] = args[i + 1].slice(equal + 1);
    }
    const reserved = resources.find(
      (entry) => entry.id === labels["ai.resource"],
    );
    assert.equal(reserved?.state, "pending");
    assert.equal(reserved.locator, null);
    assert.equal(labels["ai.execution"], this.context.executionId);
    assert.equal(labels["ai.workspace"], this.context.workspace);
    assert.equal(labels["ai.task"], (await readManifest(this.context)).taskId);
    if (this.failCreate && --this.failCreate === 0)
      throw new Error("Injected creation failure");
    return this.create("volume", labels).name;
  }
  create(kind, labels, overrides = {}) {
    const id = randomBytes(32).toString("hex");
    const object = {
      kind,
      id,
      name: id,
      created: new Date().toISOString(),
      labels: clone(labels),
      mounts: [],
      ...overrides,
    };
    this.objects.set(
      `${kind}:${kind === "volume" ? object.name : object.id}`,
      object,
    );
    return object;
  }
  async remove(entry) {
    await this.verifyIdentity(entry.provider);
    if (this.failRemoval) throw new Error("Injected removal failure");
    this.objects.delete(`volume:${entry.locator.name}`);
  }
}

async function fixture(t) {
  const workspace = await realpath(
    await mkdtemp(path.join(tmpdir(), "resource-volumes-")),
  );
  t.after(() => rm(workspace, { recursive: true, force: true }));
  const workflow = path.join(workspace, ".ai");
  await mkdir(path.join(workflow, "plans"), { recursive: true });
  git(workflow, "init", "-b", "main");
  const plan = ".ai/plans/volumes.md";
  await writeFile(path.join(workspace, plan), "# Disposable volume test\n");
  const context = await initExecution({ workspace, plan });
  const docker = new FakeDocker();
  docker.context = context;
  const manager = new ResourceManager({ docker });
  const provider = await docker.identity();
  const { entry: parent, labels } = await manager.reserve(
    context,
    "container",
    provider,
  );
  const options = { manager, context, provider, parent, image: "fixture:1" };
  return { ...options, docker, labels, options };
}

async function explicitVolume(f, context = f.context) {
  const { entry, labels } = await f.manager.reserve(
    context,
    "volume",
    f.provider,
  );
  const actual = f.docker.create("volume", labels, {
    name: `named-${entry.id}`,
  });
  await f.manager.captureDocker(context, entry.id, actual.name);
  return actual;
}

async function container(f, prepared) {
  const actual = f.docker.create("container", f.labels, {
    mounts: prepared.mounts.map((mount) => ({
      Type: "volume",
      Name: mount.source,
      Destination: mount.target,
    })),
    declaredVolumes: f.docker.declared,
  });
  await f.manager.captureDocker(f.context, f.parent.id, actual.id);
  return actual;
}

test("image data volumes are reserved and labelled before anonymous allocation, with exact declared targets", async (t) => {
  const f = await fixture(t);
  const prepared = await prepareContainerVolumes(f.options);
  assert.deepEqual(
    prepared.mounts.map((mount) => mount.target),
    ["/data", "/logs"],
  );
  assert.equal(prepared.entries.length, 2);
  for (const entry of prepared.entries) {
    assert.equal(entry.state, "present");
    assert.deepEqual(entry.dependencies, [f.parent.id]);
    assert.match(entry.locator.name, /^[a-f0-9]{64}$/);
    assert.equal(
      f.docker.objects.get(`volume:${entry.locator.name}`).labels[
        "ai.resource"
      ],
      entry.id,
    );
  }
  assert.equal(
    f.docker.commands.filter((args) => args[1] === "pull").length,
    0,
  );
  const actual = await container(f, prepared);
  assert.equal((await readManifest(f.context)).resources.length, 3);
  f.docker.objects.delete(`container:${actual.id}`);
  await cleanupContainerVolumes({
    ...f.options,
    containerId: actual.id,
    entries: prepared.entries,
  });
  assert.ok(
    (await readManifest(f.context)).resources.every(
      (entry) => entry.state === "removed",
    ),
  );
  assert.equal(f.docker.objects.size, 0);
});

test("missing reference is pulled once while local sha256 IDs never require a reference match", async (t) => {
  const f = await fixture(t);
  f.docker.images = [];
  f.docker.declared = null;
  assert.deepEqual(await prepareContainerVolumes(f.options), {
    mounts: [],
    entries: [],
  });
  assert.deepEqual(f.docker.commands[0], ["image", "pull", "fixture:1"]);
  const before = f.docker.commands.length;
  await prepareContainerVolumes({ ...f.options, image: imageId });
  assert.equal(f.docker.commands.length, before + 1);
  f.docker.images = [];
  await assert.rejects(
    prepareContainerVolumes({ ...f.options, image: imageId }),
  );
});

test("container volume preparation refuses foreign task images before allocating any storage", async (t) => {
  const f = await fixture(t);
  f.docker.imageLabels = {
    "ai.task": "foreign-task",
    "ai.execution": "foreign-execution",
    "ai.resource": "foreign-image",
    "ai.workspace": f.context.workspace,
  };
  const before = await readManifest(f.context);
  await assert.rejects(prepareContainerVolumes(f.options));
  assert.deepEqual(await readManifest(f.context), before);
  assert.equal(f.docker.objects.size, 0);
});

test("explicit owned storage replaces one declared target and survives normal fixture teardown", async (t) => {
  const f = await fixture(t);
  const explicit = await explicitVolume(f);
  const prepared = await prepareContainerVolumes({
    ...f.options,
    volumeMounts: [{ source: explicit.name, target: "/data", mode: "ro" }],
  });
  assert.deepEqual(prepared.mounts[0], {
    source: explicit.name,
    target: "/data",
    mode: "ro",
  });
  assert.equal(prepared.entries.length, 1);
  assert.equal(prepared.mounts[1].target, "/logs");
  const actual = await container(f, prepared);
  f.docker.objects.delete(`container:${actual.id}`);
  await cleanupContainerVolumes({
    ...f.options,
    containerId: actual.id,
    entries: prepared.entries,
  });
  assert.ok(f.docker.objects.has(`volume:${explicit.name}`));
  assert.equal(
    (await readManifest(f.context)).resources.find(
      (entry) => entry.locator?.name === explicit.name,
    ).state,
    "present",
  );
});

test("host, missing, cross-execution and cross-task explicit volumes are refused before creation", async (t) => {
  const f = await fixture(t);
  const other = await initExecution({
    workspace: f.context.workspace,
    plan: f.context.plan,
  });
  const crossExecution = await explicitVolume(f, other);
  const otherPlan = ".ai/plans/other.md";
  await writeFile(path.join(f.context.workspace, otherPlan), "# Other\n");
  const otherTask = await initExecution({
    workspace: f.context.workspace,
    plan: otherPlan,
  });
  const crossTask = await explicitVolume(f, otherTask);
  for (const source of [
    "/private/tmp/host",
    "missing",
    crossExecution.name,
    crossTask.name,
  ]) {
    await assert.rejects(
      prepareContainerVolumes({
        ...f.options,
        volumeMounts: [{ source, target: "/data" }],
      }),
    );
  }
  assert.equal(f.docker.commands.length, 0);
});

test("explicit volume requires native ownership labels and exact creation identity", async (t) => {
  const f = await fixture(t);
  const explicit = await explicitVolume(f);
  const options = {
    ...f.options,
    volumeMounts: [{ source: explicit.name, target: "/data" }],
  };
  const task = explicit.labels["ai.task"];
  explicit.labels["ai.task"] = "other-task";
  await assert.rejects(prepareContainerVolumes(options));
  explicit.labels["ai.task"] = task;
  explicit.created = "2000-01-01T00:00:00.000Z";
  await assert.rejects(prepareContainerVolumes(options));
  assert.equal(f.docker.commands.length, 0);
});

test("explicit storage reuse refuses external running or stopped attachments before any allocation", async (t) => {
  const f = await fixture(t);
  const explicit = await explicitVolume(f);
  const options = {
    ...f.options,
    volumeMounts: [{ source: explicit.name, target: "/data" }],
  };
  const before = await readManifest(f.context);
  for (const running of [true, false]) {
    const external = f.docker.create(
      "container",
      {},
      {
        running,
        mounts: [
          { Type: "volume", Name: explicit.name, Destination: "/shared" },
        ],
      },
    );
    await assert.rejects(prepareContainerVolumes(options));
    assert.deepEqual(await readManifest(f.context), before);
    assert.equal(f.docker.commands.length, 0);
    f.docker.objects.delete(`container:${external.id}`);
  }
});

test("explicit storage reuse allows recorded current-execution attachments and rejects duplicate task claims", async (t) => {
  const f = await fixture(t);
  const explicit = await explicitVolume(f);
  const { entry, labels } = await f.manager.reserve(
    f.context,
    "container",
    f.provider,
  );
  const own = f.docker.create("container", labels, {
    mounts: [{ Type: "volume", Name: explicit.name, Destination: "/shared" }],
  });
  await f.manager.captureDocker(f.context, entry.id, own.id);
  f.docker.declared = null;
  const options = {
    ...f.options,
    volumeMounts: [{ source: explicit.name, target: "/data" }],
  };
  assert.deepEqual((await prepareContainerVolumes(options)).entries, []);
  const otherPlan = ".ai/plans/duplicate.md";
  await writeFile(path.join(f.context.workspace, otherPlan), "# Duplicate\n");
  const other = await initExecution({
    workspace: f.context.workspace,
    plan: otherPlan,
  });
  const reserved = await f.manager.reserve(other, "volume", f.provider);
  await updateManifest(other, (manifest) => {
    const duplicate = manifest.resources.find(
      (item) => item.id === reserved.entry.id,
    );
    duplicate.locator = {
      name: explicit.name,
      created: explicit.created,
      containerId: null,
    };
    duplicate.state = "present";
  });
  const before = await readManifest(f.context);
  await assert.rejects(prepareContainerVolumes(options));
  assert.deepEqual(await readManifest(f.context), before);
});

test("invalid image references, declared paths and explicit mount options fail closed", async (t) => {
  const f = await fixture(t);
  for (const image of ["", "-flag", "fixture\nsecret", "x".repeat(257)])
    await assert.rejects(prepareContainerVolumes({ ...f.options, image }));
  for (const target of [
    "/",
    "relative",
    "/a/../data",
    "/a/./data",
    "/a//data",
    "/data\n",
    "/data/",
  ]) {
    f.docker.declared = { [target]: {} };
    await assert.rejects(prepareContainerVolumes(f.options));
  }
  f.docker.declared = Object.fromEntries(
    Array.from({ length: 129 }, (_, i) => [`/data${i}`, {}]),
  );
  await assert.rejects(prepareContainerVolumes(f.options));
  assert.equal(f.docker.objects.size, 0);
  const explicit = await explicitVolume(f);
  for (const volumeMounts of [
    [{ source: explicit.name, target: "/data", mode: "bad" }],
    [
      { source: explicit.name, target: "/data" },
      { source: explicit.name, target: "/data" },
    ],
  ])
    await assert.rejects(
      prepareContainerVolumes({ ...f.options, volumeMounts }),
    );
});

test("comma-bearing image and explicit targets refuse before volume allocation", async (t) => {
  const f = await fixture(t);
  f.docker.declared = { "/safe": {}, "/data,readonly": {} };
  const before = await readManifest(f.context);
  await assert.rejects(
    prepareContainerVolumes(f.options),
    /Invalid image volume paths/,
  );
  assert.deepEqual(await readManifest(f.context), before);
  assert.equal(
    f.docker.commands.some(
      (args) => args[0] === "volume" && args[1] === "create",
    ),
    false,
  );
  assert.equal(f.docker.objects.size, 0);
  const explicit = await explicitVolume(f);
  f.docker.declared = null;
  const explicitBefore = await readManifest(f.context);
  await assert.rejects(
    prepareContainerVolumes({
      ...f.options,
      volumeMounts: [{ source: explicit.name, target: "/data,readonly" }],
    }),
    /Invalid or duplicate/,
  );
  assert.deepEqual(await readManifest(f.context), explicitBefore);
});

test("partial creation retains present allocations and the failed pending reservation", async (t) => {
  const f = await fixture(t);
  f.docker.failCreate = 2;
  await assert.rejects(prepareContainerVolumes(f.options));
  const resources = (await readManifest(f.context)).resources;
  assert.deepEqual(
    resources.map((entry) => entry.state),
    ["pending", "present", "pending"],
  );
  assert.equal(f.docker.objects.size, 1);
});

test("teardown rejects missing container identity and reused explicit entries without changing pending evidence", async (t) => {
  const f = await fixture(t);
  const before = await readManifest(f.context);
  await assert.rejects(cleanupContainerVolumes({ ...f.options, entries: [] }));
  assert.deepEqual(await readManifest(f.context), before);
  const explicit = await explicitVolume(f);
  const prepared = await prepareContainerVolumes(f.options);
  const actual = await container(f, prepared);
  f.docker.objects.delete(`container:${actual.id}`);
  const reused = (await readManifest(f.context)).resources.find(
    (entry) => entry.locator?.name === explicit.name,
  );
  await assert.rejects(
    cleanupContainerVolumes({
      ...f.options,
      containerId: actual.id,
      entries: [reused],
    }),
  );
  assert.equal(
    (await readManifest(f.context)).resources.find(
      (entry) => entry.id === f.parent.id,
    ).state,
    "present",
  );
  assert.equal(f.docker.objects.size, 3);
});

test("normal teardown preserves volumes while parent remains or another container shares storage", async (t) => {
  const f = await fixture(t);
  const prepared = await prepareContainerVolumes(f.options);
  const actual = await container(f, prepared);
  const options = {
    ...f.options,
    containerId: actual.id,
    entries: prepared.entries,
  };
  await assert.rejects(cleanupContainerVolumes(options));
  assert.ok(
    (await readManifest(f.context)).resources.every(
      (entry) => entry.state === "present",
    ),
  );
  f.docker.objects.delete(`container:${actual.id}`);
  const unrelated = f.docker.create(
    "container",
    {},
    { mounts: [{ Type: "volume", Name: prepared.mounts[0].source }] },
  );
  await assert.rejects(cleanupContainerVolumes(options));
  assert.equal(f.docker.objects.size, 3);
  f.docker.objects.delete(`container:${unrelated.id}`);
  await cleanupContainerVolumes(options);
  assert.equal(f.docker.objects.size, 0);
});

test("failed teardown preserves volume evidence and exact-ID retry handles already absent allocations", async (t) => {
  const f = await fixture(t);
  const prepared = await prepareContainerVolumes(f.options);
  const actual = await container(f, prepared);
  f.docker.objects.delete(`container:${actual.id}`);
  f.docker.failRemoval = true;
  const options = {
    ...f.options,
    containerId: actual.id,
    entries: prepared.entries,
  };
  await assert.rejects(cleanupContainerVolumes(options));
  assert.ok(
    (await readManifest(f.context)).resources
      .filter((entry) => entry.kind === "volume")
      .every((entry) => entry.state === "present"),
  );
  f.docker.failRemoval = false;
  f.docker.objects.delete(`volume:${prepared.mounts[0].source}`);
  await cleanupContainerVolumes(options);
  assert.equal(f.docker.objects.size, 0);
});

test("missing ownership after parent removal and duplicate task storage records both prevent teardown", async (t) => {
  const f = await fixture(t);
  const prepared = await prepareContainerVolumes(f.options);
  const actual = await container(f, prepared);
  f.docker.objects.delete(`container:${actual.id}`);
  const volume = f.docker.objects.get(`volume:${prepared.mounts[0].source}`);
  const labels = volume.labels;
  volume.labels = {};
  const options = {
    ...f.options,
    containerId: actual.id,
    entries: prepared.entries,
  };
  await assert.rejects(cleanupContainerVolumes(options));
  assert.equal(f.docker.objects.size, 2);
  volume.labels = labels;
  const otherPlan = ".ai/plans/shared.md";
  await writeFile(
    path.join(f.context.workspace, otherPlan),
    "# Shared record\n",
  );
  const other = await initExecution({
    workspace: f.context.workspace,
    plan: otherPlan,
  });
  const { entry } = await f.manager.reserve(other, "volume", f.provider);
  await updateManifest(other, (manifest) => {
    const stored = manifest.resources.find((item) => item.id === entry.id);
    stored.locator = clone(prepared.entries[0].locator);
    stored.state = "present";
  });
  await assert.rejects(cleanupContainerVolumes(options));
  assert.equal(f.docker.objects.size, 2);
});
