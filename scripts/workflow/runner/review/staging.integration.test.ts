import test from "node:test";

import { runWorkflowRunner } from "../runtime.ts";
import {
  checkForPreReviewStagedWork,
  clearStagedWorkForExecution,
} from "./staging.ts";

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
      ".ai/artifacts/workflow-runner/state/files.json",
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
test("review preflight unstages stale out-of-scope work while preserving plan-owned staging", async () => {
  const calls: Parameters<ProcessRunner>[0][] = [];
  const result = await checkForPreReviewStagedWork(
    "/workspace",
    async (call) => {
      calls.push(call);
      if (call.promptPath === "git-pre-review-staged-check") {
        return {
          launched: true,
          stdout: [
            "M\tsrc/plan-owned.ts",
            "A\tsupabase/migrations/legacy_regression_fixture.sql",
          ].join("\n"),
          stderr: "",
          exitCode: 0,
        };
      }
      return { launched: true, stdout: "", stderr: "", exitCode: 0 };
    },
    ["src/plan-owned.ts"],
  );

  assert.equal(result.ok, true);
  assert.deepEqual(
    calls.map((call) => [call.command, call.args, call.promptPath]),
    [
      ["git", ["diff", "--staged", "--name-status", "--"], "git-pre-review-staged-check"],
      [
        "git",
        [
          "reset",
          "--quiet",
          "--",
          "supabase/migrations/legacy_regression_fixture.sql",
        ],
        "git-pre-review-unstage-out-of-scope",
      ],
    ],
  );
});

test("execute entry clears every staged path before implementation starts", async () => {
  const calls: Parameters<ProcessRunner>[0][] = [];
  const result = await clearStagedWorkForExecution("/workspace", async (call) => {
    calls.push(call);
    if (call.promptPath === "git-execute-staged-check") {
      return {
        launched: true,
        stdout: [
          "src/plan-owned.ts",
          "supabase/migrations/legacy_regression_fixture.sql",
        ].join("\n"),
        stderr: "",
        exitCode: 0,
      };
    }
    return { launched: true, stdout: "", stderr: "", exitCode: 0 };
  });

  assert.equal(result.ok, true);
  assert.deepEqual(
    calls.map((call) => [call.command, call.args, call.promptPath]),
    [
      ["git", ["diff", "--staged", "--name-only", "--"], "git-execute-staged-check"],
      [
        "git",
        [
          "reset",
          "--quiet",
          "--",
          "src/plan-owned.ts",
          "supabase/migrations/legacy_regression_fixture.sql",
        ],
        "git-execute-unstage",
      ],
    ],
  );
});

