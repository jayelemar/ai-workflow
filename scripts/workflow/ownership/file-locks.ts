import { createHash } from "node:crypto";
import { rmSync } from "node:fs";
import { mkdir, readFile, rm, writeFile } from "node:fs/promises";
import path from "node:path";

import {
  asRecord,
  type Failure,
  type WorkflowFileLockMetadata,
} from "../runner/types.ts";

export const WORKFLOW_FILE_LOCK_HEARTBEAT_INTERVAL_MS = 60_000;
const WORKFLOW_FILE_LOCK_STALE_AFTER_MS = 30 * 60_000;

const activeWorkflowFileLockPaths = new Set<string>();

export const workflowFileLockDir = (rootDir: string): string =>
  path.join(rootDir, ".ai", "workflow-state", "file-locks");

export const workflowFileLockPath = (
  rootDir: string,
  relativePath: string,
): string => {
  const digest = createHash("sha256").update(relativePath).digest("hex");
  return path.join(workflowFileLockDir(rootDir), `${digest}.json`);
};

const releaseActiveWorkflowFileLocksOnExit = () => {
  for (const lockPath of activeWorkflowFileLockPaths) {
    try {
      rmSync(lockPath, { force: true });
    } catch {
      // Forced process exit cannot recover from a filesystem failure.
    }
  }
  activeWorkflowFileLockPaths.clear();
};

process.once("exit", releaseActiveWorkflowFileLocksOnExit);

export const parseWorkflowFileLockMetadata = (
  raw: string,
  lockPath: string,
): WorkflowFileLockMetadata | Failure => {
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    return {
      ok: false,
      reason: `workflow file lock is malformed: ${lockPath}`,
    };
  }

  const record = asRecord(parsed);
  const planPath = record?.planPath;
  const pid = record?.pid;
  const createdAt = record?.createdAt;
  const heartbeatAt = record?.heartbeatAt;
  const ownedPath = record?.path;
  if (
    typeof planPath !== "string" ||
    !Number.isInteger(pid) ||
    (pid as number) <= 0 ||
    typeof createdAt !== "string" ||
    (heartbeatAt !== undefined && typeof heartbeatAt !== "string") ||
    typeof ownedPath !== "string"
  ) {
    return {
      ok: false,
      reason: `workflow file lock is malformed: ${lockPath}`,
    };
  }

  return {
    planPath,
    pid: pid as number,
    createdAt,
    heartbeatAt: heartbeatAt as string | undefined,
    path: ownedPath,
  };
};

export const isWorkflowFileLockStale = (
  metadata: WorkflowFileLockMetadata,
  now = Date.now(),
): boolean => {
  const leaseAt = Date.parse(metadata.heartbeatAt ?? metadata.createdAt);
  return (
    Number.isFinite(leaseAt) &&
    now - leaseAt > WORKFLOW_FILE_LOCK_STALE_AFTER_MS
  );
};

const isProcessAlive = (pid: number): boolean => {
  try {
    process.kill(pid, 0);
    return true;
  } catch (error) {
    const code = (error as NodeJS.ErrnoException).code;
    return code === "EPERM";
  }
};

export const releaseWorkflowFileLocks = async (
  lockPaths: Set<string>,
): Promise<{ ok: true } | Failure> => {
  for (const lockPath of [...lockPaths]) {
    try {
      await rm(lockPath, { force: true });
      lockPaths.delete(lockPath);
      activeWorkflowFileLockPaths.delete(lockPath);
    } catch (error) {
      return {
        ok: false,
        reason: `workflow file lock cannot be released: ${lockPath}: ${String(error)}`,
      };
    }
  }
  return { ok: true };
};

export const refreshWorkflowFileLockHeartbeats = async ({
  lockPaths,
  now = () => new Date().toISOString(),
}: {
  lockPaths: Set<string>;
  now?: () => string;
}): Promise<void> => {
  for (const lockPath of [...lockPaths]) {
    let raw: string;
    try {
      raw = await readFile(lockPath, "utf8");
    } catch {
      lockPaths.delete(lockPath);
      continue;
    }

    const metadata = parseWorkflowFileLockMetadata(raw, lockPath);
    if (!("planPath" in metadata) || metadata.pid !== process.pid) {
      lockPaths.delete(lockPath);
      continue;
    }

    try {
      await writeFile(
        lockPath,
        JSON.stringify({ ...metadata, heartbeatAt: now() }),
        "utf8",
      );
    } catch {
      // Keep lock tracked so normal release still attempts cleanup.
    }
  }
};

