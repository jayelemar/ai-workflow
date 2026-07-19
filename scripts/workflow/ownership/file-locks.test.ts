import assert from "node:assert/strict";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { existsSync, mkdirSync } from "node:fs";
import { dirname, join } from "node:path";
import { tmpdir } from "node:os";
import test from "node:test";

import {
  acquireWorkflowFileOwnershipForPaths,
  isWorkflowFileLockStale,
  parseWorkflowFileLockMetadata,
  refreshWorkflowFileLockHeartbeats,
  releaseWorkflowFileLocks,
  workflowFileLockPath,
} from "./file-locks.ts";

const setupWorkspace = async () => {
  const root = await mkdtemp(join(tmpdir(), "workflow-file-locks-"));
  return {
    root,
    cleanup: () => rm(root, { recursive: true, force: true }),
  };
};

const writeLock = async (
  root: string,
  relativePath: string,
  metadata: Record<string, unknown> | string,
) => {
  const lockPath = workflowFileLockPath(root, relativePath);
  mkdirSync(dirname(lockPath), { recursive: true });
  await writeFile(
    lockPath,
    typeof metadata === "string" ? metadata : JSON.stringify(metadata),
    "utf8",
  );
  return lockPath;
};

test("workflow file lock parser rejects malformed metadata", () => {
  const malformed = parseWorkflowFileLockMetadata("{not json", "lock.json");
  assert.equal(malformed.ok, false);
  assert.match(malformed.reason, /workflow file lock is malformed/);

  const missingPath = parseWorkflowFileLockMetadata(
    JSON.stringify({
      planPath: ".ai/plans/current-plan.md",
      pid: process.ppid,
      createdAt: "2026-07-19T00:00:00.000Z",
    }),
    "lock.json",
  );
  assert.equal(missingPath.ok, false);
  assert.match(missingPath.reason, /workflow file lock is malformed/);
});

test("workflow file lock lifecycle acquires heartbeats and releases locks", async () => {
  const workspace = await setupWorkspace();
  try {
    const heldLockPaths = new Set<string>();
    const ownedPath = "src/current.ts";
    const acquired = await acquireWorkflowFileOwnershipForPaths({
      rootDir: workspace.root,
      planPath: ".ai/plans/current-plan.md",
      paths: [ownedPath],
      heldLockPaths,
      now: () => "2026-07-19T00:00:00.000Z",
    });

    assert.equal(acquired.ok, true);
    const lockPath = workflowFileLockPath(workspace.root, ownedPath);
    assert.equal(existsSync(lockPath), true);

    await refreshWorkflowFileLockHeartbeats({
      lockPaths: heldLockPaths,
      now: () => "2026-07-19T00:01:00.000Z",
    });
    const metadata = JSON.parse(await readFile(lockPath, "utf8")) as {
      heartbeatAt: string;
    };
    assert.equal(metadata.heartbeatAt, "2026-07-19T00:01:00.000Z");

    const released = await releaseWorkflowFileLocks(heldLockPaths);
    assert.equal(released.ok, true);
    assert.equal(existsSync(lockPath), false);
    assert.equal(heldLockPaths.size, 0);
  } finally {
    await workspace.cleanup();
  }
});

test("workflow file lock acquisition blocks live other-plan lock", async () => {
  const workspace = await setupWorkspace();
  try {
    const ownedPath = "src/current.ts";
    const liveTimestamp = new Date().toISOString();
    await writeLock(workspace.root, ownedPath, {
      planPath: ".ai/plans/other-plan.md",
      pid: process.pid,
      createdAt: liveTimestamp,
      heartbeatAt: liveTimestamp,
      path: ownedPath,
    });

    const acquired = await acquireWorkflowFileOwnershipForPaths({
      rootDir: workspace.root,
      planPath: ".ai/plans/current-plan.md",
      paths: [ownedPath],
      heldLockPaths: new Set(),
      now: () => liveTimestamp,
      unlockHintForPlanPath: (planPath) => `unlock ${planPath}`,
    });

    assert.equal(acquired.ok, false);
    assert.match(acquired.reason, /workflow file ownership conflict/);
    assert.match(acquired.reason, /\.ai\/plans\/other-plan\.md/);
  } finally {
    await workspace.cleanup();
  }
});

test("workflow file lock stale check uses heartbeat before creation time", () => {
  assert.equal(
    isWorkflowFileLockStale(
      {
        planPath: ".ai/plans/current-plan.md",
        pid: process.pid,
        createdAt: "2026-07-19T00:00:00.000Z",
        heartbeatAt: "2026-07-19T00:20:00.000Z",
        path: "src/current.ts",
      },
      Date.parse("2026-07-19T00:51:00.000Z"),
    ),
    true,
  );
});
