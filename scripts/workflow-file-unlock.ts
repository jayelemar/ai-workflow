import { readFile, readdir, rm } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { workflowFileLockPath } from "./workflow-runner.ts";

type UnlockFailure = {
  ok: false;
  reason: string;
};

type UnlockSuccess = {
  ok: true;
  lockPath: string;
  metadata: WorkflowFileLockMetadata;
};

type UnlockManySuccess = {
  ok: true;
  unlockedPaths: UnlockSuccess[];
};

type WorkflowFileLockMetadata = {
  planPath: string;
  pid: number;
  createdAt: string;
  heartbeatAt?: string;
  path: string;
};

const WORKFLOW_FILE_UNLOCK_USAGE =
  "Usage: pnpm exec tsx .ai/scripts/workflow-file-unlock.ts .ai/plans/<plan-name>.md [repo-relative-file-path]";
const WORKFLOW_FILE_LOCK_STALE_AFTER_MS = 30 * 60_000;

const shellQuote = (value: string): string => {
  if (/^[A-Za-z0-9_./:@%+=,-]+$/.test(value)) {
    return value;
  }
  return `'${value.replace(/'/g, "'\\''")}'`;
};

const parseWorkflowFileLockMetadata = (
  raw: string,
  lockPath: string,
): WorkflowFileLockMetadata | UnlockFailure => {
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    return {
      ok: false,
      reason: `workflow file lock is malformed: ${lockPath}`,
    };
  }

  if (!parsed || typeof parsed !== "object") {
    return {
      ok: false,
      reason: `workflow file lock is malformed: ${lockPath}`,
    };
  }

  const record = parsed as Record<string, unknown>;
  if (
    typeof record.planPath !== "string" ||
    !Number.isInteger(record.pid) ||
    (record.pid as number) <= 0 ||
    typeof record.createdAt !== "string" ||
    (record.heartbeatAt !== undefined && typeof record.heartbeatAt !== "string") ||
    typeof record.path !== "string"
  ) {
    return {
      ok: false,
      reason: `workflow file lock is malformed: ${lockPath}`,
    };
  }

  return {
    planPath: record.planPath,
    pid: record.pid as number,
    createdAt: record.createdAt,
    heartbeatAt: record.heartbeatAt as string | undefined,
    path: record.path,
  };
};

const isWorkflowFileLockStale = (
  metadata: WorkflowFileLockMetadata,
  now = Date.now(),
): boolean => {
  const leaseAt = Date.parse(metadata.heartbeatAt ?? metadata.createdAt);
  return Number.isFinite(leaseAt) && now - leaseAt > WORKFLOW_FILE_LOCK_STALE_AFTER_MS;
};

const defaultIsProcessAlive = (pid: number): boolean => {
  try {
    process.kill(pid, 0);
    return true;
  } catch (error) {
    const code = (error as NodeJS.ErrnoException).code;
    return code === "EPERM";
  }
};

const workflowFileLockDir = (rootDir: string): string =>
  path.join(rootDir, ".ai", "artifacts", "file-locks");

export const workflowFileUnlockPathHint = (planPath: string): string =>
  `run this on the terminal:\npnpm exec tsx .ai/scripts/workflow-file-unlock.ts ${shellQuote(planPath)}`;

export const unlockWorkflowFileLock = async ({
  rootDir,
  planPath,
  ownedPath,
  isProcessAlive = defaultIsProcessAlive,
  now = () => Date.now(),
}: {
  rootDir: string;
  planPath: string;
  ownedPath: string;
  isProcessAlive?: (pid: number) => boolean;
  now?: () => number;
}): Promise<UnlockSuccess | UnlockFailure> => {
  const lockPath = workflowFileLockPath(rootDir, ownedPath);
  let raw: string;
  try {
    raw = await readFile(lockPath, "utf8");
  } catch (error) {
    const code = (error as NodeJS.ErrnoException).code;
    if (code === "ENOENT") {
      return {
        ok: false,
        reason: `workflow file lock not found for ${ownedPath}`,
      };
    }
    return {
      ok: false,
      reason: `workflow file lock cannot be read: ${lockPath}: ${String(error)}`,
    };
  }

  const metadata = parseWorkflowFileLockMetadata(raw, lockPath);
  if (!("planPath" in metadata)) {
    return metadata;
  }
  if (metadata.path !== ownedPath) {
    return {
      ok: false,
      reason: `workflow file lock path mismatch: expected ${ownedPath}, found ${metadata.path}`,
    };
  }
  if (metadata.planPath !== planPath) {
    return {
      ok: false,
      reason: `workflow file lock is owned by another plan: ${metadata.planPath}`,
    };
  }
  if (isProcessAlive(metadata.pid) && !isWorkflowFileLockStale(metadata, now())) {
    return {
      ok: false,
      reason: `workflow file lock pid ${metadata.pid} is still running for ${planPath}`,
    };
  }

  try {
    await rm(lockPath, { force: true });
  } catch (error) {
    return {
      ok: false,
      reason: `workflow file lock cannot be removed: ${lockPath}: ${String(error)}`,
    };
  }

  return {
    ok: true,
    lockPath,
    metadata,
  };
};

