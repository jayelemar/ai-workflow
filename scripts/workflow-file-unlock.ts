import { readFile, rm } from "node:fs/promises";
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

type WorkflowFileLockMetadata = {
  planPath: string;
  pid: number;
  createdAt: string;
  path: string;
};

const WORKFLOW_FILE_UNLOCK_USAGE =
  "Usage: pnpm workflow:unlock .ai/plans/<plan-name>.md <repo-relative-file-path>";

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
    path: record.path,
  };
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

export const workflowFileUnlockPathHint = (
  planPath: string,
  ownedPath: string,
): string =>
  `run this on the terminal:\npnpm workflow:unlock ${shellQuote(planPath)} ${shellQuote(ownedPath)}`;

export const unlockWorkflowFileLock = async ({
  rootDir,
  planPath,
  ownedPath,
  isProcessAlive = defaultIsProcessAlive,
}: {
  rootDir: string;
  planPath: string;
  ownedPath: string;
  isProcessAlive?: (pid: number) => boolean;
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
  if (isProcessAlive(metadata.pid)) {
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
  if (argv.length !== 2) {
    stderr(WORKFLOW_FILE_UNLOCK_USAGE);
    return 1;
  }

  const [planPath, ownedPath] = argv;
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
};

const isMain =
  process.argv[1] &&
  fileURLToPath(import.meta.url) === path.resolve(process.argv[1]);

if (isMain) {
  void runWorkflowFileUnlock({ argv: process.argv.slice(2) }).then((exitCode) => {
    process.exitCode = exitCode;
  });
}
