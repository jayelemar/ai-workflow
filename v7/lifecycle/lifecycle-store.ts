import { createHash, randomUUID } from "node:crypto";
import { mkdir, open, readFile, readdir, rename } from "node:fs/promises";
import path from "node:path";

import type { LifecycleState } from "./lifecycle.ts";
import { assertNormalizedWorkflowName } from "./lifecycle.ts";
import { canonicalJson } from "./lifecycle-ledger.ts";

export type TaskOwnershipManifest = {
  version: 7;
  workflowId: string;
  runRevision: number;
  taskId: string;
  allowedFiles: string[];
  createdAt: string;
  ownershipHash: string;
};

export const v7Root = (rootDir: string, workflowName: string): string =>
  path.join(rootDir, ".ai", "artifacts", assertNormalizedWorkflowName(workflowName), "v7");
export const lifecycleRevisionDir = (rootDir: string, workflowName: string, runRevision: number): string =>
  path.join(v7Root(rootDir, workflowName), "runs", String(runRevision));
export const lifecycleStatePath = (revisionDir: string): string => path.join(revisionDir, "state.json");
export const lifecycleCurrentPath = (rootDir: string, workflowName: string): string => path.join(v7Root(rootDir, workflowName), "current.json");
export const taskOwnershipPath = (revisionDir: string, taskId: string): string => path.join(revisionDir, "tasks", `task-${taskId}-ownership.json`);
const ownershipHash = (value: Omit<TaskOwnershipManifest, "ownershipHash">): string => createHash("sha256").update(canonicalJson(value), "utf8").digest("hex");

export const writeTaskOwnershipManifest = async ({ revisionDir, workflowId, runRevision, taskId, allowedFiles, workflowRoot, createdAt = new Date().toISOString() }: Omit<TaskOwnershipManifest, "version" | "ownershipHash" | "allowedFiles"> & { revisionDir: string; allowedFiles: string[]; workflowRoot: string }): Promise<TaskOwnershipManifest> => {
  if (!taskId || !path.isAbsolute(workflowRoot) || !allowedFiles.length) throw new Error("V7 task ownership requires task ID, absolute workflow root, and allowed files");
  const root = path.resolve(workflowRoot);
  const normalized = [...new Set(allowedFiles.map((filePath) => path.resolve(filePath)))].sort();
  if (normalized.some((filePath) => !filePath.startsWith(`${root}${path.sep}`))) throw new Error("V7 task ownership file escapes workflow root");
  const payload = { version: 7 as const, workflowId, runRevision, taskId, allowedFiles: normalized, createdAt };
  const entry: TaskOwnershipManifest = { ...payload, ownershipHash: ownershipHash(payload) };
  const target = taskOwnershipPath(revisionDir, taskId);
  await mkdir(path.dirname(target), { recursive: true });
  const handle = await open(target, "wx");
  try {
    await handle.writeFile(`${canonicalJson(entry)}\n`, "utf8");
    await handle.sync();
  } finally { await handle.close(); }
  return entry;
};

export const readTaskOwnershipManifest = async (revisionDir: string, taskId: string): Promise<TaskOwnershipManifest> => {
  const entry = JSON.parse(await readFile(taskOwnershipPath(revisionDir, taskId), "utf8")) as TaskOwnershipManifest;
  const { ownershipHash: storedHash, ...payload } = entry;
  if (entry.taskId !== taskId || !Array.isArray(entry.allowedFiles) || ownershipHash(payload) !== storedHash) throw new Error("invalid V7 task ownership manifest");
  return entry;
};

const readJson = async <T>(filePath: string): Promise<T | null> => {
  try { return JSON.parse(await readFile(filePath, "utf8")) as T; } catch (error: unknown) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return null;
    throw error;
  }
};

const atomicWriteJson = async (filePath: string, value: unknown): Promise<void> => {
  await mkdir(path.dirname(filePath), { recursive: true });
  const temporary = `${filePath}.${process.pid}.${randomUUID()}.tmp`;
  const handle = await open(temporary, "wx");
  try {
    await handle.writeFile(`${JSON.stringify(value, null, 2)}\n`, "utf8");
    await handle.sync();
  } finally { await handle.close(); }
  await rename(temporary, filePath);
  const directory = await open(path.dirname(filePath), "r");
  try { await directory.sync(); } finally { await directory.close(); }
};

