import assert from "node:assert/strict";
import { existsSync, mkdirSync } from "node:fs";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { tmpdir } from "node:os";
import test from "node:test";

import {
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

test("workflowFileUnlockPathHint prints the package-script command", () => {
  assert.equal(
    workflowFileUnlockPathHint(
      ".ai/plans/current-plan.md",
      "src/components/layout/support-issue-widget.tsx",
    ),
    "run this on the terminal:\npnpm workflow:unlock .ai/plans/current-plan.md src/components/layout/support-issue-widget.tsx",
  );
});