export const acquireWorkflowFileOwnershipForPaths = async ({
  rootDir,
  planPath,
  paths,
  heldLockPaths,
  now = () => new Date().toISOString(),
  unlockHintForPlanPath,
}: {
  rootDir: string;
  planPath: string;
  paths: string[];
  heldLockPaths: Set<string>;
  now?: () => string;
  unlockHintForPlanPath?: (planPath: string) => string;
}): Promise<{ ok: true } | Failure> => {
  const acquiredThisAttempt = new Set<string>();
  const releaseAttemptLocks = async (): Promise<Failure | undefined> => {
    const attemptedLocks = [...acquiredThisAttempt];
    const released = await releaseWorkflowFileLocks(acquiredThisAttempt);
    for (const lockPath of attemptedLocks) {
      heldLockPaths.delete(lockPath);
    }
    return released.ok ? undefined : released;
  };

  try {
    await mkdir(workflowFileLockDir(rootDir), { recursive: true });
  } catch (error) {
    return {
      ok: false,
      reason: `workflow file lock directory cannot be created: ${String(error)}`,
    };
  }

  for (const ownedPath of [...new Set(paths)]) {
    const lockPath = workflowFileLockPath(rootDir, ownedPath);
    if (heldLockPaths.has(lockPath)) {
      continue;
    }

    const metadata: WorkflowFileLockMetadata = {
      planPath,
      pid: process.pid,
      createdAt: now(),
      heartbeatAt: now(),
      path: ownedPath,
    };

    while (true) {
      try {
        await writeFile(lockPath, JSON.stringify(metadata), { flag: "wx" });
        heldLockPaths.add(lockPath);
        acquiredThisAttempt.add(lockPath);
        activeWorkflowFileLockPaths.add(lockPath);
        break;
      } catch (error) {
        const code = (error as NodeJS.ErrnoException).code;
        if (code !== "EEXIST") {
          const releaseFailure = await releaseAttemptLocks();
          return (
            releaseFailure ?? {
              ok: false,
              reason: `workflow file lock cannot be created: ${lockPath}: ${String(error)}`,
            }
          );
        }
      }

      let existingRaw: string;
      try {
        existingRaw = await readFile(lockPath, "utf8");
      } catch (error) {
        const releaseFailure = await releaseAttemptLocks();
        return (
          releaseFailure ?? {
            ok: false,
            reason: `workflow file lock cannot be read: ${lockPath}: ${String(error)}`,
          }
        );
      }

      const existing = parseWorkflowFileLockMetadata(existingRaw, lockPath);
      if (!("planPath" in existing)) {
        const releaseFailure = await releaseAttemptLocks();
        return releaseFailure ?? existing;
      }
      if (existing.pid === process.pid && existing.planPath === planPath) {
        heldLockPaths.add(lockPath);
        activeWorkflowFileLockPaths.add(lockPath);
        break;
      }
      if (isProcessAlive(existing.pid) && !isWorkflowFileLockStale(existing)) {
        const unlockHint =
          existing.planPath === planPath && unlockHintForPlanPath
            ? `\n\n${unlockHintForPlanPath(planPath)}`
            : "";
        const releaseFailure = await releaseAttemptLocks();
        return (
          releaseFailure ?? {
            ok: false,
            reason: `workflow file ownership conflict: ${ownedPath} is already owned by ${existing.planPath} (pid ${existing.pid})${unlockHint}`,
          }
        );
      }

      try {
        await rm(lockPath, { force: true });
      } catch (error) {
        const releaseFailure = await releaseAttemptLocks();
        return (
          releaseFailure ?? {
            ok: false,
            reason: `stale workflow file lock cannot be removed: ${lockPath}: ${String(error)}`,
          }
        );
      }
    }
  }

  return { ok: true };
};
