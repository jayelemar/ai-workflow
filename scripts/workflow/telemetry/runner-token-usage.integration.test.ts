import test from "node:test";

import { runWorkflowRunner } from "../runner/runtime.ts";

import {
  CODEX_COMMAND,
  setupWorkspace,
  writePlan,
  tokenCountLine,
  turnCompletedUsageDetailLine,
  planArg,
  readTokenUsageLedger,
  collectConsole,
  runnerReturning,
  analyzeTokenUsageLedger,
  assert,
  join,
  mkdirSync,
  readFile,
  workflowContextSnapshotRelativePath,
  writeFileSync,
  writeWorkflowEventArtifactSync,
  planWith,
  type ProcessRunner,
} from "../runner/__tests__/helpers/runner-runtime.ts";

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
