import test from "node:test";

import { runWorkflowRunner } from "../../../runner.ts";

import {
  CODEX_COMMAND,
  writeThinPlanV2Artifacts,
  setupWorkspace,
  writePlan,
  turnCompletedUsageDetailLine,
  assertCallSubsequence,
  planArg,
  assertFailureMetadata,
  collectConsole,
  runnerReturning,
  codexAgentMessageLine,
  commitSummaryOutput,
  assert,
  dirname,
  existsSync,
  join,
  mkdirSync,
  readFile,
  readdir,
  thinPlanV2Manifest,
  writeFile,
  writeFileSync,
  writeWorkflowEventArtifactSync,
  planWith,
  planWithFileScope,
  planWithTaskSavepoints,
  type ProcessRunner,
} from "../helpers/runner-runtime.ts";

test("routes only spec-defined executable pairs and sends blocked plans through unblock", async () => {
  const workspace = await setupWorkspace();
  try {
    const cases = [
      [
        "draft-sync",
        "draft",
        "sync-plan-artifacts",
        ".ai/prompts/sync-plan-artifacts.md",
        "gpt-5.6-luna",
        "medium",
      ],
      [
        "draft-validator",
        "draft",
        "plan-validator",
        ".ai/prompts/plan-validator.md",
        "gpt-5.6-terra",
        "medium",
      ],
      [
        "approved-execute",
        "approved",
        "execute-plan",
        ".ai/prompts/execute-plan.md",
        "gpt-5.5",
        "high",
      ],
      [
        "active-execute",
        "active",
        "execute-plan",
        ".ai/prompts/execute-plan.md",
        "gpt-5.5",
        "high",
      ],
      [
        "blocked-unblock",
        "blocked",
        "unblock-plan",
        ".ai/prompts/unblock-plan.md",
        "gpt-5.6-luna",
        "medium",
      ],
      [
        "blocked-legacy",
        "blocked",
        "execute-plan",
        ".ai/prompts/unblock-plan.md",
        "gpt-5.6-luna",
        "medium",
      ],
      [
        "review-review",
        "review",
        "review-plan",
        ".ai/prompts/review-changes.md",
        "gpt-5.6-terra",
        "xhigh",
      ],
      [
        "reopen-reopen",
        "reopening",
        "reopen-plan",
        ".ai/prompts/reopen-plan.md",
        "gpt-5.6-luna",
        "medium",
      ],
      [
        "completed-commit",
        "completed",
        "commit-summary",
        ".ai/prompts/commit-summary.md",
        "gpt-5.6-terra",
        "medium",
      ],
    ] as const;
    const launchedPrompts: string[] = [];
    const launchedModels: string[] = [];
    const launchedReasoning: string[] = [];
    for (const [
      name,
      status,
      nextAction,
      promptPath,
      model,
      reasoning,
    ] of cases) {
      await writePlan(workspace.root, name, planWith(status, nextAction));
      const launchedBefore = launchedPrompts.length;
      const result = await runWorkflowRunner({
        planName: planArg(name),
        rootDir: workspace.root,
        processRunner: runnerReturning(
          { launched: true, stdout: "done", stderr: "", exitCode: 0 },
          (call) => {
            if (
              call.command === CODEX_COMMAND &&
              call.promptPath !== ".ai/prompts/scope-cleanup.md"
            ) {
              launchedPrompts.push(call.promptPath);
              launchedModels.push(call.args[3] ?? "");
              launchedReasoning.push(call.args[5] ?? "");
            }
            if (call.promptPath === ".ai/prompts/scope-cleanup.md") {
              return;
            }
            if (call.promptPath === ".ai/prompts/sync-plan-artifacts.md") {
              writeFileSync(
                join(workspace.root, ".ai", "plans", `${name}.md`),
                planWith("draft", "plan-validator"),
              );
              return;
            }
            if (call.promptPath === ".ai/prompts/unblock-plan.md") {
              writeFileSync(
                join(workspace.root, ".ai", "plans", `${name}.md`),
                planWith("active", "execute-plan"),
              );
              return;
            }
            if (call.promptPath === ".ai/prompts/execute-plan.md") {
              writeFileSync(
                join(workspace.root, ".ai", "plans", `${name}.md`),
                planWith("blocked", "unblock-plan"),
              );
              return;
            }
            if (call.promptPath !== ".ai/prompts/commit-summary.md") {
              writeFileSync(
                join(workspace.root, ".ai", "plans", `${name}.md`),
                planWith("blocked", "unblock-plan"),
              );
            }
          },
        ),
      });
      assert.equal(launchedPrompts[launchedBefore], promptPath);
      assert.equal(launchedModels[launchedBefore], model);
      assert.equal(
        launchedReasoning[launchedBefore],
        `model_reasoning_effort="${reasoning}"`,
      );
      assert.equal(typeof result.reason, "string");
    }

    await writePlan(
      workspace.root,
      "undefined",
      planWith("draft", "execute-plan"),
    );
    const undefinedPair = await runWorkflowRunner({
      planName: planArg("undefined"),
      rootDir: workspace.root,
      processRunner: runnerReturning({
        launched: true,
        stdout: "",
        stderr: "",
        exitCode: 0,
      }),
    });
    assert.equal(undefinedPair.success, false);
    assert.match(undefinedPair.reason, /unknown workflowState value: draft--execute-plan/);

    await writePlan(
      workspace.root,
      "unsupported-fix",
      planWith("draft", "fix-plan"),
    );
    const unsupportedFix = await runWorkflowRunner({
      planName: planArg("unsupported-fix"),
      rootDir: workspace.root,
      processRunner: runnerReturning({
        launched: true,
        stdout: "",
        stderr: "",
        exitCode: 0,
      }),
    });
    assert.equal(unsupportedFix.success, false);
    assert.match(unsupportedFix.reason, /unknown workflowState value: draft--fix-plan/);

    await writePlan(
      workspace.root,
      "completed-reopen",
      planWith("completed", "reopen-plan"),
    );
    const completedReopen = await runWorkflowRunner({
      planName: planArg("completed-reopen"),
      rootDir: workspace.root,
      processRunner: runnerReturning({
        launched: true,
        stdout: "",
        stderr: "",
        exitCode: 0,
      }),
    });
    assert.equal(completedReopen.success, false);
    assert.match(
      completedReopen.reason,
      /unknown workflowState value: completed--reopen-plan/,
    );

    await writePlan(
      workspace.root,
      "deployment-validation",
      planWith("deployment-validation", "unblock-plan"),
    );
    const deploymentValidation = await runWorkflowRunner({
      planName: planArg("deployment-validation"),
      rootDir: workspace.root,
      processRunner: runnerReturning({
        launched: true,
        stdout: "",
        stderr: "",
        exitCode: 0,
      }),
    });
    assert.equal(deploymentValidation.success, false);
    assert.match(
      deploymentValidation.reason,
      /unknown workflowState value: deployment-validation--unblock-plan/,
    );
  } finally {
    await workspace.cleanup();
  }
});

