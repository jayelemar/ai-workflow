import assert from "node:assert/strict";
import {
  lstat,
  mkdir,
  mkdtemp,
  readFile,
  readdir,
  rm,
  symlink,
  writeFile,
} from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";

import {
  parseCleanupWorkflowArgs,
  runWorkflowCleanup,
} from "./cleanup-workflow.mjs";

const createFixture = async () => {
  const temporaryRoot = await mkdtemp(
    path.join(os.tmpdir(), "cleanup-workflow-"),
  );
  const workflowDirectory = path.join(temporaryRoot, ".ai");
  const worktreesDirectory = path.join(temporaryRoot, ".worktrees");
  await mkdir(workflowDirectory);
  await mkdir(worktreesDirectory);
  return { temporaryRoot, workflowDirectory, worktreesDirectory };
};

const withFixture = async (callback) => {
  const fixture = await createFixture();
  try {
    return await callback(fixture);
  } finally {
    await rm(fixture.temporaryRoot, { force: true, recursive: true });
  }
};

const pathExists = async (targetPath) => {
  try {
    await lstat(targetPath);
    return true;
  } catch (error) {
    if (error.code === "ENOENT") return false;
    throw error;
  }
};

const writeRecord = async (fixture, relativePath, content = "record\n") => {
  const targetPath = path.join(fixture.workflowDirectory, relativePath);
  await mkdir(path.dirname(targetPath), { recursive: true });
  await writeFile(targetPath, content);
  return targetPath;
};

const addRegisteredTask = async (
  fixture,
  name,
  { dirty = "", locked = false, repository = "frontend" } = {},
) => {
  const taskRoot = path.join(fixture.worktreesDirectory, name);
  const targetPath = path.join(taskRoot, repository);
  const primaryPath = path.join(fixture.temporaryRoot, repository);
  await mkdir(targetPath, { recursive: true });
  await mkdir(path.join(primaryPath, ".git"), { recursive: true });
  await writeFile(path.join(targetPath, ".git"), "gitdir: fixture\n");
  await mkdir(path.join(taskRoot, ".ai"), { recursive: true });
  return {
    branch: `feat/${name}`,
    dirty,
    locked,
    name,
    primaryPath,
    repository,
    targetPath,
    taskRoot,
  };
};

const createCommandExecutor = (tasks, commands = [], failureTarget) => {
  const byTarget = new Map(tasks.map((task) => [task.targetPath, task]));
  const byPrimary = new Map(tasks.map((task) => [task.primaryPath, task]));
  return async ({ args, cwd }) => {
    commands.push({ args, cwd });
    const task = byTarget.get(cwd);
    if (task && args.join(" ") === "rev-parse --show-toplevel") {
      return { exitCode: 0, stderr: "", stdout: `${task.targetPath}\n` };
    }
    if (task && args.join(" ") === "rev-parse --git-common-dir") {
      return {
        exitCode: 0,
        stderr: "",
        stdout: `${path.join(task.primaryPath, ".git")}\n`,
      };
    }
    if (task && args.join(" ") === "worktree list --porcelain") {
      return {
        exitCode: 0,
        stderr: "",
        stdout: [
          `worktree ${task.primaryPath}`,
          "HEAD 1111111111111111111111111111111111111111",
          "branch refs/heads/development",
          "",
          `worktree ${task.targetPath}`,
          "HEAD 2222222222222222222222222222222222222222",
          `branch refs/heads/${task.branch}`,
          ...(task.locked ? ["locked fixture-lock"] : []),
          "",
        ].join("\n"),
      };
    }
    if (
      task &&
      args.join(" ") === "status --porcelain=v1 --untracked-files=all"
    ) {
      return { exitCode: 0, stderr: "", stdout: task.dirty };
    }

    const primaryTask = byPrimary.get(cwd);
    if (primaryTask && args[0] === "worktree" && args[1] === "remove") {
      if (primaryTask.targetPath === failureTarget) {
        return { exitCode: 1, stderr: "simulated removal failure", stdout: "" };
      }
      await rm(primaryTask.targetPath, { force: true, recursive: true });
      return { exitCode: 0, stderr: "", stdout: "" };
    }
    return { exitCode: 1, stderr: "unexpected git command", stdout: "" };
  };
};

const run = async (fixture, tasks, options = {}) => {
  const commands = [];
  const output = [];
  const result = await runWorkflowCleanup({
    args: options.args ?? [],
    commandExecutor:
      options.commandExecutor ??
      createCommandExecutor(tasks, commands, options.failureTarget),
    output: (line) => output.push(line),
    workflowDirectory: fixture.workflowDirectory,
  });
  return { commands, output, result };
};

