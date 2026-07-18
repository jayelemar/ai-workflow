import { createHash, randomUUID } from "node:crypto";
import { mkdir, open, readFile, rm } from "node:fs/promises";
import path from "node:path";

import { canonicalJson } from "./lifecycle-ledger.ts";
import { v7Root } from "./lifecycle-store.ts";

export const LIFECYCLE_LOCK_STALE_AFTER_MS = 90_000;

export type LifecycleLock = {
  workflowId: string;
  runRevision: number;
  ownerId: string;
  pid: number;
  acquiredAt: string;
  heartbeatAt: string;
  lockHash: string;
};

type LifecycleLockPayload = Omit<LifecycleLock, "lockHash">;

export const lifecycleLockPath = (revisionDir: string): string => path.join(revisionDir, "lifecycle.lock.json");
export const workflowRevisionLockPath = (rootDir: string, workflowName: string): string => path.join(v7Root(rootDir, workflowName), "revision.lock");

const lockHash = (lock: LifecycleLockPayload): string => createHash("sha256").update(canonicalJson(lock), "utf8").digest("hex");
const withHash = (lock: LifecycleLockPayload): LifecycleLock => ({ ...lock, lockHash: lockHash(lock) });

const asLifecycleLock = (value: unknown): LifecycleLock | null => {
  if (!value || typeof value !== "object") return null;
  const lock = value as Partial<LifecycleLock>;
  if (typeof lock.workflowId !== "string" || !Number.isSafeInteger(lock.runRevision) || lock.runRevision < 0
    || typeof lock.ownerId !== "string" || !lock.ownerId || !Number.isSafeInteger(lock.pid)
    || typeof lock.acquiredAt !== "string" || Number.isNaN(Date.parse(lock.acquiredAt))
    || typeof lock.heartbeatAt !== "string" || Number.isNaN(Date.parse(lock.heartbeatAt))
    || typeof lock.lockHash !== "string") return null;
  const { lockHash: storedHash, ...payload } = lock as LifecycleLock;
  return lockHash(payload) === storedHash ? lock as LifecycleLock : null;
};

const syncDirectory = async (directory: string): Promise<void> => {
  const handle = await open(directory, "r");
  try { await handle.sync(); } finally { await handle.close(); }
};

const readOwnedLock = async (revisionDir: string, ownerId: string): Promise<LifecycleLock> => {
  const lock = await readLifecycleLock(revisionDir);
  if (!lock) throw new Error("V7 lifecycle lock ownership lost");
  if (lock.ownerId !== ownerId) throw new Error("V7 lifecycle lock ownership lost");
  return lock;
};

export const acquireLifecycleLock = async (
  revisionDir: string,
  lock: Omit<LifecycleLockPayload, "ownerId" | "pid" | "acquiredAt" | "heartbeatAt"> & Partial<Pick<LifecycleLockPayload, "ownerId" | "pid">>,
): Promise<LifecycleLock> => {
  await mkdir(revisionDir, { recursive: true });
  const now = new Date().toISOString();
  const entry = withHash({
    ...lock,
    ownerId: lock.ownerId ?? randomUUID(),
    pid: lock.pid ?? process.pid,
    acquiredAt: now,
    heartbeatAt: now,
  });
  try {
    const handle = await open(lifecycleLockPath(revisionDir), "wx");
    try {
      await handle.writeFile(`${canonicalJson(entry)}\n`, "utf8");
      await handle.sync();
    } finally { await handle.close(); }
    await syncDirectory(revisionDir);
    return entry;
  } catch (error: unknown) {
    if ((error as NodeJS.ErrnoException).code === "EEXIST") throw new Error(`V7 lifecycle lock is already held: ${revisionDir}`);
    throw error;
  }
};

export const readLifecycleLock = async (revisionDir: string): Promise<LifecycleLock | null> => {
  try {
    const lock = asLifecycleLock(JSON.parse(await readFile(lifecycleLockPath(revisionDir), "utf8")));
    if (!lock) throw new Error("V7 lifecycle lock is malformed or has an invalid hash");
    return lock;
  } catch (error: unknown) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return null;
    throw error;
  }
};

