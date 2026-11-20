import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { randomBytes } from "node:crypto";
import { mkdir, mkdtemp, realpath, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import test from "node:test";
import { DockerProvider, requireLoopbackPublications } from "./docker.mjs";
import {
  startDockerContainer,
  startDockerNetwork,
  prepareTrackedImage,
} from "./fixtures.mjs";
import { ResourceManager } from "./manager.mjs";
import { initExecution, readManifest } from "./store.mjs";

class FakeDocker extends DockerProvider {
  constructor() {
    super();
    this.provider = {
      type: "docker",
      endpoint: "unix:///private/tmp/fixture-stop-test.sock",
      daemonId: "fixture-stop-test-daemon",
    };
    this.objects = new Map();
    this.removals = [];
    this.commands = [];
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
            if (filter.startsWith("reference="))
              return object.tags?.includes(filter.slice("reference=".length));
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
  async command(args, endpoint) {
    assert.equal(endpoint, this.provider.endpoint);
    this.commands.push(structuredClone(args));
    const labels = {};
    for (let index = 0; index < args.length; index++)
      if (args[index] === "--label") {
        const [key, ...value] = args[++index].split("=");
        labels[key] = value.join("=");
      }
    if (args[0] === "image" && args[1] === "inspect")
      return JSON.stringify({ "/data": {} });
    if (args[0] === "network" && args[1] === "create") {
      assert.deepEqual(args.slice(0, 4), [
        "network",
        "create",
        "--driver",
        "bridge",
      ]);
      assert.equal(
        args[args.indexOf("--opt") + 1],
        "com.docker.network.bridge.host_binding_ipv4=127.0.0.1",
      );
      return this.create("network", labels, {
        driver: "bridge",
        options: { "com.docker.network.bridge.host_binding_ipv4": "127.0.0.1" },
        containers: {},
      }).id;
    }
    if (args[0] === "volume" && args[1] === "create")
      return this.create("volume", labels).name;
    if (args[0] === "container" && args[1] === "create") {
      const networkId = args[args.indexOf("--network") + 1];
      assert.match(networkId, /^[a-f0-9]{64}$/);
      const mounts = [];
      const ports = {};
      for (let index = 0; index < args.length; index++) {
        if (args[index] === "--mount") {
          const [, Name, Destination] = args[++index].match(
            /^type=volume,source=([^,]+),target=([^,]+)(?:,readonly)?$/,
          );
          mounts.push({ Type: "volume", Name, Destination });
        } else if (args[index] === "--publish") {
          const [, hostPort, port, protocol] = args[++index].match(
            /^127\.0\.0\.1:([0-9]*):([0-9]+)\/(tcp|udp)$/,
          );
          ports[`${port}/${protocol}`] = [
            { HostIp: "127.0.0.1", HostPort: hostPort || "55001" },
          ];
        }
      }
      const object = this.create("container", labels, {
        mounts,
        declaredVolumes: { "/data": {} },
        ports,
        networks: { private: { NetworkID: networkId } },
        running: false,
      });
      this.objects.get(`network:${networkId}`).containers[object.id] = {};
      return object.id;
    }
    if (args[0] === "container" && ["start", "stop"].includes(args[1])) {
      const object = this.objects.get(`container:${args[2]}`);
      object.running = args[1] === "start";
      return object.id;
    }
    throw new Error("Unexpected fake Docker command");
  }
  create(kind, labels, overrides = {}) {
    const hex = randomBytes(32).toString("hex");
    const id = kind === "image" ? `sha256:${hex}` : hex;
    const object = {
      kind,
      id,
      name: id,
      created: new Date().toISOString(),
      labels: structuredClone(labels),
      mounts: [],
      tags: [],
      ...overrides,
    };
    this.objects.set(`${kind}:${id}`, object);
    return object;
  }
  async remove(entry) {
    await this.verifyIdentity(entry.provider);
    const id = entry.kind === "volume" ? entry.locator.name : entry.locator.id;
    this.removals.push({ kind: entry.kind, id });
    this.objects.delete(`${entry.kind}:${id}`);
    for (const object of this.objects.values())
      if (object.kind === "network") delete object.containers[id];
  }
}

async function fixture(t, { start = true } = {}) {
  const workspace = await realpath(
    await mkdtemp(path.join(tmpdir(), "resource-fixture-stop-")),
  );
  t.after(() => rm(workspace, { recursive: true, force: true }));
  const workflow = path.join(workspace, ".ai");
  await mkdir(path.join(workflow, "plans"), { recursive: true });
  execFileSync("rtk", ["proxy", "git", "-C", workflow, "init", "-b", "main"], {
    stdio: "pipe",
  });
  const plan = ".ai/plans/fixture-stop.md";
  await writeFile(path.join(workspace, plan), "# Disposable stop fixture\n");
  const context = await initExecution({ workspace, plan });
  const docker = new FakeDocker();
  const manager = new ResourceManager({ docker });
  docker.create("image", {}, { tags: ["public-fixture:unit"] });
  const dependencies = { manager, getContext: () => context };
  const started = start
    ? await startDockerContainer(
        {
          image: "public-fixture:unit",
          command: ["serve", "literal $(argument)"],
          environment: { EXAMPLE: "literal=value" },
          ports: [8025],
        },
        dependencies,
      )
    : null;
  const container = docker.objects.get(`container:${started?.getId()}`);
  const volume = [...docker.objects.values()].find(
    (object) => object.kind === "volume",
  );
  return { context, docker, manager, container, volume, started, dependencies };
}

// Public API tests exercise real reservations/capture/disposal with a fake local
// Docker provider. They prove resource ownership without allocating native state.
test("portable Docker API pins images, uses private networking, preallocates image storage, and publishes explicit loopback ports", async (t) => {
  const f = await fixture(t);
  assert.equal(f.started.getHost(), "127.0.0.1");
  assert.equal(f.started.getMappedPort(8025), 55001);
  assert.throws(() => f.started.getMappedPort(1234), /no verified publication/);
  assert.throws(() => f.started.getMappedPort("8025"), /Invalid mapped port/);
  assert.throws(
    () => f.started.getMappedPort(8025, "sctp"),
    /Invalid mapped port/,
  );
  assert.equal(f.container.running, true);
  const resources = (await readManifest(f.context)).resources;
  assert.equal(resources.length, 3);
  assert.ok(resources.every((entry) => entry.state === "present"));
  const network = resources.find((entry) => entry.kind === "network");
  const container = resources.find((entry) => entry.kind === "container");
  const volume = resources.find((entry) => entry.kind === "volume");
  assert.deepEqual(container.dependencies, [network.id]);
  assert.deepEqual(volume.dependencies, [container.id]);
  assert.equal(f.container.mounts[0].Name, volume.locator.name);
  const create = f.docker.commands.find(
    (args) => args[0] === "container" && args[1] === "create",
  );
  assert.ok(create.includes("127.0.0.1::8025/tcp"));
  assert.ok(create.includes("EXAMPLE=literal=value"));
  assert.ok(create.includes("literal $(argument)"));
  assert.ok(
    create.includes(
      [...f.docker.objects.values()].find((entry) => entry.kind === "image").id,
    ),
  );
});

test("default stop disposes its exact container and allocated storage while leaving its reusable private network", async (t) => {
  const f = await fixture(t);
  await f.started.stop();
  await f.started.stop();
  assert.ok(!f.docker.objects.has(`container:${f.container.id}`));
  assert.ok(!f.docker.objects.has(`volume:${f.volume.name}`));
  const resources = (await readManifest(f.context)).resources;
  assert.ok(
    resources
      .filter((entry) => entry.kind !== "network")
      .every((entry) => entry.state === "removed"),
  );
  assert.equal(
    resources.find((entry) => entry.kind === "network").state,
    "present",
  );
});

test("removeVolumes:false preserves storage and later explicit stop can remove it", async (t) => {
  const f = await fixture(t);
  await f.started.stop({ removeVolumes: false });
  assert.ok(!f.docker.objects.has(`container:${f.container.id}`));
  assert.ok(f.docker.objects.has(`volume:${f.volume.name}`));
  assert.equal(
    (await readManifest(f.context)).resources.find(
      (entry) => entry.kind === "volume",
    ).state,
    "present",
  );
  await f.started.stop();
  assert.ok(!f.docker.objects.has(`volume:${f.volume.name}`));
});

test("remove:false stops but retains the container and volumes for later guarded removal", async (t) => {
  const f = await fixture(t);
  await f.started.stop({ remove: false });
  assert.equal(f.container.running, false);
  assert.ok(
    (await readManifest(f.context)).resources.every(
      (entry) => entry.state === "present",
    ),
  );
  f.container.labels["ai.task"] = "another-task";
  await assert.rejects(f.started.stop(), /Ownership/);
  assert.deepEqual(f.docker.removals, []);
});

test("normal stop refuses changed daemon, container ownership, and volume replacement before deletion", async (t) => {
  for (const changed of ["daemon", "container", "volume"]) {
    const f = await fixture(t);
    if (changed === "daemon") f.docker.provider.daemonId = "replacement";
    else if (changed === "container")
      f.container.labels["ai.task"] = "another-task";
    else f.volume.created = "replacement-creation";
    await assert.rejects(f.started.stop());
    assert.deepEqual(f.docker.removals, []);
    assert.ok(f.docker.objects.has(`container:${f.container.id}`));
    assert.ok(f.docker.objects.has(`volume:${f.volume.name}`));
  }
});

test("network handles refuse attached containers, ownership changes, and daemon changes", async (t) => {
  const f = await fixture(t, { start: false });
  const network = await startDockerNetwork(f.dependencies);
  const object = f.docker.objects.get(`network:${network.getId()}`);
  f.docker.provider.daemonId = "replacement-daemon";
  await assert.rejects(network.stop());
  f.docker.provider.daemonId = "fixture-stop-test-daemon";
  const labels = object.labels;
  object.labels = { ...labels, "ai.task": "another-task" };
  await assert.rejects(network.stop());
  object.labels = labels;
  object.containers.outside = {};
  await assert.rejects(network.stop(), /another container/);
  delete object.containers.outside;
  await network.stop();
  await network.stop();
  assert.ok(!f.docker.objects.has(`network:${network.getId()}`));
});

test("invalid or absent context and unsafe explicit publications allocate nothing", async (t) => {
  const f = await fixture(t, { start: false });
  for (const ports of [
    [{ containerPort: 8025, hostIp: "0.0.0.0" }],
    [0],
    [8025, 8025],
    [{ containerPort: 8025, hostPort: 65536 }],
  ])
    await assert.rejects(
      startDockerContainer(
        { image: "public-fixture:unit", ports },
        f.dependencies,
      ),
    );
  await assert.rejects(
    startDockerContainer(
      { image: "public-fixture:unit" },
      { ...f.dependencies, getContext: () => null },
    ),
    /context/,
  );
  await assert.rejects(
    startDockerNetwork({ ...f.dependencies, getContext: () => null }),
    /context/,
  );
  assert.equal((await readManifest(f.context)).resources.length, 0);
  assert.deepEqual(f.docker.commands, []);
});

test("explicit network cannot adopt a network from a different execution", async (t) => {
  const f = await fixture(t);
  const other = await initExecution({
    workspace: f.context.workspace,
    plan: f.context.plan,
  });
  const networkId = Object.values(f.container.networks)[0].NetworkID;
  const before = f.docker.objects.size;
  await assert.rejects(
    startDockerContainer(
      { image: "public-fixture:unit", networkId },
      { ...f.dependencies, getContext: () => other },
    ),
    /does not belong/,
  );
  assert.equal(f.docker.objects.size, before);
});

test("unsupported top-level Docker flags fail before allocation", async (t) => {
  const f = await fixture(t, { start: false });
  for (const extra of [
    { privileged: true },
    { hostIp: "0.0.0.0" },
    { labels: {} },
    { networkMode: "host" },
  ])
    await assert.rejects(
      startDockerContainer(
        { image: "public-fixture:unit", ...extra },
        f.dependencies,
      ),
      /Unsupported/,
    );
  assert.equal((await readManifest(f.context)).resources.length, 0);
  assert.deepEqual(f.docker.commands, []);
});

test("a reused explicit task volume is preserved by the consuming handle's normal teardown", async (t) => {
  const f = await fixture(t);
  const other = await startDockerContainer(
    {
      image: "public-fixture:unit",
      volumeMounts: [{ source: f.volume.name, target: "/data" }],
    },
    f.dependencies,
  );
  await other.stop();
  assert.ok(f.docker.objects.has(`volume:${f.volume.name}`));
  assert.ok(f.docker.objects.has(`container:${f.container.id}`));
  assert.ok(!f.docker.objects.has(`container:${other.getId()}`));
  await f.started.stop();
  assert.ok(!f.docker.objects.has(`volume:${f.volume.name}`));
});

test("interrupted container creation retains exact ownership for reconciliation and retry cleanup", async (t) => {
  const f = await fixture(t, { start: false });
  const nativeCommand = f.docker.command.bind(f.docker);
  f.docker.command = async (...arguments_) => {
    const result = await nativeCommand(...arguments_);
    if (arguments_[0][0] === "container" && arguments_[0][1] === "create")
      throw new Error("Creation response interrupted");
    return result;
  };
  await assert.rejects(
    startDockerContainer({ image: "public-fixture:unit" }, f.dependencies),
    /interrupted/,
  );
  let manifest = await readManifest(f.context);
  assert.equal(
    manifest.resources.find((entry) => entry.kind === "container").state,
    "pending",
  );
  assert.ok(
    manifest.resources
      .filter((entry) => entry.kind !== "container")
      .every((entry) => entry.state === "present"),
  );
  assert.equal(f.docker.removals.length, 0);
  f.docker.command = nativeCommand;
  await f.manager.reconcile(f.context);
  manifest = await readManifest(f.context);
  assert.ok(manifest.resources.every((entry) => entry.state === "present"));
  await f.manager.release(f.context);
  await f.manager.cleanup(
    await f.manager.inventory(f.context.workspace, [f.context.plan]),
    "PROCEED",
  );
  assert.ok(
    (await readManifest(f.context)).resources.every(
      (entry) => entry.state === "removed",
    ),
  );
  assert.equal(f.docker.objects.size, 1);
});

test("published fixture ports accept loopback only and reject wildcard or malformed bindings", () => {
  for (const HostIp of ["127.0.0.1", "::1"])
    requireLoopbackPublications({
      ports: { "5432/tcp": [{ HostIp, HostPort: "55000" }], "8025/tcp": null },
    });
  for (const ports of [
    [],
    "private",
    { "5432/tcp": {} },
    ...["0.0.0.0", "::", "", "192.168.1.1"].map((HostIp) => ({
      "5432/tcp": [{ HostIp, HostPort: "55000" }],
    })),
    { "5432/tcp": [{ HostIp: "127.0.0.1", HostPort: "99999" }] },
  ])
    assert.throws(() => requireLoopbackPublications({ ports }));
});

// The image handle invokes the real bound adapter against canonical records;
// its disposal must remain safe even when complete() never ran after a build.
test("image preparations reject implicit tags before reserving any resource", async (t) => {
  const f = await fixture(t, { start: false });
  const before = await readManifest(f.context);
  for (const tag of [
    "task-image",
    "namespace/task-image",
    "localhost:5000/task-image",
    "task-image@sha256:abc",
    "task-image:",
  ])
    await assert.rejects(
      prepareTrackedImage(tag, f.dependencies),
      /explicit.*tag/i,
    );
  assert.deepEqual(await readManifest(f.context), before);
  assert.equal(f.docker.objects.size, 1);
  assert.deepEqual(f.docker.commands, []);
});

test("explicit latest and registry-port tags retain exact aliases through disposal", async (t) => {
  const f = await fixture(t, { start: false });
  for (const tag of ["task-image:latest", "localhost:5000/task-image:task"]) {
    const handle = await prepareTrackedImage(tag, f.dependencies);
    const image = f.docker.create("image", handle.labels, { tags: [tag] });
    await handle.complete();
    const entry = (await readManifest(f.context)).resources.find(
      (item) => item.locator?.id === image.id,
    );
    assert.deepEqual(entry.expectedTags, [tag]);
    assert.deepEqual(entry.locator.tags, [tag]);
    await handle.dispose();
    assert.equal(f.docker.objects.has(`image:${image.id}`), false);
  }
  assert.equal(f.docker.objects.size, 1);
});

test("image handle reconciles only its failed-build image and refuses daemon or ownership changes without fallback", async (t) => {
  for (const failure of ["daemon", "ownership"]) {
    const f = await fixture(t);
    const tag = `disposal-build-${failure}:task`;
    const handle = await prepareTrackedImage(tag, {
      manager: f.manager,
      getContext: () => f.context,
    });
    const image = f.docker.create("image", handle.labels, { tags: [tag] });
    const labels = image.labels;
    if (failure === "daemon") f.docker.provider.daemonId = "replacement-daemon";
    else image.labels = { ...labels, "ai.task": "another-task" };
    await assert.rejects(handle.dispose());
    assert.deepEqual(f.docker.removals, []);
    assert.ok(f.docker.objects.has(`image:${image.id}`));
    f.docker.provider.daemonId = "fixture-stop-test-daemon";
    image.labels = labels;
    await handle.dispose();
    assert.deepEqual(f.docker.removals, [{ kind: "image", id: image.id }]);
    assert.equal(f.docker.objects.size, 4);
    const manifest = await readManifest(f.context);
    const entry = manifest.resources.find(
      (resource) => resource.kind === "image",
    );
    assert.equal(entry.state, "removed");
    assert.deepEqual(entry.expectedTags, [tag]);
  }
});

test("image handle preserves an outside alias on pending and completed builds and reports disposal failure", async (t) => {
  for (const complete of [false, true]) {
    const f = await fixture(t);
    const tag = `disposal-shared-${complete}:task`;
    const handle = await prepareTrackedImage(tag, {
      manager: f.manager,
      getContext: () => f.context,
    });
    const image = f.docker.create("image", handle.labels, { tags: [tag] });
    if (complete) await handle.complete();
    image.tags.push("outside-alias:shared");
    await assert.rejects(handle.dispose(), /shared/);
    assert.deepEqual(f.docker.removals, []);
    assert.ok(f.docker.objects.has(`image:${image.id}`));
    const entry = (await readManifest(f.context)).resources.find(
      (resource) => resource.kind === "image",
    );
    assert.equal(entry.state, "present");
    assert.deepEqual(entry.locator.tags, [tag]);
  }
});
