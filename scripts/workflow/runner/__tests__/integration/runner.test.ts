import assert from "node:assert/strict";
import { readFile, readdir, rm, writeFile } from "node:fs/promises";
import { existsSync, mkdirSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import test from "node:test";

import {
  codexExecutionConfig,
  analyzeTokenUsageLedger,
  runWorkflowRunner,
  WORKFLOW_RUNNER_CODEX_FALLBACK_MODEL,
  WORKFLOW_RUNNER_CODEX_PROFILE,
  workflowContextSnapshotRelativePath,
  type ProcessRunner,
} from "../../../runner.ts";
import {
  createThinPlanV2ArtifactWriter,
  setupWorkflowWorkspace,
} from "../helpers/workspace.ts";
import {
  planWith,
  planWithEllipsizedTaskSavepoints,
  planWithFileScope,
  planWithTaskSavepoints,
  thinPlanV2Manifest,
  writeWorkflowRunnerPlan,
} from "../helpers/runner-plan.ts";
import {
  writeWorkflowEventArtifact,
  writeWorkflowEventArtifactSync,
} from "../helpers/workflow-events.ts";

const PROMPTS = {
  "sync-plan-artifacts.md": "SYNC PLAN ARTIFACTS PROMPT",
  "plan-validator.md": "PLAN VALIDATOR PROMPT",
  "execute-plan.md": "EXECUTE PLAN PROMPT",
  "unblock-plan.md": "UNBLOCK PLAN PROMPT",
  "review-changes.md": "REVIEW CHANGES PROMPT",
  "scope-cleanup.md": "SCOPE CLEANUP PROMPT",
  "reopen-plan.md": "REOPEN PLAN PROMPT",
  "commit-summary.md": "COMMIT SUMMARY PROMPT",
};

const CODEX_COMMAND = WORKFLOW_RUNNER_CODEX_PROFILE;
const CODEX_EXEC_LABEL = `${CODEX_COMMAND} exec`;
const CODEX_HOME_SUFFIX = `/.${CODEX_COMMAND}`;
const OVERRIDE_CODEX_PROFILE = "codex-personal";
const OVERRIDE_CODEX_EXEC_LABEL = `${OVERRIDE_CODEX_PROFILE} exec`;
const OVERRIDE_CODEX_HOME_SUFFIX = `/.${OVERRIDE_CODEX_PROFILE}`;

const writeThinPlanV2Artifacts = createThinPlanV2ArtifactWriter("runner");


const ownershipReleaseSection = (
  file: string,
  releasedTo = ".ai/plans/dependent-plan.md",
) => `## File Ownership Releases

### Release v1

* File: ${file}
* Released By: .ai/plans/current-plan.md
* Released To: ${releasedTo}
* Evidence: current-plan file-specific validation passed
* Status: transferred
`;

const ownershipScopeSection = (entries: string[]) => `## Ownership Scope

${entries.map((entry) => `* ${entry}`).join("\n")}
`;

const setupWorkspace = () =>
  setupWorkflowWorkspace({
    prefix: "workflow-runner-",
    directories: [".ai/plans", ".ai/prompts"],
    prompts: PROMPTS,
  });

const writePlan = writeWorkflowRunnerPlan;

const tokenCountLine = (usedTokens: number, contextWindowTokens: number) =>
  JSON.stringify({
    type: "event_msg",
    payload: {
      type: "token_count",
      info: {
        last_token_usage: {
          total_tokens: usedTokens,
        },
        model_context_window: contextWindowTokens,
      },
    },
  });

const turnCompletedUsageDetailLine = ({
  inputTokens,
  cachedInputTokens,
  outputTokens,
  reasoningOutputTokens,
}: {
  inputTokens: number;
  cachedInputTokens: number;
  outputTokens: number;
  reasoningOutputTokens: number;
}) =>
  JSON.stringify({
    type: "turn.completed",
    usage: {
      input_tokens: inputTokens,
      cached_input_tokens: cachedInputTokens,
      output_tokens: outputTokens,
      reasoning_output_tokens: reasoningOutputTokens,
    },
  });

const callTriples = (calls: Parameters<ProcessRunner>[0][]) =>
  calls.map((call) => [call.command, call.args[0] ?? "", call.promptPath]);

const assertCallSubsequence = (
  calls: Parameters<ProcessRunner>[0][],
  expected: string[][],
) => {
  const actual = callTriples(calls);
  let cursor = 0;
  for (const item of actual) {
    if (
      cursor < expected.length &&
      item.length === expected[cursor].length &&
      item.every((value, index) => value === expected[cursor][index])
    ) {
      cursor += 1;
    }
  }
  assert.equal(
    cursor,
    expected.length,
    `missing call subsequence ${JSON.stringify(expected)} in ${JSON.stringify(actual)}`,
  );
};

const writeFileOwnershipArtifact = async (
  root: string,
  planName: string,
  artifact: Record<string, unknown>,
) => {
  const artifactPath = join(
    root,
    ".ai",
    "artifacts",
    planName,
    "state",
    "file-ownership.json",
  );
  mkdirSync(dirname(artifactPath), { recursive: true });
  await writeFile(artifactPath, JSON.stringify(artifact, null, 2), "utf8");
  if (typeof artifact.workflowState === "string") {
    await writeFile(
      join(dirname(artifactPath), "workflow.json"),
      `${JSON.stringify(
        {
          planPath: artifact.planPath,
          workflowState: artifact.workflowState,
          latest: {},
          history: [],
          unresolvedBlockers: [],
          updatedAt: artifact.updatedAt,
        },
        null,
        2,
      )}\n`,
      "utf8",
    );
  }
  return artifactPath;
};

const writeArtifactStateFile = async (
  root: string,
  planName: string,
  fileName: string,
  content: string,
) => {
  const artifactPath = join(
    root,
    ".ai",
    "artifacts",
    planName,
    "state",
    fileName,
  );
  mkdirSync(dirname(artifactPath), { recursive: true });
  await writeFile(artifactPath, content, "utf8");
  return artifactPath;
};

const planArg = (planName: string) => `.ai/plans/${planName}.md`;

const readTokenUsageLedger = async (root: string, planName: string) => {
  const content = await readFile(
    join(root, ".ai", "artifacts", planName, "logs", "token-usage.jsonl"),
    "utf8",
  );
  return content
    .trim()
    .split("\n")
    .filter(Boolean)
    .map((line) => JSON.parse(line) as Record<string, unknown>);
};

const readFailureDebugLedger = async (root: string, planName: string) => {
  const content = await readFile(
    join(root, ".ai", "artifacts", planName, "logs", "failure.jsonl"),
    "utf8",
  );
  return content
    .trim()
    .split("\n")
    .filter(Boolean)
    .map((line) => JSON.parse(line) as Record<string, unknown>);
};

const assertFailureMetadata = (
  log: string,
  expected: {
    kind: string;
    reason: RegExp;
    nextSuggestedAction: RegExp;
  },
) => {
  assert.match(log, new RegExp(`failureKind: ${expected.kind}`));
  assert.match(log, expected.reason);
  assert.match(log, expected.nextSuggestedAction);
};

const collectConsole = () => {
  const lines: string[] = [];
  return {
    lines,
    console: {
      log: (message: string) => lines.push(message),
      error: (message: string) => lines.push(message),
    },
  };
};

const runnerReturning =
  (
    result: Awaited<ReturnType<ProcessRunner>>,
    onRun?: (call: Parameters<ProcessRunner>[0]) => Promise<void> | void,
  ): ProcessRunner =>
  async (call) => {
    await onRun?.(call);
    if (
      call.command === "git" &&
      call.args[0] === "status" &&
      call.args[1] === "--short"
    ) {
      return { launched: true, stdout: "", stderr: "", exitCode: 0 };
    }
    return result;
  };

const codexAgentMessageLine = (text: string) =>
  JSON.stringify({
    type: "item.completed",
    item: {
      id: "item_agent",
      type: "agent_message",
      text,
    },
  });

const commitSummaryOutput = ({
  planPath,
  subject,
  summaryLines,
}: {
  planPath: string;
  subject: string;
  summaryLines: string[];
}) =>
  [
    "**Plan**",
    `\`${planPath}\``,
    "",
    "**Summary**",
    "* COMMIT CREATED",
    "* All staged plan-owned files were committed.",
    "",
    "**Key Details**",
    subject,
    ...summaryLines.map((line) => `-- ${line}`),
    "",
    "**Next**",
    "Status: `completed`",
  ].join("\n");

const codexCommandOutputLine = (text: string, command = "pnpm test") =>
  JSON.stringify({
    type: "item.completed",
    item: {
      id: "item_command",
      command,
      type: "command_execution",
      aggregated_output: text,
      exit_code: 0,
      status: "completed",
    },
  });

const codexCommandStartedLine = (command = "pnpm test") =>
  JSON.stringify({
    type: "item.started",
    item: {
      id: "item_command",
      command,
      type: "command_execution",
      aggregated_output: "",
      exit_code: null,
      status: "in_progress",
    },
  });
const JEST_FAILED_COMMAND =
  "/bin/bash -lc 'pnpm --dir apps/backend exec jest --config jest.config.js --runTestsByPath test/onboarding/document-content-generator.service.spec.ts --runInBand -t \"widens unmapped suffixless\"'";

test(`startup validation fails before ${CODEX_EXEC_LABEL} for invalid plan inputs`, async () => {
  const workspace = await setupWorkspace();
  try {
    const processCalls: Parameters<ProcessRunner>[0][] = [];
    const processRunner: ProcessRunner = async (call) => {
      processCalls.push(call);
      return { launched: true, stdout: "", stderr: "", exitCode: 0 };
    };

    assert.equal(
      (
        await runWorkflowRunner({
          planName: "",
          rootDir: workspace.root,
          processRunner,
        })
      ).success,
      false,
    );
    assert.match(
      (
        await runWorkflowRunner({
          planName: planArg("missing"),
          rootDir: workspace.root,
          processRunner,
        })
      ).reason,
      /plan file does not exist/,
    );

    await writePlan(
      workspace.root,
      "missing-status",
      "## Next Action\n\nexecute-plan\n",
    );
    await writePlan(workspace.root, "missing-action", "## Status\n\nactive\n");
    await writePlan(
      workspace.root,
      "empty-status",
      "## Status\n\n## Next Action\n\nexecute-plan\n",
    );
    await writePlan(
      workspace.root,
      "empty-action",
      "## Status\n\nactive\n\n## Next Action\n",
    );
    await writePlan(
      workspace.root,
      "unknown-status",
      planWith("unknown", "execute-plan"),
    );
    await writePlan(
      workspace.root,
      "unknown-action",
      planWith("active", "unknown"),
    );

    for (const planName of [
      "missing-status",
      "missing-action",
      "empty-status",
      "empty-action",
      "unknown-status",
      "unknown-action",
    ]) {
      const result = await runWorkflowRunner({
        planName: planArg(planName),
        rootDir: workspace.root,
        processRunner,
      });
      assert.equal(result.success, false, planName);
    }
    assert.equal(processCalls.length, 0);
  } finally {
    await workspace.cleanup();
  }
});

test("oversized aggregate thin-plan history warns without blocking the workflow", async () => {
  const workspace = await setupWorkspace();
  try {
    for (let version = 1; version <= 18; version += 1) {
      await writeWorkflowEventArtifact({
        root: workspace.root,
        planName: "oversized-thin-history",
        kind: "validation",
        version,
      });
    }
    const aggregateEntries = Array.from({ length: 18 }, (_, index) => {
      const version = index + 1;
      return `### Validation v${version}

* Summary: ${"x".repeat(120)}
* Result: APPROVED
* Evidence: .ai/artifacts/oversized-thin-history/events/validation-v${version}.md`;
    }).join("\n\n");
    await writePlan(
      workspace.root,
      "oversized-thin-history",
      planWith(
        "completed",
        "commit-summary",
        `## Validation History

${aggregateEntries}
`,
      ),
    );
    const output = collectConsole();

    const result = await runWorkflowRunner({
      planName: planArg("oversized-thin-history"),
      rootDir: workspace.root,
      console: output.console,
      processRunner: runnerReturning({
        launched: true,
        stdout: turnCompletedUsageDetailLine({
          inputTokens: 100,
          cachedInputTokens: 50,
          outputTokens: 40,
          reasoningOutputTokens: 10,
        }),
        stderr: "",
        exitCode: 0,
      }),
    });

    assert.equal(result.success, true, result.success ? "" : result.reason);
    assert.equal(
      output.lines.some((line) =>
        /WARNING: Thin-plan workflow history is .* > 4 KB/i.test(line),
      ),
      true,
    );
  } finally {
    await workspace.cleanup();
  }
});

test(`plan argument validation rejects unsupported path forms before ${CODEX_EXEC_LABEL}`, async () => {
  const workspace = await setupWorkspace();
  try {
    const processCalls: Parameters<ProcessRunner>[0][] = [];
    for (const planName of [
      "workflow-runner",
      "workflow-runner.md",
      ".ai/plans/workflow-runner",
      ".ai/plans/workflow-runner.txt",
      "docs/workflow-runner.md",
      "../workflow-runner.md",
      "/tmp/workflow-runner.md",
    ]) {
      const result = await runWorkflowRunner({
        planName,
        rootDir: workspace.root,
        processRunner: async (call) => {
          processCalls.push(call);
          return { launched: true, stdout: "", stderr: "", exitCode: 0 };
        },
      });
      assert.equal(result.success, false, planName);
      assert.match(result.reason, /plan argument/, planName);
    }
    assert.equal(processCalls.length, 0);
  } finally {
    await workspace.cleanup();
  }
});

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

test("task savepoint mode reopens thin-plan-v2 without writing generated sections into the manifest", async () => {
  const workspace = await setupWorkspace();
  try {
    await writeThinPlanV2Artifacts(workspace.root, {
      status: "completed",
      nextAction: "commit-summary",
      modified: ["src/artifact-state.ts"],
      changedFiles: ["src/artifact-state.ts"],
    });
    await writePlan(
      workspace.root,
      "artifact-state",
      thinPlanV2Manifest(
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
      `${thinPlanV2Manifest("completed", "commit-summary")}
## Phases

### Implementation

* Objective: Complete task-savepoint work.
* Tasks:
  1. [task:01-backend-endpoints] Add backend endpoints
  2. [task:02-web-surface] Add web surface
`,
    );
    await writeThinPlanV2Artifacts(workspace.root, {
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
      join(taskDir, "01-backend-endpoints-v1.md"),
      `# Task Savepoint: 01-backend-endpoints

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

test("execute-plan blocked output is concise and includes the latest unresolved blocker detail", async () => {
  const workspace = await setupWorkspace();
  try {
    await writePlan(
      workspace.root,
      "blocked",
      planWith(
        "active",
        "execute-plan",
        `## Blockers

### Blocker 1

* Status: resolved
* Description: old resolved blocker
* Required Action: old action
* Next Step: old next step

### Blocker 2

* Type: source-of-truth conflict
* Status: unresolved
* Description: spec must be updated before plan can be fixed
* Required Action: update the workflow runner spec
* Next Step: rerun plan-validator after the spec changes
`,
      ),
    );

    const output = collectConsole();
    let launches = 0;
    const result = await runWorkflowRunner({
      planName: planArg("blocked"),
      rootDir: workspace.root,
      console: output.console,
      processRunner: async () => {
        launches += 1;
        await writePlan(
          workspace.root,
          "blocked",
          planWith(
            "blocked",
            "unblock-plan",
            `## Blockers

### Blocker 1

* Status: resolved
* Description: old resolved blocker
* Required Action: old action
* Next Step: old next step

### Blocker 2

* Type: source-of-truth conflict
* Status: unresolved
* Description: spec must be updated before plan can be fixed
* Required Action: update the workflow runner spec
* Next Step: rerun plan-validator after the spec changes
`,
          ),
        );
        return { launched: true, stdout: "", stderr: "", exitCode: 0 };
      },
    });

    assert.equal(result.success, false);
    assert.equal(launches, 1);
    assert.equal(
      result.reason,
      "plan blocked after execute-plan: spec must be updated before plan can be fixed",
    );
    assert.deepEqual(output.lines.slice(-11), [
      "BLOCKED",
      "- Reason: BLOCKED",
      "-> spec must be updated before plan can be fixed",
      "-> Next: Run Codex CLI with this:",
      "`use unblock-plan.md`",
      "`evidence: ...`",
      "`.ai/plans/blocked.md`",
      "",
      "- Workflow log: .ai/artifacts/blocked/logs/runner.log",
      "- Token usage ledger: .ai/artifacts/blocked/logs/token-usage.jsonl",
      "- Worked for 0s",
    ]);
  } finally {
    await workspace.cleanup();
  }
});

test("execute-plan browser validation blockers use a short browser validation reason", async () => {
  const workspace = await setupWorkspace();
  try {
    await writePlan(
      workspace.root,
      "browser-blocked",
      planWith("active", "execute-plan"),
    );

    const output = collectConsole();
    const result = await runWorkflowRunner({
      planName: planArg("browser-blocked"),
      rootDir: workspace.root,
      console: output.console,
      processRunner: async () => {
        await writePlan(
          workspace.root,
          "browser-blocked",
          planWith(
            "blocked",
            "unblock-plan",
            `## Blockers

### Blocker 1

* Type: browser validation
* Status: unresolved
* Description: Mandatory browser validation cannot be performed because no authenticated dashboard session is available.
* Required Action: Provide an authenticated browser session.
* Next Step: Rerun unblock-plan with manual validation evidence.
`,
          ),
        );
        return { launched: true, stdout: "", stderr: "", exitCode: 0 };
      },
    });

    assert.equal(result.success, false);
    assert.equal(
      result.reason,
      "plan blocked after execute-plan: Browser validation: no authenticated dashboard session is available",
    );
    assert.equal(output.lines.includes("BLOCKED"), true);
    assert.equal(output.lines.includes("- Reason: BROWSER VALIDATION"), true);
    assert.equal(
      output.lines.includes(
        "-> no authenticated dashboard session is available",
      ),
      true,
    );
    assert.equal(
      output.lines.includes("-> Next: Run Codex CLI with this:"),
      true,
    );
    assert.equal(output.lines.includes("`use unblock-plan.md`"), true);
    assert.equal(output.lines.includes("`evidence: ...`"), true);
    assert.equal(output.lines.includes("`.ai/plans/browser-blocked.md`"), true);
  } finally {
    await workspace.cleanup();
  }
});

test(`missing selected prompt files fail before ${CODEX_EXEC_LABEL}`, async () => {
  const workspace = await setupWorkspace();
  try {
    await rm(join(workspace.root, ".ai", "prompts", "execute-plan.md"));
    await writePlan(
      workspace.root,
      "workflow-runner",
      planWith("active", "execute-plan"),
    );
    let launched = false;
    const result = await runWorkflowRunner({
      planName: planArg("workflow-runner"),
      rootDir: workspace.root,
      processRunner: async () => {
        launched = true;
        return { launched: true, stdout: "", stderr: "", exitCode: 0 };
      },
    });
    assert.equal(result.success, false);
    assert.equal(launched, false);
    assert.match(result.reason, /prompt file does not exist/);
  } finally {
    await workspace.cleanup();
  }
});

test(`${CODEX_EXEC_LABEL} prompt contains selected prompt content and exact plan path in fresh invocations`, async () => {
  const workspace = await setupWorkspace();
  try {
    await writePlan(
      workspace.root,
      "workflow-runner",
      planWith("active", "execute-plan"),
    );
    const calls: Parameters<ProcessRunner>[0][] = [];
    const result = await runWorkflowRunner({
      planName: planArg("workflow-runner"),
      rootDir: workspace.root,
      processRunner: runnerReturning(
        { launched: true, stdout: "ok", stderr: "", exitCode: 0 },
        (call) => {
          calls.push(call);
          if (call.promptPath === ".ai/prompts/execute-plan.md") {
            writeFileSync(
              join(workspace.root, ".ai", "plans", "workflow-runner.md"),
              planWith("review", "review-plan"),
            );
          }
        },
      ),
    });
    assert.equal(result.success, false);
    assert.deepEqual(
      calls
        .filter((call) => call.command === CODEX_COMMAND)
        .map((call) => [call.command, call.args[0], call.promptPath]),
      [
        [CODEX_COMMAND, "exec", ".ai/prompts/execute-plan.md"],
        [CODEX_COMMAND, "exec", ".ai/prompts/scope-cleanup.md"],
        [CODEX_COMMAND, "exec", ".ai/prompts/review-changes.md"],
      ],
    );
    assert.equal(calls[0].args.length, 7);
    assert.equal(calls[0].input, "");
    assert.match(
      calls[0].env?.CODEX_HOME ?? "",
      new RegExp(`${CODEX_HOME_SUFFIX.replace("/", "\\/")}$`),
    );
    assert.match(
      calls[0].env?.PATH ?? "",
      /\/\.nvm\/versions\/node\/v20\.20\.2\/bin/,
    );
    assert.match(calls[0].args[6], /^Use \.ai\/prompts\/execute-plan\.md/);
    assert.match(
      calls[0].args[6],
      /Execute:\n\.ai\/plans\/workflow-runner\.md/,
    );
    assert.match(calls[0].args[6], /Workflow prompt controller:/);
    assert.match(
      calls[0].args[6],
      /Follow \.ai\/prompts\/execute-plan\.md exactly\./,
    );
    assert.doesNotMatch(calls[0].args[6], /EXECUTE PLAN PROMPT/);
  } finally {
    await workspace.cleanup();
  }
});

test(`${OVERRIDE_CODEX_EXEC_LABEL} override applies to launched codex commands and CODEX_HOME`, async () => {
  const workspace = await setupWorkspace();
  try {
    await writePlan(
      workspace.root,
      "workflow-runner",
      planWith("active", "execute-plan"),
    );
    const calls: Parameters<ProcessRunner>[0][] = [];
    const result = await runWorkflowRunner({
      argv: [
        "--profile",
        OVERRIDE_CODEX_PROFILE,
        ".ai/plans/workflow-runner.md",
      ],
      rootDir: workspace.root,
      processRunner: runnerReturning(
        { launched: true, stdout: "ok", stderr: "", exitCode: 0 },
        (call) => {
          calls.push(call);
          if (call.promptPath === ".ai/prompts/execute-plan.md") {
            writeFileSync(
              join(workspace.root, ".ai", "plans", "workflow-runner.md"),
              planWith("review", "review-plan"),
            );
          }
        },
      ),
    });
    assert.equal(result.success, false);
    assert.deepEqual(
      calls
        .filter((call) => call.command === OVERRIDE_CODEX_PROFILE)
        .map((call) => call.promptPath),
      [
        ".ai/prompts/execute-plan.md",
        ".ai/prompts/scope-cleanup.md",
        ".ai/prompts/review-changes.md",
      ],
    );
    assert.equal(calls[0].command, OVERRIDE_CODEX_PROFILE);
    assert.match(
      calls[0].env?.CODEX_HOME ?? "",
      new RegExp(`${OVERRIDE_CODEX_HOME_SUFFIX.replace("/", "\\/")}$`),
    );
  } finally {
    await workspace.cleanup();
  }
});

test("reopen-plan prompts include selected prompt content and continue to execute-plan", async () => {
  const workspace = await setupWorkspace();
  try {
    await writePlan(
      workspace.root,
      "workflow-runner",
      planWith("reopening", "reopen-plan"),
    );
    const calls: Parameters<ProcessRunner>[0][] = [];
    const result = await runWorkflowRunner({
      planName: planArg("workflow-runner"),
      rootDir: workspace.root,
      processRunner: runnerReturning(
        { launched: true, stdout: "ok", stderr: "", exitCode: 0 },
        (call) => {
          calls.push(call);
          if (call.promptPath === ".ai/prompts/reopen-plan.md") {
            writeFileSync(
              join(workspace.root, ".ai", "plans", "workflow-runner.md"),
              planWith("active", "execute-plan"),
            );
            return;
          }
          if (call.promptPath === ".ai/prompts/execute-plan.md") {
            writeFileSync(
              join(workspace.root, ".ai", "plans", "workflow-runner.md"),
              planWith("blocked", "unblock-plan"),
            );
          }
        },
      ),
    });
    assert.equal(result.success, false);
    assert.deepEqual(
      calls.map((call) => [call.command, call.args[0], call.promptPath]),
      [
        [CODEX_COMMAND, "exec", ".ai/prompts/reopen-plan.md"],
        [CODEX_COMMAND, "exec", ".ai/prompts/execute-plan.md"],
      ],
    );
    assert.equal(calls[0].args.length, 7);
    assert.equal(calls[0].input, "");
    assert.match(calls[0].args[6], /^Use \.ai\/prompts\/reopen-plan\.md/);
    assert.match(calls[0].args[6], /Reopen:\n\.ai\/plans\/workflow-runner\.md/);
    assert.doesNotMatch(calls[0].args[6], /REOPEN PLAN PROMPT/);
  } finally {
    await workspace.cleanup();
  }
});

test("codex execution config requires an explicit prompt mapping", () => {
  assert.deepEqual(codexExecutionConfig(".ai/prompts/sync-plan-artifacts.md"), {
    model: "gpt-5.6-luna",
    reasoning: "medium",
  });
  assert.deepEqual(codexExecutionConfig(".ai/prompts/commit-summary.md"), {
    model: "gpt-5.6-terra",
    reasoning: "medium",
  });
  assert.throws(
    () => codexExecutionConfig(".ai/prompts/unknown.md"),
    /workflow runner codex config missing for prompt: \.ai\/prompts\/unknown\.md/,
  );
});

test(`${CODEX_EXEC_LABEL} uses prompt-tier model and reasoning policy`, async () => {
  const workspace = await setupWorkspace();
  try {
    await writePlan(
      workspace.root,
      "workflow-runner",
      planWith("review", "review-plan"),
    );
    const calls: Parameters<ProcessRunner>[0][] = [];
    const result = await runWorkflowRunner({
      planName: planArg("workflow-runner"),
      rootDir: workspace.root,
      processRunner: runnerReturning(
        { launched: true, stdout: "ok", stderr: "", exitCode: 0 },
        (call) => {
          calls.push(call);
          if (
            call.command === CODEX_COMMAND &&
            call.promptPath === ".ai/prompts/review-changes.md"
          ) {
            writeWorkflowEventArtifactSync({
              root: workspace.root,
              planName: "workflow-runner",
              kind: "review",
              version: 1,
            });
            writeFileSync(
              join(workspace.root, ".ai", "plans", "workflow-runner.md"),
              planWith("completed", "commit-summary"),
            );
          }
        },
      ),
    });

    assert.equal(result.success, true);
    const codexCalls = calls.filter((call) => call.command === CODEX_COMMAND);
    assert.equal(codexCalls.length, 3);
    assert.deepEqual(codexCalls[0].args.slice(0, 6), [
      "exec",
      "--json",
      "--model",
      "gpt-5.6-terra",
      "-c",
      'model_reasoning_effort="high"',
    ]);
    assert.deepEqual(codexCalls[1].args.slice(0, 6), [
      "exec",
      "--json",
      "--model",
      "gpt-5.6-terra",
      "-c",
      'model_reasoning_effort="xhigh"',
    ]);
    assert.deepEqual(codexCalls[2].args.slice(0, 6), [
      "exec",
      "--json",
      "--model",
      "gpt-5.6-terra",
      "-c",
      'model_reasoning_effort="medium"',
    ]);
    assert.match(
      codexCalls[0].args[6],
      /^Use \.ai\/prompts\/scope-cleanup\.md/,
    );
    assert.match(
      codexCalls[1].args[6],
      /git diff --staged -- \.ai\/scripts\/workflow\/runner\/__tests__\/integration\/runner\.test\.ts \.ai\/scripts\/workflow\/runner\.ts/,
    );
    assert.match(
      codexCalls[1].args[6],
      /git diff --staged --name-status -- \.ai\/scripts\/workflow\/runner\/__tests__\/integration\/runner\.test\.ts \.ai\/scripts\/workflow\/runner\.ts/,
    );
    assert.match(
      codexCalls[1].args[6],
      /^Use \.ai\/prompts\/review-changes\.md/,
    );
    assert.equal(codexCalls[2].args.includes("--add-dir"), true);
    assert.equal(
      codexCalls[2].args.includes(join(workspace.root, ".git")),
      true,
    );
    assert.match(
      codexCalls[2].args.at(-1) ?? "",
      /^Use \.ai\/prompts\/commit-summary\.md/,
    );

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
    assert.match(log, /model: gpt-5\.6-terra/);
    assert.match(log, /reasoning: xhigh/);
    assert.match(log, /reasoning: medium/);
  } finally {
    await workspace.cleanup();
  }
});

test(`${CODEX_EXEC_LABEL} retries selected model twice before retrying fallback model twice on capacity`, async () => {
  const workspace = await setupWorkspace();
  try {
    await writePlan(
      workspace.root,
      "capacity-fallback",
      planWith("completed", "commit-summary"),
    );
    const calls: Parameters<ProcessRunner>[0][] = [];
    const output = collectConsole();
    let codexLaunches = 0;
    const result = await runWorkflowRunner({
      planName: planArg("capacity-fallback"),
      rootDir: workspace.root,
      console: output.console,
      processRunner: async (call) => {
        calls.push(call);
        if (call.command !== CODEX_COMMAND) {
          return { launched: true, stdout: "", stderr: "", exitCode: 0 };
        }
        codexLaunches += 1;
        if (codexLaunches <= 4) {
          return {
            launched: true,
            stdout: "",
            stderr:
              "[codex] error: Selected model is at capacity. Please try a different model.",
            exitCode: 1,
          };
        }
        return { launched: true, stdout: "summary", stderr: "", exitCode: 0 };
      },
    });

    assert.equal(result.success, true);
    const codexCalls = calls.filter((call) => call.command === CODEX_COMMAND);
    assert.equal(codexCalls.length, 5);
    assert.deepEqual(
      codexCalls.map((call) => call.promptPath),
      Array.from({ length: 5 }, () => ".ai/prompts/commit-summary.md"),
    );
    assert.deepEqual(
      codexCalls.map((call) => call.args.slice(0, 4)),
      [
        ["exec", "--json", "--model", "gpt-5.6-terra"],
        ["exec", "--json", "--model", "gpt-5.6-terra"],
        ["exec", "--json", "--model", "gpt-5.6-terra"],
        ["exec", "--json", "--model", WORKFLOW_RUNNER_CODEX_FALLBACK_MODEL],
        ["exec", "--json", "--model", WORKFLOW_RUNNER_CODEX_FALLBACK_MODEL],
      ],
    );

    const log = await readFile(
      join(
        workspace.root,
        ".ai",
        "artifacts",
        "capacity-fallback",
        "logs",
        "runner.log",
      ),
      "utf8",
    );
    assert.match(
      log,
      new RegExp(`model: ${WORKFLOW_RUNNER_CODEX_FALLBACK_MODEL}`),
    );
    assert.equal(
      output.lines.some((line) =>
        /retrying \.ai\/prompts\/commit-summary\.md with the same model \(2\/3\)/.test(
          line,
        ),
      ),
      true,
    );
    assert.equal(
      output.lines.some((line) =>
        /retrying \.ai\/prompts\/commit-summary\.md with the same model \(3\/3\)/.test(
          line,
        ),
      ),
      true,
    );
    assert.equal(
      output.lines.some((line) =>
        /retrying \.ai\/prompts\/commit-summary\.md with fallback model gpt-5\.5 \(1\/2\)/.test(
          line,
        ),
      ),
      true,
    );
    assert.equal(
      output.lines.some((line) =>
        /retrying \.ai\/prompts\/commit-summary\.md with fallback model gpt-5\.5 \(2\/2\)/.test(
          line,
        ),
      ),
      true,
    );
  } finally {
    await workspace.cleanup();
  }
});

test(`${CODEX_EXEC_LABEL} grants commit-summary explicit write access to .git`, async () => {
  const workspace = await setupWorkspace();
  try {
    await writePlan(
      workspace.root,
      "workflow-runner",
      planWith("review", "review-plan"),
    );
    const calls: Parameters<ProcessRunner>[0][] = [];
    const result = await runWorkflowRunner({
      planName: planArg("workflow-runner"),
      rootDir: workspace.root,
      processRunner: runnerReturning(
        { launched: true, stdout: "ok", stderr: "", exitCode: 0 },
        (call) => {
          calls.push(call);
          if (
            call.command === CODEX_COMMAND &&
            call.promptPath === ".ai/prompts/review-changes.md"
          ) {
            writeWorkflowEventArtifactSync({
              root: workspace.root,
              planName: "workflow-runner",
              kind: "review",
              version: 1,
            });
            writeFileSync(
              join(workspace.root, ".ai", "plans", "workflow-runner.md"),
              planWith("completed", "commit-summary"),
            );
          }
        },
      ),
    });

    assert.equal(result.success, true);
    const commitSummaryCall = calls.find(
      (call) =>
        call.command === CODEX_COMMAND &&
        call.promptPath === ".ai/prompts/commit-summary.md",
    );
    assert.ok(commitSummaryCall);
    assert.equal(commitSummaryCall.args.includes("--add-dir"), true);
    assert.equal(
      commitSummaryCall.args.includes(join(workspace.root, ".git")),
      true,
    );
  } finally {
    await workspace.cleanup();
  }
});

test("iteration logs include parsed context window usage from codex json output", async () => {
  const workspace = await setupWorkspace();
  try {
    await writePlan(
      workspace.root,
      "workflow-runner",
      planWith("completed", "commit-summary"),
    );
    const result = await runWorkflowRunner({
      planName: planArg("workflow-runner"),
      rootDir: workspace.root,
      processRunner: runnerReturning({
        launched: true,
        stdout: tokenCountLine(129200, 258400),
        stderr: "",
        exitCode: 0,
      }),
    });

    assert.equal(result.success, true);
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
    assert.match(log, /contextWindowTokens: 258400/);
    assert.match(log, /contextWindowUsedTokens: 129200/);
    assert.match(log, /contextWindowUsedPercent: 50\.00/);
  } finally {
    await workspace.cleanup();
  }
});

test("iteration logs include branch and HEAD without non-savepoint commit progress", async () => {
  const workspace = await setupWorkspace();
  try {
    mkdirSync(join(workspace.root, ".git"), { recursive: true });
    await writePlan(
      workspace.root,
      "workflow-runner",
      planWith("completed", "commit-summary"),
    );

    const output = collectConsole();
    let headLookupCount = 0;
    const result = await runWorkflowRunner({
      planName: planArg("workflow-runner"),
      rootDir: workspace.root,
      console: output.console,
      processRunner: async (call) => {
        if (
          call.command === "git" &&
          call.args.join(" ") === "rev-parse --abbrev-ref HEAD"
        ) {
          return {
            launched: true,
            stdout: "feature/workflow\n",
            stderr: "",
            exitCode: 0,
          };
        }
        if (
          call.command === "git" &&
          call.args.join(" ") === "rev-parse HEAD"
        ) {
          headLookupCount += 1;
          return {
            launched: true,
            stdout:
              headLookupCount === 1
                ? "1111111111111111111111111111111111111111\n"
                : "2222222222222222222222222222222222222222\n",
            stderr: "",
            exitCode: 0,
          };
        }
        if (call.command === "git" && call.args[0] === "status") {
          return { launched: true, stdout: "", stderr: "", exitCode: 0 };
        }
        return { launched: true, stdout: "ok", stderr: "", exitCode: 0 };
      },
    });

    assert.equal(result.success, true);
    assert.doesNotMatch(
      output.lines.join("\n"),
      /\[0\/1\] final commit pending/,
    );
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
    assert.match(log, /currentBranch: feature\/workflow/);
    assert.match(
      log,
      /startingHeadSha: 1111111111111111111111111111111111111111/,
    );
    assert.match(
      log,
      /endingHeadSha: 2222222222222222222222222222222222222222/,
    );
    assert.doesNotMatch(log, /commitProgress:/);
    assert.doesNotMatch(log, /commitProgressDescription:/);
  } finally {
    await workspace.cleanup();
  }
});

test("successful workflow stages append token usage ledger entries and report the ledger path", async () => {
  const workspace = await setupWorkspace();
  try {
    await writePlan(
      workspace.root,
      "workflow-runner",
      planWith("completed", "commit-summary"),
    );
    const output = collectConsole();
    const result = await runWorkflowRunner({
      planName: planArg("workflow-runner"),
      rootDir: workspace.root,
      console: output.console,
      processRunner: runnerReturning({
        launched: true,
        stdout: turnCompletedUsageDetailLine({
          inputTokens: 1200,
          cachedInputTokens: 400,
          outputTokens: 90,
          reasoningOutputTokens: 30,
        }),
        stderr: "",
        exitCode: 0,
      }),
    });

    assert.equal(result.success, true);
    assert.equal(
      output.lines.includes(
        "- Token usage ledger: .ai/artifacts/workflow-runner/logs/token-usage.jsonl",
      ),
      true,
    );
    const ledger = await readTokenUsageLedger(
      workspace.root,
      "workflow-runner",
    );
    assert.equal(ledger.length, 1);
    assert.deepEqual(ledger[0], {
      timestamp: ledger[0]?.timestamp,
      iteration: 1,
      planPath: ".ai/plans/workflow-runner.md",
      startingWorkflowState: "completed",
      promptPath: ".ai/prompts/commit-summary.md",
      model: "gpt-5.6-terra",
      reasoning: "medium",
      result: "success",
      signal: null,
      usageAvailable: true,
      stageInputTokens: 1200,
      stageCachedInputTokens: 400,
      stageUncachedInputTokens: 800,
      stageOutputTokens: 90,
      stageReasoningOutputTokens: 30,
      stageTotalTokens: 1290,
      contextWindowTokens: "unavailable",
      contextWindowUsedTokens: 1200,
      contextWindowUsedPercent: "unavailable",
      inputTokens: 1200,
      cachedInputTokens: 400,
      uncachedInputTokens: 800,
      outputTokens: 90,
      reasoningOutputTokens: 30,
      totalTokens: 1290,
    });
  } finally {
    await workspace.cleanup();
  }
});

test("token usage ledger analysis identifies the latest stage and prompt action", async () => {
  const workspace = await setupWorkspace();
  try {
    await writePlan(
      workspace.root,
      "workflow-runner",
      planWith("active", "execute-plan"),
    );
    mkdirSync(
      join(workspace.root, ".ai", "artifacts", "workflow-runner", "logs"),
      { recursive: true },
    );
    writeFileSync(
      join(
        workspace.root,
        ".ai",
        "artifacts",
        "workflow-runner",
        "logs",
        "token-usage.jsonl",
      ),
      [
        JSON.stringify({
          iteration: 1,
          promptPath: ".ai/prompts/execute-plan.md",
          stageInputTokens: 90,
          stageUncachedInputTokens: 40,
          inputTokens: 90,
          totalTokens: 120,
        }),
        JSON.stringify({
          iteration: 2,
          promptPath: ".ai/prompts/review-changes.md",
          stageInputTokens: 2_100_000,
          stageUncachedInputTokens: 120_000,
          inputTokens: 2_100_090,
          totalTokens: 2_100_250,
        }),
      ].join("\n") + "\n",
      "utf8",
    );

    const analysis = await analyzeTokenUsageLedger(
      workspace.root,
      "workflow-runner",
    );

    assert.deepEqual(analysis, {
      ledgerPath: ".ai/artifacts/workflow-runner/logs/token-usage.jsonl",
      latestStage: {
        iteration: 2,
        promptPath: ".ai/prompts/review-changes.md",
        promptAction: "review-changes",
        totalInputTokens: 2_100_000,
        uncachedInputTokens: 120_000,
      },
      cumulative: {
        inputTokens: 2_100_090,
        totalTokens: 2_100_250,
      },
    });
  } finally {
    await workspace.cleanup();
  }
});

test("workflow runner writes the context snapshot before launching a workflow prompt", async () => {
  const workspace = await setupWorkspace();
  try {
    await writePlan(
      workspace.root,
      "workflow-runner",
      planWith("completed", "commit-summary"),
    );
    let sawSnapshot = false;
    const result = await runWorkflowRunner({
      planName: planArg("workflow-runner"),
      rootDir: workspace.root,
      processRunner: async (call) => {
        if (call.command === "git" && call.args[0] === "status") {
          return { launched: true, stdout: "", stderr: "", exitCode: 0 };
        }
        if (call.command === CODEX_COMMAND) {
          sawSnapshot = existsSync(
            join(
              workspace.root,
              workflowContextSnapshotRelativePath("workflow-runner"),
            ),
          );
          const snapshot = await readFile(
            join(
              workspace.root,
              workflowContextSnapshotRelativePath("workflow-runner"),
            ),
            "utf8",
          );
          assert.match(snapshot, /## Current State/);
          assert.match(snapshot, /\* Workflow State: completed/);
        }
        return {
          launched: true,
          stdout: turnCompletedUsageDetailLine({
            inputTokens: 100,
            cachedInputTokens: 50,
            outputTokens: 40,
            reasoningOutputTokens: 10,
          }),
          stderr: "",
          exitCode: 0,
        };
      },
    });

    assert.equal(result.success, true);
    assert.equal(sawSnapshot, true);
  } finally {
    await workspace.cleanup();
  }
});

test("high token stages log one short advisory warning while keeping token usage details", async () => {
  const workspace = await setupWorkspace();
  try {
    await writePlan(
      workspace.root,
      "workflow-runner",
      `${planWith("completed", "commit-summary")}\n${"x".repeat(110 * 1024)}`,
    );
    const output = collectConsole();
    const result = await runWorkflowRunner({
      planName: planArg("workflow-runner"),
      rootDir: workspace.root,
      console: output.console,
      processRunner: runnerReturning({
        launched: true,
        stdout: turnCompletedUsageDetailLine({
          inputTokens: 1_100_100,
          cachedInputTokens: 50,
          outputTokens: 90,
          reasoningOutputTokens: 30,
        }),
        stderr: "",
        exitCode: 0,
      }),
    });

    assert.equal(result.success, true);
    assert.equal(
      output.lines.some((line) => /WARNING: Plan file is/i.test(line)),
      true,
    );
    const tokenWarnings = output.lines.filter((line) =>
      /WARNING: Stage token usage is high/i.test(line),
    );
    assert.equal(tokenWarnings.length, 1);
    assert.doesNotMatch(tokenWarnings[0], />/);
    assert.doesNotMatch(tokenWarnings[0], /100,000|2,000,000/);

    const snapshot = await readFile(
      join(
        workspace.root,
        workflowContextSnapshotRelativePath("workflow-runner"),
      ),
      "utf8",
    );
    assert.match(snapshot, /## Latest Token Usage Summary/);
    assert.match(snapshot, /Stage Input Tokens: 1100100/);
    assert.match(snapshot, /Stage Uncached Input Tokens: 1100050/);
    assert.match(snapshot, /Stage Output Tokens: 90/);
    assert.doesNotMatch(snapshot, /## Threshold Warnings/);

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
    assert.doesNotMatch(log, /thresholdWarnings:/);
  } finally {
    await workspace.cleanup();
  }
});

test("high-token prior stages add generic guardrail guidance to execute prompts", async () => {
  const workspace = await setupWorkspace();
  try {
    await writePlan(
      workspace.root,
      "workflow-runner",
      planWith("active", "execute-plan"),
    );
    mkdirSync(
      join(workspace.root, ".ai", "artifacts", "workflow-runner", "logs"),
      { recursive: true },
    );
    writeFileSync(
      join(
        workspace.root,
        ".ai",
        "artifacts",
        "workflow-runner",
        "logs",
        "token-usage.jsonl",
      ),
      `${JSON.stringify({
        timestamp: "2026-06-29T00:00:00.000Z",
        iteration: 3,
        promptPath: ".ai/prompts/review-changes.md",
        stageInputTokens: 1_100_000,
        stageCachedInputTokens: 1_020_000,
        stageUncachedInputTokens: 80_000,
        stageOutputTokens: 800,
        stageTotalTokens: 1_100_800,
        totalTokens: 1_100_800,
      })}\n`,
      "utf8",
    );

    const calls: Parameters<ProcessRunner>[0][] = [];
    await runWorkflowRunner({
      planName: planArg("workflow-runner"),
      rootDir: workspace.root,
      processRunner: runnerReturning(
        { launched: true, stdout: "ok", stderr: "", exitCode: 0 },
        (call) => {
          calls.push(call);
          if (call.promptPath === ".ai/prompts/execute-plan.md") {
            writeFileSync(
              join(workspace.root, ".ai", "plans", "workflow-runner.md"),
              planWith("blocked", "unblock-plan"),
            );
          }
        },
      ),
    });

    const executeCall = calls.find(
      (call) => call.promptPath === ".ai/prompts/execute-plan.md",
    );
    assert.ok(executeCall);
    assert.match(executeCall.args[6], /Workflow token guardrail:/);
    assert.match(
      executeCall.args[6],
      /previous stage exceeded token thresholds/i,
    );
    assert.doesNotMatch(executeCall.args[6], /Execute token guardrail:/);
  } finally {
    await workspace.cleanup();
  }
});

test("high-token prior stages add generic guardrail guidance to review prompts", async () => {
  const workspace = await setupWorkspace();
  try {
    await writePlan(
      workspace.root,
      "workflow-runner",
      planWith("review", "review-plan"),
    );
    mkdirSync(
      join(workspace.root, ".ai", "artifacts", "workflow-runner", "logs"),
      { recursive: true },
    );
    writeFileSync(
      join(
        workspace.root,
        ".ai",
        "artifacts",
        "workflow-runner",
        "logs",
        "token-usage.jsonl",
      ),
      `${JSON.stringify({
        timestamp: "2026-06-29T00:00:00.000Z",
        iteration: 3,
        promptPath: ".ai/prompts/execute-plan.md",
        stageInputTokens: 1_100_000,
        stageCachedInputTokens: 1_020_000,
        stageUncachedInputTokens: 80_000,
        stageOutputTokens: 800,
        stageTotalTokens: 1_100_800,
        totalTokens: 1_100_800,
      })}\n`,
      "utf8",
    );

    const calls: Parameters<ProcessRunner>[0][] = [];
    await runWorkflowRunner({
      planName: planArg("workflow-runner"),
      rootDir: workspace.root,
      processRunner: runnerReturning(
        { launched: true, stdout: "ok", stderr: "", exitCode: 0 },
        (call) => {
          calls.push(call);
          if (call.promptPath === ".ai/prompts/review-changes.md") {
            writeWorkflowEventArtifactSync({
              root: workspace.root,
              planName: "workflow-runner",
              kind: "review",
              version: 1,
            });
            writeFileSync(
              join(workspace.root, ".ai", "plans", "workflow-runner.md"),
              planWith("completed", "commit-summary"),
            );
          }
        },
      ),
    });

    const reviewCall = calls.find(
      (call) => call.promptPath === ".ai/prompts/review-changes.md",
    );
    assert.ok(reviewCall);
    assert.match(reviewCall.args[6], /Workflow token guardrail:/);
    assert.doesNotMatch(reviewCall.args[6], /Execute token guardrail:/);
    assert.doesNotMatch(reviewCall.args[6], /Auto-narrow reason: stage input/i);
  } finally {
    await workspace.cleanup();
  }
});

test("high-token prior stages add generic guardrail guidance to plan-validator prompts", async () => {
  const workspace = await setupWorkspace();
  try {
    writeWorkflowEventArtifactSync({
      root: workspace.root,
      planName: "workflow-runner",
      kind: "validation",
      version: 1,
    });
    await writePlan(
      workspace.root,
      "workflow-runner",
      planWith(
        "draft",
        "plan-validator",
        "## Validation History\n\n### Validation v1\n\n* Summary: Needs fix\n* Decision: draft\n* Evidence: .ai/artifacts/workflow-runner/events/validation-v1.md\n",
      ),
    );
    mkdirSync(
      join(workspace.root, ".ai", "artifacts", "workflow-runner", "logs"),
      { recursive: true },
    );
    writeFileSync(
      join(
        workspace.root,
        ".ai",
        "artifacts",
        "workflow-runner",
        "logs",
        "token-usage.jsonl",
      ),
      `${JSON.stringify({
        timestamp: "2026-06-29T00:00:00.000Z",
        iteration: 3,
        promptPath: ".ai/prompts/plan-validator.md",
        stageInputTokens: 1_100_000,
        stageCachedInputTokens: 1_020_000,
        stageUncachedInputTokens: 80_000,
        stageOutputTokens: 800,
        stageTotalTokens: 1_100_800,
        totalTokens: 1_100_800,
      })}\n`,
      "utf8",
    );

    const calls: Parameters<ProcessRunner>[0][] = [];
    await runWorkflowRunner({
      planName: planArg("workflow-runner"),
      rootDir: workspace.root,
      processRunner: runnerReturning(
        { launched: true, stdout: "ok", stderr: "", exitCode: 0 },
        (call) => {
          calls.push(call);
          if (call.promptPath === ".ai/prompts/plan-validator.md") {
            writeFileSync(
              join(workspace.root, ".ai", "plans", "workflow-runner.md"),
              planWith("approved", "execute-plan"),
            );
          }
          if (call.promptPath === ".ai/prompts/execute-plan.md") {
            writeFileSync(
              join(workspace.root, ".ai", "plans", "workflow-runner.md"),
              planWith("blocked", "unblock-plan"),
            );
          }
        },
      ),
    });

    const validatorCall = calls.find(
      (call) => call.promptPath === ".ai/prompts/plan-validator.md",
    );
    assert.ok(validatorCall);
    assert.match(validatorCall.args[6], /Workflow token guardrail:/);
    assert.doesNotMatch(validatorCall.args[6], /Execute token guardrail:/);
  } finally {
    await workspace.cleanup();
  }
});

test("high-token prior stages do not add generic guardrail guidance to unguarded prompts", async () => {
  const workspace = await setupWorkspace();
  try {
    await writePlan(
      workspace.root,
      "workflow-runner",
      planWith("draft", "sync-plan-artifacts"),
    );
    mkdirSync(
      join(workspace.root, ".ai", "artifacts", "workflow-runner", "logs"),
      { recursive: true },
    );
    writeFileSync(
      join(
        workspace.root,
        ".ai",
        "artifacts",
        "workflow-runner",
        "logs",
        "token-usage.jsonl",
      ),
      `${JSON.stringify({
        timestamp: "2026-06-29T00:00:00.000Z",
        iteration: 3,
        promptPath: ".ai/prompts/execute-plan.md",
        stageInputTokens: 1_100_000,
        stageCachedInputTokens: 1_020_000,
        stageUncachedInputTokens: 80_000,
        stageOutputTokens: 800,
        stageTotalTokens: 1_100_800,
        totalTokens: 1_100_800,
      })}\n`,
      "utf8",
    );

    const calls: Parameters<ProcessRunner>[0][] = [];
    await runWorkflowRunner({
      planName: planArg("workflow-runner"),
      rootDir: workspace.root,
      processRunner: runnerReturning(
        { launched: true, stdout: "ok", stderr: "", exitCode: 0 },
        (call) => {
          calls.push(call);
          if (call.promptPath === ".ai/prompts/sync-plan-artifacts.md") {
            writeFileSync(
              join(workspace.root, ".ai", "plans", "workflow-runner.md"),
              planWith("approved", "execute-plan"),
            );
          }
          if (call.promptPath === ".ai/prompts/execute-plan.md") {
            writeFileSync(
              join(workspace.root, ".ai", "plans", "workflow-runner.md"),
              planWith("blocked", "unblock-plan"),
            );
          }
        },
      ),
    });

    const syncCall = calls.find(
      (call) => call.promptPath === ".ai/prompts/sync-plan-artifacts.md",
    );
    assert.ok(syncCall);
    assert.doesNotMatch(syncCall.args[6], /Workflow token guardrail:/);
    assert.doesNotMatch(syncCall.args[6], /Execute token guardrail:/);
  } finally {
    await workspace.cleanup();
  }
});

test("below-threshold, malformed latest, and non-finite latest ledgers do not add workflow guardrails", async () => {
  const scenarios: Array<{
    name: string;
    ledger: string;
  }> = [
    {
      name: "below-threshold",
      ledger: `${JSON.stringify({
        timestamp: "2026-06-29T00:00:00.000Z",
        iteration: 3,
        promptPath: ".ai/prompts/review-changes.md",
        stageInputTokens: 299_999,
        stageUncachedInputTokens: 39_999,
      })}\n`,
    },
    {
      name: "malformed-latest",
      ledger: `${JSON.stringify({
        timestamp: "2026-06-29T00:00:00.000Z",
        iteration: 2,
        promptPath: ".ai/prompts/review-changes.md",
        stageInputTokens: 1_100_000,
        stageUncachedInputTokens: 80_000,
      })}\nnot-json\n`,
    },
    {
      name: "non-finite-latest",
      ledger: `${JSON.stringify({
        timestamp: "2026-06-29T00:00:00.000Z",
        iteration: 3,
        promptPath: ".ai/prompts/review-changes.md",
        stageInputTokens: "many",
        stageUncachedInputTokens: null,
      })}\n`,
    },
  ];

  for (const scenario of scenarios) {
    const workspace = await setupWorkspace();
    try {
      await writePlan(
        workspace.root,
        scenario.name,
        planWith("active", "execute-plan"),
      );
      mkdirSync(
        join(workspace.root, ".ai", "artifacts", scenario.name, "logs"),
        {
          recursive: true,
        },
      );
      writeFileSync(
        join(
          workspace.root,
          ".ai",
          "artifacts",
          scenario.name,
          "logs",
          "token-usage.jsonl",
        ),
        scenario.ledger,
        "utf8",
      );

      const calls: Parameters<ProcessRunner>[0][] = [];
      await runWorkflowRunner({
        planName: planArg(scenario.name),
        rootDir: workspace.root,
        processRunner: runnerReturning(
          { launched: true, stdout: "ok", stderr: "", exitCode: 0 },
          (call) => {
            calls.push(call);
            if (call.promptPath === ".ai/prompts/execute-plan.md") {
              writeFileSync(
                join(workspace.root, ".ai", "plans", `${scenario.name}.md`),
                planWith("blocked", "unblock-plan"),
              );
            }
          },
        ),
      });

      const executeCall = calls.find(
        (call) => call.promptPath === ".ai/prompts/execute-plan.md",
      );
      assert.ok(executeCall);
      assert.doesNotMatch(executeCall.args[6], /Workflow token guardrail:/);
      assert.doesNotMatch(executeCall.args[6], /Execute token guardrail:/);
    } finally {
      await workspace.cleanup();
    }
  }
});

test("thin plans keep latest-stage token summaries without warning remediation text", async () => {
  const workspace = await setupWorkspace();
  try {
    await writePlan(
      workspace.root,
      "thin-token-spike",
      planWith("completed", "commit-summary"),
    );
    mkdirSync(
      join(workspace.root, ".ai", "artifacts", "thin-token-spike", "logs"),
      { recursive: true },
    );
    writeFileSync(
      join(
        workspace.root,
        ".ai",
        "artifacts",
        "thin-token-spike",
        "logs",
        "token-usage.jsonl",
      ),
      `${JSON.stringify({
        timestamp: "2026-06-26T00:00:00.000Z",
        iteration: 9,
        promptPath: ".ai/prompts/execute-plan.md",
        stageInputTokens: 6_173_271,
        stageCachedInputTokens: 5_856_512,
        stageUncachedInputTokens: 316_759,
        stageOutputTokens: 10_000,
        stageTotalTokens: 6_183_271,
        totalTokens: 6_183_271,
      })}\n`,
      "utf8",
    );
    const output = collectConsole();

    const result = await runWorkflowRunner({
      planName: planArg("thin-token-spike"),
      rootDir: workspace.root,
      console: output.console,
      processRunner: runnerReturning({
        launched: true,
        stdout: turnCompletedUsageDetailLine({
          inputTokens: 100,
          cachedInputTokens: 20,
          outputTokens: 30,
          reasoningOutputTokens: 10,
        }),
        stderr: "",
        exitCode: 0,
      }),
    });

    assert.equal(result.success, true);
    const terminalOutput = output.lines.join("\n");
    assert.doesNotMatch(terminalOutput, /Latest stage total input tokens/i);
    assert.doesNotMatch(terminalOutput, /Latest stage uncached input tokens/i);
    assert.doesNotMatch(terminalOutput, /pathological/i);

    const snapshot = await readFile(
      join(
        workspace.root,
        workflowContextSnapshotRelativePath("thin-token-spike"),
      ),
      "utf8",
    );
    assert.match(snapshot, /## Latest Token Usage Summary/);
    assert.match(snapshot, /Stage Input Tokens: 100/);
    assert.match(snapshot, /Stage Uncached Input Tokens: 80/);
    assert.match(snapshot, /Stage Output Tokens: 30/);
    assert.doesNotMatch(snapshot, /## Threshold Warnings/);
  } finally {
    await workspace.cleanup();
  }
});

test("token usage ledger accumulates totals across multiple workflow stages", async () => {
  const workspace = await setupWorkspace();
  try {
    await writePlan(
      workspace.root,
      "workflow-runner",
      planWith("review", "review-plan"),
    );
    const result = await runWorkflowRunner({
      planName: planArg("workflow-runner"),
      rootDir: workspace.root,
      processRunner: async (call) => {
        if (call.command === "git") {
          return { launched: true, stdout: "", stderr: "", exitCode: 0 };
        }
        if (
          call.command === CODEX_COMMAND &&
          call.promptPath === ".ai/prompts/review-changes.md"
        ) {
          writeWorkflowEventArtifactSync({
            root: workspace.root,
            planName: "workflow-runner",
            kind: "review",
            version: 1,
          });
          await writePlan(
            workspace.root,
            "workflow-runner",
            planWith("completed", "commit-summary"),
          );
          return {
            launched: true,
            stdout: turnCompletedUsageDetailLine({
              inputTokens: 100,
              cachedInputTokens: 20,
              outputTokens: 30,
              reasoningOutputTokens: 10,
            }),
            stderr: "",
            exitCode: 0,
          };
        }
        if (
          call.command === CODEX_COMMAND &&
          call.promptPath === ".ai/prompts/scope-cleanup.md"
        ) {
          return { launched: true, stdout: "", stderr: "", exitCode: 0 };
        }
        return {
          launched: true,
          stdout: turnCompletedUsageDetailLine({
            inputTokens: 200,
            cachedInputTokens: 50,
            outputTokens: 40,
            reasoningOutputTokens: 12,
          }),
          stderr: "",
          exitCode: 0,
        };
      },
    });

    assert.equal(result.success, true);
    const ledger = await readTokenUsageLedger(
      workspace.root,
      "workflow-runner",
    );
    assert.equal(ledger.length, 2);
    assert.equal(ledger[0]?.endingWorkflowState, "completed");
    assert.equal(ledger[0]?.inputTokens, 100);
    assert.equal(ledger[0]?.cachedInputTokens, 20);
    assert.equal(ledger[0]?.uncachedInputTokens, 80);
    assert.equal(ledger[0]?.outputTokens, 30);
    assert.equal(ledger[0]?.reasoningOutputTokens, 10);
    assert.equal(ledger[0]?.totalTokens, 130);
    assert.equal(ledger[1]?.inputTokens, 300);
    assert.equal(ledger[1]?.cachedInputTokens, 70);
    assert.equal(ledger[1]?.uncachedInputTokens, 230);
    assert.equal(ledger[1]?.outputTokens, 70);
    assert.equal(ledger[1]?.reasoningOutputTokens, 22);
    assert.equal(ledger[1]?.totalTokens, 370);
  } finally {
    await workspace.cleanup();
  }
});

test("workflow runner continues after a pathological nonterminal stage because token spikes are logging-only", async () => {
  const workspace = await setupWorkspace();
  try {
    await writePlan(
      workspace.root,
      "workflow-runner",
      planWith("active", "execute-plan"),
    );
    const output = collectConsole();
    let codexCalls = 0;
    const result = await runWorkflowRunner({
      planName: planArg("workflow-runner"),
      rootDir: workspace.root,
      console: output.console,
      processRunner: async (call) => {
        if (call.command !== CODEX_COMMAND) {
          return { launched: true, stdout: "", stderr: "", exitCode: 0 };
        }
        codexCalls += 1;
        if (codexCalls === 1) {
          await writePlan(
            workspace.root,
            "workflow-runner",
            planWith(
              "active",
              "execute-plan",
              "\n## Latest Execution Summary\n\n* Finished one chunk.\n",
            ),
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
        await writePlan(
          workspace.root,
          "workflow-runner",
          planWith("blocked", "unblock-plan"),
        );
        return {
          launched: true,
          stdout: turnCompletedUsageDetailLine({
            inputTokens: 100,
            cachedInputTokens: 20,
            outputTokens: 30,
            reasoningOutputTokens: 10,
          }),
          stderr: "",
          exitCode: 0,
        };
      },
    });

    assert.equal(result.success, false);
    assert.equal(result.iterations, 2);
    assert.equal(codexCalls, 2);
    assert.match(result.reason, /plan blocked after execute-plan/i);
    const tokenWarnings = output.lines.filter((line) =>
      /WARNING: Stage token usage is high/i.test(line),
    );
    assert.equal(tokenWarnings.length, 1);
    assert.doesNotMatch(tokenWarnings[0], /100,000|2,000,000/);
    assert.equal(
      output.lines.some((line) =>
        /fresh workflow runner invocation/i.test(line),
      ),
      false,
    );

    const ledger = await readTokenUsageLedger(
      workspace.root,
      "workflow-runner",
    );
    assert.equal(ledger.length, 2);
    assert.equal(ledger[0]?.stageInputTokens, 2_100_000);
    assert.equal(ledger[1]?.stageInputTokens, 100);
  } finally {
    await workspace.cleanup();
  }
});
test("interrupted workflow stages append partial token usage without changing exact cumulative totals", async () => {
  const workspace = await setupWorkspace();
  try {
    await writePlan(
      workspace.root,
      "workflow-runner",
      planWith("active", "execute-plan"),
    );
    const result = await runWorkflowRunner({
      planName: planArg("workflow-runner"),
      rootDir: workspace.root,
      processRunner: async () =>
        ({
          launched: true,
          stdout: tokenCountLine(450, 1000),
          stderr: "interrupted",
          exitCode: 130,
          exitSignal: "SIGINT",
        }) as Awaited<ReturnType<ProcessRunner>>,
    });

    assert.equal(result.success, false);
    assert.equal(result.exitCode, 130);
    const ledger = await readTokenUsageLedger(
      workspace.root,
      "workflow-runner",
    );
    assert.equal(ledger.length, 1);
    assert.equal(ledger[0]?.result, "interrupted");
    assert.equal(ledger[0]?.signal, "SIGINT");
    assert.equal(ledger[0]?.usageAvailable, false);
    assert.equal(ledger[0]?.stageInputTokens, null);
    assert.equal(ledger[0]?.contextWindowTokens, 1000);
    assert.equal(ledger[0]?.contextWindowUsedTokens, 450);
    assert.equal(ledger[0]?.inputTokens, 0);
    assert.equal(ledger[0]?.totalTokens, 0);
  } finally {
    await workspace.cleanup();
  }
});

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

test("full .ai/plans path invocation writes to the normalized plan log", async () => {
  const workspace = await setupWorkspace();
  try {
    await writePlan(
      workspace.root,
      "workflow-runner",
      planWith("completed", "commit-summary"),
    );
    const result = await runWorkflowRunner({
      argv: [".ai/plans/workflow-runner.md"],
      rootDir: workspace.root,
      processRunner: runnerReturning({
        launched: true,
        stdout: "summary",
        stderr: "",
        exitCode: 0,
      }),
    });

    assert.equal(result.success, true);
    assert.equal(
      existsSync(
        join(
          workspace.root,
          ".ai",
          "artifacts",
          "workflow-runner",
          "logs",
          "runner.log",
        ),
      ),
      true,
    );
    assert.equal(
      existsSync(
        join(
          workspace.root,
          ".ai",
          "artifacts",
          "workflow-runner",
          "logs",
          ".ai",
        ),
      ),
      false,
    );
  } finally {
    await workspace.cleanup();
  }
});

test(`commit-summary stops before ${CODEX_COMMAND} when all plan-owned paths are ignored`, async () => {
  const workspace = await setupWorkspace();
  try {
    await writePlan(
      workspace.root,
      "workflow-runner",
      planWith("completed", "commit-summary"),
    );
    const calls: Parameters<ProcessRunner>[0][] = [];
    const result = await runWorkflowRunner({
      argv: [".ai/plans/workflow-runner.md"],
      rootDir: workspace.root,
      isIgnored: async (relativePath) => relativePath.startsWith(".ai/"),
      processRunner: async (call) => {
        calls.push(call);
        return { launched: true, stdout: "summary", stderr: "", exitCode: 0 };
      },
    });

    assert.equal(result.success, false);
    assert.match(
      result.reason,
      /commit summary file scope invalid: all commit summary paths are git-ignored/,
    );
    assert.equal(calls.length, 0);
  } finally {
    await workspace.cleanup();
  }
});

test("workflow runner ignores another plan's invalid ownership workflow state", async () => {
  const workspace = await setupWorkspace();
  try {
    await writePlan(
      workspace.root,
      "current-plan",
      planWithFileScope(
        "active",
        "execute-plan",
        {
          modified: ["apps/web/src/shared.ts"],
        },
        ownershipScopeSection(["apps/web/src/shared.ts"]),
      ),
    );
    await writeFileOwnershipArtifact(workspace.root, "other-plan", {
      planPath: ".ai/plans/other-plan.md",
      workflowState: "active",
      owns: ["apps/web/src/shared.ts"],
      released: [],
      resolvedFiles: ["apps/web/src/shared.ts"],
      changedFiles: [],
      headSha: "abc123",
      updatedAt: "2026-06-04T00:00:00.000Z",
    });
    await writeArtifactStateFile(
      workspace.root,
      "other-plan",
      "workflow.json",
      '{ "status": "active", "nextAction": "execute-plan" }\n',
    );

    const calls: Parameters<ProcessRunner>[0][] = [];
    const result = await runWorkflowRunner({
      argv: [".ai/plans/current-plan.md"],
      rootDir: workspace.root,
      processRunner: async (call) => {
        calls.push(call);
        if (call.command === "git" && call.args[0] === "status") {
          return { launched: true, stdout: "", stderr: "", exitCode: 0 };
        }
        if (call.command === "git" && call.args[0] === "rev-parse") {
          return {
            launched: true,
            stdout: "currenthead\n",
            stderr: "",
            exitCode: 0,
          };
        }
        if (call.promptPath === ".ai/prompts/execute-plan.md") {
          await writePlan(
            workspace.root,
            "current-plan",
            planWithFileScope(
              "blocked",
              "unblock-plan",
              { modified: ["apps/web/src/shared.ts"] },
              ownershipScopeSection(["apps/web/src/shared.ts"]),
            ),
          );
        }
        return { launched: true, stdout: "", stderr: "", exitCode: 0 };
      },
    });

    assert.equal(result.success, false);
    assert.match(result.reason, /plan blocked after execute-plan/);
    assert.equal(
      calls.some((call) => call.promptPath === ".ai/prompts/execute-plan.md"),
      true,
    );

    const artifact = JSON.parse(
      await readFile(
        join(
          workspace.root,
          ".ai",
          "artifacts",
          "current-plan",
          "state",
          "file-ownership.json",
        ),
        "utf8",
      ),
    );
    assert.deepEqual(artifact.resolvedFiles, ["apps/web/src/shared.ts"]);
  } finally {
    await workspace.cleanup();
  }
});

test("workflow runner ignores malformed ownership artifacts from another draft plan", async () => {
  const workspace = await setupWorkspace();
  try {
    await writePlan(
      workspace.root,
      "current-plan",
      planWithFileScope(
        "active",
        "execute-plan",
        {
          modified: ["apps/web/src/shared.ts"],
        },
        ownershipScopeSection(["apps/web/src/shared.ts"]),
      ),
    );
    await writePlan(
      workspace.root,
      "other-plan",
      planWith("draft", "sync-plan-artifacts"),
    );
    await writeArtifactStateFile(
      workspace.root,
      "other-plan",
      "file-ownership.json",
      '{ "tasks": [] }\n',
    );

    const calls: Parameters<ProcessRunner>[0][] = [];
    const result = await runWorkflowRunner({
      argv: [".ai/plans/current-plan.md"],
      rootDir: workspace.root,
      processRunner: async (call) => {
        calls.push(call);
        if (call.command === "git" && call.args[0] === "status") {
          return {
            launched: true,
            stdout: " M apps/web/src/shared.ts\n",
            stderr: "",
            exitCode: 0,
          };
        }
        if (call.command === "git" && call.args[0] === "rev-parse") {
          return {
            launched: true,
            stdout: "headsha\n",
            stderr: "",
            exitCode: 0,
          };
        }
        if (call.promptPath === ".ai/prompts/execute-plan.md") {
          await writePlan(
            workspace.root,
            "current-plan",
            planWithFileScope(
              "blocked",
              "unblock-plan",
              {
                modified: ["apps/web/src/shared.ts"],
              },
              ownershipScopeSection(["apps/web/src/shared.ts"]),
            ),
          );
        }
        return { launched: true, stdout: "", stderr: "", exitCode: 0 };
      },
    });

    assert.equal(result.success, false);
    assert.match(result.reason, /plan blocked after execute-plan/);
    assert.equal(
      calls.some((call) => call.command === CODEX_COMMAND),
      true,
    );
  } finally {
    await workspace.cleanup();
  }
});

test("workflow runner ignores malformed workflow state from another draft plan", async () => {
  const workspace = await setupWorkspace();
  try {
    await writePlan(
      workspace.root,
      "current-plan",
      planWithFileScope(
        "active",
        "execute-plan",
        {
          modified: ["apps/web/src/shared.ts"],
        },
        ownershipScopeSection(["apps/web/src/shared.ts"]),
      ),
    );
    await writePlan(
      workspace.root,
      "other-plan",
      planWith("draft", "sync-plan-artifacts"),
    );
    await writeFileOwnershipArtifact(workspace.root, "other-plan", {
      planPath: ".ai/plans/other-plan.md",
      owns: ["apps/web/src/shared.ts"],
      released: [],
      resolvedFiles: ["apps/web/src/shared.ts"],
      changedFiles: ["apps/web/src/shared.ts"],
      headSha: "otherhead",
      updatedAt: "2026-06-04T00:00:00.000Z",
    });
    await writeArtifactStateFile(
      workspace.root,
      "other-plan",
      "workflow.json",
      '{ "workflowState": "draft-artifact-sync" }\n',
    );

    const calls: Parameters<ProcessRunner>[0][] = [];
    const result = await runWorkflowRunner({
      argv: [".ai/plans/current-plan.md"],
      rootDir: workspace.root,
      processRunner: async (call) => {
        calls.push(call);
        if (call.command === "git" && call.args[0] === "status") {
          return {
            launched: true,
            stdout: " M apps/web/src/shared.ts\n",
            stderr: "",
            exitCode: 0,
          };
        }
        if (call.command === "git" && call.args[0] === "rev-parse") {
          return {
            launched: true,
            stdout: "headsha\n",
            stderr: "",
            exitCode: 0,
          };
        }
        if (call.promptPath === ".ai/prompts/execute-plan.md") {
          await writePlan(
            workspace.root,
            "current-plan",
            planWithFileScope(
              "blocked",
              "unblock-plan",
              {
                modified: ["apps/web/src/shared.ts"],
              },
              ownershipScopeSection(["apps/web/src/shared.ts"]),
            ),
          );
        }
        return { launched: true, stdout: "", stderr: "", exitCode: 0 };
      },
    });

    assert.equal(result.success, false);
    assert.match(result.reason, /plan blocked after execute-plan/);
    assert.equal(
      calls.some((call) => call.command === CODEX_COMMAND),
      true,
    );
  } finally {
    await workspace.cleanup();
  }
});

test("workflow runner ignores legacy ownership artifacts from other plans", async () => {
  const workspace = await setupWorkspace();
  try {
    await writePlan(
      workspace.root,
      "current-plan",
      planWithFileScope(
        "active",
        "execute-plan",
        {
          modified: ["apps/web/src/shared.ts"],
        },
        ownershipScopeSection(["apps/web/src/shared.ts"]),
      ),
    );
    await writeArtifactStateFile(
      workspace.root,
      "other-plan",
      "file-ownership.json",
      JSON.stringify(
        {
          planPath: ".ai/plans/other-plan.md",
          ownedFiles: ["apps/web/src/shared.ts"],
          releasedFiles: [],
        },
        null,
        2,
      ),
    );
    await writeArtifactStateFile(
      workspace.root,
      "other-plan",
      "workflow.json",
      JSON.stringify(
        {
          planPath: ".ai/plans/other-plan.md",
          workflowState: "draft-artifact-sync",
          latest: {},
          history: [],
          unresolvedBlockers: [],
          updatedAt: "2026-07-08T00:00:00.000Z",
        },
        null,
        2,
      ),
    );

    const calls: Parameters<ProcessRunner>[0][] = [];
    const result = await runWorkflowRunner({
      argv: [".ai/plans/current-plan.md"],
      rootDir: workspace.root,
      processRunner: async (call) => {
        calls.push(call);
        if (call.command === "git" && call.args[0] === "status") {
          return {
            launched: true,
            stdout: " M apps/web/src/shared.ts\n",
            stderr: "",
            exitCode: 0,
          };
        }
        if (call.command === "git" && call.args[0] === "rev-parse") {
          return {
            launched: true,
            stdout: "headsha\n",
            stderr: "",
            exitCode: 0,
          };
        }
        if (call.promptPath === ".ai/prompts/execute-plan.md") {
          await writePlan(
            workspace.root,
            "current-plan",
            planWithFileScope(
              "blocked",
              "unblock-plan",
              {
                modified: ["apps/web/src/shared.ts"],
              },
              ownershipScopeSection(["apps/web/src/shared.ts"]),
            ),
          );
        }
        return { launched: true, stdout: "", stderr: "", exitCode: 0 };
      },
    });

    assert.equal(result.success, false);
    assert.match(result.reason, /plan blocked after execute-plan/);
    assert.equal(
      calls.some((call) => call.command === CODEX_COMMAND),
      true,
    );

  } finally {
    await workspace.cleanup();
  }
});

test("workflow runner ignores malformed ownership artifacts from other plans", async () => {
  const workspace = await setupWorkspace();
  try {
    await writePlan(
      workspace.root,
      "current-plan",
      planWithFileScope(
        "active",
        "execute-plan",
        {
          modified: ["apps/web/src/shared.ts"],
        },
        ownershipScopeSection(["apps/web/src/shared.ts"]),
      ),
    );
    await writePlan(
      workspace.root,
      "other-plan",
      planWith("active", "execute-plan"),
    );
    await writeArtifactStateFile(
      workspace.root,
      "other-plan",
      "file-ownership.json",
      '{ "tasks": [] }\n',
    );

    const calls: Parameters<ProcessRunner>[0][] = [];
    const result = await runWorkflowRunner({
      argv: [".ai/plans/current-plan.md"],
      rootDir: workspace.root,
      processRunner: async (call) => {
        calls.push(call);
        if (call.command === "git" && call.args[0] === "status") {
          return {
            launched: true,
            stdout: " M apps/web/src/shared.ts\n",
            stderr: "",
            exitCode: 0,
          };
        }
        if (call.command === "git" && call.args[0] === "rev-parse") {
          return {
            launched: true,
            stdout: "headsha\n",
            stderr: "",
            exitCode: 0,
          };
        }
        if (call.promptPath === ".ai/prompts/execute-plan.md") {
          await writePlan(
            workspace.root,
            "current-plan",
            planWithFileScope(
              "blocked",
              "unblock-plan",
              { modified: ["apps/web/src/shared.ts"] },
              ownershipScopeSection(["apps/web/src/shared.ts"]),
            ),
          );
        }
        return { launched: true, stdout: "", stderr: "", exitCode: 0 };
      },
    });

    assert.equal(result.success, false);
    assert.match(result.reason, /plan blocked after execute-plan/);
    assert.equal(
      calls.some((call) => call.promptPath === ".ai/prompts/execute-plan.md"),
      true,
    );
  } finally {
    await workspace.cleanup();
  }
});

test("workflow runner resolves ownership globs to actual changed files for review staging", async () => {
  const workspace = await setupWorkspace();
  try {
    await writePlan(
      workspace.root,
      "glob-plan",
      planWithFileScope(
        "review",
        "review-plan",
        {
          modified: ["stale/files-list.ts"],
        },
        ownershipScopeSection([
          "apps/admin/src/features/admin-ugc-templates/**",
        ]),
      ),
    );

    const calls: Parameters<ProcessRunner>[0][] = [];
    const result = await runWorkflowRunner({
      argv: [".ai/plans/glob-plan.md"],
      rootDir: workspace.root,
      isIgnored: async () => false,
      processRunner: async (call) => {
        calls.push(call);
        if (call.promptPath === "git-review-staging-changed-paths") {
          return {
            launched: true,
            stdout: " M apps/admin/src/features/admin-ugc-templates/list.tsx\n",
            stderr: "",
            exitCode: 0,
          };
        }
        if (call.promptPath === "git-commit-summary-clean-check") {
          return { launched: true, stdout: "", stderr: "", exitCode: 0 };
        }
        if (
          call.command === "git" &&
          call.args[0] === "status" &&
          call.args[1] === "--short"
        ) {
          return {
            launched: true,
            stdout: [
              " M apps/admin/src/features/admin-ugc-templates/list.tsx",
              " M apps/web/src/features/dashboard/ignore.tsx",
            ].join("\n"),
            stderr: "",
            exitCode: 0,
          };
        }
        if (call.command === "git" && call.args[0] === "rev-parse") {
          return {
            launched: true,
            stdout: "headsha\n",
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
            planName: "glob-plan",
            kind: "review",
            version: 1,
          });
          await writePlan(
            workspace.root,
            "glob-plan",
            planWithFileScope(
              "completed",
              "commit-summary",
              {
                modified: [
                  "apps/admin/src/features/admin-ugc-templates/list.tsx",
                ],
              },
              ownershipScopeSection([
                "apps/admin/src/features/admin-ugc-templates/**",
              ]),
            ),
          );
        }
        return { launched: true, stdout: "summary", stderr: "", exitCode: 0 };
      },
    });

    assert.equal(result.success, true);
    const gitAddCall = calls.find(
      (call) => call.command === "git" && call.args[0] === "add",
    );
    assert.ok(gitAddCall);
    assert.deepEqual(gitAddCall.args, [
      "add",
      "--all",
      "--",
      "apps/admin/src/features/admin-ugc-templates/list.tsx",
    ]);

    const artifact = JSON.parse(
      await readFile(
        join(
          workspace.root,
          ".ai",
          "artifacts",
          "glob-plan",
          "state",
          "file-ownership.json",
        ),
        "utf8",
      ),
    );
    assert.deepEqual(artifact.resolvedFiles, [
      "apps/admin/src/features/admin-ugc-templates/list.tsx",
    ]);
    assert.deepEqual(artifact.changedFiles, [
      "apps/admin/src/features/admin-ugc-templates/list.tsx",
    ]);
  } finally {
    await workspace.cleanup();
  }
});

test("completed clean ownership artifacts do not block later plans", async () => {
  const workspace = await setupWorkspace();
  try {
    await writePlan(
      workspace.root,
      "current-plan",
      planWithFileScope(
        "active",
        "execute-plan",
        {
          modified: ["src/shared.ts"],
        },
        ownershipScopeSection(["src/shared.ts"]),
      ),
    );
    await writeFileOwnershipArtifact(workspace.root, "completed-plan", {
      planPath: ".ai/plans/completed-plan.md",
      workflowState: "completed",
      owns: ["src/shared.ts"],
      released: [],
      resolvedFiles: ["src/shared.ts"],
      changedFiles: [],
      headSha: "abc123",
      updatedAt: "2026-06-04T00:00:00.000Z",
    });

    const calls: Parameters<ProcessRunner>[0][] = [];
    const result = await runWorkflowRunner({
      argv: [".ai/plans/current-plan.md"],
      rootDir: workspace.root,
      processRunner: async (call) => {
        calls.push(call);
        if (call.command === "git" && call.args[0] === "status") {
          return { launched: true, stdout: "", stderr: "", exitCode: 0 };
        }
        if (call.command === "git" && call.args[0] === "rev-parse") {
          return {
            launched: true,
            stdout: "headsha\n",
            stderr: "",
            exitCode: 0,
          };
        }
        if (call.promptPath === ".ai/prompts/execute-plan.md") {
          await writePlan(
            workspace.root,
            "current-plan",
            planWithFileScope(
              "blocked",
              "unblock-plan",
              {
                modified: ["src/shared.ts"],
              },
              ownershipScopeSection(["src/shared.ts"]),
            ),
          );
        }
        return { launched: true, stdout: "", stderr: "", exitCode: 0 };
      },
    });

    assert.equal(result.success, false);
    assert.match(result.reason, /plan blocked after execute-plan/);
    assert.equal(
      calls.some((call) => call.promptPath === ".ai/prompts/execute-plan.md"),
      true,
    );
  } finally {
    await workspace.cleanup();
  }
});

test("thin-plan ownership preflight trusts terminal workflow state over stale ownership status", async () => {
  const workspace = await setupWorkspace();
  try {
    await writePlan(
      workspace.root,
      "artifact-state",
      thinPlanV2Manifest("approved", "execute-plan"),
    );
    await writeThinPlanV2Artifacts(workspace.root, {
      status: "approved",
      nextAction: "execute-plan",
      modified: ["src/shared.ts"],
      changedFiles: ["src/shared.ts"],
      owns: ["src/shared.ts"],
      latest: {
        validation: {
          version: 1,
          result: "APPROVED",
          summary: "Plan approved.",
          evidence: ".ai/artifacts/artifact-state/events/validation-v1.md",
        },
      },
      history: [".ai/artifacts/artifact-state/events/validation-v1.md"],
      activeBlockers: [],
    });
    await writeFileOwnershipArtifact(workspace.root, "completed-plan", {
      planPath: ".ai/plans/completed-plan.md",
      workflowState: "review",
      owns: ["src/shared.ts"],
      released: [],
      resolvedFiles: ["src/shared.ts"],
      changedFiles: ["src/shared.ts"],
      headSha: "abc123",
      updatedAt: "2026-06-04T00:00:00.000Z",
    });
    mkdirSync(
      join(workspace.root, ".ai", "artifacts", "completed-plan", "state"),
      { recursive: true },
    );
    await writeFile(
      join(
        workspace.root,
        ".ai",
        "artifacts",
        "completed-plan",
        "state",
        "workflow.json",
      ),
      `${JSON.stringify(
        {
          planPath: ".ai/plans/completed-plan.md",
          workflowState: "completed",
          latest: {},
          history: [],
          unresolvedBlockers: [],
          updatedAt: "2026-06-04T00:05:00.000Z",
        },
        null,
        2,
      )}\n`,
      "utf8",
    );

    const calls: Parameters<ProcessRunner>[0][] = [];
    const result = await runWorkflowRunner({
      argv: [".ai/plans/artifact-state.md"],
      rootDir: workspace.root,
      processRunner: async (call) => {
        calls.push(call);
        if (call.command === "git" && call.args[0] === "status") {
          return { launched: true, stdout: "", stderr: "", exitCode: 0 };
        }
        if (call.command === "git" && call.args[0] === "rev-parse") {
          return {
            launched: true,
            stdout: "headsha\n",
            stderr: "",
            exitCode: 0,
          };
        }
        if (call.promptPath === ".ai/prompts/execute-plan.md") {
          await writePlan(
            workspace.root,
            "artifact-state",
            thinPlanV2Manifest("blocked", "unblock-plan"),
          );
          await writeThinPlanV2Artifacts(workspace.root, {
            status: "blocked",
            nextAction: "unblock-plan",
            modified: ["src/shared.ts"],
            changedFiles: ["src/shared.ts"],
            owns: ["src/shared.ts"],
            activeBlockers: ["Blocker v1 | validation environment unavailable"],
          });
        }
        return { launched: true, stdout: "", stderr: "", exitCode: 0 };
      },
    });

    assert.equal(result.success, false);
    assert.match(result.reason, /plan blocked after execute-plan/);
    assert.equal(
      calls.some((call) => call.promptPath === ".ai/prompts/execute-plan.md"),
      true,
    );
  } finally {
    await workspace.cleanup();
  }
});

test("workflow runner ignores completed-plan ownership state", async () => {
  const workspace = await setupWorkspace();
  try {
    await writePlan(
      workspace.root,
      "current-plan",
      planWithFileScope(
        "active",
        "execute-plan",
        {
          modified: ["src/shared.ts"],
        },
        ownershipScopeSection(["src/shared.ts"]),
      ),
    );
    await writeFileOwnershipArtifact(workspace.root, "completed-plan", {
      planPath: ".ai/plans/completed-plan.md",
      workflowState: "completed",
      owns: ["src/shared.ts"],
      released: [],
      resolvedFiles: ["src/shared.ts"],
      changedFiles: [],
      headSha: "abc123",
      updatedAt: "2026-06-04T00:00:00.000Z",
    });

    const calls: Parameters<ProcessRunner>[0][] = [];
    const result = await runWorkflowRunner({
      argv: [".ai/plans/current-plan.md"],
      rootDir: workspace.root,
      processRunner: async (call) => {
        calls.push(call);
        if (call.command === "git" && call.args[0] === "status") {
          return {
            launched: true,
            stdout: " M src/shared.ts\n",
            stderr: "",
            exitCode: 0,
          };
        }
        if (call.command === "git" && call.args[0] === "rev-parse") {
          return {
            launched: true,
            stdout: "headsha\n",
            stderr: "",
            exitCode: 0,
          };
        }
        if (call.promptPath === ".ai/prompts/execute-plan.md") {
          await writePlan(
            workspace.root,
            "current-plan",
            planWithFileScope(
              "blocked",
              "unblock-plan",
              { modified: ["src/shared.ts"] },
              ownershipScopeSection(["src/shared.ts"]),
            ),
          );
        }
        return { launched: true, stdout: "", stderr: "", exitCode: 0 };
      },
    });

    assert.equal(result.success, false);
    assert.match(result.reason, /plan blocked after execute-plan/);
    assert.equal(
      calls.some((call) => call.promptPath === ".ai/prompts/execute-plan.md"),
      true,
    );
  } finally {
    await workspace.cleanup();
  }
});

test("released ownership artifact files do not block dependent plans", async () => {
  const workspace = await setupWorkspace();
  try {
    await writePlan(
      workspace.root,
      "current-plan",
      planWithFileScope(
        "active",
        "execute-plan",
        {
          modified: ["src/shared.ts"],
        },
        ownershipScopeSection(["src/shared.ts"]),
      ),
    );
    await writeFileOwnershipArtifact(workspace.root, "other-plan", {
      planPath: ".ai/plans/other-plan.md",
      workflowState: "active",
      owns: ["src/shared.ts"],
      released: ["src/shared.ts"],
      resolvedFiles: [],
      changedFiles: [],
      headSha: "abc123",
      updatedAt: "2026-06-04T00:00:00.000Z",
    });

    const calls: Parameters<ProcessRunner>[0][] = [];
    const result = await runWorkflowRunner({
      argv: [".ai/plans/current-plan.md"],
      rootDir: workspace.root,
      processRunner: async (call) => {
        calls.push(call);
        if (call.command === "git" && call.args[0] === "status") {
          return { launched: true, stdout: "", stderr: "", exitCode: 0 };
        }
        if (call.command === "git" && call.args[0] === "rev-parse") {
          return {
            launched: true,
            stdout: "headsha\n",
            stderr: "",
            exitCode: 0,
          };
        }
        if (call.promptPath === ".ai/prompts/execute-plan.md") {
          await writePlan(
            workspace.root,
            "current-plan",
            planWithFileScope(
              "blocked",
              "unblock-plan",
              {
                modified: ["src/shared.ts"],
              },
              ownershipScopeSection(["src/shared.ts"]),
            ),
          );
        }
        return { launched: true, stdout: "", stderr: "", exitCode: 0 };
      },
    });

    assert.equal(result.success, false);
    assert.match(result.reason, /plan blocked after execute-plan/);
    assert.equal(
      calls.some((call) => call.promptPath === ".ai/prompts/execute-plan.md"),
      true,
    );
  } finally {
    await workspace.cleanup();
  }
});

test(`removed compact CLI mode stops before ${CODEX_EXEC_LABEL}`, async () => {
  const workspace = await setupWorkspace();
  try {
    const processCalls: Parameters<ProcessRunner>[0][] = [];
    const processRunner: ProcessRunner = async (call) => {
      processCalls.push(call);
      return { launched: true, stdout: "", stderr: "", exitCode: 0 };
    };

    const compactFlag = await runWorkflowRunner({
      argv: ["--compact"],
      rootDir: workspace.root,
      processRunner,
    });
    assert.equal(compactFlag.success, false);
    assert.match(compactFlag.reason, /unknown workflow runner flag: --compact/);

    const compactWithPlan = await runWorkflowRunner({
      argv: ["--compact", "workflow-runner.md"],
      rootDir: workspace.root,
      processRunner,
    });
    assert.equal(compactWithPlan.success, false);
    assert.match(
      compactWithPlan.reason,
      /unknown workflow runner flag: --compact/,
    );

    const missingUnblockNote = await runWorkflowRunner({
      argv: [".ai/plans/workflow-runner.md", "--unblock-note"],
      rootDir: workspace.root,
      processRunner,
    });
    assert.equal(missingUnblockNote.success, false);
    assert.match(missingUnblockNote.reason, /--unblock-note requires a value/);

    const missingCodexProfile = await runWorkflowRunner({
      argv: [".ai/plans/workflow-runner.md", "--profile"],
      rootDir: workspace.root,
      processRunner,
    });
    assert.equal(missingCodexProfile.success, false);
    assert.match(missingCodexProfile.reason, /--profile requires a value/);

    const invalidCodexProfile = await runWorkflowRunner({
      argv: ["--profile", "../codex-personal", ".ai/plans/workflow-runner.md"],
      rootDir: workspace.root,
      processRunner,
    });
    assert.equal(invalidCodexProfile.success, false);
    assert.match(invalidCodexProfile.reason, /invalid --profile value/);

    assert.equal(processCalls.length, 0);
  } finally {
    await workspace.cleanup();
  }
});

test("workflow runner --help prints usage without launching Codex", async () => {
  const workspace = await setupWorkspace();
  try {
    const processCalls: Parameters<ProcessRunner>[0][] = [];
    const processRunner: ProcessRunner = async (call) => {
      processCalls.push(call);
      return { launched: true, stdout: "", stderr: "", exitCode: 0 };
    };
    const output: string[] = [];
    const errors: string[] = [];

    const result = await runWorkflowRunner({
      argv: ["--help"],
      rootDir: workspace.root,
      processRunner,
      console: {
        log: (message) => output.push(message),
        error: (message) => errors.push(message),
      },
    });

    assert.equal(result.success, true);
    assert.equal(result.exitCode, 0);
    assert.match(
      output.join("\n"),
      /Usage: pnpm exec tsx \.ai\/scripts\/workflow\/runner\.ts/,
    );
    assert.doesNotMatch(output.join("\n"), /--compact/);
    assert.deepEqual(errors, []);
    assert.equal(processCalls.length, 0);
  } finally {
    await workspace.cleanup();
  }
});

for (const branch of [
  "main",
  "master",
  "dev",
  "development",
  "staging",
  "feature/workflow",
  "HEAD",
]) {
  test(`workflow runner starts on ${branch === "HEAD" ? "detached HEAD" : branch}`, async () => {
    const workspace = await setupWorkspace();
    try {
      mkdirSync(join(workspace.root, ".git"), { recursive: true });
      mkdirSync(join(workspace.root, "src"), { recursive: true });
      await writeFile(
        join(workspace.root, "src", "artifact-state.ts"),
        "artifact state\n",
      );
      await writeThinPlanV2Artifacts(workspace.root, {
        status: "completed",
        nextAction: "commit-summary",
      });
      await writePlan(
        workspace.root,
        "artifact-state",
        thinPlanV2Manifest("completed", "commit-summary"),
      );
      const processCalls: Parameters<ProcessRunner>[0][] = [];
      const processRunner: ProcessRunner = async (call) => {
        processCalls.push(call);
        if (
          call.command === "git" &&
          call.args.join(" ") === "rev-parse --abbrev-ref HEAD"
        ) {
          return {
            launched: true,
            stdout: `${branch}\n`,
            stderr: "",
            exitCode: 0,
          };
        }
        return { launched: true, stdout: "", stderr: "", exitCode: 0 };
      };

      const result = await runWorkflowRunner({
        argv: [".ai/plans/artifact-state.md"],
        rootDir: workspace.root,
        processRunner,
        streamOutput: false,
      });

      assert.equal(result.success, true);
      assert.equal(
        processCalls.some((call) => call.command === CODEX_COMMAND),
        true,
      );
    } finally {
      await workspace.cleanup();
    }
  });
}

test("CLI failure output includes the stop reason and workflow log path", async () => {
  const workspace = await setupWorkspace();
  try {
    await writePlan(
      workspace.root,
      "workflow-runner",
      planWith("completed", "commit-summary"),
    );
    const { lines, console } = collectConsole();
    const result = await runWorkflowRunner({
      argv: [".ai/plans/workflow-runner.md"],
      rootDir: workspace.root,
      console,
      processRunner: runnerReturning({
        launched: true,
        stdout: codexAgentMessageLine(
          "STOP: spec must be updated before implementation",
        ),
        stderr: "",
        exitCode: 0,
      }),
    });

    assert.equal(result.success, false);
    assert.match(
      result.reason,
      /STOP: spec must be updated before implementation/,
    );
    assert.equal(
      lines.includes(
        `FAILED: ${CODEX_EXEC_LABEL} output contained STOP: spec must be updated before implementation`,
      ),
      true,
    );
    assert.equal(lines.includes("- Workflow log:"), true);
    assert.equal(
      lines.includes("  .ai/artifacts/workflow-runner/logs/runner.log"),
      true,
    );
    assert.equal(lines.includes("- Failure details:"), true);
    assert.equal(
      lines.includes("  .ai/artifacts/workflow-runner/logs/failure.jsonl#L1"),
      true,
    );
  } finally {
    await workspace.cleanup();
  }
});

test(`${CODEX_COMMAND} launch failures, nonzero exits, STOP output, and empty captures stop without retry`, async () => {
  const workspace = await setupWorkspace();
  try {
    const cases = [
      {
        name: "launch-failure",
        processResult: {
          launched: false as const,
          stdout: "",
          stderr: "spawn ENOENT",
          error: "spawn ENOENT",
        },
        reason: new RegExp(`could not launch ${CODEX_EXEC_LABEL}`),
        failureKind: "codex-launch",
        failureReason: new RegExp(
          `failureReason: could not launch ${CODEX_EXEC_LABEL}: spawn ENOENT`,
        ),
        nextSuggestedAction:
          /nextSuggestedAction: fix Codex launch environment, then rerun workflow-runner/,
      },
      {
        name: "nonzero",
        processResult: {
          launched: true as const,
          stdout: "",
          stderr: "bad",
          exitCode: 2,
        },
        reason: new RegExp(`${CODEX_EXEC_LABEL} exited with code 2`),
        failureKind: "codex-exit",
        failureReason: new RegExp(
          `failureReason: ${CODEX_EXEC_LABEL} exited with code 2`,
        ),
        nextSuggestedAction:
          /nextSuggestedAction: inspect workflow log, fix runtime failure, then rerun workflow-runner/,
      },
      {
        name: "stdout-stop",
        processResult: {
          launched: true as const,
          stdout: "STOP",
          stderr: "",
          exitCode: 0,
        },
        reason: new RegExp(`${CODEX_EXEC_LABEL} output contained STOP`),
        failureKind: "codex-stop",
        failureReason: /failureReason: STOP/,
        nextSuggestedAction:
          /nextSuggestedAction: inspect STOP reason, fix code or workflow evidence, then rerun workflow-runner/,
      },
      {
        name: "json-inline-code-stop",
        processResult: {
          launched: true as const,
          stdout: codexAgentMessageLine("`STOP`"),
          stderr: "",
          exitCode: 0,
        },
        reason: new RegExp(`${CODEX_EXEC_LABEL} output contained STOP`),
        failureKind: "codex-stop",
        failureReason: /failureReason: STOP/,
        nextSuggestedAction:
          /nextSuggestedAction: inspect STOP reason, fix code or workflow evidence, then rerun workflow-runner/,
      },
      {
        name: "stderr-stop",
        processResult: {
          launched: true as const,
          stdout: "",
          stderr: "STOP",
          exitCode: 0,
        },
        reason: new RegExp(`${CODEX_EXEC_LABEL} output contained STOP`),
        failureKind: "codex-stop",
        failureReason: /failureReason: STOP/,
        nextSuggestedAction:
          /nextSuggestedAction: inspect STOP reason, fix code or workflow evidence, then rerun workflow-runner/,
      },
      {
        name: "empty-captures",
        processResult: {
          launched: true as const,
          stdout: "",
          stderr: "",
          exitCode: 0,
        },
        reason: /plan content unchanged/,
        failureKind: "unchanged-plan",
        failureReason:
          /failureReason: plan content unchanged after successful nonterminal workflow action/,
        nextSuggestedAction:
          /nextSuggestedAction: inspect workflow output and update plan state, then rerun workflow-runner/,
      },
    ];
    for (const item of cases) {
      await writePlan(
        workspace.root,
        item.name,
        planWith("active", "execute-plan"),
      );
      let launches = 0;
      const result = await runWorkflowRunner({
        planName: planArg(item.name),
        rootDir: workspace.root,
        processRunner: runnerReturning(item.processResult, () => {
          launches += 1;
        }),
      });
      assert.equal(result.success, false, item.name);
      assert.match(result.reason, item.reason, item.name);
      assert.equal(launches, 1, item.name);
      const log = await readFile(
        join(
          workspace.root,
          ".ai",
          "artifacts",
          item.name,
          "logs",
          "runner.log",
        ),
        "utf8",
      );
      assert.match(log, /stdout:/);
      assert.match(log, /stderr:/);
      assertFailureMetadata(log, {
        kind: item.failureKind,
        reason: item.failureReason,
        nextSuggestedAction: item.nextSuggestedAction,
      });
      assert.match(
        log,
        new RegExp(
          String.raw`failureDebugPath: \.ai/artifacts/${item.name}/logs/failure\.jsonl#L1`,
        ),
      );
    }
  } finally {
    await workspace.cleanup();
  }
});

test("unblock-plan STOP that keeps the plan blocked reports a blocked outcome", async () => {
  const workspace = await setupWorkspace();
  try {
    await writePlan(
      workspace.root,
      "still-blocked",
      planWith(
        "blocked",
        "unblock-plan",
        "\n## Blockers\n\n### Blocker 1\n\n* Type: runtime setup\n* Description: Docker unavailable\n* Required Action: Start Docker.\n",
      ),
    );
    const { lines, console } = collectConsole();
    const result = await runWorkflowRunner({
      planName: planArg("still-blocked"),
      rootDir: workspace.root,
      console,
      processRunner: runnerReturning({
        launched: true,
        stdout: codexAgentMessageLine(
          "STOP\nBlocking reason: `blocker resolution evidence is required`\n\n**Summary**\n- STILL BLOCKED",
        ),
        stderr: "",
        exitCode: 0,
      }),
    });

    assert.equal(result.success, false);
    assert.match(result.reason, /plan remains blocked after unblock-plan/);
    assert.doesNotMatch(result.reason, /output contained STOP/);
    assert.equal(lines.includes("BLOCKED"), true);
    assert.equal(
      lines.some((line) => line.startsWith("FAILED:")),
      false,
    );
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

test("STOP failures write bounded debug sidecars while keeping the main log compact", async () => {
  const workspace = await setupWorkspace();
  try {
    await writePlan(
      workspace.root,
      "stop-sidecar",
      planWith("active", "execute-plan"),
    );
    const stopMessage = [
      "STOP: spec is incomplete for market research fallback behavior and needs a user decision.",
      "Do not guess the shape.",
    ].join("\n");
    const result = await runWorkflowRunner({
      planName: planArg("stop-sidecar"),
      rootDir: workspace.root,
      processRunner: runnerReturning({
        launched: true,
        stdout: [
          codexCommandStartedLine(
            'rtk rg -n "workflow-runner" .ai/scripts/workflow/runner.ts',
          ),
          codexCommandOutputLine(
            [
              "101: const oldVerboseLog = true",
              "102: aggregated_output should never hit the main log",
              "103: STOP breadcrumbs belong in the failure sidecar only",
              "104: raw stderr blobs are too expensive",
              "105: extra line that should be truncated from excerpts",
            ].join("\n"),
            'rtk rg -n "workflow-runner" .ai/scripts/workflow/runner.ts',
          ),
          codexAgentMessageLine(stopMessage),
        ].join("\n"),
        stderr: "",
        exitCode: 0,
      }),
    });

    assert.equal(result.success, false);
    const log = await readFile(
      join(
        workspace.root,
        ".ai",
        "artifacts",
        "stop-sidecar",
        "logs",
        "runner.log",
      ),
      "utf8",
    );
    assert.match(
      log,
      /failureDebugPath: \.ai\/artifacts\/stop-sidecar\/logs\/failure\.jsonl#L1/,
    );
    assert.doesNotMatch(log, /aggregated_output/);
    assert.doesNotMatch(log, /oldVerboseLog/);
    const debug = await readFailureDebugLedger(workspace.root, "stop-sidecar");
    assert.equal(debug.length, 1);
    assert.equal(debug[0]?.failureKind, "codex-stop");
    assert.match(String(debug[0]?.stopReason ?? ""), /spec is incomplete/);
    assert.match(String(debug[0]?.stopExcerpt ?? ""), /spec is incomplete/);
    assert.match(
      String(debug[0]?.lastAgentMessageExcerpt ?? ""),
      /Do not guess the shape/,
    );
    assert.equal(Array.isArray(debug[0]?.recentCommands), true);
    const recentCommands = debug[0]?.recentCommands as Array<
      Record<string, unknown>
    >;
    assert.equal(recentCommands.length, 1);
    assert.match(String(recentCommands[0]?.command ?? ""), /rtk rg -n/);
    assert.match(
      String(recentCommands[0]?.outputExcerpt ?? ""),
      /oldVerboseLog/,
    );
    assert.doesNotMatch(
      String(recentCommands[0]?.outputExcerpt ?? ""),
      /extra line that should be truncated/,
    );
  } finally {
    await workspace.cleanup();
  }
});

test("nonzero exits write command summaries and bounded stderr excerpts to the failure sidecar", async () => {
  const workspace = await setupWorkspace();
  try {
    await writePlan(
      workspace.root,
      "exit-sidecar",
      planWith("active", "execute-plan"),
    );
    const stderr = [
      "first failure line",
      "second failure line",
      "third failure line",
      "fourth failure line",
      "fifth failure line should be truncated",
    ].join("\n");
    const result = await runWorkflowRunner({
      planName: planArg("exit-sidecar"),
      rootDir: workspace.root,
      processRunner: runnerReturning({
        launched: true,
        stdout: [
          codexCommandStartedLine(JEST_FAILED_COMMAND),
          JSON.stringify({
            type: "item.completed",
            item: {
              id: "item_command",
              command: JEST_FAILED_COMMAND,
              type: "command_execution",
              aggregated_output: [
                "FAIL test/onboarding/document-content-generator.service.spec.ts",
                "  widens unmapped suffixless",
                "",
                "Expected: 2",
                "Received: 1",
                "extra line that should not survive the bounded excerpt",
              ].join("\n"),
              exit_code: 1,
              status: "completed",
            },
          }),
        ].join("\n"),
        stderr,
        exitCode: 2,
      }),
    });

    assert.equal(result.success, false);
    const debug = await readFailureDebugLedger(workspace.root, "exit-sidecar");
    assert.equal(debug.length, 1);
    assert.equal(debug[0]?.failureKind, "codex-exit");
    assert.match(String(debug[0]?.stderrExcerpt ?? ""), /first failure line/);
    assert.doesNotMatch(
      String(debug[0]?.stderrExcerpt ?? ""),
      /fifth failure line should be truncated/,
    );
    const recentCommands = debug[0]?.recentCommands as Array<
      Record<string, unknown>
    >;
    assert.equal(recentCommands.length, 1);
    assert.match(String(recentCommands[0]?.command ?? ""), /jest/);
    assert.equal(recentCommands[0]?.exitCode, 1);
    assert.match(String(recentCommands[0]?.outputExcerpt ?? ""), /Expected: 2/);
    assert.doesNotMatch(
      String(recentCommands[0]?.outputExcerpt ?? ""),
      /extra line that should not survive the bounded excerpt/,
    );
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

test("logs are append-only and include required iteration and review staging fields", async () => {
  const workspace = await setupWorkspace();
  try {
    await writePlan(
      workspace.root,
      "workflow-runner",
      planWith("review", "review-plan"),
    );
    mkdirSync(
      join(workspace.root, ".ai", "artifacts", "workflow-runner", "logs"),
      { recursive: true },
    );
    writeFileSync(
      join(
        workspace.root,
        ".ai",
        "artifacts",
        "workflow-runner",
        "logs",
        "runner.log",
      ),
      "existing\n",
    );
    const baseRunner = runnerReturning(
      { launched: true, stdout: "ok", stderr: "", exitCode: 0 },
      (call) => {
        if (call.command === CODEX_COMMAND) {
          writeFileSync(
            join(workspace.root, ".ai", "plans", "workflow-runner.md"),
            planWith("completed", "commit-summary"),
          );
        }
      },
    );
    await runWorkflowRunner({
      planName: planArg("workflow-runner"),
      rootDir: workspace.root,
      processRunner: async (call) => {
        if (call.promptPath === "git-review-staging-changed-paths") {
          return {
            launched: true,
            stdout: [
              " M .ai/scripts/workflow/runner/__tests__/integration/runner.test.ts",
              " M .ai/scripts/workflow/runner.ts",
            ].join("\n"),
            stderr: "",
            exitCode: 0,
          };
        }
        return baseRunner(call);
      },
    });
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
    assert.match(log, /^existing/);
    assert.match(log, /timestamp:/);
    assert.match(log, /iteration: 1/);
    assert.match(log, /planPath: .ai\/plans\/workflow-runner.md/);
    assert.match(log, /startingWorkflowState: review/);
    assert.match(log, /promptPath: .ai\/prompts\/review-changes.md/);
    assert.match(log, /result: launched/);
    assert.match(log, /exitCode: 0/);
    assert.match(log, /durationMs: \d+/);
    assert.match(log, /stdout: omitted 2 bytes, 1 lines/);
    assert.doesNotMatch(log, /stdout: ok/);
    assert.match(log, /stderr:/);
    assert.match(log, /reviewStagingCommand: git add --all --/);
    assert.match(log, /reviewStagingExitCode: 0/);
    assert.match(log, /reviewStagingStdout:/);
    assert.match(log, /reviewStagingStderr:/);
    assert.match(log, /contextWindowTokens: unavailable/);
    assert.match(log, /contextWindowUsedTokens: unavailable/);
    assert.match(log, /contextWindowUsedPercent: unavailable/);
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


test("commit-summary excludes transferred file ownership releases from commit boundary", async () => {
  const workspace = await setupWorkspace();
  try {
    await writePlan(
      workspace.root,
      "current-plan",
      planWithFileScope(
        "completed",
        "commit-summary",
        {
          modified: ["src/shared.ts", "src/owned.ts"],
        },
        ownershipReleaseSection("src/shared.ts", ".ai/plans/dependent-plan.md"),
      ),
    );
    const calls: Parameters<ProcessRunner>[0][] = [];
    const result = await runWorkflowRunner({
      argv: [".ai/plans/current-plan.md"],
      rootDir: workspace.root,
      processRunner: runnerReturning(
        { launched: true, stdout: "summary", stderr: "", exitCode: 0 },
        (call) => {
          calls.push(call);
        },
      ),
    });

    assert.equal(result.success, true);
    const codexCall = calls.find((call) => call.command === CODEX_COMMAND);
    assert.ok(codexCall);
    const prompt = codexCall.args.at(-1) ?? "";
    assert.match(prompt, /- src\/owned\.ts/);
    assert.doesNotMatch(prompt, /- src\/shared\.ts/);
    assert.match(prompt, /git add --all -- src\/owned\.ts/);
    assert.doesNotMatch(prompt, /git add --all -- src\/shared\.ts/);
  } finally {
    await workspace.cleanup();
  }
});



test(`review staging git add runs before review ${CODEX_COMMAND}, unstages plan-owned files, and stops on staging failure`, async () => {
  const workspace = await setupWorkspace();
  try {
    await writePlan(
      workspace.root,
      "workflow-runner",
      planWith("review", "review-plan"),
    );
    const calls: Parameters<ProcessRunner>[0][] = [];
    const output = collectConsole();
    const failed = await runWorkflowRunner({
      planName: planArg("workflow-runner"),
      rootDir: workspace.root,
      console: output.console,
      processRunner: async (call) => {
        calls.push(call);
        if (call.promptPath === "git-review-staging-changed-paths") {
          return {
            launched: true,
            stdout: [
              " M .ai/scripts/workflow/runner/__tests__/integration/runner.test.ts",
              " M .ai/scripts/workflow/runner.ts",
            ].join("\n"),
            stderr: "",
            exitCode: 0,
          };
        }
        if (call.command === "git" && call.args[0] === "add") {
          assert.equal(
            output.lines.some((line) =>
              /Staging 2 plan-owned files for review/i.test(line),
            ),
            true,
          );
          return { launched: true, stdout: "", stderr: "fatal", exitCode: 1 };
        }
        return { launched: true, stdout: "", stderr: "", exitCode: 0 };
      },
    });
    assert.equal(failed.success, false);
    assert.match(failed.reason, /review staging git add exited with code 1/);
    assert.match(failed.reason, /fatal/);
    assertCallSubsequence(calls, [
      ["git", "diff", "git-pre-review-staged-check"],
      ["git", "status", "git-review-staging-changed-paths"],
      ["git", "diff", "git-review-staging-staged-paths"],
      ["git", "add", "git-staging"],
    ]);
    const addCall = calls.find((call) => call.promptPath === "git-staging");
    assert.deepEqual(addCall?.args, [
      "add",
      "--all",
      "--",
      ".ai/scripts/workflow/runner/__tests__/integration/runner.test.ts",
      ".ai/scripts/workflow/runner.ts",
    ]);
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
    assert.match(log, /reviewStagingExitCode: 1/);
    assert.match(log, /reviewStagingStderr: omitted 5 bytes, 1 lines/);
    assert.doesNotMatch(log, /reviewStagingStderr: fatal/);
    assertFailureMetadata(log, {
      kind: "review-staging",
      reason: /failureReason: review staging git add exited with code 1: fatal/,
      nextSuggestedAction:
        /nextSuggestedAction: fix review staging paths or git error, then rerun workflow-runner/,
    });
  } finally {
    await workspace.cleanup();
  }
});

test("review-plan stops before staging or prompt execution when any staged files already exist", async () => {
  const workspace = await setupWorkspace();
  try {
    await writePlan(
      workspace.root,
      "review-guard",
      planWith("review", "review-plan"),
    );
    const calls: Parameters<ProcessRunner>[0][] = [];
    const output = collectConsole();
    const failed = await runWorkflowRunner({
      planName: planArg("review-guard"),
      rootDir: workspace.root,
      console: output.console,
      processRunner: async (call) => {
        calls.push(call);
        if (
          call.command === "git" &&
          call.args[0] === "diff" &&
          call.args[1] === "--staged" &&
          call.args[2] === "--name-status"
        ) {
          return {
            launched: true,
            stdout: ["M\tother-plan.ts", "A\tsrc/leftover.ts"].join("\n"),
            stderr: "",
            exitCode: 0,
          };
        }
        return { launched: true, stdout: "", stderr: "", exitCode: 0 };
      },
    });

    assert.equal(failed.success, false);
    assert.match(
      failed.reason,
      /review blocked before review-plan because staged files already exist; human may manually unstage them, then rerun workflow-runner so it owns review staging:\n\nM  other-plan\.ts;\nA  src\/leftover\.ts/,
    );
    assert.doesNotMatch(failed.reason, /other-plan\.ts; A\tsrc\/leftover\.ts/);
    assert.deepEqual(
      calls.map((call) => [call.command, call.args[0] ?? "", call.promptPath]),
      [["git", "diff", "git-pre-review-staged-check"]],
    );
    assert.equal(
      output.lines.some((line) =>
        /staged files already exist; human may manually unstage them, then rerun workflow-runner so it owns review staging:\n\nM  other-plan\.ts;\nA  src\/leftover\.ts/.test(
          line,
        ),
      ),
      true,
    );

    const log = await readFile(
      join(
        workspace.root,
        ".ai",
        "artifacts",
        "review-guard",
        "logs",
        "runner.log",
      ),
      "utf8",
    );
    assertFailureMetadata(log, {
      kind: "review-entry-staged-work",
      reason:
        /failureReason: review blocked before review-plan because staged files already exist; human may manually unstage them, then rerun workflow-runner so it owns review staging:\n\nM  other-plan\.ts;\nA  src\/leftover\.ts/,
      nextSuggestedAction:
        /nextSuggestedAction: human may manually unstage existing staged work before starting review-plan, then rerun workflow-runner/,
    });
  } finally {
    await workspace.cleanup();
  }
});

test("review-plan stages plan-owned files normally when the repo has no pre-existing staged work", async () => {
  const workspace = await setupWorkspace();
  try {
    await writePlan(
      workspace.root,
      "review-clean-entry",
      planWith("review", "review-plan"),
    );
    const calls: Parameters<ProcessRunner>[0][] = [];
    const result = await runWorkflowRunner({
      planName: planArg("review-clean-entry"),
      rootDir: workspace.root,
      processRunner: async (call) => {
        calls.push(call);
        if (
          call.command === "git" &&
          call.args[0] === "diff" &&
          call.args[1] === "--staged" &&
          call.args[2] === "--name-status"
        ) {
          return { launched: true, stdout: "", stderr: "", exitCode: 0 };
        }
        if (call.command === "git") {
          return { launched: true, stdout: "", stderr: "", exitCode: 0 };
        }
        if (call.promptPath === ".ai/prompts/review-changes.md") {
          writeWorkflowEventArtifactSync({
            root: workspace.root,
            planName: "review-clean-entry",
            kind: "review",
            version: 1,
          });
          await writePlan(
            workspace.root,
            "review-clean-entry",
            planWith("completed", "commit-summary"),
          );
        }
        return { launched: true, stdout: "summary", stderr: "", exitCode: 0 };
      },
    });

    assert.equal(result.success, true);
    assertCallSubsequence(calls, [
      ["git", "diff", "git-pre-review-staged-check"],
      ["git", "add", "git-staging"],
      ["git", "diff", "git-scope-cleanup-diff"],
      [CODEX_COMMAND, "exec", ".ai/prompts/review-changes.md"],
      [CODEX_COMMAND, "exec", ".ai/prompts/commit-summary.md"],
      ["git", "status", "git-commit-summary-clean-check"],
    ]);
  } finally {
    await workspace.cleanup();
  }
});

test("runner rejects split-review evidence", async () => {
  const workspace = await setupWorkspace();
  try {
    await writePlan(
      workspace.root,
      "review-split-history",
      planWith(
        "review",
        "review-plan",
        "\n## Review History\n\n### Review v1\n\n* Summary: SPEC PASS\n* Decision: review\n* Evidence: .ai/artifacts/review-split-history/events/review-spec-v1.md\n",
      ),
    );
    const calls: Parameters<ProcessRunner>[0][] = [];
    const result = await runWorkflowRunner({
      planName: planArg("review-split-history"),
      rootDir: workspace.root,
      processRunner: async (call) => {
        calls.push(call);
        return { launched: true, stdout: "", stderr: "", exitCode: 0 };
      },
    });

    assert.equal(result.success, false);
    assert.match(result.reason, /events\/review-v1\.md/i);
    assert.equal(
      calls.filter((call) => call.command === CODEX_COMMAND).length,
      0,
    );
  } finally {
    await workspace.cleanup();
  }
});

test("review staging auto-unstages unrelated hunks before review prompt runs", async () => {
  const workspace = await setupWorkspace();
  try {
    await writePlan(
      workspace.root,
      "review-scope-cleanup",
      planWithFileScope("review", "review-plan", {
        modified: ["src/file.ts"],
      }),
    );
    const calls: Parameters<ProcessRunner>[0][] = [];
    const result = await runWorkflowRunner({
      planName: planArg("review-scope-cleanup"),
      rootDir: workspace.root,
      processRunner: async (call) => {
        calls.push(call);
        if (call.promptPath === "git-review-staging-changed-paths") {
          return {
            launched: true,
            stdout: " M src/file.ts\n",
            stderr: "",
            exitCode: 0,
          };
        }
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
        if (call.promptPath === ".ai/prompts/scope-cleanup.md") {
          return {
            launched: true,
            stdout: codexAgentMessageLine(
              JSON.stringify({
                action: "unstage",
                patch: [
                  "diff --git a/src/file.ts b/src/file.ts",
                  "index 1111111..2222222 100644",
                  "--- a/src/file.ts",
                  "+++ b/src/file.ts",
                  "@@ -10,0 +11,2 @@",
                  '+const unrelated = "remove";',
                  "+const note = true;",
                ].join("\\n"),
              }),
            ),
            stderr: "",
            exitCode: 0,
          };
        }
        if (call.promptPath === ".ai/prompts/review-changes.md") {
          writeWorkflowEventArtifactSync({
            root: workspace.root,
            planName: "review-scope-cleanup",
            kind: "review",
            version: 1,
          });
          await writePlan(
            workspace.root,
            "review-scope-cleanup",
            planWithFileScope("completed", "commit-summary", {
              modified: ["src/file.ts"],
            }),
          );
        }
        return { launched: true, stdout: "summary", stderr: "", exitCode: 0 };
      },
    });

    assert.equal(result.success, true);
    assertCallSubsequence(calls, [
      ["git", "diff", "git-pre-review-staged-check"],
      ["git", "add", "git-staging"],
      ["git", "diff", "git-scope-cleanup-diff"],
      [CODEX_COMMAND, "exec", ".ai/prompts/scope-cleanup.md"],
      ["git", "apply", "git-scope-cleanup-unstage"],
      [CODEX_COMMAND, "exec", ".ai/prompts/review-changes.md"],
      [CODEX_COMMAND, "exec", ".ai/prompts/commit-summary.md"],
      ["git", "status", "git-commit-summary-clean-check"],
    ]);
    const applyCall = calls.find(
      (call) => call.promptPath === "git-scope-cleanup-unstage",
    );
    assert.equal(
      applyCall?.input.includes('const unrelated = "remove";'),
      true,
    );
  } finally {
    await workspace.cleanup();
  }
});

test("review scope cleanup receives prior non-plan-scoped STOP evidence", async () => {
  const workspace = await setupWorkspace();
  try {
    await writePlan(
      workspace.root,
      "review-scope-cleanup-retry",
      planWithFileScope("review", "review-plan", {
        modified: ["e2e/support-issue-widget.spec.ts"],
      }),
    );
    const failureLogDir = join(
      workspace.root,
      ".ai",
      "artifacts",
      "review-scope-cleanup-retry",
      "logs",
    );
    mkdirSync(failureLogDir, { recursive: true });
    writeFileSync(
      join(failureLogDir, "failure.jsonl"),
      `${JSON.stringify({
        timestamp: "2026-07-07T04:09:32.718Z",
        failureKind: "codex-stop",
        failureReason: "STOP",
        promptPath: ".ai/prompts/review-changes.md",
        lastAgentMessageExcerpt:
          "STOP: non plan-scoped changes detected. Path-scoped staged diff includes unrelated e2e hunks: dynamic Supabase env/auth storage setup, 2FA route mock, and /login heading change.",
      })}\n`,
    );

    const calls: Parameters<ProcessRunner>[0][] = [];
    const result = await runWorkflowRunner({
      planName: planArg("review-scope-cleanup-retry"),
      rootDir: workspace.root,
      processRunner: async (call) => {
        calls.push(call);
        if (call.command === "git" && call.args[0] === "diff") {
          return {
            launched: true,
            stdout: [
              "diff --git a/e2e/support-issue-widget.spec.ts b/e2e/support-issue-widget.spec.ts",
              "index 1111111..2222222 100644",
              "--- a/e2e/support-issue-widget.spec.ts",
              "+++ b/e2e/support-issue-widget.spec.ts",
              "@@ -1,0 +2,1 @@",
              '+const localSupabaseUrl = ".env.local";',
            ].join("\n"),
            stderr: "",
            exitCode: 0,
          };
        }
        if (call.command === "git") {
          return { launched: true, stdout: "", stderr: "", exitCode: 0 };
        }
        if (call.promptPath === ".ai/prompts/scope-cleanup.md") {
          return {
            launched: true,
            stdout: codexAgentMessageLine(JSON.stringify({ action: "keep" })),
            stderr: "",
            exitCode: 0,
          };
        }
        if (call.promptPath === ".ai/prompts/review-changes.md") {
          writeWorkflowEventArtifactSync({
            root: workspace.root,
            planName: "review-scope-cleanup-retry",
            kind: "review",
            version: 1,
          });
          await writePlan(
            workspace.root,
            "review-scope-cleanup-retry",
            planWithFileScope("completed", "commit-summary", {
              modified: ["e2e/support-issue-widget.spec.ts"],
            }),
          );
        }
        return { launched: true, stdout: "summary", stderr: "", exitCode: 0 };
      },
    });

    assert.equal(result.success, true);
    const cleanupCall = calls.find(
      (call) => call.promptPath === ".ai/prompts/scope-cleanup.md",
    );
    assert.match(
      cleanupCall?.args.join("\n") ?? "",
      /Previous non-plan-scoped review STOP evidence:/,
    );
    assert.match(cleanupCall?.args.join("\n") ?? "", /dynamic Supabase env/);
    assert.match(cleanupCall?.args.join("\n") ?? "", /2FA route mock/);
  } finally {
    await workspace.cleanup();
  }
});

test("review scope cleanup ignores prior non-plan-scoped STOP evidence after newer execution evidence", async () => {
  const workspace = await setupWorkspace();
  const planName = "review-scope-cleanup-after-execution";
  try {
    await writePlan(
      workspace.root,
      planName,
      planWithFileScope("review", "review-plan", {
        modified: ["e2e/support-issue-widget.spec.ts"],
      }),
    );
    const failureLogDir = join(
      workspace.root,
      ".ai",
      "artifacts",
      planName,
      "logs",
    );
    mkdirSync(failureLogDir, { recursive: true });
    writeFileSync(
      join(failureLogDir, "failure.jsonl"),
      `${JSON.stringify({
        timestamp: "2000-01-01T00:00:00.000Z",
        failureKind: "codex-stop",
        failureReason: "non plan-scoped changes detected.",
        promptPath: ".ai/prompts/review-changes.md",
        lastAgentMessageExcerpt:
          "STOP: non plan-scoped changes detected. Path-scoped staged diff includes unrelated e2e hunks: dynamic Supabase env/auth storage setup, 2FA route mock, and /login heading change.",
      })}\n`,
    );
    writeWorkflowEventArtifactSync({
      root: workspace.root,
      planName,
      kind: "execution",
      version: 1,
    });
    await writeArtifactStateFile(
      workspace.root,
      planName,
      "workflow.json",
      `${JSON.stringify(
        {
          planPath: `.ai/plans/${planName}.md`,
          status: "review",
          nextAction: "review-plan",
          latest: {
            execution: {
              version: 1,
              result: "PASS",
              summary: "Execution remediated the prior review STOP.",
              evidence: `.ai/artifacts/${planName}/events/execution-v1.md`,
            },
          },
          history: [`.ai/artifacts/${planName}/events/execution-v1.md`],
          unresolvedBlockers: [],
          updatedAt: "2026-07-07T00:00:00.000Z",
        },
        null,
        2,
      )}\n`,
    );

    const calls: Parameters<ProcessRunner>[0][] = [];
    const result = await runWorkflowRunner({
      planName: planArg(planName),
      rootDir: workspace.root,
      processRunner: async (call) => {
        calls.push(call);
        if (call.command === "git" && call.args[0] === "diff") {
          return {
            launched: true,
            stdout: [
              "diff --git a/e2e/support-issue-widget.spec.ts b/e2e/support-issue-widget.spec.ts",
              "index 1111111..2222222 100644",
              "--- a/e2e/support-issue-widget.spec.ts",
              "+++ b/e2e/support-issue-widget.spec.ts",
              "@@ -1,0 +2,1 @@",
              '+const supportIssueWidget = "scoped";',
            ].join("\n"),
            stderr: "",
            exitCode: 0,
          };
        }
        if (call.command === "git") {
          return { launched: true, stdout: "", stderr: "", exitCode: 0 };
        }
        if (call.promptPath === ".ai/prompts/scope-cleanup.md") {
          return {
            launched: true,
            stdout: codexAgentMessageLine(JSON.stringify({ action: "keep" })),
            stderr: "",
            exitCode: 0,
          };
        }
        if (call.promptPath === ".ai/prompts/review-changes.md") {
          writeWorkflowEventArtifactSync({
            root: workspace.root,
            planName,
            kind: "review",
            version: 1,
          });
          await writePlan(
            workspace.root,
            planName,
            planWithFileScope("completed", "commit-summary", {
              modified: ["e2e/support-issue-widget.spec.ts"],
            }),
          );
        }
        return { launched: true, stdout: "summary", stderr: "", exitCode: 0 };
      },
    });

    assert.equal(result.success, true);
    const cleanupCall = calls.find(
      (call) => call.promptPath === ".ai/prompts/scope-cleanup.md",
    );
    assert.ok(cleanupCall);
    const cleanupPrompt = cleanupCall.args.join("\n");
    assert.doesNotMatch(
      cleanupPrompt,
      /Previous non-plan-scoped review STOP evidence:/,
    );
    assert.doesNotMatch(cleanupPrompt, /dynamic Supabase env/);
  } finally {
    await workspace.cleanup();
  }
});

test("review-plan does not require hunk ownership before review", async () => {
  const workspace = await setupWorkspace();
  try {
    await writePlan(
      workspace.root,
      "review-shared-hunk-scope",
      planWithFileScope(
        "review",
        "review-plan",
        {
          modified: ["schema/openapi.generated.json"],
        },
        `## Hunk Ownership

### schema/openapi.generated.json

* Owned: generated \`users\` endpoint entries produced by the current plan.
* Excluded: generated \`billing\` endpoint entries owned by billing API work.
`,
      ),
    );
    const diff = [
      "diff --git a/schema/openapi.generated.json b/schema/openapi.generated.json",
      "index 1111111..2222222 100644",
      "--- a/schema/openapi.generated.json",
      "+++ b/schema/openapi.generated.json",
      '@@ -42,6 +42,9 @@ "paths": {',
      '   "/users": {',
      '     "get": { "operationId": "listUsers" }',
      "   },",
      '+  "/reports": {',
      '+    "get": { "operationId": "listReports" }',
      "+  },",
    ].join("\n");
    const calls: Parameters<ProcessRunner>[0][] = [];
    const result = await runWorkflowRunner({
      planName: planArg("review-shared-hunk-scope"),
      rootDir: workspace.root,
      processRunner: async (call) => {
        calls.push(call);
        if (
          call.command === "git" &&
          call.args[0] === "diff" &&
          call.args[1] === "--staged" &&
          call.args[2] === "--name-status"
        ) {
          return { launched: true, stdout: "", stderr: "", exitCode: 0 };
        }
        if (call.command === "git" && call.args[0] === "diff") {
          return { launched: true, stdout: diff, stderr: "", exitCode: 0 };
        }
        if (call.command === "git") {
          return { launched: true, stdout: "", stderr: "", exitCode: 0 };
        }
        if (call.promptPath === ".ai/prompts/scope-cleanup.md") {
          return {
            launched: true,
            stdout: codexAgentMessageLine(JSON.stringify({ action: "keep" })),
            stderr: "",
            exitCode: 0,
          };
        }
        if (call.promptPath === ".ai/prompts/review-changes.md") {
          writeWorkflowEventArtifactSync({
            root: workspace.root,
            planName: "review-shared-hunk-scope",
            kind: "review",
            version: 1,
          });
          await writePlan(
            workspace.root,
            "review-shared-hunk-scope",
            planWithFileScope("completed", "commit-summary", {
              modified: ["schema/openapi.generated.json"],
            }),
          );
        }
        return { launched: true, stdout: "summary", stderr: "", exitCode: 0 };
      },
    });

    assert.equal(result.success, true);
    assert.equal(
      calls.some((call) => call.promptPath === ".ai/prompts/review-changes.md"),
      true,
    );
    assert.equal(
      calls.some(
        (call) =>
          call.command === "git" &&
          call.promptPath === "git-review-hunk-ownership-diff",
      ),
      false,
    );
  } finally {
    await workspace.cleanup();
  }
});

test(`review ${CODEX_COMMAND} failure after staging unstages plan-owned files before exiting`, async () => {
  const workspace = await setupWorkspace();
  try {
    await writePlan(
      workspace.root,
      "review-stop",
      planWith("review", "review-plan"),
    );
    const calls: Parameters<ProcessRunner>[0][] = [];
    const failed = await runWorkflowRunner({
      planName: planArg("review-stop"),
      rootDir: workspace.root,
      processRunner: async (call) => {
        calls.push(call);
        if (call.command === "git") {
          return { launched: true, stdout: "", stderr: "", exitCode: 0 };
        }
        return {
          launched: true,
          stdout: "STOP: review requires manual fix",
          stderr: "",
          exitCode: 0,
        };
      },
    });

    assert.equal(failed.success, false);
    assert.match(
      failed.reason,
      /output contained STOP: review requires manual fix/,
    );
    assertCallSubsequence(calls, [
      ["git", "diff", "git-pre-review-staged-check"],
      ["git", "add", "git-staging"],
      [CODEX_COMMAND, "exec", ".ai/prompts/review-changes.md"],
      ["git", "reset", "git-review-unstage"],
    ]);
    const unstageCall = calls.find(
      (call) => call.promptPath === "git-review-unstage",
    );
    assert.deepEqual(unstageCall?.args, [
      "reset",
      "--quiet",
      "--",
      ".ai/scripts/workflow/runner/__tests__/integration/runner.test.ts",
      ".ai/scripts/workflow/runner.ts",
    ]);
  } finally {
    await workspace.cleanup();
  }
});

test("review cleanup failures write staging and cleanup command evidence to the failure sidecar", async () => {
  const workspace = await setupWorkspace();
  try {
    await writePlan(
      workspace.root,
      "review-cleanup-failure",
      planWith("review", "review-plan"),
    );
    const result = await runWorkflowRunner({
      planName: planArg("review-cleanup-failure"),
      rootDir: workspace.root,
      processRunner: async (call) => {
        if (call.promptPath === "git-review-staging-changed-paths") {
          return {
            launched: true,
            stdout: [
              " M .ai/scripts/workflow/runner/__tests__/integration/runner.test.ts",
              " M .ai/scripts/workflow/runner.ts",
            ].join("\n"),
            stderr: "",
            exitCode: 0,
          };
        }
        if (call.command === "git" && call.args[0] === "status") {
          return { launched: true, stdout: "", stderr: "", exitCode: 0 };
        }
        if (call.command === "git" && call.args[0] === "add") {
          return { launched: true, stdout: "staged", stderr: "", exitCode: 0 };
        }
        if (call.command === "git" && call.args[0] === "diff") {
          if (call.promptPath === "git-review-unstage-staged-paths") {
            return {
              launched: true,
              stdout: [
                ".ai/scripts/workflow/runner/__tests__/integration/runner.test.ts",
                ".ai/scripts/workflow/runner.ts",
              ].join("\n"),
              stderr: "",
              exitCode: 0,
            };
          }
          return { launched: true, stdout: "", stderr: "", exitCode: 0 };
        }
        if (call.command === "git" && call.args[0] === "reset") {
          return {
            launched: true,
            stdout: "",
            stderr: [
              "cleanup failed line 1",
              "cleanup failed line 2",
              "cleanup failed line 3",
              "cleanup failed line 4",
              "cleanup failed line 5 should be truncated",
            ].join("\n"),
            exitCode: 1,
          };
        }
        return {
          launched: true,
          stdout: codexAgentMessageLine("STOP: manual review fix required"),
          stderr: "",
          exitCode: 0,
        };
      },
    });

    assert.equal(result.success, false);
    const log = await readFile(
      join(
        workspace.root,
        ".ai",
        "artifacts",
        "review-cleanup-failure",
        "logs",
        "runner.log",
      ),
      "utf8",
    );
    assert.match(
      log,
      /failureDebugPath: \.ai\/artifacts\/review-cleanup-failure\/logs\/failure\.jsonl#L1/,
    );
    const debug = await readFailureDebugLedger(
      workspace.root,
      "review-cleanup-failure",
    );
    assert.equal(debug.length, 1);
    assert.equal(debug[0]?.failureKind, "codex-stop");
    const recentCommands = debug[0]?.recentCommands as Array<
      Record<string, unknown>
    >;
    assert.equal(recentCommands.length >= 2, true);
    assert.match(String(recentCommands[0]?.command ?? ""), /git add --all --/);
    assert.match(
      String(recentCommands[1]?.command ?? ""),
      /git reset --quiet --/,
    );
    assert.match(
      String(recentCommands[1]?.stderrExcerpt ?? ""),
      /cleanup failed line 1/,
    );
    assert.doesNotMatch(
      String(recentCommands[1]?.stderrExcerpt ?? ""),
      /cleanup failed line 5 should be truncated/,
    );
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
