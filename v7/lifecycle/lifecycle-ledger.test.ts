import assert from "node:assert/strict";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";

import { appendLifecycleLedgerRecord, lifecycleLedgerPath, readLifecycleLedger, verifyLifecycleLedger } from "./lifecycle-ledger.ts";

const usage = { inputTokens: 10, cachedInputTokens: 4, uncachedInputTokens: 6, outputTokens: 2, reasoningTokens: 1, totalTokens: 12 };
test("ledger is append-only, hash chained, and redacts evidence", async () => {
  const dir = await mkdtemp(path.join(os.tmpdir(), "v7-ledger-"));
  try {
    await appendLifecycleLedgerRecord(dir, { workflowId: "id", runRevision: 1, stage: "feature-intake", attempt: 1, outcome: "succeeded", startedAt: "2026-01-01T00:00:00Z", completedAt: "2026-01-01T00:00:01Z", durationMs: 1, sessionId: "s1", tokenUsage: usage, evidence: "full prompt secret" });
    await appendLifecycleLedgerRecord(dir, { workflowId: "id", runRevision: 1, stage: "specification-generation", attempt: 1, outcome: "zero-token", startedAt: "2026-01-01T00:00:01Z", completedAt: "2026-01-01T00:00:02Z", durationMs: 1, tokenUsage: { inputTokens: 0, cachedInputTokens: 0, uncachedInputTokens: 0, outputTokens: 0, reasoningTokens: 0, totalTokens: 0 }, evidence: "model output" });
    const records = await readLifecycleLedger(dir);
    assert.equal(verifyLifecycleLedger(records).valid, true);
    assert.doesNotMatch(await readFile(lifecycleLedgerPath(dir), "utf8"), /full prompt secret|model output/);
    await writeFile(lifecycleLedgerPath(dir), `${JSON.stringify({ ...records[1], outcome: "failed" })}\n`, "utf8");
    assert.equal(verifyLifecycleLedger(await readLifecycleLedger(dir)).valid, false);
  } finally { await rm(dir, { recursive: true, force: true }); }
});
