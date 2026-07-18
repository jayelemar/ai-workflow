import { createHash } from "node:crypto";
import { mkdir, open, readFile } from "node:fs/promises";
import path from "node:path";

import { canonicalJson } from "./lifecycle-ledger.ts";

export type V7Task = {
  id: string;
  title: string;
  files: string[];
  validation: string[];
  dependsOn: string[];
};

export type V7TaskQueue = {
  version: 7;
  workflowId: string;
  runRevision: number;
  workflowRoot: string;
  tasks: V7Task[];
  createdAt: string;
  queueHash: string;
};

export const taskQueuePath = (revisionDir: string): string => path.join(revisionDir, "tasks", "queue.json");
const queueHash = (value: Omit<V7TaskQueue, "queueHash">): string => createHash("sha256").update(canonicalJson(value), "utf8").digest("hex");

const validTask = (task: V7Task): boolean => /^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(task.id)
  && Boolean(task.title.trim()) && task.files.length > 0 && task.files.every(path.isAbsolute)
  && task.validation.length > 0 && task.validation.every((command) => Boolean(command.trim()))
  && task.dependsOn.every((id) => /^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(id));

export const writeV7TaskQueue = async ({ revisionDir, workflowId, runRevision, workflowRoot, tasks, createdAt = new Date().toISOString() }: Omit<V7TaskQueue, "version" | "createdAt" | "queueHash"> & { revisionDir: string; createdAt?: string }): Promise<V7TaskQueue> => {
  const root = path.resolve(workflowRoot);
  if (!path.isAbsolute(workflowRoot) || !tasks.length || new Set(tasks.map((task) => task.id)).size !== tasks.length || !tasks.every(validTask)
    || tasks.some((task, index) => task.files.some((file) => !path.resolve(file).startsWith(`${root}${path.sep}`)) || task.dependsOn.some((dependency) => !tasks.slice(0, index).some((earlier) => earlier.id === dependency)))) {
    throw new Error("invalid V7 immutable task queue");
  }
  const normalized = tasks.map((task) => ({ ...task, files: [...new Set(task.files.map((file) => path.resolve(file)))].sort(), validation: [...new Set(task.validation)], dependsOn: [...new Set(task.dependsOn)] }));
  const payload = { version: 7 as const, workflowId, runRevision, workflowRoot: root, tasks: normalized, createdAt };
  const entry: V7TaskQueue = { ...payload, queueHash: queueHash(payload) };
  const target = taskQueuePath(revisionDir);
  await mkdir(path.dirname(target), { recursive: true });
  const handle = await open(target, "wx");
  try { await handle.writeFile(`${canonicalJson(entry)}\n`, "utf8"); await handle.sync(); } finally { await handle.close(); }
  return entry;
};

export const readV7TaskQueue = async (revisionDir: string): Promise<V7TaskQueue> => {
  const entry = JSON.parse(await readFile(taskQueuePath(revisionDir), "utf8")) as V7TaskQueue;
  const { queueHash: storedHash, ...payload } = entry;
  if (entry.version !== 7 || !path.isAbsolute(entry.workflowRoot) || !Array.isArray(entry.tasks) || !entry.tasks.length || !entry.tasks.every(validTask)
    || storedHash !== queueHash(payload)) throw new Error("invalid V7 immutable task queue");
  return entry;
};
