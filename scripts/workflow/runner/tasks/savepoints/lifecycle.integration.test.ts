import test from "node:test";

import { runWorkflowRunner } from "../../runtime.ts";

import {
  writeThinPlanArtifacts,
  setupWorkspace,
  writePlan,
  planArg,
  collectConsole,
  codexAgentMessageLine,
  commitSummaryOutput,
  assert,
  dirname,
  join,
  mkdirSync,
  readFile,
  readdir,
  thinPlanManifest,
  writeFile,
  writeFileSync,
  writeWorkflowEventArtifactSync,
  planWithFileScope,
  planWithTaskSavepoints,
  type ProcessRunner,
} from "../../__tests__/helpers/runner-runtime.ts";

test("task savepoint artifacts use task ID filenames for long task names", async () => {
  const workspace = await setupWorkspace();
  try {
    const longTaskName =
      "Update support issue widget create flow so restored saved drafts are sanitized, invalid saved options clear with user feedback, invalid files reject on selection, empty titles and descriptions block inline, field errors clear after correction, no side effects happen on validation failure, partial attachment failures roll back, success clears drafts, failures surface inline, and created issues open detail pages";
    const plan = planWithFileScope(
      "active",
      "execute-plan",
      {
        modified: ["src/task-work.ts"],
      },
      `## Phases

### Implementation

* Objective: Complete task-savepoint work.
* Tasks:
  1. [task:04-widget-real-create] ${longTaskName}
  2. [task:05-widget-follow-up] Finalize widget follow-up
* Expected Outcome: Task savepoint complete.
`,
    );
    await writePlan(workspace.root, "long-task-artifact", plan);

    let reviewRuns = 0;
    let taskCommitRuns = 0;
    const result = await runWorkflowRunner({
      planName: planArg("long-task-artifact"),
      rootDir: workspace.root,
      processRunner: async (call) => {
        if (call.command === "git" && call.args[0] === "rev-parse") {
          return {
            launched: true,
            stdout: "abc1234\n",
            stderr: "",
            exitCode: 0,
          };
        }
        if (call.command === "git") {
          return { launched: true, stdout: "", stderr: "", exitCode: 0 };
        }
        if (call.promptPath === ".ai/prompts/execute-plan.md") {
          await writePlan(
            workspace.root,
            "long-task-artifact",
            plan
              .replace("active", "review")
              .replace("execute-plan", "review-plan"),
          );
          return { launched: true, stdout: "ok", stderr: "", exitCode: 0 };
        }
        if (call.promptPath === ".ai/prompts/review-changes.md") {
          reviewRuns += 1;
          writeWorkflowEventArtifactSync({
            root: workspace.root,
            planName: "long-task-artifact",
            kind: "review",
            version: reviewRuns,
          });
          await writePlan(
            workspace.root,
            "long-task-artifact",
            plan
              .replace("active", "completed")
              .replace("execute-plan", "commit-summary"),
          );
          return { launched: true, stdout: "ok", stderr: "", exitCode: 0 };
        }
        if (call.promptPath === ".ai/prompts/commit-summary.md") {
          const prompt = call.args.at(-1) ?? "";
          if (prompt.includes("Task savepoint aggregate summary")) {
            return {
              launched: true,
              stdout: "aggregate summary",
              stderr: "",
              exitCode: 0,
            };
          }
          taskCommitRuns += 1;
          const subjects = [
            "feat(widget): create real support issues",
            "feat(widget): finalize follow up",
          ];
          return {
            launched: true,
            stdout: commitSummaryOutput({
              planPath: ".ai/plans/long-task-artifact.md",
              subject: subjects[Math.max(0, taskCommitRuns - 1)] ?? subjects[0],
              summaryLines: [
                "Created support issues through the reviewed widget flow.",
              ],
            }),
            stderr: "",
            exitCode: 0,
          };
        }
        return { launched: true, stdout: "ok", stderr: "", exitCode: 0 };
      },
    });

    assert.equal(result.success, true);
    const taskFiles = await readdir(
      join(workspace.root, ".ai", "artifacts", "long-task-artifact", "tasks"),
    );
    assert.deepEqual(taskFiles.sort(), [
      "04-widget-real-create-v1.md",
      "05-widget-follow-up-v1.md",
    ]);
    const longTaskArtifact = await readFile(
      join(
        workspace.root,
        ".ai",
        "artifacts",
        "long-task-artifact",
        "tasks",
        "04-widget-real-create-v1.md",
      ),
      "utf8",
    );
    assert.match(longTaskArtifact, new RegExp(longTaskName));
  } finally {
    await workspace.cleanup();
  }
});
test("task savepoint mode does not treat artifact without commit SHA as complete", async () => {
  const workspace = await setupWorkspace();
  try {
    await writePlan(
      workspace.root,
      "task-savepoint-uncommitted-artifact",
      planWithTaskSavepoints("review", "review-plan"),
    );

    const firstTaskArtifact = join(
      workspace.root,
      ".ai",
      "artifacts",
      "task-savepoint-uncommitted-artifact",
      "tasks",
      "01-backend-endpoints-v1.md",
    );
    mkdirSync(dirname(firstTaskArtifact), { recursive: true });
    writeFileSync(
      firstTaskArtifact,
      `# Task Savepoint: 01-backend-endpoints

## Summary

* Backend endpoints are ready for review but not committed.
`,
      "utf8",
    );

    let reviewPrompt = "";
    const result = await runWorkflowRunner({
      planName: planArg("task-savepoint-uncommitted-artifact"),
      rootDir: workspace.root,
      processRunner: async (call) => {
        if (call.command === "git") {
          return { launched: true, stdout: "", stderr: "", exitCode: 0 };
        }
        if (call.promptPath === ".ai/prompts/review-changes.md") {
          reviewPrompt = call.args.at(-1) ?? "";
          return {
            launched: true,
            stdout: codexAgentMessageLine(
              "STOP: review intentionally paused for assertion",
            ),
            stderr: "",
            exitCode: 0,
          };
        }
        return { launched: true, stdout: "ok", stderr: "", exitCode: 0 };
      },
    });

    assert.equal(result.success, false);
    assert.match(reviewPrompt, /Task ID: 01-backend-endpoints/);
    assert.doesNotMatch(reviewPrompt, /Task ID: 02-web-surface/);

    const currentTask = await readFile(
      join(
        workspace.root,
        ".ai",
        "artifacts",
        "task-savepoint-uncommitted-artifact",
        "state",
        "current-task.md",
      ),
      "utf8",
    );
    assert.match(currentTask, /Task ID: 01-backend-endpoints/);
    assert.match(currentTask, /Commit SHA: \(pending\)/);
  } finally {
    await workspace.cleanup();
  }
});

