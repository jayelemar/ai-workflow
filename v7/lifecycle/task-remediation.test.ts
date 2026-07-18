import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { mkdtemp, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";

import { canonicalJson } from "./lifecycle-ledger.ts";
import { createLifecycleState } from "./lifecycle.ts";
import { createLifecycleRevision, writeTaskOwnershipManifest } from "./lifecycle-store.ts";
import { taskRemediationArtifactPath, writeTaskRemediationArtifact } from "./task-remediation.ts";

test("task remediation is immutable and restricted to its task ownership manifest", async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), "v7-remediation-"));
  try {
    const state = createLifecycleState({ workflowId: "id", workflowName: "flow", runRevision: 1, risk: "HIGH", intakeStage: "feature-intake" });
    assert.ok(state);
    state.currentStage = "task-review";
    const { revisionDir } = await createLifecycleRevision(root, state);
    const allowedFile = path.join(root, "allowed.ts");
    const ownership = await writeTaskOwnershipManifest({ revisionDir, workflowId: "id", runRevision: 1, taskId: "task-1", workflowRoot: root, allowedFiles: [allowedFile] });
    const payload = { version: 7 as const, workflowId: "id", runRevision: 1, taskId: "task-1", changedFiles: [allowedFile], summary: "repair applied", completedAt: "2026-01-01T00:00:00.000Z" };
    const result = { ...payload, remediationHash: createHash("sha256").update(canonicalJson(payload), "utf8").digest("hex") };
    const written = await writeTaskRemediationArtifact({ revisionDir, state, ownership, attempt: 1, result });
    assert.equal(written.remediationHash, result.remediationHash);
    await assert.rejects(() => writeTaskRemediationArtifact({ revisionDir, state, ownership, attempt: 1, result }), /replay/);
    const outsidePayload = { ...payload, changedFiles: [path.join(root, "outside.ts")] };
    const outside = { ...outsidePayload, remediationHash: createHash("sha256").update(canonicalJson(outsidePayload), "utf8").digest("hex") };
    await assert.rejects(() => writeTaskRemediationArtifact({ revisionDir, state, ownership, attempt: 2, result: outside }), /ownership/);
    assert.ok(taskRemediationArtifactPath(revisionDir, "task-1", 1));
  } finally { await rm(root, { recursive: true, force: true }); }
});