test("arguments distinguish preview, clean-only apply, and exact all-task approval", () => {
  assert.deepEqual(parseCleanupWorkflowArgs([]), { mode: "preview" });
  assert.deepEqual(parseCleanupWorkflowArgs(["--apply-clean"]), {
    mode: "apply-clean",
  });
  assert.deepEqual(
    parseCleanupWorkflowArgs([
      "--apply-all",
      "--approve",
      "dirty-task",
      "--approve",
      "orphan-task",
    ]),
    {
      approvals: ["dirty-task", "orphan-task"],
      mode: "apply-all",
    },
  );
  assert.match(
    parseCleanupWorkflowArgs(["--apply-all", "--force"]).error,
    /Unknown option/,
  );
});

test("preview lists clean, dirty, and orphan tasks without mutation", async () => {
  await withFixture(async (fixture) => {
    const clean = await addRegisteredTask(fixture, "clean-task");
    const dirty = await addRegisteredTask(fixture, "dirty-task", {
      dirty: " M src/changed.js\n?? src/new.js\n",
    });
    const orphanRoot = path.join(fixture.worktreesDirectory, "orphan-task");
    await mkdir(path.join(orphanRoot, ".ai"), { recursive: true });
    await writeRecord(fixture, "plans/clean-task.md");

    const { output, result } = await run(fixture, [clean, dirty]);

    assert.equal(result.ok, true, output.join("\n"));
    assert.match(output.join("\n"), /clean-task: Clean/);
    assert.match(output.join("\n"), /dirty-task: Approval required/);
    assert.match(output.join("\n"), /M src\/changed\.js/);
    assert.match(output.join("\n"), /\?\? src\/new\.js/);
    assert.match(output.join("\n"), /orphan-task: Approval required/);
    assert.match(output.join("\n"), /No mutation occurred/);
    assert.equal(await pathExists(clean.taskRoot), true);
    assert.equal(await pathExists(dirty.taskRoot), true);
    assert.equal(await pathExists(orphanRoot), true);
  });
});

test("clean-only apply removes clean tasks and unrelated records but preserves dirty task context", async () => {
  await withFixture(async (fixture) => {
    const clean = await addRegisteredTask(fixture, "clean-task");
    const dirty = await addRegisteredTask(fixture, "dirty-task", {
      dirty: " M src/changed.js\n",
    });
    await writeRecord(fixture, "plans/clean-task.md");
    await writeRecord(
      fixture,
      "plans/dirty-task.md",
      "Spec: `.ai/specs/dirty-request.spec.md`\n",
    );
    await writeRecord(fixture, "specs/clean-task.spec.md");
    await writeRecord(fixture, "specs/dirty-request.spec.md");
    await writeRecord(fixture, "artifacts/clean-task/review.md");
    await writeRecord(fixture, "artifacts/dirty-task/review.md");

    const { commands, output, result } = await run(fixture, [clean, dirty], {
      args: ["--apply-clean"],
    });

    assert.equal(result.ok, true, output.join("\n"));
    assert.equal(await pathExists(clean.taskRoot), false);
    assert.equal(await pathExists(dirty.taskRoot), true);
    assert.equal(
      await pathExists(
        path.join(fixture.workflowDirectory, "plans/clean-task.md"),
      ),
      false,
    );
    assert.equal(
      await readFile(
        path.join(fixture.workflowDirectory, "specs/dirty-request.spec.md"),
        "utf8",
      ),
      "record\n",
    );
    assert.equal(
      await readFile(
        path.join(fixture.workflowDirectory, "artifacts/dirty-task/review.md"),
        "utf8",
      ),
      "record\n",
    );
    assert.equal(
      commands.some(
        (command) =>
          command.args.includes("--force") ||
          command.args.includes("branch") ||
          command.args.includes("prune"),
      ),
      false,
    );
  });
});

test("all-task apply refuses incomplete approval before mutation", async () => {
  await withFixture(async (fixture) => {
    const dirty = await addRegisteredTask(fixture, "dirty-task", {
      dirty: " M src/changed.js\n",
    });
    const orphanRoot = path.join(fixture.worktreesDirectory, "orphan-task");
    await mkdir(path.join(orphanRoot, ".ai"), { recursive: true });
    await writeRecord(fixture, "plans/dirty-task.md");

    const { output, result } = await run(fixture, [dirty], {
      args: ["--apply-all", "--approve", "dirty-task"],
    });

    assert.equal(result.ok, false);
    assert.match(output.join("\n"), /approval set does not match/);
    assert.match(output.join("\n"), /orphan-task/);
    assert.equal(await pathExists(dirty.taskRoot), true);
    assert.equal(await pathExists(orphanRoot), true);
    assert.equal(
      await pathExists(
        path.join(fixture.workflowDirectory, "plans/dirty-task.md"),
      ),
      true,
    );
  });
});

