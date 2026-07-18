import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";

import { acquireLifecycleLock, heartbeatLifecycleLock, lifecycleLockPath, readLifecycleLock, recoverUnpublishedLifecycleLock, releaseLifecycleLock } from "./lifecycle-lock.ts";
import { createLifecycleState } from "./lifecycle.ts";
import { createLifecycleRevision, lifecycleRevisionDir } from "./lifecycle-store.ts";
import { runV7LifecycleWithLock } from "./workflow-lifecycle.ts";

test("exclusive lifecycle lock rejects concurrent start", async () => {
  const dir = await mkdtemp(path.join(os.tmpdir(), "v7-lock-"));
  try {
    const lock = await acquireLifecycleLock(dir, { workflowId: "id", runRevision: 1 });
    await assert.rejects(() => acquireLifecycleLock(dir, { workflowId: "id", runRevision: 1 }), /already held/);
    await releaseLifecycleLock(dir, lock.ownerId);
  } finally { await rm(dir, { recursive: true, force: true }); }
});

test("empty unpublished lock recovery rejects when required primitives are unavailable", async () => {
  const dir = await mkdtemp(path.join(os.tmpdir(), "v7-lock-unpublished-"));
  try {
    await (await import("node:fs/promises")).writeFile(lifecycleLockPath(dir), "");
    await assert.rejects(() => recoverUnpublishedLifecycleLock(dir, "unpublished-empty"), /unavailable/);
  } finally { await rm(dir, { recursive: true, force: true }); }
});

test("lock owner cannot heartbeat or release a replacement lock", async () => {
  const dir = await mkdtemp(path.join(os.tmpdir(), "v7-lock-owner-"));
  try {
    const lock = await acquireLifecycleLock(dir, { workflowId: "id", runRevision: 1 });
    await rm(lifecycleLockPath(dir));
    const replacement = await acquireLifecycleLock(dir, { workflowId: "id", runRevision: 1 });
    await assert.rejects(() => heartbeatLifecycleLock(dir, lock.ownerId), /ownership lost/);
    await assert.rejects(() => releaseLifecycleLock(dir, lock.ownerId), /ownership lost/);
    assert.equal((await readLifecycleLock(dir))?.ownerId, replacement.ownerId);
    await releaseLifecycleLock(dir, replacement.ownerId);
  } finally { await rm(dir, { recursive: true, force: true }); }
});

test("running V7 lifecycle heartbeats its exclusive lock", async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), "v7-lock-heartbeat-"));
  try {
    const state = createLifecycleState({ workflowId: "id", workflowName: "flow", runRevision: 1, risk: "HIGH", intakeStage: "feature-intake" });
    assert.ok(state);
    state.currentStage = "plan-setup";
    await createLifecycleRevision(root, state);
    let observedHeartbeat: string | undefined;
    await runV7LifecycleWithLock(root, "flow", async () => {
      await new Promise((resolve) => setTimeout(resolve, 15));
      observedHeartbeat = (await readLifecycleLock(lifecycleRevisionDir(root, "flow", 1)))?.heartbeatAt;
      return undefined;
    }, 1);
    assert.ok(observedHeartbeat);
    assert.equal(await readLifecycleLock(lifecycleRevisionDir(root, "flow", 1)), null);
  } finally { await rm(root, { recursive: true, force: true }); }
});
