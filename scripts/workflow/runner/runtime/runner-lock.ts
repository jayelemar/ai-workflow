import { mkdir, open, readFile, rm } from "node:fs/promises";
import path from "node:path";

import { thinPlanArtifactPath } from "../plan/thin-plan-sidecars.ts";
import type { Failure } from "../types.ts";

const runnerLockPath = (planName: string): string =>
  thinPlanArtifactPath(planName, "state", "runner.lock");

const processIsAlive = (pid: number): boolean => {
  try {
    process.kill(pid, 0);
    return true;
  } catch (error) {
    return (error as NodeJS.ErrnoException).code === "EPERM";
  }
};

const lockOwnerPid = (content: string): number | undefined => {
  try {
    const value = JSON.parse(content) as { pid?: unknown };
    return typeof value.pid === "number" && Number.isInteger(value.pid)
      ? value.pid
      : undefined;
  } catch {
    return undefined;
  }
};

export const acquireWorkflowRunnerLock = async ({
  rootDir,
  planName,
  pid = process.pid,
  isPidAlive = processIsAlive,
}: {
  rootDir: string;
  planName: string;
  pid?: number;
  isPidAlive?: (pid: number) => boolean;
}): Promise<
  | { ok: true; release: () => Promise<void> }
  | Failure
> => {
  const relativePath = runnerLockPath(planName);
  const absolutePath = path.join(rootDir, relativePath);
  const token = `${pid}:${Date.now()}:${Math.random().toString(36).slice(2)}`;
  const contents = `${JSON.stringify({ pid, token, startedAt: new Date().toISOString() })}\n`;

  for (let attempt = 0; attempt < 2; attempt += 1) {
    try {
      await mkdir(path.dirname(absolutePath), { recursive: true });
      const handle = await open(absolutePath, "wx");
      await handle.writeFile(contents, "utf8");
      await handle.close();
      return {
        ok: true,
        release: async () => {
          try {
            const current = await readFile(absolutePath, "utf8");
            if (current === contents) {
              await rm(absolutePath, { force: true });
            }
          } catch (error) {
            if ((error as NodeJS.ErrnoException).code !== "ENOENT") {
              throw error;
            }
          }
        },
      };
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== "EEXIST") {
        return {
          ok: false,
          reason: `workflow runner lock cannot be acquired: ${String(error)}`,
        };
      }
    }

    let ownerPid: number | undefined;
    try {
      ownerPid = lockOwnerPid(await readFile(absolutePath, "utf8"));
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== "ENOENT") {
        return {
          ok: false,
          reason: `workflow runner lock cannot be inspected: ${String(error)}`,
        };
      }
      continue;
    }
    if (ownerPid !== undefined && !isPidAlive(ownerPid)) {
      await rm(absolutePath, { force: true });
      continue;
    }
    return {
      ok: false,
      reason: `workflow runner is already active for ${planName}${ownerPid === undefined ? "" : ` (pid ${ownerPid})`}; wait for it to finish or stop it before starting another runner`,
    };
  }

  return {
    ok: false,
    reason: `workflow runner lock changed while acquiring ${relativePath}; retry the runner once`,
  };
};
