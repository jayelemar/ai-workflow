import test from "node:test";

import { runWorkflowRunner } from "../runtime.ts";

import {
  CODEX_COMMAND,
  setupWorkspace,
  writePlan,
  assertCallSubsequence,
  writeArtifactStateFile,
  planArg,
  readFailureDebugLedger,
  assertFailureMetadata,
  collectConsole,
  codexAgentMessageLine,
  assert,
  join,
  mkdirSync,
  readFile,
  writeFileSync,
  writeWorkflowEventArtifactSync,
  planWith,
  planWithFileScope,
  type ProcessRunner,
} from "../__tests__/helpers/runner-runtime.ts";

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