test("task savepoint mode reuses an existing uncommitted task artifact", async () => {
  const workspace = await setupWorkspace();
  try {
    await writePlan(
      workspace.root,
      "task-savepoint-current-artifact",
      planWithTaskSavepoints("active", "execute-plan"),
    );

    const firstTaskArtifact = join(
      workspace.root,
      ".ai",
      "artifacts",
      "task-savepoint-current-artifact",
      "tasks",
      "01-backend-endpoints-v1.md",
    );
    mkdirSync(dirname(firstTaskArtifact), { recursive: true });
    writeFileSync(
      firstTaskArtifact,
      `# Task Savepoint: 01-backend-endpoints

## Status

review-ready

## Commit SHA

(pending)
`,
      "utf8",
    );

    let executePrompt = "";
    const result = await runWorkflowRunner({
      planName: planArg("task-savepoint-current-artifact"),
      rootDir: workspace.root,
      processRunner: async (call) => {
        if (call.command === "git") {
          return { launched: true, stdout: "", stderr: "", exitCode: 0 };
        }
        if (call.promptPath === ".ai/prompts/execute-plan.md") {
          executePrompt = call.args.at(-1) ?? "";
          return {
            launched: true,
            stdout: codexAgentMessageLine("STOP: intentional assertion stop"),
            stderr: "",
            exitCode: 0,
          };
        }
        return { launched: true, stdout: "ok", stderr: "", exitCode: 0 };
      },
    });

    assert.equal(result.success, false);
    assert.match(
      executePrompt,
      /Task Artifact: \.ai\/artifacts\/task-savepoint-current-artifact\/tasks\/01-backend-endpoints-v1\.md/,
    );

    const currentTask = await readFile(
      join(
        workspace.root,
        ".ai",
        "artifacts",
        "task-savepoint-current-artifact",
        "state",
        "current-task.md",
      ),
      "utf8",
    );
    assert.match(
      currentTask,
      /Task Artifact: \.ai\/artifacts\/task-savepoint-current-artifact\/tasks\/01-backend-endpoints-v1\.md/,
    );
  } finally {
    await workspace.cleanup();
  }
});

