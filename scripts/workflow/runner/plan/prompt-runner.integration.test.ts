import test from "node:test";

import { runWorkflowRunner } from "../runtime.ts";

import {
  CODEX_COMMAND,
  CODEX_EXEC_LABEL,
  CODEX_HOME_SUFFIX,
  setupWorkspace,
  writePlan,
  turnCompletedUsageDetailLine,
  planArg,
  runnerReturning,
  assert,
  existsSync,
  join,
  readFile,
  workflowContextSnapshotRelativePath,
  writeFileSync,
  planWith,
  type ProcessRunner,
} from "../__tests__/helpers/runner-runtime.ts";

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
