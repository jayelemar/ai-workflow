import assert from "node:assert/strict";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";

import { runWorkflowRunner } from "../runner.ts";

test("manual plans are refused before Codex or Git work", async () => {
  const rootDir = await mkdtemp(join(tmpdir(), "manual-workflow-plan-"));
  try {
    await mkdir(join(rootDir, ".ai", "plans"), { recursive: true });
    await mkdir(join(rootDir, ".git"), { recursive: true });
    await writeFile(
      join(rootDir, ".ai", "plans", "manual.md"),
      `# Plan: manual\n\n## Workflow Content Rules\n\nthin-plan-v2\n\n## Execution Mode\n\nmanual\n\n## Workflow State\n\nN/A: manual plan-bound execution\n`,
    );
    const calls: string[] = [];

    const result = await runWorkflowRunner({
      argv: [".ai/plans/manual.md"],
      rootDir,
      processRunner: async (call) => {
        calls.push(call.command);
        return { launched: true, stdout: "", stderr: "", exitCode: 0 };
      },
    });

    assert.equal(result.success, false);
    assert.match(result.reason, /manual plan cannot be run by workflow-runner/);
    assert.match(result.reason, /manual-execute-plan\.md/);
    assert.deepEqual(calls, []);
  } finally {
    await rm(rootDir, { recursive: true, force: true });
  }
});

test("missing plan instruction references are refused before Codex execution", async () => {
  const rootDir = await mkdtemp(join(tmpdir(), "missing-instruction-plan-"));
  try {
    await mkdir(join(rootDir, ".ai", "plans"), { recursive: true });
    await mkdir(join(rootDir, ".git"), { recursive: true });
    await writeFile(
      join(rootDir, ".ai", "plans", "missing-instruction.md"),
      `# Plan: missing instruction

## Execution Mode

runner-managed

## Notes

Read .ai/instructions/shared/missing.md before implementation.

## Workflow State

draft-artifact-sync
`,
    );
    const calls: string[] = [];

    const result = await runWorkflowRunner({
      argv: [".ai/plans/missing-instruction.md"],
      rootDir,
      processRunner: async (call) => {
        calls.push(call.command);
        return {
          launched: true,
          stdout: call.command === "git" ? "feature/missing-instruction\n" : "",
          stderr: "",
          exitCode: 0,
        };
      },
    });

    assert.equal(result.success, false);
    assert.match(result.reason, /plan references missing instruction path/);
    assert.match(result.reason, /shared\/missing\.md/);
    assert.deepEqual(calls, ["git"]);
  } finally {
    await rm(rootDir, { recursive: true, force: true });
  }
});