export const readLifecycleState = (revisionDir: string): Promise<LifecycleState | null> =>
  readJson<LifecycleState>(lifecycleStatePath(revisionDir));

export const readCurrentLifecycleState = async (rootDir: string, workflowName: string): Promise<LifecycleState | null> => {
  const current = await readJson<{ runRevision?: number }>(lifecycleCurrentPath(rootDir, workflowName));
  if (!current?.runRevision || !Number.isInteger(current.runRevision)) return null;
  return readLifecycleState(lifecycleRevisionDir(rootDir, workflowName, current.runRevision));
};

export const createLifecycleRevision = async (rootDir: string, state: LifecycleState): Promise<{ revisionDir: string }> => {
  const revisionDir = lifecycleRevisionDir(rootDir, state.workflowName, state.runRevision);
  const existing = await readLifecycleState(revisionDir);
  if (existing) throw new Error(`V7 lifecycle revision already exists: ${state.workflowName}#${state.runRevision}`);
  const current = await readCurrentLifecycleState(rootDir, state.workflowName);
  const isIntegrityAbandonmentSuccessor = current?.runOutcome === "interrupted"
    && state.linkedFromRevision === current.runRevision
    && state.currentStage === "plan-reopening";
  if ((current?.runOutcome === "active" || current?.runOutcome === "blocked" || current?.runOutcome === "interrupted") && !isIntegrityAbandonmentSuccessor) {
    throw new Error(`active V7 workflow already exists: ${state.workflowName}#${current.runRevision}`);
  }
  try {
    await mkdir(revisionDir, { recursive: false });
  } catch (error: unknown) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") {
      await mkdir(path.dirname(revisionDir), { recursive: true });
      try { await mkdir(revisionDir, { recursive: false }); }
      catch (retryError: unknown) {
        if ((retryError as NodeJS.ErrnoException).code === "EEXIST") throw new Error(`V7 lifecycle revision already exists: ${state.workflowName}#${state.runRevision}`);
        throw retryError;
      }
    } else if ((error as NodeJS.ErrnoException).code === "EEXIST") {
      throw new Error(`V7 lifecycle revision already exists: ${state.workflowName}#${state.runRevision}`);
    } else throw error;
  }
  await atomicWriteJson(lifecycleStatePath(revisionDir), state);
  await atomicWriteJson(lifecycleCurrentPath(rootDir, state.workflowName), { version: 7, workflowId: state.workflowId, runRevision: state.runRevision });
  return { revisionDir };
};

export const writeLifecycleState = async (rootDir: string, state: LifecycleState): Promise<void> => {
  const revisionDir = lifecycleRevisionDir(rootDir, state.workflowName, state.runRevision);
  const existing = await readLifecycleState(revisionDir);
  if (!existing) throw new Error(`V7 lifecycle revision does not exist: ${state.workflowName}#${state.runRevision}`);
  if (["completed", "superseded"].includes(existing.runOutcome) && JSON.stringify(existing) !== JSON.stringify(state)) {
    throw new Error(`completed or superseded V7 lifecycle revision is immutable: ${state.workflowName}#${state.runRevision}`);
  }
  await atomicWriteJson(lifecycleStatePath(revisionDir), state);
  await atomicWriteJson(lifecycleCurrentPath(rootDir, state.workflowName), { version: 7, workflowId: state.workflowId, runRevision: state.runRevision });
};

export const nextLifecycleRevision = async (rootDir: string, workflowName: string): Promise<number> => {
  const runsDir = path.join(v7Root(rootDir, workflowName), "runs");
  try {
    const entries = await readdir(runsDir, { withFileTypes: true });
    return Math.max(0, ...entries.filter((entry) => entry.isDirectory() && /^\d+$/.test(entry.name)).map((entry) => Number(entry.name))) + 1;
  } catch (error: unknown) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return 1;
    throw error;
  }
};
