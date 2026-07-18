import assert from "node:assert/strict";
import { mkdtemp, mkdir, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";

import { runV7WorkflowRunner } from "./workflow-runner.ts";

test("standalone V7 runner delegates to isolated lifecycle CLI", async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), "v7-runner-"));
  try {
    const workflowRoot = path.join(root, "workspace");
    const codexHome = path.join(root, "codex-home");
    const specPath = path.join(root, "runner-flow.spec.md");
    const planPath = path.join(root, "runner-flow.plan.md");
    const intakeArtifact = path.join(root, "runner-flow.intake.json");
    const sessionId = "3d1941a3-7193-4bdc-9ae5-3e48c7d548fb";
    const startedAt = new Date(Date.now() - 1_000).toISOString();
    await mkdir(path.join(codexHome, "sessions"), { recursive: true });
    await mkdir(workflowRoot, { recursive: true });
    await writeFile(specPath, "workflow: runner-flow\n");
    await writeFile(planPath, "workflow: runner-flow\n");
    await writeFile(intakeArtifact, JSON.stringify({ version: 7, workflowId: "runner-id", workflowName: "runner-flow", risk: "HIGH", intakeRevision: 1, route: "feature" }));
    await writeFile(path.join(codexHome, "sessions", "intake.jsonl"), `${JSON.stringify({ type: "session_meta", payload: { session_id: sessionId, cwd: workflowRoot } })}\n${JSON.stringify({ type: "event_msg", payload: { type: "token_count", info: { total_token_usage: { input_tokens: 2, cached_input_tokens: 0, output_tokens: 1, reasoning_output_tokens: 0, total_tokens: 3 } } } })}\n`);
    const result = await runV7WorkflowRunner([
      "create",
      "--workflow",
      "runner-flow",
      "--route", "feature", "--intake-revision", "1", "--spec", specPath, "--plan", planPath,
      "--intake-artifact", intakeArtifact, "--intake-session", sessionId, "--intake-invocation-start", startedAt,
      "--workflow-root", workflowRoot, "--codex-home", codexHome,
    ], root);
    assert.equal(result.exitCode, 0);
    assert.equal(JSON.parse(result.message).runRevision, 1);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});
