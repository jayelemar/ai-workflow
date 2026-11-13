import assert from "node:assert/strict";
import test from "node:test";
import { execFileSync } from "node:child_process";
import { mkdtemp, mkdir, writeFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { changedPaths, runPrePush, selectTests } from "./pre-push.mjs";

const local = "a".repeat(40);
const remote = "b".repeat(40);
const zero = "0".repeat(40);
const update = `refs/heads/work ${local} refs/heads/work ${remote}\n`;
const guidance = "scripts/maintenance/workflow-guidance.test.mjs";
const result = (stdout = "", exitCode = 0) => ({
  stdout,
  stderr: "",
  exitCode,
});

test("ordinary skill and documentation edits avoid expensive Git fixtures", () => {
  for (const file of [
    "README.md",
    "AGENTS.md",
    "docs/notes.md",
    "prompts/manage-instructions.md",
    "instructions/mobile/ui.md",
    ".agents/skills/brainstorm/SKILL.md",
    ".agents/skills/brainstorm/agents/openai.yaml",
  ]) {
    assert.deepEqual(selectTests([file]), [guidance], file);
  }
});

test("executable instructions and production scripts select their regression suites", () => {
  const cases = [
    [
      ".agents/skills/worktree-setup/references/context-copy.md",
      "scripts/maintenance/worktree-context.test.mjs",
    ],
    [
      ".agents/skills/worktree-setup/SKILL.md",
      "scripts/maintenance/worktree-context.test.mjs",
    ],
    [
      "scripts/setup/agents-override.mjs",
      "scripts/setup/agents-override.test.mjs",
    ],
    ["docs/codex-agent.md", "scripts/setup/agents-override.test.mjs"],
    [
      "scripts/maintenance/cleanup-local.mjs",
      "scripts/maintenance/cleanup-local.test.mjs",
    ],
    [
      "scripts/maintenance/health-check.mjs",
      "scripts/maintenance/health-check.test.mjs",
    ],
    [
      "scripts/maintenance/pre-push.mjs",
      "scripts/maintenance/pre-push.test.mjs",
    ],
    [".husky/pre-push", "scripts/maintenance/git-hooks.test.mjs"],
  ];
  for (const [file, expected] of cases)
    assert.ok(selectTests([file]).includes(expected), file);
  assert.ok(
    selectTests(["scripts/maintenance/pre-push.test.mjs"]).includes(
      "scripts/maintenance/pre-push.test.mjs",
    ),
  );
  assert.equal(selectTests(["scripts/unknown.mjs"]), null);
  assert.equal(
    selectTests([".agents/skills/brainstorm/scripts/helper.py"]),
    null,
  );
  for (const file of [
    "package.json",
    "pnpm-lock.yaml",
    ".gitignore",
    ".codex/config.toml",
  ])
    assert.equal(selectTests([file]), null);
});

test("multiple ref updates and dirty checkout changes are combined with literal NUL filenames", async () => {
  const responses = [
    "README.md\0",
    "",
    "docs/a b.md\0docs/line\nbreak.md\0",
    "",
    "scripts/setup/agents-override.mjs\0",
    "docs/untracked.md\0",
  ];
  const args = [];
  const paths = await changedPaths(update + update, async (command) => {
    args.push(command);
    return result(responses.shift());
  });
  assert.deepEqual(paths, [
    "README.md",
    "docs/a b.md",
    "docs/line\nbreak.md",
    "docs/untracked.md",
    "scripts/setup/agents-override.mjs",
  ]);
  assert.deepEqual(args[0], [
    "diff",
    "--name-only",
    "-z",
    "--no-renames",
    remote,
    local,
    "--",
  ]);
  assert.equal(selectTests(paths), null); // Unclassifiable newline filename stays conservative.
});

test("new branches, unavailable bases, malformed input, and manual runs use full regression", async () => {
  const success = async () => result();
  assert.equal(await changedPaths("", success), null);
  assert.equal(await changedPaths("malformed", success), null);
  assert.equal(await changedPaths(update.replace(remote, zero), success), null);
  assert.equal(await changedPaths(update, async () => result("", 1)), null);
  let calls = 0;
  assert.equal(
    await changedPaths(update, async () =>
      ++calls === 1 ? result("README.md\0") : result("", 1),
    ),
    null,
  );
  assert.deepEqual(
    await changedPaths(update.replace(local, zero), success),
    [],
  );
  const longUpdate = update
    .replaceAll(local, "a".repeat(64))
    .replaceAll(remote, "b".repeat(64));
  assert.deepEqual(await changedPaths(longUpdate, success), []);
});

test("fast push always runs health and blocks on either static or selected test failure", async () => {
  for (const [healthOK, testCode] of [
    [true, 0],
    [false, 0],
    [true, 1],
  ]) {
    const commands = [];
    const checks = [];
    const ok = await runPrePush({
      updates: update,
      healthCheck: async (options) => {
        checks.push(options.args);
        return { ok: healthOK };
      },
      commandExecutor: async (command) => {
        commands.push(command);
        return command.command === "git"
          ? result("README.md\0")
          : result("", testCode);
      },
      stdout() {},
      stderr() {},
    });
    assert.equal(ok, healthOK && testCode === 0);
    assert.deepEqual(checks, [[]]);
    for (const command of commands.filter(
      (command) => command.command === "git",
    )) {
      assert.equal(command.env.GIT_NO_LAZY_FETCH, "1");
    }
    const testRuns = commands.filter((command) => command.command !== "git");
    assert.equal(testRuns.length, healthOK ? 1 : 0);
    if (healthOK)
      assert.deepEqual(testRuns[0].args, [
        "--import",
        "tsx",
        "--test",
        guidance,
      ]);
  }
});

test("full fallback forwards failures and deletion-only pushes still run static health", async () => {
  for (const healthOK of [true, false]) {
    const checks = [];
    assert.equal(
      await runPrePush({
        updates: "",
        healthCheck: async (options) => {
          checks.push(options.args);
          return { ok: healthOK };
        },
        stdout() {},
      }),
      healthOK,
    );
    assert.deepEqual(checks, [["--full"]]);
  }
  const checks = [];
  assert.equal(
    await runPrePush({
      updates: update.replace(local, zero),
      healthCheck: async (options) => {
        checks.push(options.args);
        return { ok: true };
      },
      stdout() {},
    }),
    true,
  );
  assert.deepEqual(checks, [[]]);
});

test("real Git ranges include other-branch checkout differences, staged edits, and untracked instructions", async (t) => {
  const root = await mkdtemp(path.join(tmpdir(), "push-selection-"));
  t.after(() => rm(root, { recursive: true, force: true }));
  const git = (...args) =>
    execFileSync("git", args, {
      cwd: root,
      encoding: "utf8",
      env: {
        ...process.env,
        GIT_CONFIG_GLOBAL: "/dev/null",
        GIT_CONFIG_NOSYSTEM: "1",
      },
    });
  const commit = () => {
    git("add", ".");
    git(
      "-c",
      "user.name=Fixture",
      "-c",
      "user.email=fixture@example.invalid",
      "-c",
      "commit.gpgsign=false",
      "commit",
      "-qm",
      "fixture",
    );
    return git("rev-parse", "HEAD").trim();
  };
  git("init", "-q");
  await writeFile(path.join(root, "README.md"), "before\n");
  const base = commit();
  git("mv", "README.md", "AGENTS.md");
  const head = commit();
  await mkdir(path.join(root, "scripts/maintenance"), { recursive: true });
  await writeFile(
    path.join(root, "scripts/maintenance/cleanup-local.mjs"),
    "// committed checkout difference\n",
  );
  commit();
  await mkdir(path.join(root, "scripts/setup"), { recursive: true });
  await writeFile(
    path.join(root, "scripts/setup/agents-override.mjs"),
    "// staged\n",
  );
  git("add", "scripts/setup/agents-override.mjs");
  await mkdir(path.join(root, ".agents/skills/worktree-setup/references"), {
    recursive: true,
  });
  await writeFile(
    path.join(root, ".agents/skills/worktree-setup/references/context-copy.md"),
    "executable instructions\n",
  );
  const paths = await changedPaths(
    `refs/heads/work ${head} refs/heads/work ${base}\n`,
    async (args) => result(git(...args)),
  );
  assert.deepEqual(paths, [
    ".agents/skills/worktree-setup/references/context-copy.md",
    "AGENTS.md",
    "README.md",
    "scripts/maintenance/cleanup-local.mjs",
    "scripts/setup/agents-override.mjs",
  ]);
  const tests = selectTests(paths);
  assert.ok(tests.includes("scripts/maintenance/cleanup-local.test.mjs"));
  assert.ok(tests.includes("scripts/setup/agents-override.test.mjs"));
  assert.ok(tests.includes("scripts/maintenance/worktree-context.test.mjs"));
});

test("deleted test files fall back to discovery instead of executing missing paths", async () => {
  const checks = [];
  const ok = await runPrePush({
    updates: update,
    commandExecutor: async () =>
      result("scripts/maintenance/removed.test.mjs\0"),
    healthCheck: async (options) => {
      checks.push(options.args);
      return { ok: true };
    },
    stdout() {},
  });
  assert.equal(ok, true);
  assert.deepEqual(checks, [["--full"]]);
});
