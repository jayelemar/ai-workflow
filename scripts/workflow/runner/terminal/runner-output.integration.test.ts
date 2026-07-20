import test from "node:test";

import { runWorkflowRunner } from "../runtime.ts";

import {
  CODEX_COMMAND,
  setupWorkspace,
  writePlan,
  planArg,
  collectConsole,
  runnerReturning,
  codexAgentMessageLine,
  commitSummaryOutput,
  codexCommandOutputLine,
  codexCommandStartedLine,
  assert,
  existsSync,
  join,
  mkdirSync,
  readFile,
  writeFileSync,
  writeWorkflowEventArtifactSync,
  planWith,
  planWithEllipsizedTaskSavepoints,
  planWithFileScope,
  planWithTaskSavepoints,
} from "../__tests__/helpers/runner-runtime.ts";

test(`${CODEX_COMMAND} stdout and stderr are streamed while still captured for logs`, async () => {
  const workspace = await setupWorkspace();
  try {
    await writePlan(
      workspace.root,
      "workflow-runner",
      planWith("completed", "commit-summary"),
    );
    let streamedStdout = "";
    let streamedStderr = "";
    const result = await runWorkflowRunner({
      planName: planArg("workflow-runner"),
      rootDir: workspace.root,
      outputStream: {
        stdout: (chunk) => {
          streamedStdout += chunk;
        },
        stderr: (chunk) => {
          streamedStderr += chunk;
        },
      },
      processRunner: async (call) => {
        if (call.command === "git" && call.args[0] === "status") {
          return { launched: true, stdout: "", stderr: "", exitCode: 0 };
        }
        const rawStdout = `${codexCommandStartedLine("git status --short")}\n${codexCommandOutputLine(
          " M src/file.ts\n",
          "git status --short",
        )}\n`;
        call.onStdout?.(rawStdout);
        call.onStderr?.("live stderr\n");
        return {
          launched: true,
          stdout: rawStdout,
          stderr: "captured stderr",
          exitCode: 0,
        };
      },
    });

    assert.equal(result.success, true);
    assert.equal(streamedStdout, "Ran git status --short\n\n");
    assert.equal(streamedStderr, "live stderr\n");
    const log = await readFile(
      join(
        workspace.root,
        ".ai",
        "artifacts",
        "workflow-runner",
        "logs",
        "runner.log",
      ),
      "utf8",
    );
    assert.match(log, /stdout: omitted \d+ bytes, \d+ lines/);
    assert.match(log, /stderr: omitted \d+ bytes, 1 lines/);
    assert.doesNotMatch(log, /\{"type":"item.started"/);
    assert.doesNotMatch(log, /captured stderr/);
    assert.equal(
      existsSync(
        join(
          workspace.root,
          ".ai",
          "artifacts",
          "workflow-runner",
          "logs",
          "failure.jsonl",
        ),
      ),
      false,
    );
    assert.doesNotMatch(log, /failureDebugPath:/);
  } finally {
    await workspace.cleanup();
  }
});

test("workflow runner does not emit heartbeat lines while codex is streaming output", async () => {
  const workspace = await setupWorkspace();
  try {
    await writePlan(
      workspace.root,
      "heartbeat",
      planWith("active", "execute-plan"),
    );
    const terminalEvents: string[] = [];
    const outputStream = {
      isTTY: true,
      stdout: (chunk: string) => {
        terminalEvents.push(`stdout:${chunk}`);
      },
      stderr: (chunk: string) => {
        terminalEvents.push(`stderr:${chunk}`);
      },
    };
    const hasHeartbeat = () =>
      terminalEvents.some((event) => event.toLowerCase().includes("working:"));

    await runWorkflowRunner({
      planName: planArg("heartbeat"),
      rootDir: workspace.root,
      now: () => 0,
      outputStream,
      processRunner: async (call) => {
        if (call.command === CODEX_COMMAND) {
          assert.equal(hasHeartbeat(), false);
          call.onStdout?.(codexAgentMessageLine("Executing plan"));
          await writePlan(
            workspace.root,
            "heartbeat",
            planWith(
              "blocked",
              "unblock-plan",
              "\n## Blockers\n\n### Blocker 1\n\n* Description: waiting\n",
            ),
          );
        }
        return {
          launched: true,
          stdout: codexAgentMessageLine("Executing plan"),
          stderr: "",
          exitCode: 0,
        };
      },
    });

    const agentOutputIndex = terminalEvents.findIndex((event) =>
      event.includes("[agent]\nExecuting plan"),
    );
    assert(agentOutputIndex >= 0);
    assert.equal(hasHeartbeat(), false);
  } finally {
    await workspace.cleanup();
  }
});

test("workflow runner logs edited file summaries and colorizes live diff counts", async () => {
  const workspace = await setupWorkspace();
  const originalForceColor = process.env.FORCE_COLOR;
  const originalNoColor = process.env.NO_COLOR;
  try {
    process.env.FORCE_COLOR = "1";
    delete process.env.NO_COLOR;
    mkdirSync(join(workspace.root, "src"), { recursive: true });
    writeFileSync(join(workspace.root, "src", "file.ts"), "one\n");
    await writePlan(
      workspace.root,
      "edited-summary",
      planWithFileScope("completed", "commit-summary", {
        modified: ["src/file.ts"],
      }),
    );
    const output = collectConsole();
    const result = await runWorkflowRunner({
      planName: planArg("edited-summary"),
      rootDir: workspace.root,
      console: output.console,
      processRunner: runnerReturning(
        { launched: true, stdout: "summary", stderr: "", exitCode: 0 },
        (call) => {
          if (call.command === CODEX_COMMAND) {
            writeFileSync(join(workspace.root, "src", "file.ts"), "one\ntwo\n");
          }
        },
      ),
    });

    assert.equal(result.success, true);
    assert.match(
      output.lines.join("\n"),
      /\* \u001b\[34mEdited\u001b\[0m src\/file\.ts \(\u001b\[32m\+1\u001b\[0m \u001b\[31m-0\u001b\[0m\)/,
    );
    const log = await readFile(
      join(
        workspace.root,
        ".ai",
        "artifacts",
        "edited-summary",
        "logs",
        "runner.log",
      ),
      "utf8",
    );
    assert.match(log, /editedFiles: Edited src\/file\.ts \(\+1 -0\)/);
  } finally {
    if (originalForceColor === undefined) {
      delete process.env.FORCE_COLOR;
    } else {
      process.env.FORCE_COLOR = originalForceColor;
    }
    if (originalNoColor === undefined) {
      delete process.env.NO_COLOR;
    } else {
      process.env.NO_COLOR = originalNoColor;
    }
    await workspace.cleanup();
  }
});

test("workflow runner prints edited file summaries before the completed turn marker", async () => {
  const workspace = await setupWorkspace();
  const originalForceColor = process.env.FORCE_COLOR;
  const originalNoColor = process.env.NO_COLOR;
  try {
    process.env.FORCE_COLOR = "0";
    delete process.env.NO_COLOR;
    mkdirSync(join(workspace.root, "src"), { recursive: true });
    writeFileSync(join(workspace.root, "src", "file.ts"), "one\n");
    await writePlan(
      workspace.root,
      "edited-summary-spacing",
      planWithFileScope("completed", "commit-summary", {
        modified: ["src/file.ts"],
      }),
    );
    let output = "";
    const result = await runWorkflowRunner({
      planName: planArg("edited-summary-spacing"),
      rootDir: workspace.root,
      console: {
        log: (message) => {
          output += `${message}\n`;
        },
        error: (message) => {
          output += `${message}\n`;
        },
      },
      outputStream: {
        stdout: (chunk) => {
          output += chunk;
        },
        stderr: (chunk) => {
          output += chunk;
        },
      },
      processRunner: runnerReturning(
        {
          launched: true,
          stdout: `${codexAgentMessageLine("Done")}\n${JSON.stringify({ type: "turn.completed" })}\n`,
          stderr: "",
          exitCode: 0,
        },
        (call) => {
          if (call.command === CODEX_COMMAND) {
            writeFileSync(join(workspace.root, "src", "file.ts"), "one\ntwo\n");
            call.onStdout?.(
              `${codexAgentMessageLine("Done")}\n${JSON.stringify({ type: "turn.completed" })}\n`,
            );
          }
        },
      ),
    });

    assert.equal(result.success, true);
    assert.match(
      output,
      /\[agent\]\nDone\n\n\* Edited src\/file\.ts \(\+1 -0\)\n\n\[codex\] turn completed\n\nSUCCESS/,
    );
  } finally {
    if (originalForceColor === undefined) {
      delete process.env.FORCE_COLOR;
    } else {
      process.env.FORCE_COLOR = originalForceColor;
    }
    if (originalNoColor === undefined) {
      delete process.env.NO_COLOR;
    } else {
      process.env.NO_COLOR = originalNoColor;
    }
    await workspace.cleanup();
  }
});

test("workflow runner leaves a blank line between commit progress and streamed live output", async () => {
  const workspace = await setupWorkspace();
  try {
    await writePlan(
      workspace.root,
      "task-savepoint-spacing",
      planWithTaskSavepoints("active", "execute-plan"),
    );
    let output = "";
    let reviewRuns = 0;
    let taskCommitRuns = 0;
    const shas = ["abc1234", "def5678"];
    const result = await runWorkflowRunner({
      planName: planArg("task-savepoint-spacing"),
      rootDir: workspace.root,
      console: {
        log: (message) => {
          output += `${message}\n`;
        },
        error: (message) => {
          output += `${message}\n`;
        },
      },
      outputStream: {
        stdout: (chunk) => {
          output += chunk;
        },
        stderr: (chunk) => {
          output += chunk;
        },
      },
      processRunner: async (call) => {
        if (call.command === "git" && call.args[0] === "rev-parse") {
          return {
            launched: true,
            stdout: `${shas[Math.max(0, taskCommitRuns - 1)]}\n`,
            stderr: "",
            exitCode: 0,
          };
        }
        if (call.command === "git") {
          return { launched: true, stdout: "", stderr: "", exitCode: 0 };
        }
        if (call.command === CODEX_COMMAND) {
          call.onStderr?.("Reading additional input from stdin...\n");
          call.onStdout?.(
            `${JSON.stringify({ type: "thread.started", thread_id: "thread_123" })}\n${JSON.stringify({ type: "turn.started" })}\n`,
          );
        }
        if (call.promptPath === ".ai/prompts/execute-plan.md") {
          await writePlan(
            workspace.root,
            "task-savepoint-spacing",
            planWithTaskSavepoints("review", "review-plan"),
          );
          return { launched: true, stdout: "ok", stderr: "", exitCode: 0 };
        }
        if (call.promptPath === ".ai/prompts/review-changes.md") {
          reviewRuns += 1;
          writeWorkflowEventArtifactSync({
            root: workspace.root,
            planName: "task-savepoint-spacing",
            kind: "review",
            version: reviewRuns,
          });
          await writePlan(
            workspace.root,
            "task-savepoint-spacing",
            planWithTaskSavepoints("completed", "commit-summary"),
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
          const outputs = [
            commitSummaryOutput({
              planPath: ".ai/plans/task-savepoint-spacing.md",
              subject: "feat(api): add backend endpoints",
              summaryLines: [
                "Added backend endpoints for support-ticket flows.",
              ],
            }),
            commitSummaryOutput({
              planPath: ".ai/plans/task-savepoint-spacing.md",
              subject: "feat(web): add support ticket surface",
              summaryLines: ["Added the web surface for support-ticket flows."],
            }),
          ];
          return {
            launched: true,
            stdout: outputs[Math.max(0, taskCommitRuns - 1)] ?? outputs[0],
            stderr: "",
            exitCode: 0,
          };
        }
        return {
          launched: true,
          stdout: `${JSON.stringify({ type: "thread.started", thread_id: "thread_123" })}\n${JSON.stringify({ type: "turn.started" })}\n`,
          stderr: "Reading additional input from stdin...\n",
          exitCode: 0,
        };
      },
    });

    assert.equal(result.success, true, result.success ? "" : result.reason);
    assert.match(
      output,
      /\[EXECUTE\] Task 1 of 2 — Backend endpoints\nProgress: 0 tasks committed · Implementing planned scope\n\nReading additional input from stdin\.\.\.\n\n\[codex\] thread started thread_123\n\n\[codex\] turn started[\s\S]*SUCCESS/,
    );
  } finally {
    await workspace.cleanup();
  }
});

test("task savepoint review output expands ellipsized goals and spaces task status before streamed live output", async () => {
  const workspace = await setupWorkspace();
  try {
    await writePlan(
      workspace.root,
      "task-savepoint-review-spacing",
      planWithEllipsizedTaskSavepoints("review", "review-plan"),
    );
    let output = "";
    const result = await runWorkflowRunner({
      planName: planArg("task-savepoint-review-spacing"),
      rootDir: workspace.root,
      console: {
        log: (message) => {
          output += `${message}\n`;
        },
        error: (message) => {
          output += `${message}\n`;
        },
      },
      outputStream: {
        stdout: (chunk) => {
          output += chunk;
        },
        stderr: (chunk) => {
          output += chunk;
        },
      },
      processRunner: async (call) => {
        if (call.command === "git") {
          return { launched: true, stdout: "", stderr: "", exitCode: 0 };
        }
        if (call.command === CODEX_COMMAND) {
          call.onStderr?.("Reading additional input from stdin...\n");
          call.onStdout?.(
            `${JSON.stringify({ type: "thread.started", thread_id: "thread_review" })}\n`,
          );
          return { launched: true, stdout: "", stderr: "", exitCode: 1 };
        }
        return { launched: true, stdout: "", stderr: "", exitCode: 0 };
      },
    });

    assert.equal(result.success, false);
    assert.match(
      output,
      /\[REVIEW\] Task 1 of 2 — Option management\nProgress: 0 tasks committed · Review scope: 1 staged file\n\nReading additional input from stdin\.\.\.\n\n\[codex\] thread started thread_review/,
    );
  } finally {
    await workspace.cleanup();
  }
});
test("console output reports elapsed time when startup validation fails", async () => {
  const workspace = await setupWorkspace();
  try {
    const output = collectConsole();
    const ticks = [0, 12_000];
    const result = await runWorkflowRunner({
      argv: [],
      rootDir: workspace.root,
      processRunner: runnerReturning({
        launched: true,
        stdout: "",
        stderr: "",
        exitCode: 0,
      }),
      console: output.console,
      now: () => ticks.shift() ?? 12_000,
    });
    assert.equal(result.success, false);
    assert.deepEqual(output.lines, [
      "FAILED: plan name is required",
      "- Worked for 12s",
    ]);
  } finally {
    await workspace.cleanup();
  }
});
