import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { randomUUID } from "node:crypto";
import {
  chmod,
  lstat,
  mkdir,
  mkdtemp,
  readFile,
  realpath,
  rename,
  rm,
  symlink,
  writeFile,
} from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import test from "node:test";
import { MAX_MANIFEST_BYTES, parseManifest } from "./schema.mjs";
import {
  initExecution,
  readAllManifests,
  readManifest,
  readManifestUnlocked,
  updateManifest,
  withResourceLock,
  writeManifestUnlocked,
} from "./store.mjs";

// The changed boundary is persisted deletion authority. Disposable Git fixtures
// exercise canonical routing, hostile files, and competing writes without any
// Docker or simulator operations; guidance-text assertions cannot prove these.
const git = (root, ...args) =>
  execFileSync("git", ["-C", root, ...args], {
    encoding: "utf8",
    stdio: ["ignore", "pipe", "pipe"],
    env: {
      PATH: process.env.PATH,
      GIT_CONFIG_NOSYSTEM: "1",
      GIT_CONFIG_GLOBAL: "/dev/null",
    },
  }).trim();
const put = async (root, relative, data) => {
  const file = path.join(root, relative);
  await mkdir(path.dirname(file), { recursive: true });
  await writeFile(file, data);
};
async function initGit(root) {
  await mkdir(root, { recursive: true });
  git(root, "init", "-b", "main");
  await put(root, "baseline", "disposable resource fixture\n");
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
async function fixture(t) {
  const workspace = await realpath(
    await mkdtemp(path.join(tmpdir(), "task-resources-")),
  );
  t.after(() => rm(workspace, { recursive: true, force: true }));
  await initGit(path.join(workspace, ".ai"));
  await initGit(path.join(workspace, "app"));
  const plan = ".ai/plans/sample-task.md";
  await put(workspace, plan, "# Disposable task\n");
  return { workspace, plan, root: workspace };
}
const artifact = (f) =>
  path.join(f.workspace, ".ai/artifacts/sample-task/resources.json");
const clone = (value) => structuredClone(value);

test("project labels persist without changing context and legacy records remain readable", async (t) => {
  const f = await fixture(t);
  const context = await initExecution({ ...f, projectName: "MyUse" });
  assert.deepEqual(Object.keys(context).sort(), [
    "executionId",
    "plan",
    "workspace",
  ]);
  assert.equal((await readManifest(context)).projectName, "MyUse");
  const before = await readFile(artifact(f), "utf8");
  await assert.rejects(
    initExecution({ ...f, resume: context.executionId, projectName: "Other" }),
    /project.*name|label/i,
  );
  assert.equal(await readFile(artifact(f), "utf8"), before);
  assert.deepEqual(
    await initExecution({ ...f, resume: context.executionId }),
    context,
  );
  const legacy = await readManifest(context);
  delete legacy.projectName;
  await writeFile(artifact(f), JSON.stringify(legacy));
  assert.equal((await readManifest(context)).projectName, undefined);
  assert.equal(await readFile(artifact(f), "utf8"), JSON.stringify(legacy));
  await initExecution({ ...f, projectName: "New Label" });
  assert.equal((await readManifest(context)).projectName, "New Label");
});

test("invalid descriptive project labels fail before resource records are written", async (t) => {
  const f = await fixture(t);
  for (const projectName of ["", "\nprivate", " ", "a".repeat(257)])
    await assert.rejects(initExecution({ ...f, projectName }));
  await assert.rejects(lstat(artifact(f)), { code: "ENOENT" });
});

test("Unicode-only source labels remain usable on legacy init and resume", async (t) => {
  const outer = await fixture(t);
  const workspace = path.join(outer.workspace, "旅行");
  await initGit(path.join(workspace, ".ai"));
  await initGit(path.join(workspace, "app"));
  await put(workspace, outer.plan, "# Unicode workspace task\n");
  const context = await initExecution({ workspace, plan: outer.plan });
  assert.equal((await readManifest(context)).projectName, "旅行");
  await updateManifest(context, (manifest) => {
    delete manifest.projectName;
  });
  assert.deepEqual(
    await initExecution({
      workspace,
      plan: outer.plan,
      resume: context.executionId,
    }),
    context,
  );
  assert.equal((await readManifest(context)).projectName, "旅行");
});

test("malformed resource JSON diagnostics omit input excerpts", async (t) => {
  const f = await fixture(t);
  const context = await initExecution(f);
  const secret = "s3cr3t";
  await writeFile(artifact(f), secret);
  await assert.rejects(
    readManifest(context),
    (error) => !error.message.includes(secret),
  );
});

function entry(manifest, context, overrides = {}) {
  const id = randomUUID();
  return {
    id,
    executionId: context.executionId,
    disposable: true,
    kind: "container",
    state: "pending",
    createdAt: new Date().toISOString(),
    provider: {
      type: "docker",
      endpoint: "unix:///private/tmp/disposable-docker.sock",
      daemonId: "fixture-daemon",
    },
    locator: null,
    dependencies: [],
    ownership: {
      taskId: manifest.taskId,
      executionId: context.executionId,
      entryId: id,
    },
    ...overrides,
  };
}

test("main and native worktree executions share only the source manifest and resume exact identities", async (t) => {
  const f = await fixture(t);
  const main = await initExecution({ ...f, projectName: "MyUse" });
  const before = await readManifest(main);
  const worktree = path.join(f.workspace, ".worktrees/sample-task/app");
  await mkdir(path.dirname(worktree), { recursive: true });
  git(
    path.join(f.workspace, "app"),
    "worktree",
    "add",
    "-b",
    "task-fixture",
    worktree,
  );
  const work = await initExecution({ ...f, root: path.dirname(worktree) });
  const after = await readManifest(work);
  assert.equal(before.projectName, "MyUse");
  assert.equal(after.projectName, "MyUse");
  assert.equal(after.taskId, before.taskId);
  assert.notEqual(main.executionId, work.executionId);
  assert.deepEqual(
    after.executions.map((run) => run.mode),
    ["main", "worktree"],
  );
  assert.equal(after.executions[1].repositories[0].root, worktree);
  assert.equal((await readAllManifests(f.workspace)).length, 1);
  assert.equal((await readAllManifests(f.workspace))[0].taskId, after.taskId);
  await assert.rejects(
    lstat(
      path.join(
        path.dirname(worktree),
        ".ai/artifacts/sample-task/resources.json",
      ),
    ),
    { code: "ENOENT" },
  );
  assert.deepEqual(
    await initExecution({
      ...f,
      root: path.dirname(worktree),
      resume: work.executionId,
    }),
    work,
  );
  assert.equal((await readManifest(work)).executions.length, 2);
  await assert.rejects(
    initExecution({ ...f, resume: work.executionId }),
    /Resume execution identity/,
  );
  await assert.rejects(
    initExecution({ ...f, resume: randomUUID() }),
    /Resume execution identity/,
  );
  git(path.join(f.workspace, "app"), "worktree", "remove", worktree);
  assert.equal(
    (await readManifest(work)).executions.length,
    2,
    "already removed historical worktrees retain their resource evidence",
  );
});

test("resource-bearing resume requires verification under the lock before activation", async (t) => {
  const f = await fixture(t);
  const context = await initExecution(f);
  await updateManifest(context, (manifest) => {
    manifest.resources.push(entry(manifest, context));
    manifest.executions[0].active = false;
  });
  const original = await readFile(artifact(f), "utf8");
  const resume = { ...f, resume: context.executionId };
  await assert.rejects(initExecution(resume), /original resource helper/);
  await assert.rejects(
    initExecution({
      ...resume,
      verifyResume: async (received) => {
        assert.deepEqual(received, context);
        assert.equal(
          (await readManifest(received)).executions[0].active,
          false,
        );
        await assert.rejects(
          withResourceLock(f.workspace, () => {}, { waitMs: 0 }),
          { code: "RESOURCE_LOCK_BUSY" },
        );
        throw new Error("Live ownership refused");
      },
    }),
    /Live ownership refused/,
  );
  assert.equal(await readFile(artifact(f), "utf8"), original);
  assert.deepEqual(
    await initExecution({
      ...resume,
      verifyResume: async (received) => {
        received.executionId = randomUUID();
      },
    }),
    context,
    "the verifier cannot mutate the store's trusted context",
  );
  assert.equal((await readManifest(context)).executions[0].active, true);
});

test("strict resource validation rejects malformed authority and preserves the previous record", async (t) => {
  const f = await fixture(t);
  const context = await initExecution(f);
  await updateManifest(context, (manifest) =>
    manifest.resources.push(
      entry(manifest, context, {
        state: "present",
        locator: { id: "a".repeat(64), created: new Date().toISOString() },
      }),
    ),
  );
  const valid = await readManifest(context);
  const cases = [
    (m) => {
      m.version = 2;
    },
    (m) => {
      m.secret = "forbidden";
    },
    (m) => {
      delete m.resources[0].ownership;
    },
    (m) => {
      delete m.resources[0].disposable;
    },
    (m) => {
      m.resources[0].disposable = false;
    },
    (m) => {
      m.resources[0].environment = {};
    },
    (m) => {
      m.resources[0].provider.endpoint = "tcp://remote.invalid:2375";
    },
    (m) => {
      m.resources[0].provider.endpoint = "unix:///private/tmp/../docker.sock";
    },
    (m) => {
      m.resources[0].provider.password = "forbidden";
    },
    (m) => {
      m.resources[0].kind = "android-emulator";
    },
    (m) => {
      m.resources[0].locator.id = "short";
    },
    (m) => {
      m.resources[0].locator = null;
    },
    (m) => {
      m.resources[0].executionId = randomUUID();
    },
    (m) => {
      m.resources[0].ownership.taskId = randomUUID();
    },
    (m) => {
      m.resources[0].ownership.entryId = randomUUID();
    },
    (m) => {
      m.resources[0].dependencies = [randomUUID()];
    },
    (m) => {
      m.resources[0].dependencies = [m.resources[0].id];
    },
    (m) => {
      m.executions.push(clone(m.executions[0]));
    },
    (m) => {
      const duplicate = clone(m.executions[0]);
      duplicate.id = duplicate.id.toUpperCase();
      m.executions.push(duplicate);
    },
    (m) => {
      m.resources.push(clone(m.resources[0]));
    },
    (m) => {
      const duplicate = clone(m.resources[0]);
      duplicate.id = duplicate.id.toUpperCase();
      duplicate.ownership.entryId = duplicate.id;
      m.resources.push(duplicate);
    },
    (m) => {
      const other = clone(m.resources[0]);
      other.id = randomUUID();
      other.ownership.entryId = other.id;
      m.resources.push(other);
    },
  ];
  for (const mutate of cases) {
    const invalid = clone(valid);
    mutate(invalid);
    assert.throws(() => parseManifest(invalid));
  }
  const bytes = await readFile(artifact(f), "utf8");
  await assert.rejects(
    updateManifest(context, (manifest) => {
      manifest.resources[0].ownership.taskId = randomUUID();
    }),
  );
  await assert.rejects(
    updateManifest(context, () => {
      throw new Error("injected callback failure");
    }),
    /injected callback failure/,
  );
  assert.equal(await readFile(artifact(f), "utf8"), bytes);
  const result = await updateManifest(context, () => "caller result");
  assert.equal(result, "caller result");
});

test("duplicate simulator identity uses UDID rather than display name", async (t) => {
  const f = await fixture(t);
  const context = await initExecution(f);
  const manifest = await readManifest(context);
  const udid = randomUUID();
  const simulator = () =>
    entry(manifest, context, {
      kind: "ios-simulator",
      provider: { type: "ios", deviceSet: "/private/tmp/device-set" },
      state: "present",
      locator: {
        udid,
        name: "iPhone 17 · iOS 26",
        deviceType: "com.apple.CoreSimulator.SimDeviceType.iPhone-17",
        runtime: "com.apple.CoreSimulator.SimRuntime.iOS-26-0",
      },
    });
  manifest.resources = [simulator(), simulator()];
  manifest.resources[1].locator.udid = randomUUID();
  assert.doesNotThrow(() => parseManifest(manifest));
  manifest.resources[1].locator.udid = udid.toUpperCase();
  manifest.resources[1].locator.name = "Different display name";
  assert.throws(
    () => parseManifest(manifest),
    /Duplicate provider resource identity/,
  );
});

test("path traversal, copied workflows, unrelated repositories, and forged mappings fail closed", async (t) => {
  const f = await fixture(t);
  for (const plan of [
    ".ai/plans/../sample-task.md",
    ".ai/plans/nested/sample.md",
    "/tmp/sample-task.md",
    ".ai/plans/.hidden.md",
    ".ai/plans/UPPER.md",
    ".ai/plans/under_score.md",
    ".ai/plans/double--dash.md",
  ])
    await assert.rejects(initExecution({ ...f, plan }));
  await assert.rejects(initExecution({ ...f, plan: ".ai/plans/missing.md" }), {
    code: "ENOENT",
  });
  const copy = path.join(f.workspace, ".worktrees/copied");
  await initGit(path.join(copy, ".ai"));
  await put(copy, f.plan, "# Copied plan\n");
  await assert.rejects(
    initExecution({ workspace: copy, plan: f.plan, root: copy }),
    /Source workspace cannot be beneath/,
  );
  await assert.rejects(
    initExecution({ ...f, root: copy }),
    /registered source repositories/,
  );
  const unrelated = path.join(f.workspace, ".worktrees/unrelated");
  await initGit(unrelated);
  await assert.rejects(
    initExecution({ ...f, root: unrelated }),
    /registered source repositories/,
  );
  const ordinary = path.join(f.workspace, "ordinary");
  await mkdir(ordinary);
  await assert.rejects(
    initExecution({ ...f, root: ordinary }),
    /Git|repository/,
  );
  await assert.rejects(
    initExecution({
      ...f,
      repositories: [
        {
          id: "app",
          root: path.join(f.workspace, "app"),
          gitCommonDir: path.join(f.workspace, ".ai/.git"),
        },
      ],
    }),
    /primary source checkout/,
  );
  const escaped = path.join(f.workspace, "..");
  await assert.rejects(initExecution({ ...f, root: escaped }));
});

test("failed allocations can retain removed reservations without inventing a locator", async (t) => {
  const f = await fixture(t);
  const context = await initExecution(f);
  await updateManifest(context, (manifest) => {
    manifest.resources.push(entry(manifest, context, { state: "removed" }));
  });
  assert.equal((await readManifest(context)).resources[0].locator, null);
  await assert.rejects(
    updateManifest(context, (manifest) => {
      manifest.resources[0].state = "present";
    }),
  );
  assert.equal((await readManifest(context)).resources[0].state, "removed");
});

test("source .ai must be an independent exact Git checkout", async (t) => {
  const workspace = await realpath(
    await mkdtemp(path.join(tmpdir(), "task-resources-parent-")),
  );
  t.after(() => rm(workspace, { recursive: true, force: true }));
  await initGit(workspace);
  await put(workspace, ".ai/plans/sample.md", "# Plan\n");
  await assert.rejects(
    initExecution({ workspace, plan: ".ai/plans/sample.md", root: workspace }),
    /exact Git repository root/,
  );
});

test("symlinked source plans, artifact ancestors, manifests, and lock paths are never followed", async (t) => {
  for (const location of [
    "plan",
    "artifact",
    "manifest",
    "lock",
    "workspace",
  ]) {
    const f = await fixture(t);
    const context = await initExecution(f);
    const saved = await readFile(artifact(f), "utf8");
    if (location === "plan") {
      const original = path.join(f.workspace, f.plan);
      await rename(original, `${original}.saved`);
      await symlink(`${original}.saved`, original);
      await assert.rejects(readManifest(context), /Symlinked/);
    } else if (location === "artifact") {
      const directory = path.dirname(artifact(f));
      await rename(directory, `${directory}-saved`);
      await symlink(`${directory}-saved`, directory);
      await assert.rejects(readManifest(context), /Symlinked/);
      await assert.rejects(readAllManifests(f.workspace), /Symlinked/);
    } else if (location === "manifest") {
      await rename(artifact(f), `${artifact(f)}.saved`);
      await symlink(`${artifact(f)}.saved`, artifact(f));
      await assert.rejects(readManifest(context), /Symlinked/);
      await assert.rejects(
        updateManifest(context, () => {}),
        /Symlinked/,
      );
      assert.equal(await readFile(`${artifact(f)}.saved`, "utf8"), saved);
    } else if (location === "lock") {
      await symlink(
        path.dirname(artifact(f)),
        path.join(f.workspace, ".ai/tmp/task-resources.lock"),
      );
      await assert.rejects(
        updateManifest(context, () => {}),
        /Symlinked/,
      );
    } else {
      const alias = `${f.workspace}-alias`;
      t.after(() => rm(alias, { force: true }));
      await symlink(f.workspace, alias);
      await assert.rejects(
        initExecution({ ...f, workspace: alias, root: alias }),
        /Symlinked/,
      );
    }
  }
});

test("bounded reads reject malformed, oversized, and source-mismatched records", async (t) => {
  const f = await fixture(t);
  const context = await initExecution(f);
  const original = await readFile(artifact(f), "utf8");
  for (const bytes of [
    "{broken",
    " ".repeat(MAX_MANIFEST_BYTES + 1),
    Buffer.from([0xff]),
  ]) {
    await writeFile(artifact(f), bytes);
    await assert.rejects(readManifest(context));
    await assert.rejects(readAllManifests(f.workspace));
  }
  const mismatch = JSON.parse(original);
  mismatch.workspace = "/private/tmp/other-workspace";
  await writeFile(artifact(f), JSON.stringify(mismatch));
  await assert.rejects(readManifest(context), /source context mismatch/);
  await writeFile(artifact(f), original);
  const escaped = JSON.parse(original);
  escaped.executions[0].root = "/private/tmp/other-root";
  await writeFile(artifact(f), JSON.stringify(escaped));
  await assert.rejects(readManifest(context), /execution root escapes/);
  await writeFile(artifact(f), original);
  await assert.rejects(
    readManifest({ ...context, executionId: randomUUID() }),
    /Unknown resource execution context/,
  );
  const changedTask = JSON.parse(original);
  changedTask.taskId = randomUUID();
  await assert.rejects(
    withResourceLock(f.workspace, () =>
      writeManifestUnlocked(context, changedTask),
    ),
    /replace task ownership identity/,
  );
  assert.equal(await readFile(artifact(f), "utf8"), original);
});

test("one workspace lock times out without stealing busy or stale owner evidence", async (t) => {
  const f = await fixture(t);
  const context = await initExecution(f);
  await withResourceLock(f.workspace, async () => {
    const lock = path.join(f.workspace, ".ai/tmp/task-resources.lock");
    const owner = JSON.parse(
      await readFile(path.join(lock, "owner.json"), "utf8"),
    );
    assert.equal(owner.pid, process.pid);
    assert.ok(owner.hostname);
    assert.ok(owner.startedAt);
    for (const waitMs of [-1, NaN, Infinity])
      await assert.rejects(
        withResourceLock(f.workspace, () => {}, { waitMs }),
        /finite nonnegative number/,
      );
    await assert.rejects(
      withResourceLock(f.workspace, () => {}, { waitMs: 0 }),
      { code: "RESOURCE_LOCK_BUSY" },
    );
    assert.deepEqual(
      JSON.parse(await readFile(path.join(lock, "owner.json"), "utf8")),
      owner,
    );
    assert.equal(
      (await readManifestUnlocked(context)).taskId,
      (await readManifest(context)).taskId,
    );
  });
  const lock = path.join(f.workspace, ".ai/tmp/task-resources.lock");
  await mkdir(lock);
  await writeFile(
    path.join(lock, "owner.json"),
    JSON.stringify({ pid: 999999999, startedAt: "2000-01-01T00:00:00Z" }),
  );
  await assert.rejects(
    withResourceLock(f.workspace, () => {}, { waitMs: 10 }),
    { code: "RESOURCE_LOCK_BUSY" },
  );
  assert.equal(
    JSON.parse(await readFile(path.join(lock, "owner.json"), "utf8")).pid,
    999999999,
  );
});

test("parallel writers wait for the lock and preserve all independent reservations", async (t) => {
  const f = await fixture(t);
  const context = await initExecution(f);
  const reserve = () =>
    updateManifest(context, (manifest) => {
      const resource = entry(manifest, context);
      manifest.resources.push(resource);
      return resource.id;
    });
  const ids = await Promise.all(Array.from({ length: 6 }, reserve));
  const manifest = await readManifest(context);
  assert.deepEqual(
    new Set(manifest.resources.map((resource) => resource.id)),
    new Set(ids),
  );
  assert.equal((await readAllManifests(f.workspace)).length, 1);
});

test("an actual filesystem write failure leaves valid manifest bytes intact", async (t) => {
  if (process.getuid?.() === 0) {
    t.skip("permission denial cannot be induced as root");
    return;
  }
  const f = await fixture(t);
  const context = await initExecution(f);
  const original = await readFile(artifact(f), "utf8");
  const directory = path.dirname(artifact(f));
  await chmod(directory, 0o500);
  try {
    await assert.rejects(
      updateManifest(context, (manifest) =>
        manifest.resources.push(entry(manifest, context)),
      ),
      /EACCES|EPERM/,
    );
    assert.equal(await readFile(artifact(f), "utf8"), original);
  } finally {
    await chmod(directory, 0o700);
  }
  assert.doesNotThrow(() => JSON.parse(original));
});

test("legacy plans without a marker or JSON retain file-only semantics", async (t) => {
  const f = await fixture(t);
  const original = await readFile(path.join(f.workspace, f.plan), "utf8");
  assert.equal(
    await readManifest({
      workspace: f.workspace,
      plan: f.plan,
      executionId: randomUUID(),
    }),
    null,
  );
  assert.deepEqual(await readAllManifests(f.workspace), []);
  assert.equal(
    await readFile(path.join(f.workspace, f.plan), "utf8"),
    original,
  );
  const context = await initExecution(f);
  const manifest = await readManifest(context);
  const source = await readFile(path.join(f.workspace, f.plan), "utf8");
  assert.equal(
    source,
    `${original}\n<!-- task-resources: ${manifest.taskId} -->\n`,
  );
  await initExecution({ ...f, resume: context.executionId });
  assert.equal(
    await readFile(path.join(f.workspace, f.plan), "utf8"),
    source,
    "resume never duplicates the source marker",
  );
});

test("a source marker prevents lost JSON from being reinitialized or treated as a legacy plan", async (t) => {
  for (const removeDirectory of [false, true]) {
    const f = await fixture(t);
    const context = await initExecution(f);
    const source = await readFile(path.join(f.workspace, f.plan), "utf8");
    await rm(
      removeDirectory ? path.join(f.workspace, ".ai/artifacts") : artifact(f),
      { recursive: removeDirectory },
    );
    await assert.rejects(
      readManifest(context),
      /Expected task resource manifest is missing/,
    );
    await assert.rejects(
      readAllManifests(f.workspace),
      /Expected task resource manifest is missing/,
    );
    await assert.rejects(
      initExecution(f),
      /Expected task resource manifest is missing/,
    );
    await assert.rejects(lstat(artifact(f)), { code: "ENOENT" });
    assert.equal(
      await readFile(path.join(f.workspace, f.plan), "utf8"),
      source,
    );
  }
});

test("conflicting, duplicate, and malformed plan markers block reads and initialization", async (t) => {
  const f = await fixture(t);
  const context = await initExecution(f);
  const source = await readFile(path.join(f.workspace, f.plan), "utf8");
  const original = await readFile(artifact(f), "utf8");
  const manifest = JSON.parse(original);
  const marker = `<!-- task-resources: ${manifest.taskId} -->`;
  for (const changed of [
    source.replace(marker, `<!-- task-resources: ${randomUUID()} -->`),
    `${source}\n${marker}\n`,
    source.replace(marker, "<!-- task-resources: malformed -->"),
  ]) {
    await writeFile(path.join(f.workspace, f.plan), changed);
    await assert.rejects(readManifest(context), /marker/);
    await assert.rejects(readAllManifests(f.workspace), /marker/);
    await assert.rejects(initExecution(f), /marker/);
    assert.equal(await readFile(artifact(f), "utf8"), original);
    assert.equal(
      await readFile(path.join(f.workspace, f.plan), "utf8"),
      changed,
    );
  }
});

test("resume repairs the marker after interruption between manifest and source-plan writes", async (t) => {
  if (process.getuid?.() === 0) {
    t.skip("permission denial cannot be induced as root");
    return;
  }
  const f = await fixture(t);
  const directory = path.join(f.workspace, ".ai/plans");
  const original = await readFile(path.join(f.workspace, f.plan), "utf8");
  await chmod(directory, 0o500);
  try {
    await assert.rejects(initExecution(f), /EACCES|EPERM/);
  } finally {
    await chmod(directory, 0o700);
  }
  const manifest = JSON.parse(await readFile(artifact(f), "utf8"));
  assert.equal(
    await readFile(path.join(f.workspace, f.plan), "utf8"),
    original,
  );
  const context = {
    workspace: f.workspace,
    plan: f.plan,
    executionId: manifest.executions[0].id,
  };
  assert.equal(
    (await readManifest(context)).taskId,
    manifest.taskId,
    "an unmarked valid record remains readable for recovery",
  );
  assert.deepEqual(
    await initExecution({ ...f, resume: context.executionId }),
    context,
  );
  const repaired = await readManifest(context);
  assert.equal(repaired.taskId, manifest.taskId);
  assert.equal(repaired.executions.length, 1);
  assert.equal(
    await readFile(path.join(f.workspace, f.plan), "utf8"),
    `${original}\n<!-- task-resources: ${manifest.taskId} -->\n`,
  );
});