test("review safe path routes to completed commit-summary and succeeds after plan-owned paths are clean", async () => {
  const workspace = await setupWorkspace();
  try {
    await writePlan(
      workspace.root,
      "safe-review",
      planWithFileScope("review", "review-plan", {
        modified: ["src/file.ts"],
      }),
    );
    const calls: Parameters<ProcessRunner>[0][] = [];
    const result = await runWorkflowRunner({
      planName: planArg("safe-review"),
      rootDir: workspace.root,
      processRunner: async (call) => {
        calls.push(call);
        if (call.command === "git" && call.args[0] === "diff") {
          return {
            launched: true,
            stdout: [
              "diff --git a/src/file.ts b/src/file.ts",
              "index 1111111..2222222 100644",
              "--- a/src/file.ts",
              "+++ b/src/file.ts",
              "@@ -10,0 +11,2 @@",
              '+const unrelated = "remove";',
              "+const note = true;",
            ].join("\n"),
            stderr: "",
            exitCode: 0,
          };
        }
        if (call.command === "git") {
          return { launched: true, stdout: "", stderr: "", exitCode: 0 };
        }
        if (call.promptPath === ".ai/prompts/review-changes.md") {
          writeWorkflowEventArtifactSync({
            root: workspace.root,
            planName: "safe-review",
            kind: "review",
            version: 1,
          });
          await writePlan(
            workspace.root,
            "safe-review",
            planWithFileScope("completed", "commit-summary", {
              modified: ["src/file.ts"],
            }),
          );
          return {
            launched: true,
            stdout: "review ok",
            stderr: "",
            exitCode: 0,
          };
        }
        return { launched: true, stdout: "summary", stderr: "", exitCode: 0 };
      },
    });

    assert.equal(result.success, true, result.success ? "" : result.reason);
    assert.deepEqual(
      calls
        .filter((call) => call.command === CODEX_COMMAND)
        .map((call) => call.promptPath),
      [
        ".ai/prompts/scope-cleanup.md",
        ".ai/prompts/review-changes.md",
        ".ai/prompts/commit-summary.md",
      ],
    );
    assertCallSubsequence(
      calls.filter((call) => call.command === "git"),
      [
        ["git", "diff", "git-pre-review-staged-check"],
        ["git", "add", "git-staging"],
        ["git", "diff", "git-scope-cleanup-diff"],
        ["git", "status", "git-commit-summary-clean-check"],
      ],
    );
  } finally {
    await workspace.cleanup();
  }
});

test("thin-plan-v2 review and commit-summary stage plan-owned paths from files.json", async () => {
  const workspace = await setupWorkspace();
  try {
    mkdirSync(join(workspace.root, "src"), { recursive: true });
    await writeFile(
      join(workspace.root, "src", "artifact-state.ts"),
      "artifact state\n",
    );
    await writeThinPlanV2Artifacts(workspace.root, {
      status: "review",
      nextAction: "review-plan",
      modified: ["src/artifact-state.ts"],
      changedFiles: ["src/artifact-state.ts"],
    });
    await writePlan(
      workspace.root,
      "artifact-state",
      thinPlanV2Manifest("review", "review-plan"),
    );
    const calls: Parameters<ProcessRunner>[0][] = [];
    const result = await runWorkflowRunner({
      planName: planArg("artifact-state"),
      rootDir: workspace.root,
      processRunner: async (call) => {
        calls.push(call);
        if (call.command === "git" && call.args[0] === "diff") {
          return { launched: true, stdout: "", stderr: "", exitCode: 0 };
        }
        if (call.command === "git") {
          return { launched: true, stdout: "", stderr: "", exitCode: 0 };
        }
        if (call.promptPath === ".ai/prompts/review-changes.md") {
          await writePlan(
            workspace.root,
            "artifact-state",
            thinPlanV2Manifest("completed", "commit-summary"),
          );
          await writeThinPlanV2Artifacts(workspace.root, {
            status: "completed",
            nextAction: "commit-summary",
            modified: ["src/artifact-state.ts"],
            changedFiles: ["src/artifact-state.ts"],
            latest: {
              validation: {
                version: 2,
                result: "PASS",
                summary: "Required checks passed.",
                evidence:
                  ".ai/artifacts/artifact-state/events/validation-v2.md",
              },
              review: {
                version: 1,
                summary: "SAFE",
                decision: "completed",
                evidence: ".ai/artifacts/artifact-state/events/review-v1.md",
              },
            },
            history: [
              ".ai/artifacts/artifact-state/events/validation-v2.md",
              ".ai/artifacts/artifact-state/events/review-v1.md",
            ],
          });
          return {
            launched: true,
            stdout: "review ok",
            stderr: "",
            exitCode: 0,
          };
        }
        return { launched: true, stdout: "summary", stderr: "", exitCode: 0 };
      },
    });

    assert.equal(result.success, true, result.success ? "" : result.reason);
    assert.deepEqual(
      calls
        .filter((call) => call.command === CODEX_COMMAND)
        .map((call) => call.promptPath),
      [".ai/prompts/review-changes.md", ".ai/prompts/commit-summary.md"],
    );
    assertCallSubsequence(
      calls.filter((call) => call.command === "git"),
      [
        ["git", "diff", "git-pre-review-staged-check"],
        ["git", "add", "git-staging"],
        ["git", "diff", "git-scope-cleanup-diff"],
        ["git", "status", "git-commit-summary-clean-check"],
      ],
    );
  } finally {
    await workspace.cleanup();
  }
});

test("artifact-only no-commit thin plan completes review without staging or Codex", async () => {
  const workspace = await setupWorkspace();
  try {
    const artifactPath = ".ai/artifacts/artifact-state/events/execution-v1.md";
    await writeThinPlanV2Artifacts(workspace.root, {
      status: "review",
      nextAction: "review-plan",
      modified: [artifactPath],
      changedFiles: [artifactPath],
    });
    await writePlan(
      workspace.root,
      "artifact-state",
      thinPlanV2Manifest(
        "review",
        "review-plan",
        "## Commit Boundaries\n\nN/A: read-only verification creates no committable paths.\n",
      ),
    );
    const calls: Parameters<ProcessRunner>[0][] = [];

    const result = await runWorkflowRunner({
      planName: planArg("artifact-state"),
      rootDir: workspace.root,
      processRunner: async (call) => {
        calls.push(call);
        return { launched: true, stdout: "", stderr: "", exitCode: 0 };
      },
    });

    assert.equal(result.success, true, result.success ? "" : result.reason);
    assert.equal(
      calls.some((call) =>
        ["git-staging", ".ai/prompts/review-changes.md", ".ai/prompts/commit-summary.md"].includes(
          call.promptPath,
        ),
      ),
      false,
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
    ) as Record<string, unknown>;
    assert.equal(workflow.workflowState, "completed");
    assert.equal(
      existsSync(
        join(
          workspace.root,
          ".ai",
          "artifacts",
          "artifact-state",
          "events",
          "review-v1.md",
        ),
      ),
      true,
    );
  } finally {
    await workspace.cleanup();
  }
});