export const unlockWorkflowFileLocksForPlan = async ({
  rootDir,
  planPath,
  isProcessAlive = defaultIsProcessAlive,
  now = () => Date.now(),
}: {
  rootDir: string;
  planPath: string;
  isProcessAlive?: (pid: number) => boolean;
  now?: () => number;
}): Promise<UnlockManySuccess | UnlockFailure> => {
  let entries: string[];
  try {
    entries = await readdir(workflowFileLockDir(rootDir));
  } catch (error) {
    const code = (error as NodeJS.ErrnoException).code;
    if (code === "ENOENT") {
      return {
        ok: false,
        reason: `no workflow file locks found for ${planPath}`,
      };
    }
    return {
      ok: false,
      reason: `workflow file lock directory cannot be read: ${String(error)}`,
    };
  }

  const unlockedPaths: UnlockSuccess[] = [];
  for (const entry of entries) {
    if (!entry.endsWith(".json")) {
      continue;
    }
    const lockPath = path.join(workflowFileLockDir(rootDir), entry);
    let raw: string;
    try {
      raw = await readFile(lockPath, "utf8");
    } catch (error) {
      return {
        ok: false,
        reason: `workflow file lock cannot be read: ${lockPath}: ${String(error)}`,
      };
    }

    const metadata = parseWorkflowFileLockMetadata(raw, lockPath);
    if (!("planPath" in metadata)) {
      return metadata;
    }
    if (metadata.planPath !== planPath) {
      continue;
    }
    if (isProcessAlive(metadata.pid) && !isWorkflowFileLockStale(metadata, now())) {
      continue;
    }

    try {
      await rm(lockPath, { force: true });
    } catch (error) {
      return {
        ok: false,
        reason: `workflow file lock cannot be removed: ${lockPath}: ${String(error)}`,
      };
    }
    unlockedPaths.push({
      ok: true,
      lockPath,
      metadata,
    });
  }

  if (unlockedPaths.length === 0) {
    return {
      ok: false,
      reason: `no stale workflow file locks found for ${planPath}`,
    };
  }

  return { ok: true, unlockedPaths };
};

export const runWorkflowFileUnlock = async ({
  argv,
  rootDir = process.cwd(),
  stdout = (line: string) => console.log(line),
  stderr = (line: string) => console.error(line),
}: {
  argv: string[];
  rootDir?: string;
  stdout?: (line: string) => void;
  stderr?: (line: string) => void;
}): Promise<number> => {
  if (argv.length < 1 || argv.length > 2) {
    stderr(WORKFLOW_FILE_UNLOCK_USAGE);
    return 1;
  }

  const [planPath, ownedPath] = argv;
  if (ownedPath) {
    const result = await unlockWorkflowFileLock({
      rootDir,
      planPath,
      ownedPath,
    });
    if (!result.ok) {
      stderr(`FAILED: ${result.reason}`);
      return 1;
    }

    stdout(`Unlocked ${ownedPath}`);
    stdout(`Removed ${path.relative(rootDir, result.lockPath)}`);
    return 0;
  }

  const result = await unlockWorkflowFileLocksForPlan({
    rootDir,
    planPath,
  });
  if (!result.ok) {
    stderr(`FAILED: ${result.reason}`);
    return 1;
  }

  stdout(`Unlocked ${result.unlockedPaths.length} files for ${planPath}`);
  for (const unlockedPath of result.unlockedPaths) {
    stdout(`- ${unlockedPath.metadata.path}`);
  }
  return 0;
};

const isMain =
  process.argv[1] &&
  fileURLToPath(import.meta.url) === path.resolve(process.argv[1]);

if (isMain) {
  void runWorkflowFileUnlock({ argv: process.argv.slice(2) }).then((exitCode) => {
    process.exitCode = exitCode;
  });
}
