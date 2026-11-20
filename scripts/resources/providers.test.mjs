import assert from "node:assert/strict";
import {
  mkdir,
  mkdtemp,
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
import { DockerProvider, ownershipLabels } from "./docker.mjs";
import { IOSProvider } from "./ios.mjs";

test("Docker argument credentials bypass command-history recorders", async (t) => {
  const directory = await realpath(
    await mkdtemp(path.join(os.tmpdir(), "resource-argument-history-")),
  );
  t.after(() => rm(directory, { recursive: true, force: true }));
  const history = path.join(directory, "history.txt");
  const called = path.join(directory, "docker-called.txt");
  const args = [
    "container",
    "create",
    "--env",
    "AUTH_TOKEN=dummy-test-value",
    "fixture:unit",
    "literal $(argument); 💡",
  ];
  await writeFile(
    path.join(directory, "rtk"),
    `#!${process.execPath}\nrequire('node:fs').appendFileSync(${JSON.stringify(history)}, JSON.stringify(process.argv.slice(2))); console.log('ok');\n`,
    { mode: 0o700 },
  );
  await writeFile(
    path.join(directory, "docker"),
    `#!${process.execPath}\nrequire('node:assert/strict').deepEqual(process.argv.slice(2), ${JSON.stringify(args)}); require('node:fs').writeFileSync(${JSON.stringify(called)},'called'); console.log('ok');\n`,
    { mode: 0o700 },
  );
  const provider = new DockerProvider({
    environment: {
      ...process.env,
      PATH: `${directory}${path.delimiter}${process.env.PATH}`,
    },
  });
  assert.equal(await provider.command(args), "ok");
  await assert.rejects(stat(history), { code: "ENOENT" });
  assert.equal(await readFile(called, "utf8"), "called");
});

test("Docker sends configuration through stdin without adding it to process arguments or errors", async (t) => {
  const directory = await realpath(
    await mkdtemp(path.join(os.tmpdir(), "resource-stdin-")),
  );
  t.after(() => rm(directory, { recursive: true, force: true }));
  await writeFile(
    path.join(directory, "docker"),
    `#!${process.execPath}\nlet input = ''; for await (const chunk of process.stdin) input += chunk; console.log(JSON.stringify({input, args: process.argv.slice(2)}));\n`,
    { mode: 0o700 },
  );
  const provider = new DockerProvider({
    environment: {
      ...process.env,
      PATH: `${directory}${path.delimiter}${process.env.PATH}`,
    },
  });
  const input = JSON.stringify({
    environment: { SECRET: "private-input-$value" },
  });
  const result = JSON.parse(
    await provider.command(["compose", "--file", "-", "config"], undefined, {
      input,
    }),
  );
  assert.equal(result.input, input);
  assert.deepEqual(result.args, ["compose", "--file", "-", "config"]);
  await writeFile(
    path.join(directory, "docker"),
    `#!${process.execPath}\nprocess.stderr.write('private-input-$value'); process.exit(1);\n`,
    { mode: 0o700 },
  );
  await assert.rejects(
    provider.command(["compose", "--file", "-", "config"], undefined, {
      input,
    }),
    (error) => !error.message.includes("private-input"),
  );
  let called = false;
  const blocked = new DockerProvider({
    run: () => {
      called = true;
    },
  });
  for (const invalid of [{}, "x".repeat(8 * 1024 * 1024 + 1)])
    await assert.rejects(
      blocked.command(["compose"], undefined, { input: invalid }),
      /supported bound/,
    );
  assert.equal(called, false);
});

// Destructive provider calls have no existing behavioral coverage. Fake command
// runners cheaply prove ownership and preservation decisions without touching a
// daemon or device; mutation assertions document the exact deletion authority.
const endpoint = "unix:///tmp/task-resources-test.sock";
const dockerIdentity = { type: "docker", endpoint, daemonId: "local-daemon" };
const ids = {
  container: "a".repeat(64),
  other: "b".repeat(64),
  network: "c".repeat(64),
  image: `sha256:${"d".repeat(64)}`,
};
const created = "2026-11-19T00:00:00.000Z";
const expected = ownershipLabels(
  { workspace: "/workspace" },
  { taskId: "task" },
  { id: "entry", executionId: "execution" },
);

function dockerFixture({
  daemonId = dockerIdentity.daemonId,
  fail,
  inspectOutput,
  hiddenImages = false,
} = {}) {
  const objects = {
    container: new Map(),
    volume: new Map(),
    network: new Map(),
    image: new Map(),
  };
  const calls = [];
  const run = async (file, original) => {
    assert.equal(file, "docker");
    let args = original;
    if (args[0] === "--host") {
      assert.equal(args[1], endpoint);
      args = args.slice(2);
    }
    calls.push(args);
    if (fail?.(args)) throw new Error("private provider diagnostic");
    if (args[0] === "context") return { stdout: endpoint };
    if (args[0] === "info") return { stdout: daemonId };
    const [kind, operation] = args;
    assert.ok(objects[kind], `Unexpected Docker operation: ${args.join(" ")}`);
    if (
      operation === "ls" &&
      kind === "image" &&
      hiddenImages &&
      !args.includes("--all")
    )
      return { stdout: "" };
    if (operation === "ls")
      return { stdout: [...objects[kind].keys()].join("\n") };
    if (operation === "inspect") {
      const formatIndex = args.indexOf("--format");
      assert.ok(
        formatIndex >= 0,
        "Provider inspection must request bounded metadata",
      );
      const requestedIds = args.slice(formatIndex + 2);
      const inspected = requestedIds.map((id) => {
        const object = objects[kind].get(id);
        assert.ok(
          object,
          "Tests must not invent an inspect result for an absent object",
        );
        return object;
      });
      return {
        stdout:
          typeof inspectOutput === "function"
            ? inspectOutput(inspected, kind)
            : (inspectOutput ??
              inspected.map((object) => JSON.stringify(object)).join("\n")),
      };
    }
    if (operation === "rm") {
      objects[kind].delete(args.at(-1));
      return { stdout: args.at(-1) };
    }
    assert.fail(`Unexpected Docker operation: ${args.join(" ")}`);
  };
  return {
    provider: new DockerProvider({ run, environment: {} }),
    objects,
    calls,
    mutations: () => calls.filter((args) => args[1] === "rm"),
  };
}

function dockerEntry(kind, overrides = {}) {
  const locator =
    kind === "volume"
      ? { name: "task-volume", created, containerId: null }
      : kind === "image"
        ? { id: ids.image, tags: ["task-image:task"] }
        : { id: ids[kind], created };
  return {
    id: "entry",
    executionId: "execution",
    kind,
    provider: dockerIdentity,
    locator,
    ...overrides,
  };
}

test("Docker hidden intermediate or dangling images remain present until exact native deletion", async () => {
  const f = dockerFixture({ hiddenImages: true });
  const entry = dockerEntry("image");
  addDocker(f, entry);
  assert.equal((await f.provider.verify(entry, expected)).state, "present");
  assert.deepEqual(f.mutations(), []);
});

function addDocker(fixture, entry, overrides = {}) {
  const object = {
    id: entry.locator.id,
    name: entry.locator.name,
    created,
    labels: { ...expected },
    mounts: [],
    containers: {},
    image: ids.image,
    tags: ["task-image:task"],
    ...overrides,
  };
  fixture.objects[entry.kind].set(
    entry.locator.name ?? entry.locator.id,
    object,
  );
  return object;
}

test("Docker pins a verified local endpoint and daemon identity", async () => {
  const fixture = dockerFixture();
  assert.deepEqual(await fixture.provider.identity(), dockerIdentity);
  for (const remote of [
    "tcp://127.0.0.1:2375",
    "ssh://machine",
    "unix:///tmp/socket\n",
  ]) {
    let ran = false;
    const provider = new DockerProvider({
      environment: { DOCKER_HOST: remote },
      run: async () => {
        ran = true;
      },
    });
    await assert.rejects(provider.identity(), /local Unix-socket/);
    assert.equal(
      ran,
      false,
      "Reject an unsafe endpoint before contacting a provider",
    );
  }
  const changed = dockerFixture({ daemonId: "replacement-daemon" });
  await assert.rejects(
    changed.provider.remove(dockerEntry("container")),
    /identity changed/,
  );
  assert.deepEqual(changed.mutations(), []);
});

test("Docker rejects a changed endpoint before resource inspection", async () => {
  const fixture = dockerFixture();
  const entry = dockerEntry("container", {
    provider: { ...dockerIdentity, endpoint: "unix:///tmp/previous.sock" },
  });
  await assert.rejects(
    fixture.provider.verify(entry, expected),
    /identity changed/,
  );
  assert.equal(
    fixture.calls.some(
      (args) => args[0] === "container" && args[1] === "inspect",
    ),
    false,
  );
});

test("Docker's default environment follows process.env replacement and refuses a newly remote endpoint", async () => {
  const original = process.env;
  let providerCalls = 0;
  try {
    process.env = { DOCKER_HOST: endpoint };
    const provider = new DockerProvider({
      run: async (file, args, options) => {
        providerCalls++;
        assert.equal(file, "docker");
        assert.deepEqual(args, [
          "--host",
          endpoint,
          "info",
          "--format",
          "{{.ID}}",
        ]);
        assert.ok(
          options.env === process.env,
          "Provider commands must use the current environment object",
        );
        return { stdout: dockerIdentity.daemonId };
      },
    });
    process.env = { DOCKER_HOST: endpoint };
    assert.deepEqual(await provider.identity(), dockerIdentity);
    process.env = { DOCKER_HOST: "ssh://remote-host" };
    await assert.rejects(provider.identity(), /local Unix-socket/);
    assert.equal(
      providerCalls,
      1,
      "A replacement remote endpoint must be refused before another provider command",
    );
  } finally {
    process.env = original;
  }
});

test("Docker absence requires a successful listing; unavailable and malformed responses remain unverified", async () => {
  const absent = dockerFixture();
  assert.deepEqual(
    await absent.provider.verify(dockerEntry("container"), expected),
    { state: "absent" },
  );
  for (const operation of ["info", "ls", "inspect"]) {
    const fixture = dockerFixture({
      fail: (args) =>
        operation === "info" ? args[0] === "info" : args[1] === operation,
    });
    addDocker(fixture, dockerEntry("container"));
    await assert.rejects(
      fixture.provider.verify(dockerEntry("container"), expected),
      /unverified|no absence/,
    );
    assert.deepEqual(fixture.mutations(), []);
  }
  const malformed = dockerFixture({ inspectOutput: "not JSON" });
  addDocker(malformed, dockerEntry("container"));
  await assert.rejects(
    malformed.provider.verify(dockerEntry("container"), expected),
    /no absence/,
  );
});

test("Docker never includes provider diagnostics in failure messages", async () => {
  const fixture = dockerFixture({ fail: () => true });
  await assert.rejects(fixture.provider.identity(), (error) => {
    assert.doesNotMatch(error.message, /private provider diagnostic/);
    return true;
  });
});

test("Docker attachment inventory inspects the complete container set in one batch", async () => {
  const fixture = dockerFixture();
  addDocker(fixture, dockerEntry("container"));
  addDocker(
    fixture,
    dockerEntry("container", {
      locator: { id: ids.other, created },
    }),
    { running: false },
  );
  const inspected = await fixture.provider.containers(dockerIdentity);
  assert.deepEqual(
    inspected.map((container) => container.id),
    [ids.container, ids.other],
  );
  assert.equal(inspected[1].running, false);
  const inspections = fixture.calls.filter(
    (args) => args[0] === "container" && args[1] === "inspect",
  );
  assert.equal(
    inspections.length,
    1,
    "Attachment inventory must avoid one native invocation per existing container",
  );
  assert.deepEqual(
    new Set(inspections[0].slice(inspections[0].indexOf("--format") + 2)),
    new Set([ids.container, ids.other]),
  );
});

test("Docker attachment inventory refuses incomplete, duplicate, unexpected or malformed batch responses", async () => {
  for (const output of [
    (objects) => JSON.stringify(objects[0]),
    (objects) =>
      [objects[0], objects[0]]
        .map((object) => JSON.stringify(object))
        .join("\n"),
    (objects) =>
      [objects[0], { ...objects[1], id: "e".repeat(64) }]
        .map((object) => JSON.stringify(object))
        .join("\n"),
    () => "not JSON\nnot JSON",
  ]) {
    const fixture = dockerFixture({ inspectOutput: output });
    addDocker(fixture, dockerEntry("container"));
    addDocker(
      fixture,
      dockerEntry("container", { locator: { id: ids.other, created } }),
    );
    await assert.rejects(
      fixture.provider.containers(dockerIdentity),
      /inspect|inventory|container|incomplete|unverified|unexpected/i,
    );
    assert.deepEqual(fixture.mutations(), []);
  }
});

test("Docker allows null optional mount declarations without weakening attachment inspection", async () => {
  const fixture = dockerFixture();
  const entry = dockerEntry("container");
  addDocker(fixture, entry, {
    declaredVolumes: null,
    binds: null,
    requestedMounts: null,
  });
  assert.equal(
    (await fixture.provider.verify(entry, expected)).state,
    "present",
  );
  const [actual] = await fixture.provider.containers(dockerIdentity);
  assert.equal(actual.declaredVolumes, null);
  assert.equal(actual.binds, null);
  assert.equal(actual.requestedMounts, null);
  assert.deepEqual(actual.mounts, []);
});

test("Docker network attachment checks use the network's exact membership inventory", async () => {
  const fixture = dockerFixture({ fail: (args) => args[0] === "container" });
  const entry = dockerEntry("network");
  addDocker(fixture, entry, { containers: {} });
  assert.deepEqual(await fixture.provider.verify(entry, expected), {
    state: "present",
  });
});

for (const kind of ["container", "volume", "network", "image"]) {
  test(`Docker ${kind} requires all task, execution, entry and workspace ownership labels`, async () => {
    for (const key of Object.keys(expected)) {
      const fixture = dockerFixture();
      const entry = dockerEntry(kind);
      addDocker(fixture, entry, {
        labels: { ...expected, [key]: "another-owner" },
      });
      await assert.rejects(
        fixture.provider.verify(entry, expected),
        /Ownership mismatch/,
      );
      assert.deepEqual(fixture.mutations(), []);
    }
  });
}

for (const kind of ["container", "volume", "network"]) {
  test(`Docker ${kind} refuses a replacement with the same locator but a different creation identity`, async () => {
    const fixture = dockerFixture();
    const entry = dockerEntry(kind);
    addDocker(fixture, entry, { created: "2026-11-19T01:00:00.000Z" });
    await assert.rejects(fixture.provider.verify(entry, expected), /replaced/);
  });
}

test("Docker network permits selected containers and refuses an external attachment", async () => {
  const fixture = dockerFixture();
  const entry = dockerEntry("network");
  const network = addDocker(fixture, entry, {
    containers: { [ids.container]: {} },
  });
  assert.deepEqual(
    await fixture.provider.verify(entry, expected, new Set([ids.container])),
    { state: "present" },
  );
  network.containers[ids.other] = {};
  await assert.rejects(
    fixture.provider.verify(entry, expected, new Set([ids.container])),
    /another container/,
  );
});

test("Docker volume refuses attachment by another container, including stopped containers", async () => {
  const fixture = dockerFixture();
  const entry = dockerEntry("volume");
  addDocker(fixture, entry);
  addDocker(fixture, dockerEntry("container"), {
    running: false,
    mounts: [{ Type: "volume", Name: entry.locator.name }],
  });
  await assert.rejects(
    fixture.provider.verify(entry, expected),
    /another container/,
  );
  assert.deepEqual(
    await fixture.provider.verify(entry, expected, new Set([ids.container])),
    { state: "present" },
  );
  assert.ok(
    fixture.calls.some(
      (args) =>
        args[0] === "container" && args[1] === "ls" && args.includes("--all"),
    ),
  );
});

test("Docker rejects forged unlabelled volume ownership even with a fabricated absent parent", async () => {
  const fixture = dockerFixture();
  const entry = dockerEntry("volume");
  entry.locator.containerId = ids.container;
  addDocker(fixture, entry, { labels: {} });
  await assert.rejects(
    fixture.provider.verify(entry, expected),
    /Ownership mismatch/,
  );
  assert.deepEqual(fixture.mutations(), []);
});

test("Docker labelled volume keeps corroboration when its parent is present", async () => {
  for (const invalidParent of [
    { labels: { ...expected, "ai.execution": "other" } },
    {
      mounts: [{ Type: "bind", Name: "task-volume", Source: "/private/data" }],
    },
    { mounts: [{ Type: "volume", Name: "other-volume" }] },
  ]) {
    const fixture = dockerFixture();
    const entry = dockerEntry("volume");
    entry.locator.containerId = ids.container;
    addDocker(fixture, entry);
    addDocker(fixture, dockerEntry("container"), {
      mounts: [{ Type: "volume", Name: "task-volume" }],
      ...invalidParent,
    });
    await assert.rejects(
      fixture.provider.verify(entry, expected, new Set([ids.container])),
      /corroborates ownership/,
    );
  }
  const fixture = dockerFixture();
  const entry = dockerEntry("volume");
  entry.locator.containerId = ids.container;
  addDocker(fixture, entry);
  addDocker(fixture, dockerEntry("container"), {
    labels: { ...expected, "ai.resource": "parent-entry" },
    mounts: [{ Type: "volume", Name: "task-volume" }],
  });
  assert.deepEqual(
    await fixture.provider.verify(entry, expected, new Set([ids.container])),
    { state: "present" },
  );
  fixture.objects.container.delete(ids.container);
  assert.deepEqual(await fixture.provider.verify(entry, expected), {
    state: "present",
  });
});

test("Docker images preserve non-task tags and references from other containers", async () => {
  for (const sharing of ["tag", "container"]) {
    const fixture = dockerFixture();
    const entry = dockerEntry("image");
    const image = addDocker(fixture, entry);
    if (sharing === "tag") image.tags.push("personal-image:latest");
    else addDocker(fixture, dockerEntry("container"), { running: false });
    assert.equal(
      (await fixture.provider.verify(entry, expected)).state,
      "preserved",
    );
    assert.deepEqual(fixture.mutations(), []);
    if (sharing === "container") {
      assert.deepEqual(
        await fixture.provider.verify(
          entry,
          expected,
          new Set([ids.container]),
        ),
        { state: "present" },
      );
    }
  }
});

test("Docker removal uses exact locators, never volume cascades, forced images or bind target deletion", async () => {
  const fixture = dockerFixture();
  for (const kind of ["container", "volume", "network", "image"]) {
    const entry = dockerEntry(kind);
    addDocker(fixture, entry, {
      mounts: [
        {
          Type: "bind",
          Source: "/private/personal-data",
          Destination: "/data",
        },
      ],
    });
    await fixture.provider.remove(entry);
    assert.equal(fixture.objects[kind].size, 0);
  }
  assert.deepEqual(fixture.mutations(), [
    ["container", "rm", "--force", ids.container],
    ["volume", "rm", "task-volume"],
    ["network", "rm", ids.network],
    ["image", "rm", ids.image],
  ]);
});

const udid = "11111111-1111-4111-8111-111111111111";
const otherUDID = "22222222-2222-4222-8222-222222222222";
const deviceType = "com.apple.CoreSimulator.SimDeviceType.iPhone-17";
const runtime = "com.apple.CoreSimulator.SimRuntime.iOS-26-0";
const iosOwnership = {
  taskId: "33333333-3333-4333-8333-333333333333",
  executionId: "44444444-4444-4444-8444-444444444444",
  entryId: "55555555-5555-4555-8555-555555555555",
};

async function iosFixture(
  t,
  {
    processes = "",
    fail,
    createdUDID = udid,
    omitCreated = false,
    createdOverrides = {},
    createdRuntime = runtime,
  } = {},
) {
  const temporary = await mkdtemp(
    path.join(os.tmpdir(), "task-provider-test-"),
  );
  const deviceSet = await realpath(temporary);
  t.after(() => rm(temporary, { recursive: true, force: true }));
  const inventory = {
    devices: { [runtime]: [] },
    runtimes: [{ identifier: runtime, name: "iOS 26.0", isAvailable: true }],
    devicetypes: [{ identifier: deviceType, name: "iPhone 17" }],
  };
  const calls = [];
  const run = async (file, args) => {
    assert.equal(file, "rtk");
    if (args[1] === "ps") {
      if (fail?.(["ps"])) throw new Error("private process diagnostic");
      return { stdout: processes };
    }
    assert.deepEqual(args.slice(0, 5), [
      "proxy",
      "xcrun",
      "simctl",
      "--set",
      deviceSet,
    ]);
    const command = args.slice(5);
    calls.push(command);
    if (fail?.(command)) throw new Error("private simulator diagnostic");
    if (command[0] === "list") return { stdout: JSON.stringify(inventory) };
    if (command[0] === "create") {
      if (!omitCreated) {
        (inventory.devices[createdRuntime] ??= []).push({
          udid: createdUDID,
          name: command[1],
          deviceTypeIdentifier: deviceType,
          state: "Shutdown",
          isAvailable: true,
          ...createdOverrides,
        });
        await mkdir(path.join(deviceSet, createdUDID, "data"), {
          recursive: true,
        });
      }
      return { stdout: createdUDID };
    }
    if (command[0] === "shutdown") {
      inventory.devices[runtime].find(
        (device) => device.udid === command[1],
      ).state = "Shutdown";
      return { stdout: "" };
    }
    if (command[0] === "delete") {
      inventory.devices[runtime] = inventory.devices[runtime].filter(
        (device) => device.udid !== command[1],
      );
      return { stdout: "" };
    }
    assert.fail(`Unexpected Simulator operation: ${command.join(" ")}`);
  };
  const provider = new IOSProvider({ run, deviceSet });
  const identity = await provider.identity();
  const entry = {
    provider: identity,
    ownership: iosOwnership,
    locator: { udid, deviceType, runtime, name: "iPhone 17 — iOS 26.0" },
  };
  const options = { workspace: deviceSet };
  const ownership = { ...iosOwnership, ...options };
  const proofPath = (deviceUDID = udid) =>
    path.join(deviceSet, deviceUDID, "data", ".task-resources-owner.json");
  const addDevice = (overrides = {}) => {
    const device = {
      udid,
      deviceTypeIdentifier: deviceType,
      name: entry.locator.name,
      isAvailable: true,
      state: "Shutdown",
      ...overrides,
    };
    inventory.devices[runtime].push(device);
    return device;
  };
  const addOwnedDevice = async (overrides = {}) => {
    const device = addDevice(overrides);
    await mkdir(path.dirname(proofPath(device.udid)), { recursive: true });
    await writeFile(
      proofPath(device.udid),
      JSON.stringify({
        ...ownership,
        udid: device.udid.toLowerCase(),
      }),
      { mode: 0o600 },
    );
    return device;
  };
  return {
    provider,
    identity,
    entry,
    inventory,
    calls,
    addDevice,
    addOwnedDevice,
    deviceSet,
    ownership,
    options,
    proofPath,
  };
}

test("iOS rejects a forged manifest for an existing personal device without native ownership proof", async (t) => {
  const fixture = await iosFixture(t);
  fixture.addDevice();
  await assert.rejects(
    fixture.provider.remove(fixture.entry, { workspace: fixture.deviceSet }),
    /ownership/i,
  );
  assert.equal(
    fixture.calls.some((args) => ["shutdown", "delete"].includes(args[0])),
    false,
  );
});

test("iOS verifies a canonical real device set and refuses changed or symlinked sets", async (t) => {
  const fixture = await iosFixture(t);
  assert.deepEqual(fixture.identity, {
    type: "ios",
    deviceSet: fixture.deviceSet,
  });
  await assert.rejects(
    fixture.provider.devices({
      ...fixture.identity,
      deviceSet: `${fixture.deviceSet}-other`,
    }),
    /device set changed/,
  );
  const link = `${fixture.deviceSet}-link`;
  await symlink(fixture.deviceSet, link);
  t.after(() => rm(link, { force: true }));
  await assert.rejects(
    new IOSProvider({ deviceSet: link }).identity(),
    /Unsafe Simulator/,
  );
});

test("iOS unavailable tools and process inspection are never treated as an absent device", async (t) => {
  for (const operation of ["list", "ps"]) {
    const fixture = await iosFixture(t, {
      fail: (args) => args[0] === operation,
    });
    await fixture.addOwnedDevice();
    await assert.rejects(
      fixture.provider.verify(fixture.entry, fixture.options),
      /unverified|availability/,
    );
    assert.equal(
      fixture.calls.some((args) => ["shutdown", "delete"].includes(args[0])),
      false,
    );
  }
  const absent = await iosFixture(t);
  assert.deepEqual(await absent.provider.verify(absent.entry, absent.options), {
    state: "absent",
  });
});

test("iOS verification targets exact UDID, model and runtime rather than a matching display name", async (t) => {
  const fixture = await iosFixture(t);
  fixture.addDevice({ udid: otherUDID });
  assert.deepEqual(
    await fixture.provider.verify(fixture.entry, fixture.options),
    {
      state: "absent",
    },
  );
  const device = fixture.addDevice({ deviceTypeIdentifier: "another-model" });
  await assert.rejects(
    fixture.provider.verify(fixture.entry, fixture.options),
    /identity changed/,
  );
  device.deviceTypeIdentifier = deviceType;
  const moved = fixture.inventory.devices[runtime].pop();
  fixture.inventory.devices[`${runtime}-other`] = [moved];
  await assert.rejects(
    fixture.provider.verify(fixture.entry, fixture.options),
    /identity changed/,
  );
});

test("iOS treats letter-case variants of one UDID as the same device identity", async (t) => {
  const fixture = await iosFixture(t);
  const lowercase = "abcdefab-cdef-4abc-8def-abcdefabcdef";
  fixture.entry.locator.udid = lowercase;
  await fixture.addOwnedDevice({ udid: lowercase.toUpperCase() });
  assert.equal(
    (await fixture.provider.verify(fixture.entry, fixture.options)).state,
    "present",
  );
  fixture.addDevice({ udid: lowercase });
  await assert.rejects(
    fixture.provider.verify(fixture.entry, fixture.options),
    /Ambiguous Simulator identifier/,
  );
});

test("iOS creation refuses adoption when a pre-existing UDID is returned with different letter case", async (t) => {
  const lowercase = "abcdefab-cdef-4abc-8def-abcdefabcdef";
  const fixture = await iosFixture(t, {
    createdUDID: lowercase.toUpperCase(),
    omitCreated: true,
  });
  fixture.addDevice({ udid: lowercase });
  await assert.rejects(
    fixture.provider.create(
      { deviceType, runtime },
      fixture.identity,
      fixture.ownership,
    ),
    /pre-existing identifier/,
  );
  assert.equal(fixture.inventory.devices[runtime].length, 1);
});

test("iOS refuses an unavailable recorded device or runtime", async (t) => {
  for (const unavailable of ["device", "runtime"]) {
    const fixture = await iosFixture(t);
    fixture.addDevice({ isAvailable: unavailable !== "device" });
    if (unavailable === "runtime")
      fixture.inventory.runtimes[0].isAvailable = false;
    await assert.rejects(
      fixture.provider.verify(fixture.entry, fixture.options),
      /available|unavailable/,
    );
  }
});

test("iOS creates a new dedicated device without adopting a matching existing device", async (t) => {
  const fixture = await iosFixture(t);
  fixture.addDevice({ udid: otherUDID });
  const locator = await fixture.provider.create(
    { deviceType, runtime },
    fixture.identity,
    fixture.ownership,
  );
  assert.equal(locator.udid, udid);
  assert.equal(locator.name, "iPhone 17 — iOS 26.0 (2)");
  assert.deepEqual(JSON.parse(await readFile(fixture.proofPath(), "utf8")), {
    ...fixture.ownership,
    udid,
  });
  assert.equal((await stat(fixture.proofPath())).mode & 0o777, 0o600);
  assert.equal(fixture.inventory.devices[runtime].length, 2);
  assert.equal(
    (
      await fixture.provider.verify(
        { provider: fixture.identity, locator, ownership: iosOwnership },
        fixture.options,
      )
    ).state,
    "present",
  );
  assert.ok(
    fixture.inventory.devices[runtime].some(
      (device) => device.udid === otherUDID,
    ),
  );
});

test("iOS present devices require exact task, execution, entry, workspace and UDID proof", async (t) => {
  for (const field of [
    "taskId",
    "executionId",
    "entryId",
    "workspace",
    "udid",
  ]) {
    const fixture = await iosFixture(t);
    await fixture.addOwnedDevice();
    const proof = JSON.parse(await readFile(fixture.proofPath(), "utf8"));
    proof[field] =
      field === "workspace" ? `${fixture.deviceSet}-other` : otherUDID;
    await writeFile(fixture.proofPath(), JSON.stringify(proof));
    await assert.rejects(
      fixture.provider.remove(fixture.entry, fixture.options),
      /ownership proof/,
    );
    assert.equal(
      fixture.calls.some((args) => ["shutdown", "delete"].includes(args[0])),
      false,
    );
  }
  const fixture = await iosFixture(t);
  await fixture.addOwnedDevice();
  await assert.rejects(
    fixture.provider.verify(
      { ...fixture.entry, ownership: undefined },
      fixture.options,
    ),
    /ownership/,
  );
  await assert.rejects(fixture.provider.verify(fixture.entry), /ownership/);
  await assert.rejects(
    fixture.provider.verify(fixture.entry, {
      workspace: `${fixture.deviceSet}-other`,
    }),
    /ownership/,
  );
});

test("iOS refuses unknown, malformed, oversized and symlinked native ownership proof", async (t) => {
  for (const damage of [
    "unknown",
    "malformed",
    "oversized",
    "symlink",
    "directory",
    "ancestor",
  ]) {
    const fixture = await iosFixture(t);
    await fixture.addOwnedDevice();
    const target = fixture.proofPath();
    const proof = await readFile(target, "utf8");
    if (damage === "unknown")
      await writeFile(
        target,
        JSON.stringify({ ...JSON.parse(proof), unknown: true }),
      );
    if (damage === "malformed") await writeFile(target, "not JSON");
    if (damage === "oversized")
      await writeFile(target, `${proof}${" ".repeat(8192)}`);
    if (damage === "symlink") {
      const outside = path.join(fixture.deviceSet, "personal-proof.json");
      await writeFile(outside, proof);
      await rm(target);
      await symlink(outside, target);
    }
    if (damage === "directory") {
      await rm(target);
      await mkdir(target);
    }
    if (damage === "ancestor") {
      const outside = path.join(fixture.deviceSet, "personal-data");
      await mkdir(outside);
      await writeFile(path.join(outside, path.basename(target)), proof);
      await rm(path.dirname(target), { recursive: true });
      await symlink(outside, path.dirname(target));
    }
    await assert.rejects(
      fixture.provider.remove(fixture.entry, fixture.options),
      /ownership/,
    );
    assert.equal(
      fixture.calls.some((args) => ["shutdown", "delete"].includes(args[0])),
      false,
    );
  }
});

test("iOS creation validates strict ownership and normalized paths before allocating", async (t) => {
  const fixture = await iosFixture(t);
  for (const ownership of [
    undefined,
    { ...fixture.ownership, taskId: "not-a-uuid" },
    { ...fixture.ownership, executionId: "not-a-uuid" },
    { ...fixture.ownership, entryId: "not-a-uuid" },
    { ...fixture.ownership, workspace: "relative/path" },
    { ...fixture.ownership, workspace: "/workspace/../personal" },
    { ...fixture.ownership, workspace: "/workspace\u0000" },
    { ...fixture.ownership, unknown: true },
  ]) {
    await assert.rejects(
      fixture.provider.create(
        { deviceType, runtime },
        fixture.identity,
        ownership,
      ),
      /ownership/,
    );
  }
  assert.equal(
    fixture.calls.some((args) => args[0] === "create"),
    false,
  );
});

test("iOS never plants ownership on a returned existing device or a new mismatched model/runtime", async (t) => {
  const existing = await iosFixture(t, { omitCreated: true });
  existing.addDevice();
  await mkdir(path.dirname(existing.proofPath()), { recursive: true });
  await assert.rejects(
    existing.provider.create(
      { deviceType, runtime },
      existing.identity,
      existing.ownership,
    ),
    /pre-existing identifier/,
  );
  await assert.rejects(readFile(existing.proofPath()), { code: "ENOENT" });
  for (const options of [
    { createdOverrides: { deviceTypeIdentifier: "personal-model" } },
    { createdRuntime: `${runtime}-other` },
  ]) {
    const wrong = await iosFixture(t, options);
    await assert.rejects(
      wrong.provider.create(
        { deviceType, runtime },
        wrong.identity,
        wrong.ownership,
      ),
      /identity changed/,
    );
    await assert.rejects(readFile(wrong.proofPath()), { code: "ENOENT" });
  }
});

test("iOS creation never overwrites an existing ownership file", async (t) => {
  const fixture = await iosFixture(t);
  await mkdir(path.dirname(fixture.proofPath()), { recursive: true });
  await writeFile(fixture.proofPath(), "preserve existing evidence");
  await assert.rejects(
    fixture.provider.create(
      { deviceType, runtime },
      fixture.identity,
      fixture.ownership,
    ),
    /ownership; allocation remains pending/,
  );
  assert.equal(
    await readFile(fixture.proofPath(), "utf8"),
    "preserve existing evidence",
  );
});

test("iOS creation refuses wrong platforms and unavailable models or runtimes before allocation", async (t) => {
  const fixture = await iosFixture(t);
  for (const requested of [
    { deviceType: "missing-model", runtime },
    { deviceType, runtime: "missing-runtime" },
    { deviceType, runtime: "com.apple.CoreSimulator.SimRuntime.tvOS-26-0" },
  ]) {
    await assert.rejects(
      fixture.provider.create(requested, fixture.identity, fixture.ownership),
      /not installed and available/,
    );
  }
  fixture.inventory.runtimes[0].isAvailable = false;
  await assert.rejects(
    fixture.provider.create(
      { deviceType, runtime },
      fixture.identity,
      fixture.ownership,
    ),
    /not installed and available/,
  );
  assert.equal(
    fixture.calls.some((args) => args[0] === "create"),
    false,
  );
});

test("iOS creation rejects a returned existing UDID and an uncorroborated new UDID", async (t) => {
  const existing = await iosFixture(t, {
    createdUDID: otherUDID,
    omitCreated: true,
  });
  existing.addDevice({ udid: otherUDID });
  await assert.rejects(
    existing.provider.create(
      { deviceType, runtime },
      existing.identity,
      existing.ownership,
    ),
    /pre-existing identifier/,
  );
  const missing = await iosFixture(t, { omitCreated: true });
  await assert.rejects(
    missing.provider.create(
      { deviceType, runtime },
      missing.identity,
      missing.ownership,
    ),
    /not present|not found|corroborat|absent/,
  );
  const invalid = await iosFixture(t, {
    createdUDID: "not-a-udid",
    omitCreated: true,
  });
  await assert.rejects(
    invalid.provider.create(
      { deviceType, runtime },
      invalid.identity,
      invalid.ownership,
    ),
    /allocation remains pending/,
  );
});

test("iOS active test processes block deletion only for the exact selected device", async (t) => {
  for (const command of [
    "maestro",
    "xcodebuild",
    "xctest",
    "detox",
    "appium",
  ]) {
    const fixture = await iosFixture(t, {
      processes: `100 ${command} --device ${udid.toUpperCase()}`,
    });
    await fixture.addOwnedDevice({ state: "Booted" });
    await assert.rejects(
      fixture.provider.remove(fixture.entry, fixture.options),
      /active test process/,
    );
    assert.equal(
      fixture.calls.some((args) => ["shutdown", "delete"].includes(args[0])),
      false,
    );
  }
  const unrelated = await iosFixture(t, {
    processes: `100 xcodebuild --device ${otherUDID}\n101 Simulator ${udid}`,
  });
  await unrelated.addOwnedDevice();
  assert.equal(
    (await unrelated.provider.verify(unrelated.entry, unrelated.options)).state,
    "present",
  );
});

test("iOS shutdown and deletion affect only the recorded UDID and verify final absence", async (t) => {
  const fixture = await iosFixture(t);
  await fixture.addOwnedDevice({ state: "Booted" });
  fixture.addDevice({ udid: otherUDID, state: "Booted" });
  await fixture.provider.remove(fixture.entry, fixture.options);
  assert.deepEqual(
    fixture.calls.filter((args) => ["shutdown", "delete"].includes(args[0])),
    [
      ["shutdown", udid],
      ["delete", udid],
    ],
  );
  assert.deepEqual(
    fixture.inventory.devices[runtime].map((device) => device.udid),
    [otherUDID],
  );
  assert.equal(fixture.inventory.devices[runtime][0].state, "Booted");
  assert.equal(fixture.inventory.runtimes[0].identifier, runtime);
  await fixture.provider.remove(fixture.entry, fixture.options);
  assert.equal(
    fixture.calls.filter((args) => args[0] === "delete").length,
    1,
    "A retry of a verified absent UDID must not delete a replacement by name",
  );
});
