import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";

import { acquireLifecycleLock, lifecycleLockPath } from "./lifecycle-lock.ts";
import { readStageCompletionArtifact, recoverInterruptedLifecycleFromArtifact, recoverStaleLockWithEvidence, stageCompletionArtifactPath, writeStageCompletionArtifact } from "./lifecycle-recovery.ts";
import { createLifecycleState } from "./lifecycle.ts";
import { createLifecycleRevision, lifecycleRevisionDir } from "./lifecycle-store.ts";
import { readLifecycleLedger } from "./lifecycle-ledger.ts";
import { canonicalJson } from "./lifecycle-ledger.ts";

test("stale lock recovery rejects safely when required primitives are unavailable", async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), "v7-recovery-"));
  try {
    const state = createLifecycleState({ workflowId: "id", workflowName: "flow", runRevision: 1, risk: "HIGH", intakeStage: "feature-intake" });
    assert.ok(state);
    await createLifecycleRevision(root, state);
    const revisionDir = lifecycleRevisionDir(root, "flow", 1);
    const lock = await acquireLifecycleLock(revisionDir, { workflowId: "id", runRevision: 1 });
    const { lockHash: ignoredHash, ...payload } = lock;
    const stalePayload = { ...payload, heartbeatAt: "1970-01-01T00:00:00.000Z" };
    const stale = { ...stalePayload, lockHash: createHash("sha256").update(canonicalJson(stalePayload), "utf8").digest("hex") };
    await writeFile(lifecycleLockPath(revisionDir), JSON.stringify(stale));
    await assert.rejects(() => recoverStaleLockWithEvidence({ rootDir: root, revisionDir, state, staleAfterMs: 1, reason: "" }), /requires recorded reason/);
    await assert.rejects(() => recoverStaleLockWithEvidence({ rootDir: root, revisionDir, state, staleAfterMs: 90_000, reason: "process crashed" }), /unavailable/);
    const entries = await readLifecycleLedger(revisionDir);
    assert.equal(entries.length, 0);
  } finally { await rm(root, { recursive: true, force: true }); }
});

test("unproven interrupted call cannot advance lifecycle", async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), "v7-interrupt-"));
  try {
    const state = createLifecycleState({ workflowId: "id", workflowName: "flow", runRevision: 1, risk: "HIGH", intakeStage: "feature-intake" });
    assert.ok(state);
    const { createLifecycleRevision, lifecycleRevisionDir, readLifecycleState } = await import("./lifecycle-store.ts");
    const { recoverInterruptedLifecycle } = await import("./lifecycle-recovery.ts");
    const { revisionDir } = await createLifecycleRevision(root, state);
    const recovered = await recoverInterruptedLifecycle({ rootDir: root, revisionDir, state, evidence: { provable: true, reason: "claim without evidence" } });
    assert.equal(recovered.runOutcome, "interrupted");
    assert.equal((await readLifecycleState(lifecycleRevisionDir(root, "flow", 1)))?.runOutcome, "interrupted");
  } finally { await rm(root, { recursive: true, force: true }); }
});

test("completion artifact is immutable, canonical-hashed, and detects tampering", async () => {
  const dir = await mkdtemp(path.join(os.tmpdir(), "v7-completion-"));
  try {
    const tokenUsage = { inputTokens: 3, cachedInputTokens: 1, uncachedInputTokens: 2, outputTokens: 2, reasoningTokens: 1, totalTokens: 5 };
    const artifact = await writeStageCompletionArtifact({ revisionDir: dir, workflowId: "id", runRevision: 1, stage: "feature-intake", attempt: 1, sessionId: "session", outcome: "succeeded", tokenUsage, completedAt: "2026-01-01T00:00:00Z" });
    assert.equal((await readStageCompletionArtifact(dir, "feature-intake", 1)).artifactHash, artifact.artifactHash);
    await assert.rejects(() => writeStageCompletionArtifact({ revisionDir: dir, workflowId: "id", runRevision: 1, stage: "feature-intake", attempt: 1, sessionId: "session", outcome: "succeeded", tokenUsage, completedAt: "2026-01-01T00:00:00Z" }), /EEXIST/);
    await writeFile(stageCompletionArtifactPath(dir, "feature-intake", 1), JSON.stringify({ ...artifact, outcome: "failed" }));
    await assert.rejects(() => readStageCompletionArtifact(dir, "feature-intake", 1), /invalid/);
  } finally { await rm(dir, { recursive: true, force: true }); }
});

test("artifact-only interrupted completion can replay exactly once", async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), "v7-proof-"));
  try {
    const state = createLifecycleState({ workflowId: "id", workflowName: "flow", runRevision: 1, risk: "HIGH", intakeStage: "feature-intake" });
    assert.ok(state);
    const { revisionDir } = await createLifecycleRevision(root, state);
    const tokenUsage = { inputTokens: 3, cachedInputTokens: 1, uncachedInputTokens: 2, outputTokens: 2, reasoningTokens: 1, totalTokens: 5 };
    await writeStageCompletionArtifact({ revisionDir, workflowId: "id", runRevision: 1, stage: "feature-intake", attempt: 1, sessionId: "session", outcome: "succeeded", tokenUsage, completedAt: "2026-01-01T00:00:00Z" });
    const recovered = await recoverInterruptedLifecycleFromArtifact({ rootDir: root, revisionDir, state, stage: "feature-intake", attempt: 1, sessionId: "session", tokenUsage });
    assert.equal(recovered.currentStage, "specification-generation");
    const replayed = await recoverInterruptedLifecycleFromArtifact({ rootDir: root, revisionDir, state, stage: "feature-intake", attempt: 1, sessionId: "session", tokenUsage });
    assert.equal(replayed.currentStage, "specification-generation");
    const records = await readLifecycleLedger(revisionDir);
    assert.equal(records.length, 2);
    assert.equal(records[1].recordKind, "recovery");
  } finally { await rm(root, { recursive: true, force: true }); }
});
