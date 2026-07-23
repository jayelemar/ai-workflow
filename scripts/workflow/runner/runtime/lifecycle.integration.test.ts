import test from "node:test";

import { runWorkflowRunner } from "../runtime.ts";

import {
  CODEX_COMMAND,
  CODEX_EXEC_LABEL,
  setupWorkspace,
  writePlan,
  turnCompletedUsageDetailLine,
  planArg,
  readFailureDebugLedger,
  assertFailureMetadata,
  collectConsole,
  runnerReturning,
  codexAgentMessageLine,
  codexCommandOutputLine,
  codexCommandStartedLine,
  JEST_FAILED_COMMAND,
  assert,
  existsSync,
  join,
  mkdirSync,
  readFile,
  writeFile,
  writeFileSync,
  writeWorkflowEventArtifact,
  planWith,
  type ProcessRunner,
} from "../__tests__/helpers/runner-runtime.ts";

test("runner rejects legacy inline thin-plan history", async () => {
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
    const result = await runWorkflowRunner({
      planName: planArg("oversized-thin-history"),
      rootDir: workspace.root,
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

    assert.equal(result.success, false);
    assert.match(result.reason, /thin-plan contains forbidden inline section Validation History/i);
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
      planWith("active", "execute-plan"),
    );

    const output = collectConsole();
    let launches = 0;
    const result = await runWorkflowRunner({
      planName: planArg("blocked"),
      rootDir: workspace.root,
      console: output.console,
      processRunner: async (call) => {
        if (call.command === "git") {
          return { launched: true, stdout: "", stderr: "", exitCode: 0 };
        }
        launches += 1;
        await writeWorkflowEventArtifact({
          root: workspace.root,
          planName: "blocked",
          kind: "execution",
          version: 1,
          outcome: "blocked",
          summary: "spec must be updated before plan can be fixed",
          evidence: "The current spec conflicts with the plan.",
          remediation: ["spec must be updated before plan can be fixed"],
        });
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

test("execution STOP for an undeclared task prerequisite becomes a resumable blocked handoff", async () => {
  const workspace = await setupWorkspace();
  try {
    await writePlan(
      workspace.root,
      "task-boundary-prerequisite",
      planWith("active", "execute-plan"),
    );

    const output = collectConsole();
    const result = await runWorkflowRunner({
      planName: planArg("task-boundary-prerequisite"),
      rootDir: workspace.root,
      console: output.console,
      processRunner: async (call) => {
        if (call.command === "git") {
          return { launched: true, stdout: "", stderr: "", exitCode: 0 };
        }
        return {
          launched: true,
          stdout: codexAgentMessageLine(
            "STOP: the task cannot become review-ready inside its declared file boundary because it requires a downstream database-owned migration and generated contract outside the current task files.",
          ),
          stderr: "",
          exitCode: 0,
        };
      },
    });

    assert.equal(result.success, false);
    assert.equal(
      result.reason,
      "plan blocked after execute-plan: Current task needs a separate prerequisite outside its declared Files boundary",
    );
    assert.equal(output.lines.includes("BLOCKED"), true);
    assert.equal(output.lines.some((line) => line.startsWith("FAILED:")), false);

    const event = await readFile(
      join(
        workspace.root,
        ".ai",
        "artifacts",
        "task-boundary-prerequisite",
        "events",
        "execution-v1.md",
      ),
      "utf8",
    );
    assert.match(event, /## Outcome\s+blocked/);
    assert.match(event, /separate plan or savepoint/i);

    const workflow = JSON.parse(
      await readFile(
        join(
          workspace.root,
          ".ai",
          "artifacts",
          "task-boundary-prerequisite",
          "state",
          "workflow.json",
        ),
        "utf8",
      ),
    ) as { workflowState: string; unresolvedBlockers: string[] };
    assert.equal(workflow.workflowState, "blocked");
    assert.deepEqual(workflow.unresolvedBlockers, [
      "Complete the required prerequisite in a separate plan or savepoint that owns its files, then rerun this plan.",
    ]);
  } finally {
    await workspace.cleanup();
  }
});

test("unblock stages that exit without their reserved event become resumable blocked handoffs", async () => {
  const workspace = await setupWorkspace();
  try {
    await writePlan(
      workspace.root,
      "unblock-missing-event",
      planWith("blocked", "unblock-plan"),
    );

    const output = collectConsole();
    const result = await runWorkflowRunner({
      planName: planArg("unblock-missing-event"),
      rootDir: workspace.root,
      console: output.console,
      processRunner: async (call) => {
        if (call.command === "git") {
          return { launched: true, stdout: "", stderr: "", exitCode: 0 };
        }
        return { launched: true, stdout: "", stderr: "", exitCode: 0 };
      },
    });

    assert.equal(result.success, false);
    assert.equal(
      result.reason,
      "plan blocked after unblock-plan: The unblock stage ended without writing its reserved event",
    );
    assert.equal(output.lines.includes("BLOCKED"), true);
    assert.equal(output.lines.some((line) => line.startsWith("FAILED:")), false);

    const event = await readFile(
      join(
        workspace.root,
        ".ai",
        "artifacts",
        "unblock-missing-event",
        "events",
        "unblock-v1.md",
      ),
      "utf8",
    );
    assert.match(event, /## Outcome\s+blocked/);
    assert.match(event, /without writing its reserved event/i);

    const workflow = JSON.parse(
      await readFile(
        join(
          workspace.root,
          ".ai",
          "artifacts",
          "unblock-missing-event",
          "state",
          "workflow.json",
        ),
        "utf8",
      ),
    ) as { workflowState: string; unresolvedBlockers: string[] };
    assert.equal(workflow.workflowState, "blocked");
    assert.deepEqual(workflow.unresolvedBlockers, [
      "Repair the stage-agent environment or event write failure, then rerun this plan with the existing unblock evidence.",
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
      processRunner: async (call) => {
        if (call.command === "git") {
          return { launched: true, stdout: "", stderr: "", exitCode: 0 };
        }
        await writeWorkflowEventArtifact({
          root: workspace.root,
          planName: "browser-blocked",
          kind: "execution",
          version: 1,
          outcome: "blocked",
          summary: "Mandatory browser validation cannot be performed because no authenticated dashboard session is available.",
          evidence: "Authenticated dashboard session was unavailable.",
          remediation: ["Mandatory browser validation cannot be performed because no authenticated dashboard session is available."],
        });
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

test("full .ai/plans path invocation writes to the normalized plan log", async () => {
  const workspace = await setupWorkspace();
  try {
    await writePlan(
      workspace.root,
      "workflow-runner",
      planWith("completed", "commit-summary", "* Files: src/artifact-state.ts"),
    );
    mkdirSync(join(workspace.root, "src"), { recursive: true });
    writeFileSync(join(workspace.root, "src", "artifact-state.ts"), "export {};\n");
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
      planWith("completed", "commit-summary", "* Files: src/artifact-state.ts"),
    );
    mkdirSync(join(workspace.root, "src"), { recursive: true });
    writeFileSync(join(workspace.root, "src", "artifact-state.ts"), "export {};\n");
    const calls: Parameters<ProcessRunner>[0][] = [];
    const result = await runWorkflowRunner({
      argv: [".ai/plans/workflow-runner.md"],
      rootDir: workspace.root,
      isIgnored: async () => true,
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

test("CLI failure output includes the stop reason and workflow log path", async () => {
  const workspace = await setupWorkspace();
  try {
    await writePlan(
      workspace.root,
      "workflow-runner",
      planWith("completed", "commit-summary", "* Files: src/artifact-state.ts"),
    );
    mkdirSync(join(workspace.root, "src"), { recursive: true });
    writeFileSync(join(workspace.root, "src", "artifact-state.ts"), "export {};\n");
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

test(`${CODEX_COMMAND} launch failures, nonzero exits, and STOP output stop without retry`, async () => {
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

test("active execution progress is finalized even when the plan manifest is unchanged", async () => {
  const workspace = await setupWorkspace();
  try {
    await writePlan(
      workspace.root,
      "active-progress",
      planWith("active", "execute-plan"),
    );
    const manifestPath = join(
      workspace.root,
      ".ai",
      "plans",
      "active-progress.md",
    );
    await writeFile(
      manifestPath,
      (await readFile(manifestPath, "utf8")).replace(/\n{3,}/g, "\n\n"),
      "utf8",
    );
    const manifestBefore = await readFile(manifestPath, "utf8");
    let launches = 0;

    const result = await runWorkflowRunner({
      planName: planArg("active-progress"),
      rootDir: workspace.root,
      processRunner: async (call) => {
        if (call.command === "git") {
          return { launched: true, stdout: "", stderr: "", exitCode: 0 };
        }
        launches += 1;
        if (launches === 1) {
          await writeWorkflowEventArtifact({
            root: workspace.root,
            planName: "active-progress",
            kind: "execution",
            version: 1,
            outcome: "active",
            summary: "Implementation remains in progress.",
            evidence: "Focused validation is pending.",
          });
          return { launched: true, stdout: "", stderr: "", exitCode: 0 };
        }
        return { launched: true, stdout: "STOP", stderr: "", exitCode: 0 };
      },
    });

    assert.equal(launches, 2);
    assert.match(result.reason, new RegExp(`${CODEX_EXEC_LABEL} output contained STOP`));
    assert.equal(await readFile(manifestPath, "utf8"), manifestBefore);
    const workflow = JSON.parse(await readFile(
      join(
        workspace.root,
        ".ai",
        "artifacts",
        "active-progress",
        "state",
        "workflow.json",
      ),
      "utf8",
    ));
    assert.equal(workflow.workflowState, "active");
    assert.deepEqual(workflow.latest.execution, {
      version: 1,
      outcome: "active",
      summary: "Implementation remains in progress.",
      evidence: ".ai/artifacts/active-progress/events/execution-v1.md",
    });
    assert.deepEqual(workflow.history, [
      ".ai/artifacts/active-progress/events/execution-v1.md",
    ]);
  } finally {
    await workspace.cleanup();
  }
});

test("unblock-plan event that keeps the plan blocked reports a blocked outcome", async () => {
  const workspace = await setupWorkspace();
  try {
    await writePlan(
      workspace.root,
      "still-blocked",
      planWith("blocked", "unblock-plan"),
    );
    const { lines, console } = collectConsole();
    const result = await runWorkflowRunner({
      planName: planArg("still-blocked"),
      rootDir: workspace.root,
      console,
      processRunner: async (call) => {
        if (call.command === "git") {
          return { launched: true, stdout: "", stderr: "", exitCode: 0 };
        }
        await writeWorkflowEventArtifact({
          root: workspace.root,
          planName: "still-blocked",
          kind: "unblock",
          version: 1,
          outcome: "blocked",
          summary: "Docker unavailable",
          evidence: "Docker daemon was unavailable during validation.",
          remediation: ["Start Docker."],
        });
        return { launched: true, stdout: "", stderr: "", exitCode: 0 };
      },
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