test("task savepoint mode creates a current task artifact before commit-summary", async () => {
  const workspace = await setupWorkspace();
  try {
    await writePlan(
      workspace.root,
      "task-savepoint-stage-artifact",
      planWithTaskSavepoints("active", "execute-plan"),
    );

    const result = await runWorkflowRunner({
      planName: planArg("task-savepoint-stage-artifact"),
      rootDir: workspace.root,
      processRunner: async (call) => {
        if (call.command === "git") {
          return { launched: true, stdout: "", stderr: "", exitCode: 0 };
        }
        if (call.promptPath === ".ai/prompts/execute-plan.md") {
          return {
            launched: true,
            stdout: codexAgentMessageLine("STOP: intentional assertion stop"),
            stderr: "",
            exitCode: 0,
          };
        }
        return { launched: true, stdout: "ok", stderr: "", exitCode: 0 };
      },
    });

    assert.equal(result.success, false);
    const artifact = await readFile(
      join(
        workspace.root,
        ".ai",
        "artifacts",
        "task-savepoint-stage-artifact",
        "tasks",
        "01-backend-endpoints-v1.md",
      ),
      "utf8",
    );
    assert.match(artifact, /# Task Savepoint: 01-backend-endpoints/);
    assert.match(artifact, /## Stage\s+implementing/);
    assert.match(artifact, /## Commit SHA\s+\(pending\)/);
  } finally {
    await workspace.cleanup();
  }
});

test("task savepoint mode reopens thin-plan without writing generated sections into the manifest", async () => {
  const workspace = await setupWorkspace();
  try {
    await writeThinPlanArtifacts(workspace.root, {
      status: "completed",
      nextAction: "commit-summary",
      modified: ["src/artifact-state.ts"],
      changedFiles: ["src/artifact-state.ts"],
    });
    await writePlan(
      workspace.root,
      "artifact-state",
      thinPlanManifest(
        "completed",
        "commit-summary",
        `## Phases

### Implementation

* Objective: Complete artifact-state task savepoints.
* Tasks:
  1. [task:01-backend-endpoints] Add backend endpoints
  2. [task:02-web-surface] Add web surface
* Expected Outcome: Task savepoints complete.
`,
      ),
    );

    const firstTaskArtifact = join(
      workspace.root,
      ".ai",
      "artifacts",
      "artifact-state",
      "tasks",
      "01-backend-endpoints-v1.md",
    );
    mkdirSync(dirname(firstTaskArtifact), { recursive: true });
    writeFileSync(
      firstTaskArtifact,
      `# Task Savepoint: 01-backend-endpoints

## Summary

* Added backend endpoints for artifact-state flows.

## Commit SHA

abc1234

## Commit Message

feat(api): add backend endpoints
`,
      "utf8",
    );

    let executeRuns = 0;
    const result = await runWorkflowRunner({
      planName: planArg("artifact-state"),
      rootDir: workspace.root,
      console: collectConsole().console,
      processRunner: async (call) => {
        if (call.command === "git") {
          return { launched: true, stdout: "", stderr: "", exitCode: 0 };
        }
        if (call.promptPath === ".ai/prompts/execute-plan.md") {
          executeRuns += 1;
          return {
            launched: true,
            stdout: "intentional stop after reopen",
            stderr: "",
            exitCode: 1,
          };
        }
        return { launched: true, stdout: "ok", stderr: "", exitCode: 0 };
      },
    });

    const manifest = await readFile(
      join(workspace.root, ".ai", "plans", "artifact-state.md"),
      "utf8",
    );
    const workflow = JSON.parse(
      await readFile(
        join(
          workspace.root,
          ".ai",
          "artifacts",
          "artifact-state",
          "state",
          "workflow.json",
        ),
        "utf8",
      ),
    );

    assert.equal(result.success, false);
    assert.equal(executeRuns, 1);
    assert.doesNotMatch(manifest, /^## Implementation Map$/m);
    assert.doesNotMatch(manifest, /^## Files \(MANDATORY\)$/m);
    assert.match(manifest, /## Workflow State\n\nactive/);
    assert.equal(workflow.workflowState, "active");
  } finally {
    await workspace.cleanup();
  }
});

test("task savepoint mode preserves an existing uncommitted task at commit-summary", async () => {
  const workspace = await setupWorkspace();
  try {
    await writePlan(
      workspace.root,
      "task-savepoint-summary-resume",
      planWithTaskSavepoints("completed", "commit-summary"),
    );

    const firstTaskArtifact = join(
      workspace.root,
      ".ai",
      "artifacts",
      "task-savepoint-summary-resume",
      "tasks",
      "01-backend-endpoints-v1.md",
    );
    const secondTaskArtifact = join(
      workspace.root,
      ".ai",
      "artifacts",
      "task-savepoint-summary-resume",
      "tasks",
      "02-web-surface-v1.md",
    );
    mkdirSync(dirname(firstTaskArtifact), { recursive: true });
    writeFileSync(
      firstTaskArtifact,
      `# Task Savepoint: 01-backend-endpoints

## Commit SHA

abc1234
`,
      "utf8",
    );
    writeFileSync(
      secondTaskArtifact,
      `# Task Savepoint: 02-web-surface

## Stage

implementing

## Commit SHA

(pending)
`,
      "utf8",
    );

    const promptCalls: string[] = [];
    const result = await runWorkflowRunner({
      planName: planArg("task-savepoint-summary-resume"),
      rootDir: workspace.root,
      processRunner: async (call) => {
        if (call.command === "git") {
          return { launched: true, stdout: "", stderr: "", exitCode: 0 };
        }
        promptCalls.push(call.promptPath);
        if (call.promptPath === ".ai/prompts/commit-summary.md") {
          return {
            launched: true,
            stdout: codexAgentMessageLine(
              "STOP: commit preflight failed for current task",
            ),
            stderr: "",
            exitCode: 0,
          };
        }
        return { launched: true, stdout: "ok", stderr: "", exitCode: 0 };
      },
    });

    assert.equal(result.success, false);
    assert.match(result.reason, /commit preflight failed for current task/);
    assert.deepEqual(promptCalls, [".ai/prompts/commit-summary.md"]);
  } finally {
    await workspace.cleanup();
  }
});

test("task savepoint mode recovers missing task artifact from existing task commit", async () => {
  const workspace = await setupWorkspace();
  try {
    await writePlan(
      workspace.root,
      "task-savepoint-missing-artifact",
      planWithTaskSavepoints("completed", "commit-summary"),
    );

    let executeRuns = 0;
    let taskCommitRuns = 0;
    let aggregateRuns = 0;
    const promptCalls: string[] = [];

    const result = await runWorkflowRunner({
      planName: planArg("task-savepoint-missing-artifact"),
      rootDir: workspace.root,
      console: collectConsole().console,
      processRunner: async (call) => {
        if (call.command === "git" && call.args[0] === "log") {
          return {
            launched: true,
            stdout: [
              "abc1234abc1234abc1234abc1234abc1234",
              "feat(api): add backend endpoints",
              "",
              "Plan",
              "task-savepoint-missing-artifact",
              "",
              "Task ID",
              "01-backend-endpoints",
            ].join("\n"),
            stderr: "",
            exitCode: 0,
          };
        }
        if (call.command === "git" && call.args[0] === "rev-parse") {
          return {
            launched: true,
            stdout: "def5678\n",
            stderr: "",
            exitCode: 0,
          };
        }
        if (call.command === "git") {
          return { launched: true, stdout: "", stderr: "", exitCode: 0 };
        }
        promptCalls.push(call.promptPath);
        if (call.promptPath === ".ai/prompts/execute-plan.md") {
          executeRuns += 1;
          const prompt = call.args.at(-1) ?? "";
          assert.match(prompt, /Task ID: 02-web-surface/);
          await writePlan(
            workspace.root,
            "task-savepoint-missing-artifact",
            planWithTaskSavepoints("review", "review-plan"),
          );
          return { launched: true, stdout: "ok", stderr: "", exitCode: 0 };
        }
        if (call.promptPath === ".ai/prompts/review-changes.md") {
          writeWorkflowEventArtifactSync({
            root: workspace.root,
            planName: "task-savepoint-missing-artifact",
            kind: "review",
            version: 1,
          });
          await writePlan(
            workspace.root,
            "task-savepoint-missing-artifact",
            planWithTaskSavepoints("completed", "commit-summary"),
          );
          return { launched: true, stdout: "ok", stderr: "", exitCode: 0 };
        }
        if (call.promptPath === ".ai/prompts/commit-summary.md") {
          const prompt = call.args.at(-1) ?? "";
          if (prompt.includes("Task savepoint aggregate summary")) {
            aggregateRuns += 1;
            return {
              launched: true,
              stdout: "aggregate summary",
              stderr: "",
              exitCode: 0,
            };
          }
          taskCommitRuns += 1;
          assert.match(prompt, /Task ID: 02-web-surface/);
          return {
            launched: true,
            stdout: commitSummaryOutput({
              planPath: ".ai/plans/task-savepoint-missing-artifact.md",
              subject: "feat(web): add support ticket surface",
              summaryLines: [
                "Added the web surface for the reviewed support-ticket task.",
              ],
            }),
            stderr: "",
            exitCode: 0,
          };
        }
        return { launched: true, stdout: "ok", stderr: "", exitCode: 0 };
      },
    });

    assert.equal(result.success, true);
    assert.equal(executeRuns, 1);
    assert.equal(taskCommitRuns, 1);
    assert.equal(aggregateRuns, 1);
    assert.equal(promptCalls[0], ".ai/prompts/execute-plan.md");

    const taskFiles = await readdir(
      join(
        workspace.root,
        ".ai",
        "artifacts",
        "task-savepoint-missing-artifact",
        "tasks",
      ),
    );
    assert.match(taskFiles.join("\n"), /^01-backend-endpoints-v1\.md$/m);
  } finally {
    await workspace.cleanup();
  }
});

test("task savepoint mode recovers a later thin-plan task from its saved commit parent", async () => {
  const workspace = await setupWorkspace();
  try {
    mkdirSync(join(workspace.root, "src"), { recursive: true });
    await writeFile(
      join(workspace.root, "src", "task-work.ts"),
      "task work\n",
    );
    await writePlan(
      workspace.root,
      "artifact-state",
      `${thinPlanManifest("completed", "commit-summary")}
## Phases

### Implementation

* Objective: Complete task-savepoint work.
* Tasks:
  2. [task:02-web-surface] Add web surface
`,
    );
    await writeThinPlanArtifacts(workspace.root, {
      status: "completed",
      nextAction: "commit-summary",
      modified: ["src/task-work.ts"],
      changedFiles: ["src/task-work.ts"],
      owns: ["src/task-work.ts"],
    });

    const taskDir = join(
      workspace.root,
      ".ai",
      "artifacts",
      "artifact-state",
      "tasks",
    );
    mkdirSync(taskDir, { recursive: true });
    writeFileSync(
      join(taskDir, "01-artifact-state-v1.md"),
      `# Task Savepoint: 01-artifact-state

## Commit SHA

abc1234
`,
      "utf8",
    );

    const promptCalls: string[] = [];
    const result = await runWorkflowRunner({
      planName: planArg("artifact-state"),
      rootDir: workspace.root,
      console: collectConsole().console,
      processRunner: async (call) => {
        if (call.command === "git" && call.args[0] === "log") {
          return {
            launched: true,
            stdout: [
              "def5678def5678def5678def5678def5678",
              "abc123",
              "feat(web): add support ticket surface",
            ].join("\n"),
            stderr: "",
            exitCode: 0,
          };
        }
        if (call.command === "git") {
          return {
            launched: true,
            stdout: call.args[0] === "rev-parse" ? "def5678\n" : "",
            stderr: "",
            exitCode: 0,
          };
        }
        promptCalls.push(call.promptPath);
        if (call.promptPath === ".ai/prompts/commit-summary.md") {
          const prompt = call.args.at(-1) ?? "";
          assert.match(prompt, /Task savepoint aggregate summary/);
          return {
            launched: true,
            stdout: "aggregate summary",
            stderr: "",
            exitCode: 0,
          };
        }
        return { launched: true, stdout: "ok", stderr: "", exitCode: 0 };
      },
    });

    assert.equal(result.success, true);
    assert.deepEqual(promptCalls, [".ai/prompts/commit-summary.md"]);
    const recoveredTask = await readFile(
      join(taskDir, "02-web-surface-v1.md"),
      "utf8",
    );
    assert.match(recoveredTask, /Commit SHA\n\ndef5678de/);
    const currentTask = await readFile(
      join(
        workspace.root,
        ".ai",
        "artifacts",
        "artifact-state",
        "state",
        "current-task.md",
      ),
      "utf8",
    );
    assert.match(currentTask, /Task ID: 02-web-surface/);
    assert.match(currentTask, /Stage: committed/);
    assert.match(currentTask, /Commit SHA: def5678de/);

    const repeatOutput = collectConsole();
    const repeatCalls: Parameters<ProcessRunner>[0][] = [];
    const repeatedResult = await runWorkflowRunner({
      planName: planArg("artifact-state"),
      rootDir: workspace.root,
      console: repeatOutput.console,
      processRunner: async (call) => {
        repeatCalls.push(call);
        if (call.command === "git") {
          return { launched: true, stdout: "", stderr: "", exitCode: 0 };
        }
        throw new Error(`unexpected workflow prompt: ${call.promptPath}`);
      },
    });

    assert.equal(repeatedResult.success, true);
    assert.equal(repeatCalls.every((call) => call.command === "git"), true);
    assert.match(
      repeatOutput.lines.join("\n"),
      /\[\d+\/\d+\] task commits complete[\s\S]*SUCCESS/,
    );
  } finally {
    await workspace.cleanup();
  }
});

test("task commit recovery reopens the plan before the next task", async () => {
  const workspace = await setupWorkspace();
  try {
    mkdirSync(join(workspace.root, "src"), { recursive: true });
    await writeFile(
      join(workspace.root, "src", "task-work.ts"),
      "task work\n",
    );
    await writePlan(
      workspace.root,
      "artifact-state",
      `${thinPlanManifest("completed", "commit-summary")}
## Phases

### Implementation

* Objective: Complete task-savepoint work.
* Tasks:
  2. [task:02-web-surface] Add web surface
  3. [task:03-app-shell] Add app shell
`,
    );
    await writeThinPlanArtifacts(workspace.root, {
      status: "completed",
      nextAction: "commit-summary",
      modified: ["src/task-work.ts"],
      changedFiles: ["src/task-work.ts"],
      owns: ["src/task-work.ts"],
    });

    const taskDir = join(
      workspace.root,
      ".ai",
      "artifacts",
      "artifact-state",
      "tasks",
    );
    mkdirSync(taskDir, { recursive: true });
    writeFileSync(
      join(taskDir, "01-artifact-state-v1.md"),
      `# Task Savepoint: 01-artifact-state

## Commit SHA

abc1234
`,
      "utf8",
    );

    const promptCalls: string[] = [];
    const result = await runWorkflowRunner({
      planName: planArg("artifact-state"),
      rootDir: workspace.root,
      console: collectConsole().console,
      processRunner: async (call) => {
        if (call.command === "git" && call.args[0] === "log") {
          return {
            launched: true,
            stdout: [
              "def5678def5678def5678def5678def5678",
              "abc123",
              "feat(web): add support ticket surface",
            ].join("\n"),
            stderr: "",
            exitCode: 0,
          };
        }
        if (call.command === "git") {
          return {
            launched: true,
            stdout: call.args[0] === "rev-parse" ? "def5678\n" : "",
            stderr: "",
            exitCode: 0,
          };
        }
        promptCalls.push(call.promptPath);
        assert.equal(call.promptPath, ".ai/prompts/execute-plan.md");
        assert.match(call.args.at(-1) ?? "", /Task ID: 03-app-shell/);
        return {
          launched: true,
          stdout: codexAgentMessageLine("STOP: expected recovery handoff"),
          stderr: "",
          exitCode: 0,
        };
      },
    });

    assert.equal(result.success, false);
    assert.deepEqual(
      promptCalls,
      [".ai/prompts/execute-plan.md"],
      result.reason,
    );
    const manifest = await readFile(
      join(workspace.root, ".ai", "plans", "artifact-state.md"),
      "utf8",
    );
    assert.match(manifest, /## Workflow State\n\nactive/);
    const workflow = await readFile(
      join(
        workspace.root,
        ".ai",
        "artifacts",
        "artifact-state",
        "state",
        "workflow.json",
      ),
      "utf8",
    );
    assert.match(workflow, /"workflowState": "active"/);
  } finally {
    await workspace.cleanup();
  }
});

test("task savepoint mode stops failed review before commit and keeps current task active", async () => {
  const workspace = await setupWorkspace();
  try {
    await writePlan(
      workspace.root,
      "task-review-fail",
      planWithTaskSavepoints("active", "execute-plan"),
    );

    const output = collectConsole();
    const calls: Parameters<ProcessRunner>[0][] = [];
    const result = await runWorkflowRunner({
      planName: planArg("task-review-fail"),
      rootDir: workspace.root,
      console: output.console,
      processRunner: async (call) => {
        calls.push(call);
        if (call.command === "git") {
          return { launched: true, stdout: "", stderr: "", exitCode: 0 };
        }
        if (call.promptPath === ".ai/prompts/execute-plan.md") {
          await writePlan(
            workspace.root,
            "task-review-fail",
            planWithTaskSavepoints("review", "review-plan"),
          );
          return { launched: true, stdout: "ok", stderr: "", exitCode: 0 };
        }
        if (call.promptPath === ".ai/prompts/review-changes.md") {
          return {
            launched: true,
            stdout: codexAgentMessageLine(
              "STOP: review failed for current task",
            ),
            stderr: "",
            exitCode: 0,
          };
        }
        return { launched: true, stdout: "ok", stderr: "", exitCode: 0 };
      },
    });

    assert.equal(result.success, false);
    assert.match(result.reason, /review failed for current task/);
    assert.equal(
      calls.some((call) => call.promptPath === ".ai/prompts/commit-summary.md"),
      false,
    );
    const currentTask = await readFile(
      join(
        workspace.root,
        ".ai",
        "artifacts",
        "task-review-fail",
        "state",
        "current-task.md",
      ),
      "utf8",
    );
    assert.match(currentTask, /Task ID: 01-backend-endpoints/);
    assert.match(currentTask, /Stage: reviewing/);
    assert.doesNotMatch(output.lines.join("\n"), /\[TASK COMPLETE\]|Created \d+ commit/i);
  } finally {
    await workspace.cleanup();
  }
});

test("task savepoint mode bounds artifact filenames for long task names", async () => {
  const workspace = await setupWorkspace();
  try {
    const longTaskName =
      "Goal update only the prompt search planning savepoint so it owns prompt wording and prompt query assertions for preserving the existing market research section model source backed competitor analysis instructions conservative limitations and downstream section guidance without claiming generator enforced semantics files likely to change dependencies approved spec and the current prompt search planning entry points already exercised by the existing backend tests validation first add or update deterministic prompt search planning assertions that fail against the current wording then implement the prompt search guidance change and run completion criteria the savepoint owns only prompt search guidance plus its failing tests passes without schema or ui changes and does not claim summary classification benchmark confidence or source traceability enforcement that still lives in v1";
    const planContent = (status: string, nextAction: string, extra = "") =>
      planWithFileScope(
        status,
        nextAction,
        {
          modified: ["src/task-work.ts"],
        },
        `## Phases

### Implementation

* Objective: Complete task-savepoint work.
* Tasks:
  1. [task:01-backend-prompt-search-guidance] ${longTaskName}
  2. [task:02-web-surface] Add web surface
* Expected Outcome: Task savepoints complete.

${extra}`,
      );

    await writePlan(
      workspace.root,
      "task-savepoint-long-name",
      planContent("active", "execute-plan"),
    );

    let reviewRuns = 0;
    let taskCommitRuns = 0;
    const output = collectConsole();
    const result = await runWorkflowRunner({
      planName: planArg("task-savepoint-long-name"),
      rootDir: workspace.root,
      console: output.console,
      processRunner: async (call) => {
        if (call.command === "git" && call.args[0] === "rev-parse") {
          return {
            launched: true,
            stdout: taskCommitRuns === 1 ? "abc1234\n" : "def5678\n",
            stderr: "",
            exitCode: 0,
          };
        }
        if (call.command === "git") {
          return { launched: true, stdout: "", stderr: "", exitCode: 0 };
        }
        if (call.promptPath === ".ai/prompts/execute-plan.md") {
          await writePlan(
            workspace.root,
            "task-savepoint-long-name",
            planContent("review", "review-plan"),
          );
          return { launched: true, stdout: "ok", stderr: "", exitCode: 0 };
        }
        if (call.promptPath === ".ai/prompts/review-changes.md") {
          reviewRuns += 1;
          writeWorkflowEventArtifactSync({
            root: workspace.root,
            planName: "task-savepoint-long-name",
            kind: "review",
            version: reviewRuns,
          });
          await writePlan(
            workspace.root,
            "task-savepoint-long-name",
            planContent("completed", "commit-summary"),
          );
          return { launched: true, stdout: "ok", stderr: "", exitCode: 0 };
        }
        if (call.promptPath === ".ai/prompts/commit-summary.md") {
          const prompt = call.args.at(-1) ?? "";
          if (prompt.includes("Task savepoint aggregate summary")) {
            return {
              launched: true,
              stdout: "aggregate summary",
              stderr: "",
              exitCode: 0,
            };
          }
          taskCommitRuns += 1;
          return {
            launched: true,
            stdout: commitSummaryOutput({
              planPath: ".ai/plans/task-savepoint-long-name.md",
              subject: "test(workflow): keep task artifacts writable",
              summaryLines: [
                "Committed the long-name task without overflowing the task artifact filename.",
              ],
            }),
            stderr: "",
            exitCode: 0,
          };
        }
        return { launched: true, stdout: "ok", stderr: "", exitCode: 0 };
      },
    });

    assert.equal(result.success, true);

    const taskFiles = await readdir(
      join(
        workspace.root,
        ".ai",
        "artifacts",
        "task-savepoint-long-name",
        "tasks",
      ),
    );
    assert.deepEqual(taskFiles.sort(), [
      "01-backend-prompt-search-guidance-v1.md",
      "02-web-surface-v1.md",
    ]);
    assert.ok(taskFiles.every((file) => file.length <= 255));

    const consoleOutput = output.lines.join("\n");
    assert.match(
      consoleOutput,
      /\[EXECUTE\] Task 1 of 2 — Backend prompt search guidance\nProgress: 0 tasks committed · Implementing planned scope/,
    );
    assert.doesNotMatch(
      consoleOutput,
      /without claiming generator enforced semantics/,
    );

    const firstTaskArtifact = await readFile(
      join(
        workspace.root,
        ".ai",
        "artifacts",
        "task-savepoint-long-name",
        "tasks",
        "01-backend-prompt-search-guidance-v1.md",
      ),
      "utf8",
    );
    assert.match(firstTaskArtifact, new RegExp(longTaskName));
  } finally {
    await workspace.cleanup();
  }
});
