import assert from "node:assert/strict";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";

import { runWorkflowRunner } from "./runtime.ts";

const withWorkspace = async (
  run: (rootDir: string) => Promise<void>,
): Promise<void> => {
  const rootDir = await mkdtemp(join(tmpdir(), "workflow-runtime-"));
  try {
    await run(rootDir);
  } finally {
    await rm(rootDir, { recursive: true, force: true });
  }
};

test("runtime returns CLI help without touching process runner", async () => {
  const logs: string[] = [];
  let processCalls = 0;

  const result = await runWorkflowRunner({
    argv: ["--help"],
    console: {
      log: (message) => logs.push(message),
      error: (message) => logs.push(message),
    },
    processRunner: async () => {
      processCalls += 1;
      return { launched: true, stdout: "", stderr: "", exitCode: 0 };
    },
  });

  assert.equal(result.success, true);
  assert.equal(result.reason, "workflow runner help");
  assert.equal(processCalls, 0);
  assert.match(logs.join("\n"), /Usage: pnpm exec tsx .ai\/scripts\/workflow\/runner\.ts/);
});

test("runtime applies transition routes before Codex launch", async () => {
  await withWorkspace(async (rootDir) => {
    await mkdir(join(rootDir, ".ai", "plans"), { recursive: true });
    await writeFile(
      join(rootDir, ".ai", "plans", "bad-route.md"),
      `# Plan

## Workflow Content Rules

thin-plan-v1

## Execution Mode

runner-managed

## Workflow State

not-a-workflow-state
`,
    );

    let processCalls = 0;
    const result = await runWorkflowRunner({
      argv: [".ai/plans/bad-route.md"],
      rootDir,
      console: {
        log: () => {},
        error: () => {},
      },
      processRunner: async () => {
        processCalls += 1;
        return { launched: true, stdout: "", stderr: "", exitCode: 0 };
      },
    });

    assert.equal(result.success, false);
    assert.match(result.reason, /unknown workflowState value/);
    assert.equal(processCalls, 0);
  });
});