test("all-task apply removes exactly approved questionable tasks and retains branches", async () => {
  await withFixture(async (fixture) => {
    const dirty = await addRegisteredTask(fixture, "dirty-task", {
      dirty: " M src/changed.js\n",
      locked: true,
    });
    const orphanRoot = path.join(fixture.worktreesDirectory, "orphan-task");
    await mkdir(path.join(orphanRoot, ".ai"), { recursive: true });
    await writeRecord(fixture, "plans/dirty-task.md");

    const { commands, output, result } = await run(fixture, [dirty], {
      args: [
        "--apply-all",
        "--approve",
        "dirty-task",
        "--approve",
        "orphan-task",
      ],
    });

    assert.equal(result.ok, true, output.join("\n"));
    assert.equal(await pathExists(dirty.taskRoot), false);
    assert.equal(await pathExists(orphanRoot), false);
    assert.deepEqual(
      await readdir(path.join(fixture.workflowDirectory, "plans")),
      [],
    );
    assert.equal(
      commands.some(
        (command) =>
          command.args[0] === "worktree" &&
          command.args[1] === "remove" &&
          command.args.includes("--force"),
      ),
      true,
    );
    assert.equal(
      commands.some(
        (command) =>
          command.args.includes("branch") || command.args.includes("prune"),
      ),
      false,
    );
  });
});

test("a symlinked task root blocks every deletion", async () => {
  await withFixture(async (fixture) => {
    const clean = await addRegisteredTask(fixture, "clean-task");
    const external = path.join(fixture.temporaryRoot, "external");
    await mkdir(external);
    await symlink(
      external,
      path.join(fixture.worktreesDirectory, "linked-task"),
    );
    await writeRecord(fixture, "plans/clean-task.md");

    const { output, result } = await run(fixture, [clean], {
      args: ["--apply-clean"],
    });

    assert.equal(result.ok, false);
    assert.match(output.join("\n"), /symbolic link/);
    assert.equal(await pathExists(clean.taskRoot), true);
    assert.equal(
      await pathExists(
        path.join(fixture.workflowDirectory, "plans/clean-task.md"),
      ),
      true,
    );
  });
});

test("a symlinked task control entry blocks every deletion", async () => {
  await withFixture(async (fixture) => {
    const clean = await addRegisteredTask(fixture, "clean-task");
    const external = path.join(fixture.temporaryRoot, "external-control");
    await mkdir(external);
    await rm(path.join(clean.taskRoot, ".ai"), { recursive: true });
    await symlink(external, path.join(clean.taskRoot, ".ai"));
    await writeRecord(fixture, "plans/clean-task.md");

    const { output, result } = await run(fixture, [clean], {
      args: ["--apply-clean"],
    });

    assert.equal(result.ok, false);
    assert.match(output.join("\n"), /symbolic link/);
    assert.equal(await pathExists(clean.taskRoot), true);
    assert.equal(await pathExists(external), true);
  });
});

test("worktree removal failure preserves central records and reports partial state", async () => {
  await withFixture(async (fixture) => {
    const first = await addRegisteredTask(fixture, "first-task");
    const second = await addRegisteredTask(fixture, "second-task", {
      repository: "server",
    });
    await writeRecord(fixture, "plans/first-task.md");
    await writeRecord(fixture, "plans/second-task.md");

    const { output, result } = await run(fixture, [first, second], {
      args: ["--apply-clean"],
      failureTarget: second.targetPath,
    });

    assert.equal(result.ok, false);
    assert.match(output.join("\n"), /simulated removal failure/);
    assert.match(output.join("\n"), /Central workflow records were preserved/);
    assert.equal(
      await pathExists(
        path.join(fixture.workflowDirectory, "plans/first-task.md"),
      ),
      true,
    );
    assert.equal(
      await pathExists(
        path.join(fixture.workflowDirectory, "plans/second-task.md"),
      ),
      true,
    );
  });
});

test("a concurrent workflow record fails the record postcondition", async () => {
  await withFixture(async (fixture) => {
    const clean = await addRegisteredTask(fixture, "clean-task");
    await writeRecord(fixture, "plans/clean-task.md");
    const commands = [];
    const baseExecutor = createCommandExecutor([clean], commands);
    const commandExecutor = async (command) => {
      const result = await baseExecutor(command);
      if (
        command.args[0] === "worktree" &&
        command.args[1] === "remove" &&
        result.exitCode === 0
      ) {
        await writeRecord(fixture, "plans/concurrent-task.md");
      }
      return result;
    };

    const { output, result } = await run(fixture, [clean], {
      args: ["--apply-clean"],
      commandExecutor,
    });

    assert.equal(result.ok, false);
    assert.match(output.join("\n"), /managed root is not empty/);
    assert.equal(
      await readFile(
        path.join(fixture.workflowDirectory, "plans/concurrent-task.md"),
        "utf8",
      ),
      "record\n",
    );
  });
});

test("help and invalid arguments never inspect or mutate", async () => {
  await withFixture(async (fixture) => {
    const help = await run(fixture, [], { args: ["--help"] });
    const invalid = await run(fixture, [], {
      args: ["--apply-all", "--force"],
    });

    assert.equal(help.result.ok, true);
    assert.match(help.output.join("\n"), /cleanup-workflow\.mjs/);
    assert.equal(invalid.result.ok, false);
    assert.match(invalid.output.join("\n"), /Unknown option/);
  });
});
