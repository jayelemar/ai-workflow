import assert from "node:assert/strict";
import { mkdtemp, readFile, rm, unlink, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";

import { lifecycleReportPath, regenerateLifecycleReport, renderLifecycleReport, verifyLifecycleRevision } from "./lifecycle-report.ts";
import { createLifecycleState } from "./lifecycle.ts";
import { lifecycleLedgerPath } from "./lifecycle-ledger.ts";
import { createLifecycleRevision } from "./lifecycle-store.ts";
import { recordLifecycleAttempt } from "../runner/runner-orchestrator.ts";
import { stageCompletionArtifactPath } from "./lifecycle-recovery.ts";

test("report exposes attempt tokens and chain status without evidence body", () => {
  const state = createLifecycleState({ workflowId: "id", workflowName: "name", runRevision: 1, risk: "HIGH", intakeStage: "feature-intake" });
  assert.ok(state);
  const report = renderLifecycleReport(state, []);
  assert.match(report, /Hash chain: VERIFIED/);
  assert.match(report, /Token totals/);
  assert.doesNotMatch(report, /full model response|secret prompt/i);
});

test("report visibly flags truncated ledger", async () => {
  const dir = await mkdtemp(path.join(os.tmpdir(), "v7-report-"));
  try {
    const state = createLifecycleState({ workflowId: "id", workflowName: "name", runRevision: 1, risk: "HIGH", intakeStage: "feature-intake" });
    assert.ok(state);
    await writeFile(lifecycleLedgerPath(dir), "{truncated\n");
    await regenerateLifecycleReport(dir, state);
    assert.match(await readFile(lifecycleReportPath(dir), "utf8"), /Hash chain: INVALID/);
  } finally { await rm(dir, { recursive: true, force: true }); }
});

test("report integrity verification rejects a missing referenced completion artifact", async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), "v7-report-evidence-"));
  try {
    const state = createLifecycleState({ workflowId: "id", workflowName: "name", runRevision: 1, risk: "HIGH", intakeStage: "feature-intake" });
    assert.ok(state);
    const { revisionDir } = await createLifecycleRevision(root, state);
    await recordLifecycleAttempt({ rootDir: root, state, outcome: "succeeded", codexBacked: true, sessionId: "report-session", tokenUsage: { inputTokens: 1, cachedInputTokens: 0, uncachedInputTokens: 1, outputTokens: 1, reasoningTokens: 0, totalTokens: 2 } });
    assert.equal((await verifyLifecycleRevision(revisionDir)).valid, true);
    await unlink(stageCompletionArtifactPath(revisionDir, "feature-intake", 1));
    const verification = await verifyLifecycleRevision(revisionDir);
    assert.equal(verification.valid, false);
    await regenerateLifecycleReport(revisionDir, state);
    assert.match(await readFile(lifecycleReportPath(revisionDir), "utf8"), /Hash chain: INVALID/);
  } finally { await rm(root, { recursive: true, force: true }); }
});