test("artifact-only task review reopens a multi-task thin plan instead of completing it", async () => {
  const workspace = await setupWorkspace();
  try {
    const changedPath = ".ai/artifacts/artifact-state/events/execution-v1.md";
    await writeThinPlanV2Artifacts(workspace.root, {
      status: "review",
      nextAction: "review-plan",
      modified: [changedPath],
      changedFiles: [changedPath],
    });
    await writePlan(
      workspace.root,
      "artifact-state",
      thinPlanV2Manifest(
        "review",
        "review-plan",
        `## Commit Boundaries

N/A: artifact-only task savepoints create no committable paths.

## Phases

### Follow-up

* Objective: Complete the remaining artifact-backed task.
* Tasks:
  1. [task:02-artifact-follow-up] Complete the remaining artifact-backed task.
* Expected Outcome: Both artifact-backed tasks are complete.
`,
      ),
    );

    const promptCalls: string[] = [];
    const result = await runWorkflowRunner({
      planName: planArg("artifact-state"),
      rootDir: workspace.root,
      processRunner: async (call) => {
        if (call.command === "git") {
          return { launched: true, stdout: "", stderr: "", exitCode: 0 };
        }
        promptCalls.push(call.promptPath);
        if (call.promptPath === ".ai/prompts/execute-plan.md") {
          return {
            launched: true,
            stdout: codexAgentMessageLine("STOP: verify task reopen"),
            stderr: "",
            exitCode: 0,
          };
        }
        return { launched: true, stdout: "", stderr: "", exitCode: 0 };
      },
    });

    assert.equal(result.success, false);
    assert.deepEqual(promptCalls, [".ai/prompts/execute-plan.md"]);
    const manifest = await readFile(
      join(workspace.root, ".ai", "plans", "artifact-state.md"),
      "utf8",
    );
    assert.match(manifest, /## Workflow State\n\nactive/);
    const firstTaskArtifact = await readFile(
      join(
        workspace.root,
        ".ai",
        "artifacts",
        "artifact-state",
        "tasks",
        "01-artifact-state-v1.md",
      ),
      "utf8",
    );
    assert.match(firstTaskArtifact, /## Commit SHA\s+no-commit/);
  } finally {
    await workspace.cleanup();
  }
});

test("completed commit-summary preserves its resume point when plan-owned changes remain dirty", async () => {
  const workspace = await setupWorkspace();
  try {
    await writePlan(
      workspace.root,
      "dirty-summary",
      planWithFileScope("completed", "commit-summary", {
        modified: ["src/file.ts"],
      }),
    );
    const calls: Parameters<ProcessRunner>[0][] = [];
    const result = await runWorkflowRunner({
      planName: planArg("dirty-summary"),
      rootDir: workspace.root,
      processRunner: async (call) => {
        calls.push(call);
        if (call.command === "git" && call.args[0] === "status") {
          return {
            launched: true,
            stdout: " M src/file.ts\n",
            stderr: "",
            exitCode: 0,
          };
        }
        return { launched: true, stdout: "summary", stderr: "", exitCode: 0 };
      },
    });

    assert.equal(result.success, false);
    assert.match(
      result.reason,
      /plan-owned changes remain after commit-summary/,
    );
    assert.deepEqual(
      calls
        .filter((call) => call.command === CODEX_COMMAND)
        .map((call) => call.promptPath),
      [".ai/prompts/commit-summary.md"],
    );
    assert.equal(
      calls.filter(
        (call) =>
          call.command === "git" &&
          call.promptPath === "git-commit-summary-clean-check",
      ).length,
      1,
    );
    assert.equal(
      calls.filter(
        (call) => call.command === "git" && call.args[0] === "reset",
      ).length,
      1,
    );
    const completedPlan = await readFile(
      join(workspace.root, ".ai", "plans", "dirty-summary.md"),
      "utf8",
    );
    assert.match(completedPlan, /## Workflow State\s*\n\s*completed/);
  } finally {
    await workspace.cleanup();
  }
});

test(`completed commit-summary ${CODEX_COMMAND} STOP unstages plan-owned paths and preserves its resume point`, async () => {
  const workspace = await setupWorkspace();
  try {
    await writePlan(
      workspace.root,
      "stopped-summary",
      planWithFileScope("completed", "commit-summary", {
        modified: ["src/file.ts"],
      }),
    );
    const calls: Parameters<ProcessRunner>[0][] = [];
    const result = await runWorkflowRunner({
      planName: planArg("stopped-summary"),
      rootDir: workspace.root,
      processRunner: async (call) => {
        calls.push(call);
        if (call.command === CODEX_COMMAND) {
          return {
            launched: true,
            stdout: "STOP — `pnpm lint-staged` failed.",
            stderr: "",
            exitCode: 0,
          };
        }
        return { launched: true, stdout: "", stderr: "", exitCode: 0 };
      },
    });

    assert.equal(result.success, false);
    assert.match(
      result.reason,
      /output contained STOP: `pnpm lint-staged` failed/,
    );
    assertCallSubsequence(calls, [
      [CODEX_COMMAND, "exec", ".ai/prompts/commit-summary.md"],
      ["git", "reset", "git-commit-summary-unstage"],
    ]);
    const unstageCall = calls.find(
      (call) => call.promptPath === "git-commit-summary-unstage",
    );
    assert.deepEqual(unstageCall?.args, [
      "reset",
      "--quiet",
      "--",
      "src/file.ts",
    ]);
    const completedPlan = await readFile(
      join(workspace.root, ".ai", "plans", "stopped-summary.md"),
      "utf8",
    );
    assert.match(completedPlan, /## Workflow State\s*\n\s*completed/);
  } finally {
    await workspace.cleanup();
  }
});

test("workflow runner succeeds after review defers final browser validation to manual follow-up", async () => {
  const workspace = await setupWorkspace();
  try {
    const planContent = (status: string, nextAction: string, extra = "") =>
      planWithFileScope(
        status,
        nextAction,
        {
          modified: ["apps/web/src/browser-deferred.ts"],
        },
        extra,
      );
    await writePlan(
      workspace.root,
      "browser-deferred",
      planContent("active", "execute-plan"),
    );

    const output = collectConsole();
    const calls: Parameters<ProcessRunner>[0][] = [];
    const result = await runWorkflowRunner({
      planName: planArg("browser-deferred"),
      rootDir: workspace.root,
      console: output.console,
      processRunner: runnerReturning(
        { launched: true, stdout: "ok", stderr: "", exitCode: 0 },
        (call) => {
          calls.push(call);
          if (call.promptPath === ".ai/prompts/execute-plan.md") {
            writeWorkflowEventArtifactSync({
              root: workspace.root,
              planName: "browser-deferred",
              kind: "execution",
              version: 1,
            });
            writeFileSync(
              join(workspace.root, ".ai", "plans", "browser-deferred.md"),
              planContent(
                "review",
                "review-plan",
                `## Execution Log

### Execution v1

* Summary: Implementation and local validation complete.
* Result: completed
* Evidence: .ai/artifacts/browser-deferred/events/execution-v1.md
`,
              ),
            );
            return;
          }
          if (call.promptPath === ".ai/prompts/review-changes.md") {
            writeWorkflowEventArtifactSync({
              root: workspace.root,
              planName: "browser-deferred",
              kind: "review",
              version: 1,
            });
            writeFileSync(
              join(workspace.root, ".ai", "plans", "browser-deferred.md"),
              planContent("completed", "commit-summary"),
            );
            return;
          }
          if (call.promptPath === ".ai/prompts/commit-summary.md") {
            writeFileSync(
              join(workspace.root, ".ai", "plans", "browser-deferred.md"),
              planContent("completed", "commit-summary"),
            );
          }
        },
      ),
    });

    assert.equal(result.success, true, result.success ? "" : result.reason);
    assert.equal(result.reason, "completed + commit-summary finished");
    assert.deepEqual(
      calls
        .filter((call) => call.command === CODEX_COMMAND)
        .map((call) => call.promptPath),
      [
        ".ai/prompts/execute-plan.md",
        ".ai/prompts/scope-cleanup.md",
        ".ai/prompts/review-changes.md",
        ".ai/prompts/commit-summary.md",
      ],
    );
    assertCallSubsequence(
      calls.filter((call) => call.command === "git"),
      [
        ["git", "diff", "git-pre-review-staged-check"],
        ["git", "add", "git-staging"],
        ["git", "diff", "git-scope-cleanup-diff"],
        ["git", "status", "git-commit-summary-clean-check"],
      ],
    );
    const consoleOutput = output.lines.join("\n");
    assert.match(consoleOutput, /SUCCESS/);
    assert.doesNotMatch(consoleOutput, /BLOCKED/);
    assert.doesNotMatch(consoleOutput, /DEPLOYMENT VALIDATION/);
  } finally {
    await workspace.cleanup();
  }
});

test("task savepoint mode commits each reviewed task, writes artifacts, logs task context, and finishes with aggregate summary", async () => {
  const workspace = await setupWorkspace();
  try {
    await writePlan(
      workspace.root,
      "task-savepoints",
      planWithTaskSavepoints("active", "execute-plan"),
    );

    const output = collectConsole();
    const calls: Parameters<ProcessRunner>[0][] = [];
    let executeRuns = 0;
    let reviewRuns = 0;
    let taskCommitRuns = 0;
    let aggregateRuns = 0;
    const shas = ["abc1234", "def5678"];

    const result = await runWorkflowRunner({
      planName: planArg("task-savepoints"),
      rootDir: workspace.root,
      console: output.console,
      processRunner: async (call) => {
        calls.push(call);
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
        if (call.promptPath === ".ai/prompts/execute-plan.md") {
          executeRuns += 1;
          await writePlan(
            workspace.root,
            "task-savepoints",
            planWithTaskSavepoints("review", "review-plan"),
          );
          return {
            launched: true,
            stdout: turnCompletedUsageDetailLine({
              inputTokens: 2_100_000,
              cachedInputTokens: 1_950_000,
              outputTokens: 100,
              reasoningOutputTokens: 20,
            }),
            stderr: "",
            exitCode: 0,
          };
        }
        if (call.promptPath === ".ai/prompts/review-changes.md") {
          reviewRuns += 1;
          writeWorkflowEventArtifactSync({
            root: workspace.root,
            planName: "task-savepoints",
            kind: "review",
            version: reviewRuns,
          });
          await writePlan(
            workspace.root,
            "task-savepoints",
            planWithTaskSavepoints("completed", "commit-summary"),
          );
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
          } else {
            taskCommitRuns += 1;
            const outputs = [
              commitSummaryOutput({
                planPath: ".ai/plans/task-savepoints.md",
                subject: "feat(api): add backend endpoints",
                summaryLines: [
                  "Added backend endpoints for support-ticket flows.",
                  "Aligned the first savepoint with the reviewed task scope.",
                ],
              }),
              commitSummaryOutput({
                planPath: ".ai/plans/task-savepoints.md",
                subject: "feat(web): add support ticket surface",
                summaryLines: [
                  "Added the web surface for the reviewed support-ticket task.",
                  "Finished the second savepoint without staging unrelated files.",
                ],
              }),
            ];
            return {
              launched: true,
              stdout: outputs[Math.max(0, taskCommitRuns - 1)] ?? outputs[0],
              stderr: "",
              exitCode: 0,
            };
          }
        }
        return { launched: true, stdout: "ok", stderr: "", exitCode: 0 };
      },
    });

    assert.equal(result.success, true);
    assert.equal(executeRuns, 2);
    assert.equal(reviewRuns, 2);
    assert.equal(taskCommitRuns, 2);
    assert.equal(aggregateRuns, 1);

    const consoleOutput = output.lines.join("\n");
    assert.match(
      consoleOutput,
      /\[EXECUTE\] Task 1 of 2 — Backend endpoints\nProgress: 0 tasks committed · Implementing planned scope/,
    );
    const executeStageIndex = consoleOutput.indexOf("[1/100] STAGE EXECUTE");
    const executeTaskIndex = consoleOutput.indexOf(
      "[EXECUTE] Task 1 of 2 — Backend endpoints",
    );
    assert.ok(executeStageIndex >= 0);
    assert.ok(executeTaskIndex > executeStageIndex);
    assert.match(
      consoleOutput,
      /\[REVIEW\] Task 1 of 2 — Backend endpoints\nProgress: 0 tasks committed · Review scope: 1 staged file/,
    );
    const tokenWarningIndex = consoleOutput.indexOf(
      "WARNING: Stage token usage is high; the next guarded workflow stage will use snapshot-first guidance.",
    );
    const reviewStageIndex = consoleOutput.indexOf("[2/100] STAGE REVIEW");
    const reviewTaskIndex = consoleOutput.indexOf(
      "[REVIEW] Task 1 of 2 — Backend endpoints",
    );
    assert.ok(tokenWarningIndex >= 0);
    assert.ok(reviewStageIndex > tokenWarningIndex);
    assert.ok(reviewTaskIndex > reviewStageIndex);
    assert.doesNotMatch(
      consoleOutput,
      /Staging 1 plan-owned file for review\.\.\./,
    );
    assert.match(
      consoleOutput,
      /\[COMMITTING\] Task 1 of 2 — Backend endpoints\nProgress: 0 tasks committed · Creating 1 commit/,
    );
    assert.match(
      consoleOutput,
      /\[TASK COMPLETE\] Task 1 of 2 — Backend endpoints\nProgress: 1 tasks committed · Created 1 commit · Next: Task 2 of 2/,
    );
    assert.match(
      consoleOutput,
      /\[TASK COMPLETE\] Task 2 of 2 — Web surface\nProgress: 2 tasks committed · Created 1 commit/,
    );
    assert.match(consoleOutput, /\[2\/2\] task commits complete/);
    assert.match(
      consoleOutput,
      /STAGE FINAL SUMMARY\nworkflowState: completed/,
    );

    const currentTask = await readFile(
      join(
        workspace.root,
        ".ai",
        "artifacts",
        "task-savepoints",
        "state",
        "current-task.md",
      ),
      "utf8",
    );
    assert.match(currentTask, /Task ID: 02-web-surface/);
    assert.match(currentTask, /Stage: committed/);
    assert.match(currentTask, /Commit SHA: def5678/);

    const taskFiles = await readdir(
      join(workspace.root, ".ai", "artifacts", "task-savepoints", "tasks"),
    );
    assert.deepEqual(taskFiles.sort(), [
      "01-backend-endpoints-v1.md",
      "02-web-surface-v1.md",
    ]);
    const firstArtifact = await readFile(
      join(
        workspace.root,
        ".ai",
        "artifacts",
        "task-savepoints",
        "tasks",
        "01-backend-endpoints-v1.md",
      ),
      "utf8",
    );
    assert.match(firstArtifact, /## Commit SHA\s+abc1234/);
    assert.match(
      firstArtifact,
      /## Commit Message\s+feat\(api\): add backend endpoints/,
    );
    assert.match(
      firstArtifact,
      /Added backend endpoints for support-ticket flows\./,
    );
    assert.match(firstArtifact, /## Next Task\s+02-web-surface/);

    const executionSummary = await readFile(
      join(
        workspace.root,
        ".ai",
        "artifacts",
        "task-savepoints",
        "execution-summary.md",
      ),
      "utf8",
    );
    assert.match(executionSummary, /# Execution Summary/);
    assert.match(executionSummary, /Completed savepoints: 2\/2/);
    assert.match(executionSummary, /## Savepoints/);
    assert.match(executionSummary, /### 01-backend-endpoints/);
    assert.match(executionSummary, /Commit: `abc1234`/);
    assert.match(
      executionSummary,
      /Added backend endpoints for support-ticket flows\./,
    );
    assert.match(executionSummary, /### 02-web-surface/);
    assert.match(executionSummary, /Commit: `def5678`/);
    assert.match(
      executionSummary,
      /Added the web surface for the reviewed support-ticket task\./,
    );
    assert.match(executionSummary, /## Final Rollup/);
    assert.match(executionSummary, /Status: completed/);

    const bossSummary = await readFile(
      join(
        workspace.root,
        ".ai",
        "artifacts",
        "task-savepoints",
        "boss-summary.md",
      ),
      "utf8",
    );
    assert.match(bossSummary, /^Task Savepoints \(\d+%\)\n\nCommit abc1234/m);
    assert.match(
      bossSummary,
      /Commit abc1234\n--Added backend endpoints for support-ticket flows\.\n--Aligned the first savepoint with the reviewed task scope\./,
    );
    assert.match(
      bossSummary,
      /Commit def5678\n--Added the web surface for the reviewed support-ticket task\.\n--Finished the second savepoint without staging unrelated files\./,
    );
    assert.equal(
      [...bossSummary.matchAll(/^Task Savepoints \(\d+%\)$/gm)].length,
      1,
    );
    assert.equal([...bossSummary.matchAll(/^Commit abc1234$/gm)].length, 1);
    assert.equal([...bossSummary.matchAll(/^Commit def5678$/gm)].length, 1);

    const log = await readFile(
      join(
        workspace.root,
        ".ai",
        "artifacts",
        "task-savepoints",
        "logs",
        "runner.log",
      ),
      "utf8",
    );
    assert.match(log, /taskId: 01-backend-endpoints/);
    assert.match(log, /taskStage: implementing/);
    assert.match(log, /taskStage: reviewing/);
    assert.match(log, /taskStage: committed/);
    assert.match(log, /commitSha: abc1234/);
    assert.match(log, /commitProgress: 0\/2/);
    assert.match(log, /commitProgressDescription: Add backend endpoints/);
    assert.match(log, /commitProgress: 1\/2/);
    assert.match(log, /commitProgressDescription: Add web surface/);
    assert.match(log, /commitProgress: 2\/2/);
    assert.match(log, /commitProgressDescription: task commits complete/);
  } finally {
    await workspace.cleanup();
  }
});

test("task savepoint mode resumes remaining tasks before commit-summary on rerun", async () => {
  const workspace = await setupWorkspace();
  try {
    await writePlan(
      workspace.root,
      "task-savepoint-resume",
      planWithTaskSavepoints("completed", "commit-summary"),
    );

    const firstTaskArtifact = join(
      workspace.root,
      ".ai",
      "artifacts",
      "task-savepoint-resume",
      "tasks",
      "01-backend-endpoints-v1.md",
    );
    mkdirSync(dirname(firstTaskArtifact), { recursive: true });
    writeFileSync(
      firstTaskArtifact,
      `# Task Savepoint: 01-backend-endpoints

## Summary

* Added backend endpoints for support-ticket flows.

## Commit SHA

abc1234

## Commit Message

feat(api): add backend endpoints
`,
      "utf8",
    );

    let executeRuns = 0;
    let reviewRuns = 0;
    let taskCommitRuns = 0;
    let aggregateRuns = 0;
    const promptCalls: string[] = [];

    const result = await runWorkflowRunner({
      planName: planArg("task-savepoint-resume"),
      rootDir: workspace.root,
      console: collectConsole().console,
      processRunner: async (call) => {
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
            "task-savepoint-resume",
            planWithTaskSavepoints("review", "review-plan"),
          );
          return { launched: true, stdout: "ok", stderr: "", exitCode: 0 };
        }
        if (call.promptPath === ".ai/prompts/review-changes.md") {
          reviewRuns += 1;
          writeWorkflowEventArtifactSync({
            root: workspace.root,
            planName: "task-savepoint-resume",
            kind: "review",
            version: reviewRuns,
          });
          await writePlan(
            workspace.root,
            "task-savepoint-resume",
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
              planPath: ".ai/plans/task-savepoint-resume.md",
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
  } finally {
    await workspace.cleanup();
  }
});

test("task savepoint mode retries an interrupted task commit-summary before reopening", async () => {
  const workspace = await setupWorkspace();
  try {
    await writePlan(
      workspace.root,
      "task-savepoint-summary-retry",
      planWithTaskSavepoints("completed", "commit-summary"),
    );
    const taskDir = join(
      workspace.root,
      ".ai",
      "artifacts",
      "task-savepoint-summary-retry",
      "tasks",
    );
    mkdirSync(taskDir, { recursive: true });
    writeFileSync(
      join(taskDir, "01-backend-endpoints-v1.md"),
      `# Task Savepoint: 01-backend-endpoints

## Commit SHA

abc1234
`,
      "utf8",
    );
    writeFileSync(
      join(taskDir, "02-web-surface-v1.md"),
      `# Task Savepoint: 02-web-surface

## Stage

commit-message

## Commit SHA

(pending)
`,
      "utf8",
    );

    const promptCalls: string[] = [];
    const result = await runWorkflowRunner({
      planName: planArg("task-savepoint-summary-retry"),
      rootDir: workspace.root,
      console: collectConsole().console,
      processRunner: async (call) => {
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
          return {
            launched: true,
            stdout: prompt.includes("Task savepoint aggregate summary")
              ? "aggregate summary"
              : commitSummaryOutput({
                  planPath: ".ai/plans/task-savepoint-summary-retry.md",
                  subject: "feat(web): add support ticket surface",
                  summaryLines: ["Completed the retried web savepoint."],
                }),
            stderr: "",
            exitCode: 0,
          };
        }
        return { launched: true, stdout: "ok", stderr: "", exitCode: 0 };
      },
    });

    assert.equal(result.success, true);
    assert.deepEqual(promptCalls, [
      ".ai/prompts/commit-summary.md",
      ".ai/prompts/commit-summary.md",
    ]);
  } finally {
    await workspace.cleanup();
  }
});

test("execute STOP repairs a recorded thin-plan-v2 runtime validation block", async () => {
  const workspace = await setupWorkspace();
  try {
    await writeThinPlanV2Artifacts(workspace.root, {
      status: "active",
      nextAction: "execute-plan",
      activeBlockers: [
        "Local Supabase cannot connect to the required database port.",
      ],
      latest: {
        validation: {
          version: 2,
          result: "blocked",
          summary: "Database validation is blocked by local connectivity.",
          evidence: ".ai/artifacts/artifact-state/events/validation-v2.md",
        },
      },
      history: [".ai/artifacts/artifact-state/events/validation-v2.md"],
    });
    await writePlan(
      workspace.root,
      "artifact-state",
      thinPlanV2Manifest("active", "execute-plan"),
    );

    const { lines, console } = collectConsole();
    const result = await runWorkflowRunner({
      planName: planArg("artifact-state"),
      rootDir: workspace.root,
      console,
      processRunner: async (call) => {
        if (call.command === "git") {
          return { launched: true, stdout: "", stderr: "", exitCode: 0 };
        }
        return {
          launched: true,
          stdout: codexAgentMessageLine(
            "STOP\nRequired local database validation is unavailable.",
          ),
          stderr: "",
          exitCode: 0,
        };
      },
    });

    assert.equal(result.success, false);
    assert.match(result.reason, /plan blocked after execute-plan/);
    assert.doesNotMatch(result.reason, /output contained STOP/);
    assert.equal(lines.includes("BLOCKED"), true);

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
    ) as Record<string, unknown>;
    assert.equal(workflow.workflowState, "blocked");

    const manifest = await readFile(
      join(workspace.root, ".ai", "plans", "artifact-state.md"),
      "utf8",
    );
    assert.match(manifest, /## Workflow State\s+blocked/);
  } finally {
    await workspace.cleanup();
  }
});

test("review STOP with active execute handoff continues workflow", async () => {
  const workspace = await setupWorkspace();
  try {
    await writePlan(
      workspace.root,
      "review-needs-fix",
      planWith("review", "review-plan"),
    );
    const calls: Parameters<ProcessRunner>[0][] = [];
    const result = await runWorkflowRunner({
      planName: planArg("review-needs-fix"),
      rootDir: workspace.root,
      processRunner: async (call) => {
        calls.push(call);
        if (call.command === "git") {
          return { launched: true, stdout: "", stderr: "", exitCode: 0 };
        }
        if (call.promptPath === ".ai/prompts/review-changes.md") {
          await writePlan(
            workspace.root,
            "review-needs-fix",
            planWith("active", "execute-plan"),
          );
          return {
            launched: true,
            stdout: codexAgentMessageLine(
              "STOP\n**Summary**\n* NEEDS FIX - task returned to active + execute-plan.",
            ),
            stderr: "",
            exitCode: 0,
          };
        }
        if (call.promptPath === ".ai/prompts/execute-plan.md") {
          await writePlan(
            workspace.root,
            "review-needs-fix",
            planWith(
              "blocked",
              "unblock-plan",
              "\n## Blockers\n\n### Blocker 1\n\n* Type: assertion\n* Description: execution resumed after review fix handoff\n* Required Action: none\n",
            ),
          );
          return { launched: true, stdout: "blocked", stderr: "", exitCode: 0 };
        }
        return { launched: true, stdout: "", stderr: "", exitCode: 0 };
      },
    });

    assert.equal(result.success, false);
    assert.match(result.reason, /plan blocked after execute-plan/);
    assert.doesNotMatch(result.reason, /output contained STOP/);
    assertCallSubsequence(calls, [
      [CODEX_COMMAND, "exec", ".ai/prompts/review-changes.md"],
      ["git", "reset", "git-review-unstage"],
      [CODEX_COMMAND, "exec", ".ai/prompts/execute-plan.md"],
    ]);
  } finally {
    await workspace.cleanup();
  }
});

test("iteration handling rereads changed plans, rejects unchanged plans, enforces max iterations, and succeeds after commit-summary", async () => {
  const workspace = await setupWorkspace();
  try {
    await writePlan(
      workspace.root,
      "unchanged",
      planWith("draft", "plan-validator"),
    );
    const unchanged = await runWorkflowRunner({
      planName: planArg("unchanged"),
      rootDir: workspace.root,
      processRunner: runnerReturning({
        launched: true,
        stdout: "ok",
        stderr: "",
        exitCode: 0,
      }),
    });
    assert.equal(unchanged.success, false);
    assert.match(unchanged.reason, /plan content unchanged/);

    await writePlan(
      workspace.root,
      "terminal",
      planWith("review", "review-plan"),
    );
    let terminalWorkflowPrompts = 0;
    const terminal = await runWorkflowRunner({
      planName: planArg("terminal"),
      rootDir: workspace.root,
      processRunner: runnerReturning(
        { launched: true, stdout: "ok", stderr: "", exitCode: 0 },
        (call) => {
          if (
            call.promptPath === ".ai/prompts/review-changes.md" ||
            call.promptPath === ".ai/prompts/commit-summary.md"
          ) {
            terminalWorkflowPrompts += 1;
          }
          if (call.promptPath === ".ai/prompts/review-changes.md") {
            writeWorkflowEventArtifactSync({
              root: workspace.root,
              planName: "terminal",
              kind: "review",
              version: 1,
            });
            writeFileSync(
              join(workspace.root, ".ai", "plans", "terminal.md"),
              planWith("completed", "commit-summary"),
            );
          }
        },
      ),
    });
    assert.equal(terminal.success, true);
    assert.equal(terminalWorkflowPrompts, 2);

    await writePlan(workspace.root, "max", planWith("draft", "plan-validator"));
    let maxLaunches = 0;
    const maxed = await runWorkflowRunner({
      planName: planArg("max"),
      rootDir: workspace.root,
      processRunner: runnerReturning(
        { launched: true, stdout: "ok", stderr: "", exitCode: 0 },
        () => {
          maxLaunches += 1;
          writeFileSync(
            join(workspace.root, ".ai", "plans", "max.md"),
            `${planWith("draft", "plan-validator")}\n${maxLaunches}`,
          );
        },
      ),
    });
    assert.equal(maxed.success, false);
    assert.match(maxed.reason, /maximum iterations/);
    assert.equal(maxLaunches, 100);
    const maxLog = await readFile(
      join(workspace.root, ".ai", "artifacts", "max", "logs", "runner.log"),
      "utf8",
    );
    assertFailureMetadata(maxLog, {
      kind: "max-iterations",
      reason: /failureReason: maximum iterations 100 reached/,
      nextSuggestedAction:
        /nextSuggestedAction: inspect plan progress, then resume with workflow-runner if still valid/,
    });
  } finally {
    await workspace.cleanup();
  }
});

test("transition guards enforce bounded plan-validator preflight outcomes", async () => {
  const workspace = await setupWorkspace();
  try {
    const cases = [
      ["validator-approves", "approved", "execute-plan", false],
      ["validator-stops", "draft", "plan-validator", false],
      ["validator-fix", "draft", "fix-plan", true],
      ["validator-active", "active", "execute-plan", true],
    ] as const;

    for (const [name, status, nextAction, shouldFailTransition] of cases) {
      await writePlan(
        workspace.root,
        name,
        planWith("draft", "plan-validator"),
      );
      const result = await runWorkflowRunner({
        planName: planArg(name),
        rootDir: workspace.root,
        processRunner: runnerReturning(
          {
            launched: true,
            stdout: name === "validator-stops" ? "STOP: needs decision" : "ok",
            stderr: "",
            exitCode: 0,
          },
          (call) => {
            if (call.promptPath === ".ai/prompts/plan-validator.md") {
              writeFileSync(
                join(workspace.root, ".ai", "plans", `${name}.md`),
                `${planWith(status, nextAction)}\n${name}`,
              );
              return;
            }
            if (call.promptPath === ".ai/prompts/execute-plan.md") {
              writeFileSync(
                join(workspace.root, ".ai", "plans", `${name}.md`),
                planWith("blocked", "unblock-plan"),
              );
            }
          },
        ),
      });

      if (shouldFailTransition) {
        assert.equal(result.success, false, name);
        assert.match(
          result.reason,
          /draft-validation stage .* may not transition|unknown workflowState value: draft--fix-plan/,
        );
      } else if (name === "validator-stops") {
        assert.equal(result.success, false, name);
        assert.match(result.reason, /STOP: needs decision/);
      }
    }
  } finally {
    await workspace.cleanup();
  }
});

test("transition guards enforce execute-plan and review-changes handoffs", async () => {
  const workspace = await setupWorkspace();
  try {
    const executeTransitions = [
      ["exec-review", "review", "review-plan", false],
      ["exec-blocked", "blocked", "execute-plan", false],
      ["exec-completed", "completed", "commit-summary", true],
      ["exec-other", "draft", "plan-validator", true],
    ] as const;
    for (const [
      name,
      status,
      nextAction,
      shouldFailTransition,
    ] of executeTransitions) {
      await writePlan(workspace.root, name, planWith("active", "execute-plan"));
      const result = await runWorkflowRunner({
        planName: planArg(name),
        rootDir: workspace.root,
        processRunner: runnerReturning(
          { launched: true, stdout: "ok", stderr: "", exitCode: 0 },
          (call) => {
            if (call.promptPath === ".ai/prompts/execute-plan.md") {
              writeFileSync(
                join(workspace.root, ".ai", "plans", `${name}.md`),
                planWith(status, nextAction),
              );
              return;
            }
            if (
              name === "exec-review" &&
              call.promptPath === ".ai/prompts/review-changes.md"
            ) {
              writeWorkflowEventArtifactSync({
                root: workspace.root,
                planName: name,
                kind: "review",
                version: 1,
              });
              writeFileSync(
                join(workspace.root, ".ai", "plans", `${name}.md`),
                planWith("completed", "commit-summary"),
              );
              return;
            }
          },
        ),
      });
      if (shouldFailTransition) {
        assert.equal(result.success, false, name);
        assert.match(result.reason, /active stage .* may not transition/);
        const log = await readFile(
          join(workspace.root, ".ai", "artifacts", name, "logs", "runner.log"),
          "utf8",
        );
        assertFailureMetadata(log, {
          kind: "runner-failure",
          reason: /failureReason: active stage .* may not transition/,
          nextSuggestedAction:
            /nextSuggestedAction: inspect workflow log, resolve failure, then rerun workflow-runner/,
        });
      }
    }

    const reopenTransitions = [
      ["reopen-active", "active", "execute-plan", false],
      ["reopen-review", "review", "review-plan", true],
      ["reopen-completed", "completed", "commit-summary", true],
    ] as const;
    for (const [
      name,
      status,
      nextAction,
      shouldFailTransition,
    ] of reopenTransitions) {
      await writePlan(
        workspace.root,
        name,
        planWith("reopening", "reopen-plan"),
      );
      const result = await runWorkflowRunner({
        planName: planArg(name),
        rootDir: workspace.root,
        processRunner: runnerReturning(
          { launched: true, stdout: "ok", stderr: "", exitCode: 0 },
          (call) => {
            if (call.promptPath === ".ai/prompts/reopen-plan.md") {
              writeFileSync(
                join(workspace.root, ".ai", "plans", `${name}.md`),
                planWith(status, nextAction),
              );
              return;
            }
            if (
              name === "reopen-active" &&
              call.promptPath === ".ai/prompts/execute-plan.md"
            ) {
              writeFileSync(
                join(workspace.root, ".ai", "plans", `${name}.md`),
                planWith("blocked", "unblock-plan"),
              );
            }
          },
        ),
      });
      if (shouldFailTransition) {
        assert.equal(result.success, false, name);
        assert.match(result.reason, /reopening stage .* may not transition/);
        const log = await readFile(
          join(workspace.root, ".ai", "artifacts", name, "logs", "runner.log"),
          "utf8",
        );
        assertFailureMetadata(log, {
          kind: "runner-failure",
          reason: /failureReason: reopening stage .* may not transition/,
          nextSuggestedAction:
            /nextSuggestedAction: inspect workflow log, resolve failure, then rerun workflow-runner/,
        });
      }
    }

    await writePlan(
      workspace.root,
      "review-completed",
      planWith("review", "review-plan"),
    );
    const reviewCompleted = await runWorkflowRunner({
      planName: planArg("review-completed"),
      rootDir: workspace.root,
      processRunner: runnerReturning(
        { launched: true, stdout: "ok", stderr: "", exitCode: 0 },
        (call) => {
          if (call.promptPath === ".ai/prompts/review-changes.md") {
            writeWorkflowEventArtifactSync({
              root: workspace.root,
              planName: "review-completed",
              kind: "review",
              version: 1,
            });
            writeFileSync(
              join(workspace.root, ".ai", "plans", "review-completed.md"),
              planWith("completed", "commit-summary"),
            );
          }
        },
      ),
    });
    assert.equal(reviewCompleted.success, true);

    await writePlan(
      workspace.root,
      "review-deployment-validation",
      planWith("review", "review-plan"),
    );
    const reviewDeploymentValidation = await runWorkflowRunner({
      planName: planArg("review-deployment-validation"),
      rootDir: workspace.root,
      processRunner: runnerReturning(
        { launched: true, stdout: "ok", stderr: "", exitCode: 0 },
        (call) => {
          if (call.promptPath === ".ai/prompts/review-changes.md") {
            writeWorkflowEventArtifactSync({
              root: workspace.root,
              planName: "review-deployment-validation",
              kind: "review",
              version: 1,
            });
            writeFileSync(
              join(
                workspace.root,
                ".ai",
                "plans",
                "review-deployment-validation.md",
              ),
              planWith("deployment-validation", "commit-summary"),
            );
          }
        },
      ),
    });
    assert.equal(reviewDeploymentValidation.success, false);
    assert.match(
      reviewDeploymentValidation.reason,
      /unknown workflowState value: deployment-validation--commit-summary/,
    );
  } finally {
    await workspace.cleanup();
  }
});

test("execute-plan may keep the plan active when implementation work remains", async () => {
  const workspace = await setupWorkspace();
  try {
    await writePlan(
      workspace.root,
      "active-follow-up",
      planWith("active", "execute-plan"),
    );
    const launchedPrompts: string[] = [];
    const result = await runWorkflowRunner({
      planName: planArg("active-follow-up"),
      rootDir: workspace.root,
      processRunner: runnerReturning(
        { launched: true, stdout: "ok", stderr: "", exitCode: 0 },
        (call) => {
          if (call.command !== CODEX_COMMAND) {
            return;
          }
          launchedPrompts.push(call.promptPath);
          if (launchedPrompts.length === 1) {
            writeWorkflowEventArtifactSync({
              root: workspace.root,
              planName: "active-follow-up",
              kind: "execution",
              version: 1,
            });
          }
          const nextContent =
            launchedPrompts.length === 1
              ? planWith(
                  "active",
                  "execute-plan",
                  "\n## Execution Log\n\n### Execution v1\n\n* Summary: Follow-up implementation tasks remain.\n* Result: partial\n* Evidence: .ai/artifacts/active-follow-up/events/execution-v1.md\n",
                )
              : planWith(
                  "blocked",
                  "unblock-plan",
                  "\n## Blockers\n\n### Blocker 1\n\n* Description: validation environment unavailable\n",
                );
          writeFileSync(
            join(workspace.root, ".ai", "plans", "active-follow-up.md"),
            nextContent,
          );
        },
      ),
    });

    assert.equal(result.success, false);
    assert.equal(launchedPrompts.length, 2);
    assert.deepEqual(launchedPrompts, [
      ".ai/prompts/execute-plan.md",
      ".ai/prompts/execute-plan.md",
    ]);
    assert.match(result.reason, /plan blocked after execute-plan/);
  } finally {
    await workspace.cleanup();
  }
});

test("execute-plan recovers thin-plan review handoff when state is unchanged after validated edits", async () => {
  const workspace = await setupWorkspace();
  try {
    await writeThinPlanV2Artifacts(workspace.root, {
      status: "active",
      nextAction: "execute-plan",
      modified: ["src/previous-task.ts"],
      changedFiles: ["src/previous-task.ts"],
      owns: ["src/**"],
      latest: {
        execution: {
          path: ".ai/artifacts/artifact-state/events/execution-v1.md",
          summary: "Previous task committed.",
          state: "review-ready",
        },
      },
      history: [".ai/artifacts/artifact-state/events/execution-v1.md"],
      activeBlockers: [],
    });
    await writePlan(
      workspace.root,
      "artifact-state",
      thinPlanV2Manifest("active", "execute-plan"),
    );

    const calls: Parameters<ProcessRunner>[0][] = [];
    const result = await runWorkflowRunner({
      planName: planArg("artifact-state"),
      rootDir: workspace.root,
      processRunner: async (call) => {
        calls.push(call);
        if (
          call.command === CODEX_COMMAND &&
          call.promptPath === ".ai/prompts/execute-plan.md"
        ) {
          return {
            launched: true,
            stdout:
              "Implemented the service slice.\n\nValidation passed:\n- pnpm typecheck\n",
            stderr: "",
            exitCode: 0,
          };
        }
        if (
          call.command === CODEX_COMMAND &&
          call.promptPath === ".ai/prompts/review-changes.md"
        ) {
          return {
            launched: true,
            stdout: "STOP review intentionally paused",
            stderr: "",
            exitCode: 0,
          };
        }
        if (call.command === "git" && call.args[0] === "rev-parse") {
          return {
            launched: true,
            stdout: "abcdef1234567890\n",
            stderr: "",
            exitCode: 0,
          };
        }
        if (
          call.command === "git" &&
          call.args[0] === "status" &&
          call.args[1] === "--short"
        ) {
          return {
            launched: true,
            stdout: " M src/service.ts\n?? src/new.ts\n D src/old.ts\n",
            stderr: "",
            exitCode: 0,
          };
        }
        if (
          call.command === "git" &&
          call.args[0] === "status" &&
          call.args[1] === "--porcelain=v1"
        ) {
          return {
            launched: true,
            stdout: "M  src/service.ts\nA  src/new.ts\nD  src/old.ts\n",
            stderr: "",
            exitCode: 0,
          };
        }
        return { launched: true, stdout: "", stderr: "", exitCode: 0 };
      },
    });

    assert.equal(result.success, false);
    assert.doesNotMatch(result.reason, /plan content unchanged/);
    assert.match(result.reason, /output contained STOP/);
    assert(
      calls.some((call) => call.promptPath === ".ai/prompts/review-changes.md"),
    );

    const manifest = await readFile(
      join(workspace.root, ".ai", "plans", "artifact-state.md"),
      "utf8",
    );
    assert.match(manifest, /## Workflow State\s+review/);

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
    ) as Record<string, unknown>;
    assert.equal(workflow.workflowState, "review");
    const latest = workflow.latest as Record<string, Record<string, unknown>>;
    assert.equal(latest.execution?.state, "review-ready");

  } finally {
    await workspace.cleanup();
  }
});

test("execute-plan rejects a partial thin-plan review handoff", async () => {
  const workspace = await setupWorkspace();
  try {
    await writeThinPlanV2Artifacts(workspace.root, {
      status: "active",
      nextAction: "execute-plan",
      modified: ["src/service.ts"],
      changedFiles: ["src/service.ts"],
      owns: ["src/**"],
      activeBlockers: [],
    });
    await writePlan(
      workspace.root,
      "artifact-state",
      thinPlanV2Manifest("active", "execute-plan"),
    );

    const calls: Parameters<ProcessRunner>[0][] = [];
    const result = await runWorkflowRunner({
      planName: planArg("artifact-state"),
      rootDir: workspace.root,
      processRunner: async (call) => {
        calls.push(call);
        if (
          call.command === CODEX_COMMAND &&
          call.promptPath === ".ai/prompts/execute-plan.md"
        ) {
          const workflowPath = join(
            workspace.root,
            ".ai",
            "artifacts",
            "artifact-state",
            "state",
            "workflow.json",
          );
          const workflow = JSON.parse(
            await readFile(workflowPath, "utf8"),
          ) as Record<string, unknown>;
          await writeFile(
            workflowPath,
            `${JSON.stringify(
              {
                ...workflow,
                workflowState: "active",
              },
              null,
              2,
            )}\n`,
            "utf8",
          );
          await writePlan(
            workspace.root,
            "artifact-state",
            thinPlanV2Manifest("review", "review-plan"),
          );
          return { launched: true, stdout: "Review ready.", stderr: "", exitCode: 0 };
        }
        if (
          call.command === CODEX_COMMAND &&
          call.promptPath === ".ai/prompts/review-changes.md"
        ) {
          return {
            launched: true,
            stdout: "STOP review intentionally paused",
            stderr: "",
            exitCode: 0,
          };
        }
        if (call.command === "git" && call.args[0] === "status") {
          return { launched: true, stdout: " M src/service.ts\n", stderr: "", exitCode: 0 };
        }
        return { launched: true, stdout: "", stderr: "", exitCode: 0 };
      },
    });

    assert.equal(result.success, false);
    assert.match(result.reason, /thin-plan-v2 workflow state mismatch/);
    assert.equal(
      calls.some((call) => call.promptPath === ".ai/prompts/review-changes.md"),
      false,
    );

    const manifest = await readFile(
      join(workspace.root, ".ai", "plans", "artifact-state.md"),
      "utf8",
    );
    assert.match(manifest, /## Workflow State\s+review/);

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
    ) as Record<string, unknown>;
    assert.equal(workflow.workflowState, "active");
  } finally {
    await workspace.cleanup();
  }
});

test("execute-plan repairs a thin-plan manifest from canonical workflow state", async () => {
  const workspace = await setupWorkspace();
  try {
    await writeThinPlanV2Artifacts(workspace.root, {
      status: "active",
      nextAction: "execute-plan",
      modified: ["src/service.ts"],
      changedFiles: ["src/service.ts"],
      owns: ["src/**"],
      activeBlockers: [],
    });
    await writePlan(
      workspace.root,
      "artifact-state",
      thinPlanV2Manifest("active", "execute-plan"),
    );

    const calls: Parameters<ProcessRunner>[0][] = [];
    const result = await runWorkflowRunner({
      planName: planArg("artifact-state"),
      rootDir: workspace.root,
      processRunner: async (call) => {
        calls.push(call);
        if (
          call.command === CODEX_COMMAND &&
          call.promptPath === ".ai/prompts/execute-plan.md"
        ) {
          const workflowPath = join(
            workspace.root,
            ".ai",
            "artifacts",
            "artifact-state",
            "state",
            "workflow.json",
          );
          const workflow = JSON.parse(
            await readFile(workflowPath, "utf8"),
          ) as Record<string, unknown>;
          await writeFile(
            workflowPath,
            `${JSON.stringify(
              {
                ...workflow,
                workflowState: "review",
                latest: {
                  ...(workflow.latest as Record<string, unknown>),
                  execution: {
                    version: 36,
                    summary: "Review ready.",
                    result: "review-ready",
                    evidence:
                      ".ai/artifacts/artifact-state/events/execution-v36.md",
                  },
                },
                history: [
                  ...((workflow.history as string[] | undefined) ?? []),
                  ".ai/artifacts/artifact-state/events/execution-v36.md",
                ],
                updatedAt: "2026-07-15T00:00:00.000Z",
              },
              null,
              2,
            )}\n`,
            "utf8",
          );
          writeWorkflowEventArtifactSync({
            root: workspace.root,
            planName: "artifact-state",
            kind: "execution",
            version: 36,
            summary: "Review ready.",
            evidence: "Focused validation passed.",
          });
          return {
            launched: true,
            stdout: "Review ready.",
            stderr: "",
            exitCode: 0,
          };
        }
        if (
          call.command === CODEX_COMMAND &&
          call.promptPath === ".ai/prompts/review-changes.md"
        ) {
          return {
            launched: true,
            stdout: "STOP review intentionally paused",
            stderr: "",
            exitCode: 0,
          };
        }
        if (call.command === "git" && call.args[0] === "rev-parse") {
          return {
            launched: true,
            stdout: "abcdef1234567890\n",
            stderr: "",
            exitCode: 0,
          };
        }
        if (
          call.command === "git" &&
          call.args[0] === "status" &&
          call.args[1] === "--short"
        ) {
          return {
            launched: true,
            stdout: " M src/service.ts\n",
            stderr: "",
            exitCode: 0,
          };
        }
        return { launched: true, stdout: "", stderr: "", exitCode: 0 };
      },
    });

    assert.equal(result.success, false);
    assert.match(result.reason, /output contained STOP/);
    assert(
      calls.some(
        (call) => call.promptPath === ".ai/prompts/review-changes.md",
      ),
    );

    const manifest = await readFile(
      join(workspace.root, ".ai", "plans", "artifact-state.md"),
      "utf8",
    );
    assert.match(manifest, /## Workflow State\s+review/);
  } finally {
    await workspace.cleanup();
  }
});

test(`review changes failure resumes execute-plan after unstaging review paths`, async () => {
  const workspace = await setupWorkspace();
  try {
    await writePlan(
      workspace.root,
      "review-spec-active",
      planWith("review", "review-plan"),
    );
    const calls: Parameters<ProcessRunner>[0][] = [];
    const result = await runWorkflowRunner({
      planName: planArg("review-spec-active"),
      rootDir: workspace.root,
      processRunner: async (call) => {
        calls.push(call);
        if (call.command === "git") {
          return { launched: true, stdout: "", stderr: "", exitCode: 0 };
        }
        if (
          call.command === CODEX_COMMAND &&
          call.promptPath === ".ai/prompts/review-changes.md"
        ) {
          writeWorkflowEventArtifactSync({
            root: workspace.root,
            planName: "review-spec-active",
            kind: "review",
            version: 1,
          });
          writeFileSync(
            join(workspace.root, ".ai", "plans", "review-spec-active.md"),
            planWith(
              "active",
              "execute-plan",
              "\n## Review History\n\n### Review v1\n\n* Summary: NEEDS FIX\n* Decision: active\n* Evidence: .ai/artifacts/review-spec-active/events/review-v1.md\n",
            ),
          );
          return {
            launched: true,
            stdout: "needs fix",
            stderr: "",
            exitCode: 0,
          };
        }
        if (
          call.command === CODEX_COMMAND &&
          call.promptPath === ".ai/prompts/execute-plan.md"
        ) {
          writeFileSync(
            join(workspace.root, ".ai", "plans", "review-spec-active.md"),
            planWith(
              "blocked",
              "unblock-plan",
              "\n## Blockers\n\n* rerun paused after review fix handoff\n",
            ),
          );
          return { launched: true, stdout: "paused", stderr: "", exitCode: 0 };
        }
        return { launched: true, stdout: "", stderr: "", exitCode: 0 };
      },
    });

    assert.equal(result.success, false);
    assert.match(result.reason, /plan blocked after execute-plan/i);
    assertCallSubsequence(calls, [
      ["git", "diff", "git-pre-review-staged-check"],
      ["git", "add", "git-staging"],
      ["git", "diff", "git-scope-cleanup-diff"],
      [CODEX_COMMAND, "exec", ".ai/prompts/review-changes.md"],
      ["git", "reset", "git-review-unstage"],
      [CODEX_COMMAND, "exec", ".ai/prompts/execute-plan.md"],
    ]);
  } finally {
    await workspace.cleanup();
  }
});

test("console output reports concise progress and final outcomes", async () => {
  const workspace = await setupWorkspace();
  try {
    await writePlan(
      workspace.root,
      "workflow-runner",
      planWith("completed", "commit-summary"),
    );
    const output = collectConsole();
    let nowMs = 0;
    const result = await runWorkflowRunner({
      planName: planArg("workflow-runner"),
      rootDir: workspace.root,
      processRunner: runnerReturning(
        { launched: true, stdout: "summary", stderr: "", exitCode: 0 },
        () => {
          nowMs = 1_315_000;
        },
      ),
      console: output.console,
      now: () => nowMs,
    });
    assert.equal(result.success, true);
    assert.match(
      output.lines.join("\n"),
      /\[1\/100\] STAGE SUMMARY\nworkflowState: completed\nmodel: gpt-5\.6-terra \| reasoning: medium/,
    );
    assert.match(output.lines.join("\n"), /SUCCESS/);
    assert.match(output.lines.join("\n"), /- Worked for 21m 55s/);
  } finally {
    await workspace.cleanup();
  }
});

test("CLI without a plan argument fails before execution", async () => {
  const workspace = await setupWorkspace();
  try {
    let launched = false;
    const result = await runWorkflowRunner({
      argv: [],
      rootDir: workspace.root,
      processRunner: async () => {
        launched = true;
        return { launched: true, stdout: "", stderr: "", exitCode: 0 };
      },
    });
    assert.equal(result.success, false);
    assert.match(result.reason, /plan name is required/);
    assert.equal(launched, false);
  } finally {
    await workspace.cleanup();
  }
});
