// Explicit native smoke only: never import this file into the fast test suite.
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { execFile } from "node:child_process";
import { mkdtemp, mkdir, realpath, stat, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { promisify } from "node:util";
import { DockerProvider, ownershipLabels } from "./docker.mjs";
import {
  prepareTrackedImage,
  startDockerContainer,
  startDockerNetwork,
  trackedCompose,
} from "./fixtures.mjs";
import { IOSProvider } from "./ios.mjs";
import { ResourceManager } from "./manager.mjs";
import { disposeDockerAllocations } from "./disposal.mjs";
import { ContextSchema } from "./schema.mjs";
import { initExecution, readAllManifests, readManifest } from "./store.mjs";

const execute = promisify(execFile);
const selectedPlan = ".ai/plans/selected-task.md";
const excludedPlan = ".ai/plans/excluded-task.md";
const postgres = "postgres:18.6-bookworm";
const mailpit = "axllent/mailpit:v1.27.8";
const seaweed = "chrislusf/seaweedfs:4.53";

function options(argv) {
  if (argv.length === 1 && argv[0] === "--help") return null;
  const result = {};
  for (let index = 0; index < argv.length; index++) {
    const flag = argv[index];
    if (flag === "--docker" || flag === "--ios") {
      if (result.provider) throw new Error("Select exactly one provider");
      result.provider = flag.slice(2);
    } else if (flag === "--ports-only") {
      if (result.portsOnly) throw new Error("Duplicate ports-only option");
      result.portsOnly = true;
    } else if (flag === "--recovery-only") {
      if (result.recoveryOnly)
        throw new Error("Duplicate recovery-only option");
      result.recoveryOnly = true;
    } else if (["--fixture-id", "--device-type", "--runtime"].includes(flag)) {
      if (result[flag] || !argv[index + 1] || argv[index + 1].startsWith("--"))
        throw new Error(`Missing or duplicate ${flag}`);
      result[flag] = argv[++index];
    } else throw new Error("Unknown smoke argument; use --help");
  }
  if (!result.provider) throw new Error("Select --docker or --ios");
  ContextSchema.shape.executionId.parse(result["--fixture-id"]);
  result["--fixture-id"] = result["--fixture-id"].toLowerCase();
  if (result.portsOnly && result.recoveryOnly)
    throw new Error("Select only one focused Docker smoke mode");
  if (result.provider === "ios") {
    if (result.portsOnly || result.recoveryOnly)
      throw new Error("Focused Docker checks require Docker");
    if (
      !result["--device-type"]?.startsWith(
        "com.apple.CoreSimulator.SimDeviceType.",
      ) ||
      !result["--runtime"]?.startsWith(
        "com.apple.CoreSimulator.SimRuntime.iOS-",
      )
    )
      throw new Error("iOS smoke requires the explicit approved model/runtime");
  } else if (result["--device-type"] || result["--runtime"])
    throw new Error("Device arguments are only supported with --ios");
  return result;
}

async function git(directory, ...args) {
  try {
    return (
      await execute("rtk", ["proxy", "git", "-C", directory, ...args], {
        encoding: "utf8",
        timeout: 30_000,
        env: {
          PATH: process.env.PATH,
          GIT_CONFIG_NOSYSTEM: "1",
          GIT_CONFIG_GLOBAL: "/dev/null",
          GIT_AUTHOR_NAME: "Disposable resource smoke",
          GIT_AUTHOR_EMAIL: "smoke@invalid.example",
          GIT_COMMITTER_NAME: "Disposable resource smoke",
          GIT_COMMITTER_EMAIL: "smoke@invalid.example",
        },
      })
    ).stdout.trim();
  } catch {
    throw new Error("Disposable Git fixture operation failed");
  }
}

async function workspaceFixture(fixtureId, onCreated) {
  const workspace = await mkdtemp(
    path.join(
      await realpath(os.tmpdir()),
      `task-resource-smoke-${fixtureId}-` + "$HOME-$$-",
    ),
  );
  onCreated(workspace);
  const workflow = path.join(workspace, ".ai");
  const app = path.join(workspace, "app");
  await mkdir(path.join(workflow, "plans"), { recursive: true });
  await mkdir(app);
  await writeFile(
    path.join(workspace, selectedPlan),
    "# Selected disposable task\n",
  );
  await writeFile(
    path.join(workspace, excludedPlan),
    "# Excluded disposable task\n",
  );
  for (const repository of [workflow, app]) {
    await git(repository, "init", "--initial-branch=smoke-source");
    await writeFile(path.join(repository, "fixture.txt"), `${fixtureId}\n`);
    await git(repository, "add", ".");
    await git(
      repository,
      "-c",
      "core.hooksPath=/dev/null",
      "commit",
      "-m",
      "Disposable smoke fixture",
    );
  }
  const worktreeRoot = path.join(workspace, ".worktrees", "selected-task");
  await mkdir(worktreeRoot, { recursive: true });
  await git(
    app,
    "worktree",
    "add",
    "-b",
    "smoke-worktree",
    path.join(worktreeRoot, "app"),
  );
  // A task-local workflow directory must never receive a substitute manifest.
  await mkdir(path.join(worktreeRoot, ".ai"));
  const root = await initExecution({
    workspace,
    plan: selectedPlan,
    projectName: "Resource Smoke",
  });
  const worktree = await initExecution({
    workspace,
    plan: selectedPlan,
    root: worktreeRoot,
  });
  const excluded = await initExecution({
    workspace,
    plan: excludedPlan,
    projectName: "Resource Smoke",
  });
  assert.notEqual(root.executionId, worktree.executionId);
  assert.equal((await readAllManifests(workspace)).length, 2);
  assert.equal((await readManifest(root)).executions.length, 2);
  return { workspace, app, worktreeRoot, root, worktree, excluded };
}

async function withContext(context, operation) {
  const previous = process.env.TASK_RESOURCES_CONTEXT;
  process.env.TASK_RESOURCES_CONTEXT = JSON.stringify(context);
  try {
    return await operation();
  } finally {
    if (previous === undefined) delete process.env.TASK_RESOURCES_CONTEXT;
    else process.env.TASK_RESOURCES_CONTEXT = previous;
  }
}

function labelArgs(labels) {
  return Object.entries(labels).flatMap(([key, value]) => [
    "--label",
    `${key}=${value}`,
  ]);
}

async function dockerRecoverySmoke(fixture) {
  const docker = new DockerProvider();
  const manager = new ResourceManager({ docker });
  const provider = await docker.identity();
  const command = docker.command.bind(docker);
  const observed = [];
  for (const [context, route] of [
    [fixture.root, "reconcile"],
    [fixture.worktree, "dispose"],
  ]) {
    const before = new Set(
      (await readManifest(context)).resources.map((entry) => entry.id),
    );
    let nativeId;
    docker.command = async (args, ...rest) => {
      if (args[0] === "container" && args[1] === "start") {
        nativeId = args[2];
        throw new Error("Deliberate disposable startup interruption");
      }
      return command(args, ...rest);
    };
    try {
      await assert.rejects(
        startDockerContainer(
          { image: mailpit },
          {
            manager,
            getContext: () => context,
          },
        ),
        /disposable startup interruption/,
      );
    } finally {
      docker.command = command;
    }
    assert.match(nativeId, /^[a-f0-9]{64}$/);
    const manifest = await readManifest(context);
    const resources = manifest.resources.filter(
      (entry) => !before.has(entry.id),
    );
    const network = resources.find((entry) => entry.kind === "network");
    const container = resources.find((entry) => entry.kind === "container");
    const actual = await docker.inspect("container", nativeId, provider);
    assert.equal(actual.running, false);
    assert.equal(actual.networkMode, network.locator.id);
    assert.equal(container.state, "pending");
    const endpointIds = Object.values(actual.networks ?? {}).map(
      (network) => network.NetworkID,
    );
    if (route === "reconcile") await manager.reconcile(context);
    await disposeDockerAllocations(
      context,
      resources.map((entry) => entry.id),
      { manager },
    );
    const completed = (await readManifest(context)).resources.filter(
      (entry) => !before.has(entry.id),
    );
    assert.ok(completed.every((entry) => entry.state === "removed"));
    for (const entry of completed)
      assert.equal(
        await docker.inspect(
          entry.kind,
          entry.kind === "volume" ? entry.locator.name : entry.locator.id,
          provider,
        ),
        null,
      );
    observed.push({
      route,
      endpointIdsBeforeRecovery: endpointIds,
      nativeId,
      removed: completed.length,
    });
  }
  for (const context of [fixture.root, fixture.worktree, fixture.excluded])
    await manager.release(context);
  return {
    observed,
    checks: {
      stoppedContainerIdentity: true,
      configuredNetworkCorroborated: true,
      reconciliationRecovery: true,
      boundDisposalRecovery: true,
      fixtureResourcesAbsent: true,
    },
  };
}

async function dockerPortSmoke(fixture) {
  const { workspace, root, worktree, excluded } = fixture;
  const docker = new DockerProvider();
  const manager = new ResourceManager({ docker });
  const provider = await docker.identity();
  const file = path.join(workspace, "compose.ports.yaml");
  const buildDirectory = path.join(workspace, "generic-compose-build");
  await mkdir(buildDirectory);
  await writeFile(
    path.join(buildDirectory, "Dockerfile"),
    `FROM ${mailpit}\nVOLUME /fixture-data\n`,
    { flag: "wx", mode: 0o600 },
  );
  const originalSource = `services:\n  Worker.B:\n    build: ${JSON.stringify(buildDirectory.replaceAll("$", () => "$$"))}\n    environment:\n      SNAPSHOT_LITERAL: 'before$$runtime'\n    volumes:\n      - data:/fixture-data\n    ports:\n      - "127.0.0.1:8025:8025"\nvolumes:\n  data: {}\n`;
  const stacks = [];
  for (const context of [root, excluded]) {
    await writeFile(file, originalSource, { mode: 0o600 });
    const stack = await withContext(context, () =>
      trackedCompose({
        directory: workspace,
        files: [file],
        project: "shared-port-control",
      }),
    );
    // Allocation must consume the checked snapshot, even if callers edit source.
    await writeFile(file, "[changed source must never be reread\n");
    await stack.up();
    const manifest = await readManifest(context);
    const container = manifest.resources.find(
      (entry) => entry.kind === "container",
    );
    const actual = await docker.inspect(
      "container",
      container.locator.id,
      provider,
    );
    assert.equal(actual.labels["ai.workspace"], workspace);
    assert.deepEqual(manifest.resources.map((entry) => entry.kind).sort(), [
      "container",
      "image",
      "network",
      "volume",
    ]);
    assert.ok(manifest.resources.every((entry) => entry.state === "present"));
    assert.match(
      stack.project,
      /^resource-smoke-(selected|excluded)-task-compose-[a-f0-9]{12}$/,
    );
    for (const entry of manifest.resources) {
      if (entry.kind === "image") {
        const image = await docker.inspect("image", entry.locator.id, provider);
        assert.deepEqual(image.tags, [`${stack.project}-worker-b-0:task`]);
      } else {
        const identity =
          entry.kind === "volume" ? entry.locator.name : entry.locator.id;
        const name = (
          await docker.command(
            [entry.kind, "inspect", "--format", "{{.Name}}", identity],
            provider.endpoint,
          )
        ).replace(/^\//, "");
        assert.ok(
          name.startsWith(stack.project),
          `Unexpected Compose ${entry.kind} name: ${name}`,
        );
      }
    }
    const binding = actual.ports["8025/tcp"][0];
    const publication = `${binding.HostIp}:${binding.HostPort}`;
    const environment = JSON.parse(
      await docker.command(
        [
          "container",
          "inspect",
          "--format",
          "{{json .Config.Env}}",
          container.locator.id,
        ],
        provider.endpoint,
      ),
    );
    assert.ok(environment.includes("SNAPSHOT_LITERAL=before$runtime"));
    assert.match(publication, /^127\.0\.0\.1:[1-9][0-9]{0,4}$/);
    stacks.push({
      project: stack.project,
      publication,
      manifest,
    });
  }
  assert.notEqual(stacks[0].manifest.taskId, stacks[1].manifest.taskId);
  assert.notEqual(stacks[0].project, stacks[1].project);
  assert.notEqual(stacks[0].publication, stacks[1].publication);
  const identities = stacks.map((stack) =>
    stack.manifest.resources.map((entry) =>
      entry.kind === "volume" ? entry.locator.name : entry.locator.id,
    ),
  );
  assert.equal(
    identities[0].some((id) => identities[1].includes(id)),
    false,
  );
  // Both stacks are still running when their distinct native ports are checked.
  for (const context of [root, worktree, excluded])
    await manager.release(context);
  const preview = await manager.inventory(workspace, [
    selectedPlan,
    excludedPlan,
  ]);
  await manager.cleanup(preview, "PROCEED");
  for (const stack of stacks)
    for (const entry of stack.manifest.resources)
      assert.equal(
        await docker.inspect(
          entry.kind,
          entry.kind === "volume" ? entry.locator.name : entry.locator.id,
          provider,
        ),
        null,
      );
  return {
    publications: stacks.map(({ project, publication }) => ({
      project,
      publication,
    })),
    checks: {
      readableComposeNamesAndBuildTags: true,
      simultaneousTaskPortIsolation: true,
      distinctOwnedResources: true,
      builtImageDeclaredStorageTracked: true,
      checkedSourceSnapshotUsed: true,
      literalEnvironmentPreserved: true,
      literalWorkspaceOwnershipPreserved: true,
      fixtureResourcesAbsent: true,
    },
  };
}

async function dockerSmoke(fixture, fixtureId) {
  const { workspace, root, worktree, excluded } = fixture;
  const docker = new DockerProvider();
  const manager = new ResourceManager({ docker });
  const provider = await docker.identity();
  const smokeLabels = { "ai.smoke.fixture": fixtureId };
  const fixtureOnly = [];
  const persistFixtureOnly = () =>
    writeFile(
      path.join(workspace, "smoke-fixtures.json"),
      `${JSON.stringify({ fixtureId, provider, resources: fixtureOnly }, null, 2)}\n`,
      { mode: 0o600 },
    );
  const imageTag = `ai-smoke-${fixtureId}:task`;
  const sharedTag = `ai-smoke-${fixtureId}:fixture-shared`;
  if ((await docker.list("image", provider, [`reference=${sharedTag}`])).length)
    throw new Error(
      "Fixture shared image tag already exists; use a fresh fixture UUID",
    );
  const selected = () => manager.inventory(workspace, [selectedPlan]);
  const allPresent = async (manifest) => {
    for (const entry of manifest.resources) {
      if (entry.state === "removed") continue;
      assert.equal(entry.state, "present");
      const actual = await docker.inspect(
        entry.kind,
        entry.kind === "volume" ? entry.locator.name : entry.locator.id,
        provider,
      );
      assert.ok(actual);
      if (entry.kind === "container") assert.equal(actual.running, true);
    }
  };
  const trackedContainer = (context, image, configuration = {}) =>
    withContext(context, () =>
      startDockerContainer({ image, ...configuration }),
    );
  const trackedNetwork = (context) =>
    withContext(context, () => startDockerNetwork());
  const fixtureContainer = async (args) => {
    // Negative controls are deliberately outside task ownership. Their own
    // creation labels and exact IDs are retained separately for safe teardown.
    const id = await docker.command(
      [
        "container",
        "run",
        "--detach",
        ...labelArgs(smokeLabels),
        ...args,
        mailpit,
      ],
      provider.endpoint,
    );
    assert.match(id, /^[a-f0-9]{64}$/);
    const record = { kind: "container", id, created: null };
    fixtureOnly.push(record);
    await persistFixtureOnly();
    const actual = await docker.inspect("container", id, provider);
    assert.ok(actual);
    record.created = actual.created;
    record.volumes = actual.mounts
      .filter((mount) => mount.Type === "volume")
      .map((mount) => mount.Name);
    await persistFixtureOnly();
    assert.ok(
      actual.mounts.every(
        (mount) =>
          mount.Type !== "volume" ||
          args.some((arg) => arg.includes(`source=${mount.Name},`)),
      ),
    );
    return record;
  };
  const removeFixtureOnly = async (record) => {
    const actual = await docker.inspect(record.kind, record.id, provider);
    if (!actual) return;
    assert.equal(actual.labels?.["ai.smoke.fixture"], fixtureId);
    assert.equal(actual.created, record.created);
    assert.equal(actual.labels?.["ai.task"], undefined);
    if (record.kind === "volume") {
      assert.ok(
        !(await docker.containers(provider)).some((container) =>
          container.mounts.some((mount) => mount.Name === record.id),
        ),
      );
    }
    await docker.command(
      record.kind === "container"
        ? ["container", "rm", "--force", record.id]
        : ["volume", "rm", record.id],
      provider.endpoint,
    );
    assert.equal(await docker.inspect(record.kind, record.id, provider), null);
    record.removed = true;
    await persistFixtureOnly();
  };

  // Pull only the explicit public fixture images; no default/shared stack is used.
  for (const image of [postgres, mailpit, seaweed])
    await docker.command(["image", "pull", image], provider.endpoint);
  const rootNetwork = await trackedNetwork(root);
  const worktreeNetwork = await trackedNetwork(worktree);
  assert.notEqual(rootNetwork.getId(), worktreeNetwork.getId());
  for (const network of [rootNetwork, worktreeNetwork]) {
    assert.match(
      network.getName(),
      /^resource-smoke-selected-task-network-[a-f0-9]{12}$/,
    );
    assert.equal(
      await docker.command(
        ["network", "inspect", "--format", "{{.Name}}", network.getId()],
        provider.endpoint,
      ),
      network.getName(),
    );
  }
  const volumeReservation = await manager.reserve(root, "volume", provider);
  const namedVolume = `ai-smoke-${fixtureId}-data`;
  if (await docker.inspect("volume", namedVolume, provider))
    throw new Error(
      "Fixture data volume already exists; use a fresh fixture UUID",
    );
  await docker.command(
    [
      "volume",
      "create",
      ...labelArgs({ ...smokeLabels, ...volumeReservation.labels }),
      namedVolume,
    ],
    provider.endpoint,
  );
  await manager.captureDocker(root, volumeReservation.entry.id, namedVolume);
  const database = await trackedContainer(root, postgres, {
    networkId: rootNetwork.getId(),
    environment: { POSTGRES_HOST_AUTH_METHOD: "trust" },
    ports: [5432],
  });
  assert.match(
    database.getName(),
    /^resource-smoke-selected-task-postgres-[a-f0-9]{12}$/,
  );
  assert.equal(
    (
      await docker.command(
        ["container", "inspect", "--format", "{{.Name}}", database.getId()],
        provider.endpoint,
      )
    ).replace(/^\//, ""),
    database.getName(),
  );
  const databaseNative = await docker.inspect(
    "container",
    database.getId(),
    provider,
  );
  assert.ok(databaseNative.mounts.some((mount) => mount.Type === "volume"));
  for (const mount of databaseNative.mounts.filter(
    (mount) => mount.Type === "volume",
  ))
    assert.match(
      mount.Name,
      /^resource-smoke-selected-task-volume-[0-9]+-[a-f0-9]{12}$/,
    );
  await trackedContainer(root, seaweed, {
    networkId: rootNetwork.getId(),
    volumeMounts: [{ source: namedVolume, target: "/data" }],
    command: ["mini", "-dir=/data"],
  });
  const rootMail = await trackedContainer(root, mailpit, {
    networkId: rootNetwork.getId(),
    ports: [8025],
  });
  const worktreeMail = await trackedContainer(worktree, mailpit, {
    networkId: worktreeNetwork.getId(),
    ports: [8025],
  });
  assert.equal(rootMail.getHost(), "127.0.0.1");
  assert.notEqual(
    rootMail.getMappedPort(8025),
    worktreeMail.getMappedPort(8025),
  );
  const normalTeardown = await trackedContainer(root, mailpit);
  await normalTeardown.stop({ remove: false });
  assert.equal(
    (await docker.inspect("container", normalTeardown.getId(), provider))
      .running,
    false,
  );
  await normalTeardown.stop();
  assert.equal(
    await docker.inspect("container", normalTeardown.getId(), provider),
    null,
  );
  const imageBuild = await withContext(root, () =>
    prepareTrackedImage(imageTag),
  );
  const buildDirectory = path.join(workspace, "image-build");
  await mkdir(buildDirectory);
  await writeFile(
    path.join(buildDirectory, "Dockerfile"),
    `FROM ${mailpit}\nLABEL ai.smoke.fixture="${fixtureId}"\n`,
  );
  await docker.command(
    [
      "image",
      "build",
      "--pull=false",
      ...labelArgs(imageBuild.labels),
      "--tag",
      imageTag,
      buildDirectory,
    ],
    provider.endpoint,
  );
  await imageBuild.complete();
  const excludedNetwork = await trackedNetwork(excluded);
  await trackedContainer(excluded, mailpit, {
    networkId: excludedNetwork.getId(),
  });
  const unrelatedVolume = `ai-smoke-${fixtureId}-unrelated`;
  if (await docker.inspect("volume", unrelatedVolume, provider))
    throw new Error(
      "Fixture unrelated volume already exists; use a fresh fixture UUID",
    );
  // Names are known before allocation; only a subsequent exact label/creation
  // check can authorize their deletion.
  const unrelatedRecord = {
    kind: "volume",
    id: unrelatedVolume,
    created: null,
  };
  fixtureOnly.push(unrelatedRecord);
  await persistFixtureOnly();
  await docker.command(
    ["volume", "create", ...labelArgs(smokeLabels), unrelatedVolume],
    provider.endpoint,
  );
  const unrelatedActual = await docker.inspect(
    "volume",
    unrelatedVolume,
    provider,
  );
  unrelatedRecord.created = unrelatedActual.created;
  await persistFixtureOnly();
  const unrelatedContainer = await fixtureContainer([
    "--network",
    "none",
    "--mount",
    `type=volume,source=${unrelatedVolume},target=/fixture`,
  ]);
  for (const context of [root, worktree, excluded])
    await manager.release(context);
  const initial = await readManifest(root);
  const databaseEntry = initial.resources.find(
    (entry) =>
      entry.kind === "container" && entry.locator?.id === database.getId(),
  );
  assert.ok(
    initial.resources.some(
      (entry) =>
        entry.kind === "volume" &&
        entry.dependencies.includes(databaseEntry.id) &&
        /^resource-smoke-selected-task-volume-[0-9]+-[a-f0-9]{12}$/.test(
          entry.locator.name,
        ),
    ),
  );
  assert.ok(
    initial.resources.some(
      (entry) => entry.kind === "volume" && entry.locator.name === namedVolume,
    ),
  );
  assert.ok(
    initial.resources
      .filter((entry) => entry.executionId === root.executionId)
      .every(
        (entry) =>
          !initial.resources.some(
            (other) =>
              other.executionId === worktree.executionId &&
              JSON.stringify(other.locator) === JSON.stringify(entry.locator),
          ),
      ),
  );
  const excludedSnapshot = JSON.stringify(await readManifest(excluded));
  const firstPreview = await selected();
  assert.equal((await manager.cleanup(firstPreview, "CANCEL")).cancelled, true);
  assert.deepEqual(await selected(), firstPreview);
  await allPresent(initial);

  // A real newly allocated network invalidates the previous confirmation.
  await manager.resumeExecution({
    workspace,
    plan: selectedPlan,
    resume: root.executionId,
  });
  await trackedNetwork(root);
  await manager.release(root);
  await assert.rejects(
    manager.cleanup(firstPreview, "PROCEED"),
    /inventory changed/,
  );
  await allPresent(await readManifest(root));

  // Attach a fixture-only container to owned storage/network. Cleanup must block.
  const attachment = await fixtureContainer([
    "--network",
    rootNetwork.getId(),
    "--mount",
    `type=volume,source=${namedVolume},target=/fixture`,
  ]);
  await assert.rejects(selected(), /another container/);
  await allPresent(await readManifest(root));
  await removeFixtureOnly(attachment);

  const imageEntry = (await readManifest(root)).resources.find(
    (entry) => entry.kind === "image",
  );
  await docker.command(
    ["image", "tag", imageEntry.locator.id, sharedTag],
    provider.endpoint,
  );
  const sharedPreview = await selected();
  assert.equal(
    sharedPreview.resources.find(
      (resource) => resource.entry.id === imageEntry.id,
    ).state,
    "preserved",
  );
  let injected = false;
  const failingDocker = new DockerProvider();
  const nativeRemove = failingDocker.remove.bind(failingDocker);
  failingDocker.remove = async (entry) => {
    if (!injected && entry.id === volumeReservation.entry.id) {
      injected = true;
      throw new Error("Deliberate single fixture removal failure");
    }
    return nativeRemove(entry);
  };
  const failingManager = new ResourceManager({ docker: failingDocker });
  await assert.rejects(
    failingManager.cleanup(sharedPreview, "PROCEED"),
    (error) => {
      assert.ok(error.removed.length > 0);
      return /Deliberate single fixture removal failure/.test(error.message);
    },
  );
  assert.equal(injected, true);
  assert.ok(
    await stat(
      path.join(workspace, ".ai/artifacts/selected-task/resources.json"),
    ),
  );
  assert.ok(await docker.inspect("volume", namedVolume, provider));
  assert.ok(
    (await readManifest(root)).resources.some(
      (entry) => entry.state === "removed",
    ),
  );
  const retry = await manager.cleanup(await selected(), "PROCEED");
  assert.equal(retry.preserved.length, 1);
  assert.equal(retry.preserved[0].entry.id, imageEntry.id);
  assert.ok(await docker.inspect("image", imageEntry.locator.id, provider));
  await docker.command(["image", "rm", sharedTag], provider.endpoint);
  await manager.cleanup(await selected(), "PROCEED");
  const completed = await readManifest(root);
  assert.ok(completed.resources.every((entry) => entry.state === "removed"));
  for (const resource of (await selected()).resources)
    assert.equal(resource.state, "absent");
  assert.equal(JSON.stringify(await readManifest(excluded)), excludedSnapshot);
  await allPresent(await readManifest(excluded));
  assert.equal(
    (await docker.inspect("container", unrelatedContainer.id, provider))
      .created,
    unrelatedContainer.created,
  );
  assert.equal(
    (await docker.inspect("volume", unrelatedVolume, provider)).created,
    unrelatedActual.created,
  );
  const preserved = {
    excluded: (await readManifest(excluded)).resources.length,
    unrelated: 2,
    sharedImagesDuringRetry: retry.preserved.length,
  };
  // Only now remove the explicitly excluded and fixture-only survivors we created.
  await manager.cleanup(
    await manager.inventory(workspace, [excludedPlan]),
    "PROCEED",
  );
  for (const record of fixtureOnly.filter(
    (record) => record.kind === "container",
  ))
    await removeFixtureOnly(record);
  for (const record of fixtureOnly.filter((record) => record.kind === "volume"))
    await removeFixtureOnly(record);
  return {
    nativeIds: completed.resources.map((entry) => ({
      kind: entry.kind,
      id: entry.kind === "volume" ? entry.locator.name : entry.locator.id,
    })),
    preserved,
    checks: {
      rootWorktreeIsolation: true,
      automaticTracking: true,
      readableStandaloneNames: true,
      genericDockerFixtures: true,
      simultaneousFixturePortIsolation: true,
      normalFixtureTeardown: true,
      cancel: true,
      stalePreview: true,
      attachmentBlock: true,
      sharedImage: true,
      partialFailureRetry: true,
      selectedAbsent: true,
      excludedUnrelatedPreserved: true,
      fixtureSurvivorsRemoved: true,
    },
  };
}

async function iosSmoke(fixture, configuration) {
  const { workspace, root, worktree, excluded } = fixture;
  const ios = new IOSProvider();
  const manager = new ResourceManager({ ios });
  const provider = await ios.identity();
  const before = await ios.devices(provider);
  const beforeDevices = Object.entries(before.devices)
    .flatMap(([runtime, devices]) =>
      devices.map((device) => ({
        udid: device.udid,
        runtime,
        deviceType: device.deviceTypeIdentifier,
        name: device.name,
        state: device.state,
      })),
    )
    .sort((a, b) => a.udid.localeCompare(b.udid));
  assert.ok(
    beforeDevices.length > 0,
    "A separate pre-existing device is required as preservation evidence",
  );
  const runtimeIdentities = (runtimes) =>
    runtimes
      .map((runtime) => ({
        identifier: runtime.identifier,
        name: runtime.name,
        version: runtime.version,
        buildversion: runtime.buildversion,
        isAvailable: runtime.isAvailable,
        runtimeRoot: runtime.runtimeRoot,
        bundlePath: runtime.bundlePath,
      }))
      .sort((left, right) => left.identifier.localeCompare(right.identifier));
  const runtimeSnapshot = runtimeIdentities(before.runtimes);
  assert.ok(
    before.devicetypes.some(
      (type) => type.identifier === configuration["--device-type"],
    ),
  );
  assert.ok(
    before.runtimes.some(
      (runtime) =>
        runtime.identifier === configuration["--runtime"] &&
        runtime.isAvailable,
    ),
  );
  const locator = await manager.createSimulator(root, {
    deviceType: configuration["--device-type"],
    runtime: configuration["--runtime"],
  });
  const reused = await manager.createSimulator(root, {
    deviceType: configuration["--device-type"],
    runtime: configuration["--runtime"],
  });
  assert.deepEqual(reused, locator);
  assert.ok(!beforeDevices.some((device) => device.udid === locator.udid));
  assert.equal(locator.deviceType, configuration["--device-type"]);
  assert.equal(locator.runtime, configuration["--runtime"]);
  const model = before.devicetypes.find(
    (type) => type.identifier === locator.deviceType,
  );
  const baseName = `Resource Smoke · selected-task · ${model.name}`;
  const priorNames = new Set(beforeDevices.map((device) => device.name));
  let expectedName = baseName;
  for (let suffix = 2; priorNames.has(expectedName); suffix++)
    expectedName = `${baseName} (${suffix})`;
  assert.equal(locator.name, expectedName);
  assert.equal((await ios.inspect({ locator, provider })).name, expectedName);
  const created = await ios.devices(provider);
  const createdIds = Object.values(created.devices)
    .flat()
    .map((device) => device.udid);
  assert.deepEqual(
    createdIds.filter(
      (id) => !beforeDevices.some((device) => device.udid === id),
    ),
    [locator.udid],
  );
  assert.equal(
    Object.values(created.devices)
      .flat()
      .filter((device) => device.name === locator.name).length,
    1,
  );
  const manifest = await readManifest(root);
  assert.equal(manifest.resources.length, 1);
  assert.deepEqual(manifest.resources[0].locator, locator);
  const control = beforeDevices[0];
  const forged = {
    ...manifest.resources[0],
    locator: {
      udid: control.udid,
      deviceType: control.deviceType,
      runtime: control.runtime,
      name: control.name,
    },
  };
  await assert.rejects(ios.verify(forged, { workspace }), /ownership/i);
  assert.equal(
    (await ios.verify(manifest.resources[0], { workspace })).state,
    "present",
  );
  for (const context of [root, worktree, excluded])
    await manager.release(context);
  const preview = await manager.inventory(workspace, [selectedPlan]);
  assert.equal((await manager.cleanup(preview, "CANCEL")).cancelled, true);
  assert.equal(
    (await ios.verify(manifest.resources[0], { workspace })).state,
    "present",
  );
  assert.deepEqual(await manager.inventory(workspace, [selectedPlan]), preview);
  await manager.cleanup(preview, "PROCEED");
  assert.equal(
    (await ios.verify(manifest.resources[0], { workspace })).state,
    "absent",
  );
  const after = await ios.devices(provider);
  const afterDevices = Object.entries(after.devices)
    .flatMap(([runtime, devices]) =>
      devices.map((device) => ({
        udid: device.udid,
        runtime,
        deviceType: device.deviceTypeIdentifier,
        name: device.name,
        state: device.state,
      })),
    )
    .sort((a, b) => a.udid.localeCompare(b.udid));
  assert.deepEqual(afterDevices, beforeDevices);
  assert.deepEqual(runtimeIdentities(after.runtimes), runtimeSnapshot);
  return {
    nativeIds: [{ kind: "ios-simulator", ...locator }],
    preserved: {
      priorDevices: beforeDevices.length,
      runtimes: after.runtimes.length,
    },
    checks: {
      exactlyOneDedicatedDevice: true,
      sameExecutionReuse: true,
      metadataTracking: true,
      cancel: true,
      proceed: true,
      selectedAbsent: true,
      priorDevicesRuntimesUnchanged: true,
      forgedExistingDeviceRefused: true,
    },
  };
}

let fixture;
let configuration;
let composeRecovery;
try {
  configuration = options(process.argv.slice(2));
  if (!configuration) {
    console.log(`Explicit disposable native resource smoke (never run by default tests).
Docker: rtk proxy node .ai/scripts/resources/smoke.mjs --docker --fixture-id UUID
Docker port isolation: rtk proxy node .ai/scripts/resources/smoke.mjs --docker --ports-only --fixture-id UUID
Docker interrupted startup: rtk proxy node .ai/scripts/resources/smoke.mjs --docker --recovery-only --fixture-id UUID
iOS: rtk proxy node .ai/scripts/resources/smoke.mjs --ios --fixture-id UUID --device-type <installed-device-type> --runtime <installed-iOS-runtime>
Requires explicit execution approval. Creates only dedicated fixtures; never prunes.
Evidence is retained in a temporary canonical workspace, including on failure.`);
  } else {
    if (process.env.TASK_RESOURCES_CONTEXT !== undefined)
      throw new Error(
        "Run this standalone harness without an enclosing task resource context",
      );
    fixture = await workspaceFixture(
      configuration["--fixture-id"],
      (workspace) => {
        fixture = { workspace };
      },
    );
    const result =
      configuration.provider === "docker"
        ? configuration.recoveryOnly
          ? await dockerRecoverySmoke(fixture)
          : configuration.portsOnly
            ? await dockerPortSmoke(fixture)
            : await dockerSmoke(fixture, configuration["--fixture-id"])
        : await iosSmoke(fixture, configuration);
    if (
      configuration.provider === "docker" &&
      !configuration.portsOnly &&
      !configuration.recoveryOnly
    ) {
      composeRecovery = { fixtureId: randomUUID(), evidence: null };
      const composeFixture = await workspaceFixture(
        composeRecovery.fixtureId,
        (workspace) => {
          composeRecovery.evidence = workspace;
        },
      );
      result.compose = {
        ...composeRecovery,
        ...(await dockerPortSmoke(composeFixture)),
      };
    }
    assert.equal((await readAllManifests(fixture.workspace)).length, 2);
    await assert.rejects(
      stat(path.join(fixture.worktreeRoot, ".ai/artifacts")),
      { code: "ENOENT" },
    );
    assert.ok(await stat(fixture.app));
    assert.ok(await stat(path.join(fixture.worktreeRoot, "app")));
    const branches = await git(
      fixture.app,
      "branch",
      "--list",
      "smoke-source",
      "smoke-worktree",
    );
    assert.ok(branches.includes("smoke-source"));
    assert.ok(branches.includes("smoke-worktree"));
    const summary = {
      fixtureId: configuration["--fixture-id"],
      provider: configuration.provider,
      evidence: fixture.workspace,
      contexts: {
        root: fixture.root.executionId,
        worktree: fixture.worktree.executionId,
        excluded: fixture.excluded.executionId,
      },
      ...result,
    };
    await writeFile(
      path.join(fixture.workspace, "smoke-result.json"),
      `${JSON.stringify(summary, null, 2)}\n`,
      { flag: "wx", mode: 0o600 },
    );
    console.log(JSON.stringify(summary));
  }
} catch (error) {
  // Do not remove resources or erase pending evidence after an unexpected failure.
  console.error(
    JSON.stringify({
      fixtureId: configuration?.["--fixture-id"] ?? null,
      provider: configuration?.provider ?? null,
      evidence: fixture?.workspace ?? null,
      ...(composeRecovery ? { compose: composeRecovery } : {}),
      failed: true,
      reason:
        error instanceof assert.AssertionError
          ? "Smoke invariant failed; inspect retained fixture evidence"
          : error.message,
      cleanup:
        "No automatic failure cleanup; retain exact-ID ownership evidence",
    }),
  );
  process.exitCode = 1;
}
