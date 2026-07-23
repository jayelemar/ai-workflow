import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import test from "node:test";

import { acquireWorkflowRunnerLock } from "./runner-lock.ts";

test("runner lock rejects a concurrent runner and releases only its own lock", async () => {
  const rootDir = await mkdtemp(path.join(tmpdir(), "runner-lock-"));
  try {
    const first = await acquireWorkflowRunnerLock({
      rootDir,
      planName: "example",
      pid: 101,
      isPidAlive: (pid) => pid === 101,
    });
    assert.equal(first.ok, true);
    if (!first.ok) return;

    const second = await acquireWorkflowRunnerLock({
      rootDir,
      planName: "example",
      pid: 202,
      isPidAlive: (pid) => pid === 101,
    });
    assert.deepEqual(second, {
      ok: false,
      reason:
        "workflow runner is already active for example (pid 101); wait for it to finish or stop it before starting another runner",
    });

    await first.release();
    const afterRelease = await acquireWorkflowRunnerLock({
      rootDir,
      planName: "example",
      pid: 202,
      isPidAlive: () => true,
    });
    assert.equal(afterRelease.ok, true);
    if (afterRelease.ok) await afterRelease.release();
  } finally {
    await rm(rootDir, { recursive: true, force: true });
  }
});

test("runner lock replaces a stale owner", async () => {
  const rootDir = await mkdtemp(path.join(tmpdir(), "runner-lock-stale-"));
  try {
    const first = await acquireWorkflowRunnerLock({
      rootDir,
      planName: "example",
      pid: 101,
      isPidAlive: () => true,
    });
    assert.equal(first.ok, true);
    if (!first.ok) return;

    const recovered = await acquireWorkflowRunnerLock({
      rootDir,
      planName: "example",
      pid: 202,
      isPidAlive: () => false,
    });
    assert.equal(recovered.ok, true);
    if (recovered.ok) await recovered.release();
  } finally {
    await rm(rootDir, { recursive: true, force: true });
  }
});
