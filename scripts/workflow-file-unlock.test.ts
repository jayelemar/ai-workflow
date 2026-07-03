import assert from "node:assert/strict";
import { existsSync, mkdirSync } from "node:fs";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { tmpdir } from "node:os";
import test from "node:test";

import {
  runWorkflowFileUnlock,
  unlockWorkflowFileLocksForPlan,
  unlockWorkflowFileLock,
  workflowFileUnlockPathHint,
} from "./workflow-file-unlock.ts";
import { workflowFileLockPath } from "./workflow-runner.ts";

const setupWorkspace = async () => {
  const root = await mkdtemp(join(tmpdir(), "workflow-file-unlock-"));
  return {
    root,
    cleanup: async () => {
      await rm(root, { recursive: true, force: true });
    },
  };
};

const writeWorkflowFileLock = async (
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

test("unlockWorkflowFileLock removes a stale same-plan lock", async () => {
  const workspace = await setupWorkspace();
  try {
    const planPath = ".ai/plans/current-plan.md";
    const ownedPath = "src/owned.ts";
    const lockPath = await writeWorkflowFileLock(workspace.root, ownedPath, {
      planPath,
      pid: 2147483647,
      createdAt: "2026-07-03T00:00:00.000Z",
      path: ownedPath,
    });

    const result = await unlockWorkflowFileLock({
      rootDir: workspace.root,
      planPath,
      ownedPath,
      isProcessAlive: () => false,
    });

    assert.equal(result.ok, true);
    assert.equal(existsSync(lockPath), false);
  } finally {
    await workspace.cleanup();
  }
});

test("unlockWorkflowFileLock refuses to remove a lock owned by another plan", async () => {
  const workspace = await setupWorkspace();
  try {
    const lockPath = await writeWorkflowFileLock(
      workspace.root,
      "src/owned.ts",
      {
        planPath: ".ai/plans/other-plan.md",
        pid: 2147483647,
        createdAt: "2026-07-03T00:00:00.000Z",
        path: "src/owned.ts",
      },
    );

    const result = await unlockWorkflowFileLock({
      rootDir: workspace.root,
      planPath: ".ai/plans/current-plan.md",
      ownedPath: "src/owned.ts",
      isProcessAlive: () => false,
    });

    assert.equal(result.ok, false);
    assert.match(result.reason, /owned by another plan/);
    assert.equal(existsSync(lockPath), true);
  } finally {
    await workspace.cleanup();
  }
});

test("unlockWorkflowFileLock refuses to remove a live same-plan lock", async () => {
  const workspace = await setupWorkspace();
  try {
    const planPath = ".ai/plans/current-plan.md";
    const ownedPath = "src/owned.ts";
    const lockPath = await writeWorkflowFileLock(workspace.root, ownedPath, {
      planPath,
      pid: process.pid,
      createdAt: "2026-07-03T00:00:00.000Z",
      path: ownedPath,
    });

    const result = await unlockWorkflowFileLock({
      rootDir: workspace.root,
      planPath,
      ownedPath,
      isProcessAlive: () => true,
    });

    assert.equal(result.ok, false);
    assert.match(result.reason, /pid .* is still running/);
    assert.equal(existsSync(lockPath), true);
  } finally {
    await workspace.cleanup();
  }
});

test("unlockWorkflowFileLocksForPlan removes all stale same-plan locks", async () => {
  const workspace = await setupWorkspace();
  try {
    const planPath = ".ai/plans/current-plan.md";
    const ownedA = "src/a.ts";
    const ownedB = "src/b.ts";
    const otherPlanPath = ".ai/plans/other-plan.md";
    const lockPathA = await writeWorkflowFileLock(workspace.root, ownedA, {
      planPath,
      pid: 2147483647,
      createdAt: "2026-07-03T00:00:00.000Z",
      path: ownedA,
    });
    const lockPathB = await writeWorkflowFileLock(workspace.root, ownedB, {
      planPath,
      pid: 2147483646,
      createdAt: "2026-07-03T00:00:00.000Z",
      path: ownedB,
    });
    const otherPlanLockPath = await writeWorkflowFileLock(
      workspace.root,
      "src/c.ts",
      {
        planPath: otherPlanPath,
        pid: 2147483645,
        createdAt: "2026-07-03T00:00:00.000Z",
        path: "src/c.ts",
      },
    );

    const result = await unlockWorkflowFileLocksForPlan({
      rootDir: workspace.root,
      planPath,
      isProcessAlive: () => false,
    });

    assert.equal(result.ok, true);
    assert.deepEqual(
      result.unlockedPaths.map((entry) => entry.metadata.path).sort(),
      [ownedA, ownedB],
    );
    assert.equal(existsSync(lockPathA), false);
    assert.equal(existsSync(lockPathB), false);
    assert.equal(existsSync(otherPlanLockPath), true);
  } finally {
    await workspace.cleanup();
  }
});

test("runWorkflowFileUnlock unlocks all stale same-plan locks when only plan path is passed", async () => {
  const workspace = await setupWorkspace();
  try {
    const planPath = ".ai/plans/current-plan.md";
    await writeWorkflowFileLock(workspace.root, "src/a.ts", {
      planPath,
      pid: 2147483647,
      createdAt: "2026-07-03T00:00:00.000Z",
      path: "src/a.ts",
    });
    await writeWorkflowFileLock(workspace.root, "src/b.ts", {
      planPath,
      pid: 2147483646,
      createdAt: "2026-07-03T00:00:00.000Z",
      path: "src/b.ts",
    });
    const stdout: string[] = [];
    const stderr: string[] = [];

    const exitCode = await runWorkflowFileUnlock({
      argv: [planPath],
      rootDir: workspace.root,
      stdout: (line) => stdout.push(line),
      stderr: (line) => stderr.push(line),
    });

    assert.equal(exitCode, 0);
    assert.deepEqual(stderr, []);
    assert.match(stdout.join("\n"), /Unlocked 2 files for \.ai\/plans\/current-plan\.md/);
    assert.match(stdout.join("\n"), /- src\/a\.ts/);
    assert.match(stdout.join("\n"), /- src\/b\.ts/);
  } finally {
    await workspace.cleanup();
  }
});

test("workflowFileUnlockPathHint prints the package-script command", () => {
  assert.equal(
    workflowFileUnlockPathHint(".ai/plans/current-plan.md"),
    "run this on the terminal:\npnpm workflow:unlock .ai/plans/current-plan.md",
  );
});