test("review-plan stages plan-owned files normally when the repo has no pre-existing staged work", async () => {
  const workspace = await setupWorkspace();
  try {
    await writePlan(
      workspace.root,
      "review-clean-entry",
      planWithFileScope("review", "review-plan", {
        modified: ["src/artifact-state.ts"],
      }),
    );
    mkdirSync(join(workspace.root, "src"), { recursive: true });
    writeFileSync(join(workspace.root, "src", "artifact-state.ts"), "export {};\n");
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

test("runner restages and reruns review when a staged review path changes during review", async () => {
  const workspace = await setupWorkspace();
  try {
    await writePlan(
      workspace.root,
      "review-worktree-mutation",
      planWith("review", "review-plan"),
    );
    const calls: Parameters<ProcessRunner>[0][] = [];
    let reviewCount = 0;
    let worktreeCheckCount = 0;
    const result = await runWorkflowRunner({
      planName: planArg("review-worktree-mutation"),
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
        if (call.promptPath === ".ai/prompts/review-changes.md") {
          reviewCount += 1;
          writeWorkflowEventArtifactSync({
            root: workspace.root,
            planName: "review-worktree-mutation",
            kind: "review",
            version: reviewCount,
            ...(reviewCount === 2
              ? {
                  outcome: "active" as const,
                  remediation: ["Review the restaged worktree."],
                }
              : {}),
          });
          return { launched: true, stdout: "review complete", stderr: "", exitCode: 0 };
        }
        if (call.promptPath === "git-review-staging-worktree-check") {
          worktreeCheckCount += 1;
          return { launched: true, stdout: "", stderr: "", exitCode: 1 };
        }
        if (call.promptPath === ".ai/prompts/execute-plan.md") {
          return { launched: true, stdout: "STOP: rerun completed", stderr: "", exitCode: 0 };
        }
        if (call.command === "git") {
          return { launched: true, stdout: "", stderr: "", exitCode: 0 };
        }
        return { launched: true, stdout: "", stderr: "", exitCode: 0 };
      },
    });

    assert.equal(result.success, false);
    assert.match(result.reason, /STOP: rerun completed/);
    assert.equal(reviewCount, 2);
    assert.equal(worktreeCheckCount, 1);
    assertCallSubsequence(calls, [
      [CODEX_COMMAND, "exec", ".ai/prompts/review-changes.md"],
      ["git", "diff", "git-review-staging-worktree-check"],
      ["git", "reset", "git-review-unstage"],
      ["git", "add", "git-staging"],
      [CODEX_COMMAND, "exec", ".ai/prompts/review-changes.md"],
      [CODEX_COMMAND, "exec", ".ai/prompts/execute-plan.md"],
    ]);
    assert.equal(calls.some((call) => call.promptPath === ".ai/prompts/commit-summary.md"), false);
  } finally {
    await workspace.cleanup();
  }
});

test("runner accepts a needs-fix review result when its review scope changes", async () => {
  const workspace = await setupWorkspace();
  try {
    await writePlan(
      workspace.root,
      "review-worktree-needs-fix",
      planWith("review", "review-plan"),
    );
    const calls: Parameters<ProcessRunner>[0][] = [];
    const result = await runWorkflowRunner({
      planName: planArg("review-worktree-needs-fix"),
      rootDir: workspace.root,
      console: { log: () => {}, error: () => {} },
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
        if (call.promptPath === ".ai/prompts/review-changes.md") {
          writeWorkflowEventArtifactSync({
            root: workspace.root,
            planName: "review-worktree-needs-fix",
            kind: "review",
            version: 1,
            outcome: "active",
            remediation: ["Fix the staged migration regression."],
          });
          return { launched: true, stdout: "review complete", stderr: "", exitCode: 0 };
        }
        if (call.promptPath === ".ai/prompts/execute-plan.md") {
          return { launched: true, stdout: "STOP", stderr: "", exitCode: 0 };
        }
        if (call.command === "git") {
          return { launched: true, stdout: "", stderr: "", exitCode: 0 };
        }
        return { launched: true, stdout: "", stderr: "", exitCode: 0 };
      },
    });

    assert.equal(result.success, false);
    assert.match(result.reason, /output contained STOP/);
    assert.equal(
      calls.some((call) => call.promptPath === "git-review-staging-worktree-check"),
      false,
    );
    const workflow = JSON.parse(await readFile(
      join(
        workspace.root,
        ".ai",
        "artifacts",
        "review-worktree-needs-fix",
        "state",
        "workflow.json",
      ),
      "utf8",
    ));
    assert.equal(workflow.workflowState, "active");
    assert.deepEqual(workflow.latest.review.unresolvedFindings, [
      "Fix the staged migration regression.",
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
    assert.match(result.reason, /thin-plan contains forbidden inline section Review History/i);
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
    mkdirSync(join(workspace.root, "src"), { recursive: true });
    writeFileSync(join(workspace.root, "src", "file.ts"), "export {};\n");
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
    mkdirSync(join(workspace.root, "e2e"), { recursive: true });
    writeFileSync(join(workspace.root, "e2e", "support-issue-widget.spec.ts"), "export {};\n");
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
    mkdirSync(join(workspace.root, "e2e"), { recursive: true });
    writeFileSync(join(workspace.root, "e2e", "support-issue-widget.spec.ts"), "export {};\n");
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
          documentFormat: "workflow-state@1",
          planPath: `.ai/plans/${planName}.md`,
          workflowState: "review",
          latest: {
            execution: {
              version: 1,
              outcome: "review-ready",
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

test("review-plan accepts plan-owned file scope without hunk ownership metadata", async () => {
  const workspace = await setupWorkspace();
  try {
    await writePlan(
      workspace.root,
      "review-shared-hunk-scope",
      planWithFileScope("review", "review-plan", {
        modified: ["schema/openapi.generated.json"],
      }),
    );
    mkdirSync(join(workspace.root, "schema"), { recursive: true });
    writeFileSync(join(workspace.root, "schema", "openapi.generated.json"), "{}\n");
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
        if (call.promptPath === "git-pre-review-staged-check") {
          return { launched: true, stdout: "", stderr: "", exitCode: 0 };
        }
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
      ".ai/artifacts/review-stop/state/files.json",
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