export const heartbeatLifecycleLock = async (revisionDir: string, ownerId: string): Promise<LifecycleLock> => {
  const current = await readOwnedLock(revisionDir, ownerId);
  const { lockHash: currentHash, ...payload } = current;
  const updated = withHash({ ...payload, heartbeatAt: new Date().toISOString() });
  const handle = await open(lifecycleLockPath(revisionDir), "r+");
  try {
    const observed = asLifecycleLock(JSON.parse(await handle.readFile("utf8")));
    if (!observed || observed.ownerId !== ownerId || observed.lockHash !== currentHash) throw new Error("V7 lifecycle lock ownership lost");
    const serialized = `${canonicalJson(updated)}\n`;
    await handle.write(serialized, 0, "utf8");
    await handle.truncate(Buffer.byteLength(serialized));
    await handle.sync();
  } finally { await handle.close(); }
  return updated;
};

export const isStaleLifecycleLock = async (revisionDir: string, staleAfterMs = LIFECYCLE_LOCK_STALE_AFTER_MS): Promise<boolean> => {
  if (staleAfterMs !== LIFECYCLE_LOCK_STALE_AFTER_MS) throw new Error(`V7 lifecycle stale interval must be ${LIFECYCLE_LOCK_STALE_AFTER_MS}ms`);
  const lock = await readLifecycleLock(revisionDir);
  if (!lock) return false;
  const heartbeatAt = Date.parse(lock.heartbeatAt);
  return heartbeatAt <= Date.now() && Date.now() - heartbeatAt >= staleAfterMs;
};

export const recoverStaleLifecycleLock = async (revisionDir: string, staleAfterMs: number, reason: string): Promise<void> => {
  if (!reason.trim()) throw new Error("stale lock recovery requires recorded reason");
  if (!(await isStaleLifecycleLock(revisionDir, staleAfterMs))) throw new Error("V7 lifecycle lock is not stale");
  throw new Error("V7 stale lock recovery unavailable: this runtime lacks required flock and renameat2 no-replace primitives");
};

/**
 * Empty unpublished locks require flock + renameat2 no-replace semantics. Node
 * exposes neither primitive, so recovery is deliberately rejected rather than
 * risking deletion of a concurrently published lock.
 */
export const recoverUnpublishedLifecycleLock = async (revisionDir: string, reason: string): Promise<never> => {
  if (reason !== "unpublished-empty") throw new Error("unpublished lock recovery requires reason unpublished-empty");
  const content = await readFile(lifecycleLockPath(revisionDir), "utf8").catch((error: unknown) => {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") throw new Error("V7 lifecycle lock is not present");
    throw error;
  });
  if (content.length !== 0) throw new Error("V7 lifecycle lock is not an unpublished empty lock");
  throw new Error("V7 unpublished lock recovery unavailable: this runtime lacks required flock and renameat2 no-replace primitives");
};

export const releaseLifecycleLock = async (revisionDir: string, ownerId: string): Promise<void> => {
  await readOwnedLock(revisionDir, ownerId);
  await rm(lifecycleLockPath(revisionDir));
  await syncDirectory(revisionDir);
};

/** Serializes revision allocation without sharing or mutating lifecycle locks. */
export const withWorkflowRevisionLock = async <T>(
  rootDir: string,
  workflowName: string,
  run: () => Promise<T>,
): Promise<T> => {
  const lockPath = workflowRevisionLockPath(rootDir, workflowName);
  await mkdir(path.dirname(lockPath), { recursive: true });
  const entry = withHash({
    workflowId: `allocation:${workflowName}`,
    runRevision: 0,
    ownerId: randomUUID(),
    pid: process.pid,
    acquiredAt: new Date().toISOString(),
    heartbeatAt: new Date().toISOString(),
  });
  let created = false;
  try {
    const handle = await open(lockPath, "wx");
    created = true;
    try {
      await handle.writeFile(`${canonicalJson(entry)}\n`, "utf8");
      await handle.sync();
    } finally { await handle.close(); }
    await syncDirectory(path.dirname(lockPath));
    return await run();
  } catch (error: unknown) {
    if ((error as NodeJS.ErrnoException).code === "EEXIST") throw new Error(`V7 revision allocation lock is already held: ${workflowName}`);
    throw error;
  } finally {
    if (created) {
      const owned = await readFile(lockPath, "utf8").then((content) => asLifecycleLock(JSON.parse(content))).catch(() => null);
      if (owned?.ownerId === entry.ownerId) {
        await rm(lockPath, { force: true });
        await syncDirectory(path.dirname(lockPath));
      }
    }
  }
};
