import { createHash } from "node:crypto";
import { mkdir, open, readFile } from "node:fs/promises";
import path from "node:path";

import { canonicalJson } from "./lifecycle-ledger.ts";
import type { LifecycleState } from "./lifecycle.ts";
import type { TaskOwnershipManifest } from "./lifecycle-store.ts";

export type TaskRemediationResult = {
  version: 7;
  workflowId: string;
  runRevision: number;
  taskId: string;
  changedFiles: string[];
  summary: string;
  completedAt: string;
  remediationHash: string;
};

export const taskRemediationArtifactPath = (revisionDir: string, taskId: string, attempt: number): string =>
  path.join(revisionDir, "remediation", `remediation-${taskId}-${attempt}.json`);

const remediationHash = (payload: Omit<TaskRemediationResult, "remediationHash">): string =>
  createHash("sha256").update(canonicalJson(payload), "utf8").digest("hex");

const validate = (result: TaskRemediationResult): TaskRemediationResult => {
  const { remediationHash: storedHash, ...payload } = result;
  if (result.version !== 7 || !result.workflowId || !Number.isSafeInteger(result.runRevision) || result.runRevision < 1
    || !result.taskId || !Array.isArray(result.changedFiles) || !result.changedFiles.length || !result.summary.trim()
    || !result.completedAt || remediationHash(payload) !== storedHash) {
    throw new Error("invalid V7 task remediation result");
  }
  if (!result.changedFiles.every(path.isAbsolute) || new Set(result.changedFiles).size !== result.changedFiles.length || result.changedFiles.join("\n") !== [...result.changedFiles].sort().join("\n")) {
    throw new Error("V7 task remediation changed files must be unique sorted absolute paths");
  }
  return result;
};

export const readTaskRemediationResult = async (resultPath: string): Promise<TaskRemediationResult> =>
  validate(JSON.parse(await readFile(resultPath, "utf8")) as TaskRemediationResult);

export const writeTaskRemediationArtifact = async ({
  revisionDir,
  state,
  ownership,
  attempt,
  result,
}: {
  revisionDir: string;
  state: LifecycleState;
  ownership: TaskOwnershipManifest;
  attempt: number;
  result: TaskRemediationResult;
}): Promise<TaskRemediationResult> => {
  validate(result);
  if (!Number.isSafeInteger(attempt) || attempt < 1 || result.workflowId !== state.workflowId || result.runRevision !== state.runRevision
    || result.taskId !== ownership.taskId || ownership.workflowId !== state.workflowId || ownership.runRevision !== state.runRevision
    || result.changedFiles.some((filePath) => !ownership.allowedFiles.includes(filePath))) {
    throw new Error("V7 task remediation does not match immutable task ownership");
  }
  const target = taskRemediationArtifactPath(revisionDir, result.taskId, attempt);
  await mkdir(path.dirname(target), { recursive: true });
  try {
    const handle = await open(target, "wx");
    try {
      await handle.writeFile(`${canonicalJson(result)}\n`, "utf8");
      await handle.sync();
    } finally { await handle.close(); }
    return result;
  } catch (error: unknown) {
    if ((error as NodeJS.ErrnoException).code !== "EEXIST") throw error;
    const existing = await readTaskRemediationResult(target);
    if (canonicalJson(existing) !== canonicalJson(result)) throw new Error("V7 task remediation artifact collision or replay");
    throw new Error("V7 task remediation replay is rejected");
  }
};
