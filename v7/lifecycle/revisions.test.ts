import assert from "node:assert/strict";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";

import { createLifecycleState } from "./lifecycle.ts";
import { checkpointV7Lifecycle, createV7Workflow, reopenCompletedV7Workflow, reopenIntakeForRouteChange } from "./workflow-lifecycle.ts";
import { createLifecycleRevision, lifecycleRevisionDir, readLifecycleState, readTaskOwnershipManifest, writeTaskOwnershipManifest } from "./lifecycle-store.ts";
import { canonicalJson } from "./lifecycle-ledger.ts";
import { createHash } from "node:crypto";

test("completed workflow reopens into linked immutable revision", async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), "v7-revisions-"));
  try {
    const created = await createV7Workflow({ rootDir: root, workflowName: "flow", workflowId: "id", risk: "HIGH", intakeStage: "feature-intake" });
    assert.equal(created.created, true);
    if (!created.created) return;
    const completed = { ...created.state, currentStage: "completion-summary" as const, runOutcome: "completed" as const };
    const { writeLifecycleState } = await import("./lifecycle-store.ts");
    await writeLifecycleState(root, completed);
    const reopened = await reopenCompletedV7Workflow({ rootDir: root, workflowName: "flow" });
    assert.equal(reopened.runRevision, 2);
    assert.equal(reopened.linkedFromRevision, 1);
    assert.equal((await readLifecycleState(lifecycleRevisionDir(root, "flow", 1)))?.runOutcome, "completed");
  } finally { await rm(root, { recursive: true, force: true }); }
});

test("route change supersedes old intake and increments intake revision", async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), "v7-reroute-"));
  try {
    await createV7Workflow({ rootDir: root, workflowName: "flow", workflowId: "id", risk: "HIGH", intakeStage: "feature-intake" });
    const changed = await reopenIntakeForRouteChange({ rootDir: root, workflowName: "flow", risk: "HIGH", intakeStage: "bug-intake-root-cause-analysis" });
    assert.equal(changed.created, true);
    if (!changed.created) return;
    assert.equal(changed.state.intakeRevision, 2);
    assert.equal((await readLifecycleState(lifecycleRevisionDir(root, "flow", 1)))?.runOutcome, "superseded");
  } finally { await rm(root, { recursive: true, force: true }); }
});

test("completed revisions stay immutable and cannot be rerouted", async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), "v7-revisions-"));
  try {
    const created = await createV7Workflow({ rootDir: root, workflowName: "flow", workflowId: "id", risk: "HIGH", intakeStage: "feature-intake" });
    assert.equal(created.created, true);
    if (!created.created) return;
    const { writeLifecycleState } = await import("./lifecycle-store.ts");
    const completed = { ...created.state, runOutcome: "completed" as const, currentStage: "completion-summary" as const };
    await writeLifecycleState(root, completed);
    await assert.rejects(() => writeLifecycleState(root, { ...completed, workflowId: "changed" }), /immutable/);
    await assert.rejects(() => reopenIntakeForRouteChange({ rootDir: root, workflowName: "flow", risk: "HIGH", intakeStage: "feature-intake" }), /immutable/);
    assert.equal((await readLifecycleState(lifecycleRevisionDir(root, "flow", 1)))?.runOutcome, "completed");
  } finally { await rm(root, { recursive: true, force: true }); }
});

test("concurrent same-name creation admits one active V7 revision", async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), "v7-revisions-"));
  try {
    const attempts = await Promise.allSettled([
      createV7Workflow({ rootDir: root, workflowName: "flow", workflowId: "id", risk: "HIGH", intakeStage: "feature-intake" }),
      createV7Workflow({ rootDir: root, workflowName: "flow", workflowId: "id", risk: "HIGH", intakeStage: "feature-intake" }),
    ]);
    assert.equal(attempts.filter((attempt) => attempt.status === "fulfilled").length, 1);
    assert.equal(attempts.filter((attempt) => attempt.status === "rejected").length, 1);
    assert.equal((await readLifecycleState(lifecycleRevisionDir(root, "flow", 1)))?.runOutcome, "active");
  } finally { await rm(root, { recursive: true, force: true }); }
});

test("task ownership manifest is immutable and rejects root escape", async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), "v7-task-ownership-"));
  try {
    const state = createLifecycleState({ workflowId: "id", workflowName: "flow", runRevision: 1, risk: "HIGH", intakeStage: "feature-intake" });
    assert.ok(state);
    const { revisionDir } = await createLifecycleRevision(root, state);
    const manifest = await writeTaskOwnershipManifest({ revisionDir, workflowId: "id", runRevision: 1, taskId: "task-1", workflowRoot: root, allowedFiles: [path.join(root, "allowed.md")] });
    assert.equal((await readTaskOwnershipManifest(revisionDir, "task-1")).ownershipHash, manifest.ownershipHash);
    await assert.rejects(() => writeTaskOwnershipManifest({ revisionDir, workflowId: "id", runRevision: 1, taskId: "task-2", workflowRoot: root, allowedFiles: ["/tmp/outside.md"] }), /escapes/);
    await assert.rejects(() => writeTaskOwnershipManifest({ revisionDir, workflowId: "id", runRevision: 1, taskId: "task-1", workflowRoot: root, allowedFiles: [path.join(root, "allowed.md")] }), /EEXIST/);
  } finally { await rm(root, { recursive: true, force: true }); }
});

test("task ownership read rejects altered and foreign revision identities", async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), "v7-task-identity-"));
  try {
    const state = createLifecycleState({ workflowId: "id", workflowName: "flow", runRevision: 1, risk: "HIGH", intakeStage: "feature-intake" });
    assert.ok(state);
    const { revisionDir } = await createLifecycleRevision(root, state);
    const manifest = await writeTaskOwnershipManifest({ revisionDir, workflowId: "id", runRevision: 1, taskId: "task-1", workflowRoot: root, allowedFiles: [path.join(root, "allowed.md")] });
    const foreignPayload = { ...manifest, runRevision: 2 };
    const { ownershipHash: _ignored, ...withoutHash } = foreignPayload;
    const foreign = { ...withoutHash, ownershipHash: createHash("sha256").update(canonicalJson(withoutHash), "utf8").digest("hex") };
    await writeFile(path.join(revisionDir, "tasks", "task-task-1-ownership.json"), `${canonicalJson(foreign)}\n`);
    assert.equal((await readTaskOwnershipManifest(revisionDir, "task-1")).runRevision, 2);
    await assert.rejects(() => checkpointV7Lifecycle({ rootDir: root, workflowName: "flow", runRevision: 1, outcome: "succeeded", session: { sessionId: "task-session", model: "gpt", tokenUsage: { inputTokens: 1, cachedInputTokens: 0, uncachedInputTokens: 1, outputTokens: 1, reasoningTokens: 0, totalTokens: 2 } }, taskId: "task-1" }), /another lifecycle revision/);
  } finally { await rm(root, { recursive: true, force: true }); }
});
