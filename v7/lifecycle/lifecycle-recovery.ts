import { createHash } from "node:crypto";
import { mkdir, open, readFile, readdir } from "node:fs/promises";
import path from "node:path";

import { appendLifecycleLedgerRecord, canonicalJson, isValidLifecycleTokenUsage, type LifecycleTokenUsage } from "./lifecycle-ledger.ts";
import { regenerateLifecycleReport } from "./lifecycle-report.ts";
import { transitionLifecycle, type LifecycleState } from "./lifecycle.ts";
import { writeLifecycleState } from "./lifecycle-store.ts";
import { recoverStaleLifecycleLock } from "./lifecycle-lock.ts";

export type InterruptedAttemptEvidence = {
  provable: boolean;
  sessionId?: string;
  tokenUsage?: LifecycleTokenUsage;
  reason: string;
};

export type StageCompletionArtifact = {
  version: 7;
  workflowId: string;
  runRevision: number;
  stage: LifecycleState["currentStage"];
  attempt: number;
  sessionId: string;
  outcome: "succeeded" | "failed" | "blocked" | "usage-unavailable" | "interrupted";
  tokenUsage: LifecycleTokenUsage;
  completedAt: string;
  artifactHash: string;
};
export type RecoveryArtifact = {
  version: 7;
  workflowId: string;
  runRevision: number;
  stage: LifecycleState["currentStage"];
  attempt: number;
  disposition: "completed" | "interrupted";
  completionArtifactHash?: string;
  ledgerRecordHash?: string;
  reasonCode: string;
  recoveredAt: string;
  recoveryHash: string;
};
export type IntegrityInterruptionArtifact = {
  version: 7;
  workflowId: string;
  runRevision: number;
  reasonCode: string;
  observedHashes: string[];
  createdAt: string;
  recoveryHash: string;
};
export type SourceAbandonmentArtifact = {
  version: 7;
  workflowId: string;
  runRevision: number;
  sourceRunRevision: number;
  sourceRecoveryHash: string;
  reasonCode: string;
  createdAt: string;
  recoveryHash: string;
};

const completionOutcome = (value: string): value is StageCompletionArtifact["outcome"] =>
  ["succeeded", "failed", "blocked", "usage-unavailable", "interrupted"].includes(value);
const artifactHash = (value: Omit<StageCompletionArtifact, "artifactHash">): string =>
  createHash("sha256").update(canonicalJson(value), "utf8").digest("hex");
const recoveryHash = (value: object): string => createHash("sha256").update(canonicalJson(value), "utf8").digest("hex");

export const stageCompletionArtifactPath = (revisionDir: string, stage: LifecycleState["currentStage"], attempt: number): string =>
  path.join(revisionDir, `stage-completion-${stage}-${attempt}.json`);
const recoveryDirectory = (revisionDir: string): string => path.join(revisionDir, "recovery");
export const recoveryArtifactPath = (revisionDir: string, stage: LifecycleState["currentStage"], attempt: number): string => path.join(recoveryDirectory(revisionDir), `recovery-${stage}-${attempt}.json`);
export const integrityInterruptionArtifactPath = (revisionDir: string, recoveryId: string): string => path.join(recoveryDirectory(revisionDir), `integrity-interruption-${recoveryId}.json`);
export const sourceAbandonmentArtifactPath = (revisionDir: string): string => path.join(recoveryDirectory(revisionDir), "source-abandonment.json");

const validIntegrityInterruption = (entry: IntegrityInterruptionArtifact): boolean => {
  const { recoveryHash: storedHash, ...payload } = entry;
  return entry.version === 7 && typeof entry.workflowId === "string" && Number.isSafeInteger(entry.runRevision)
    && typeof entry.reasonCode === "string" && Array.isArray(entry.observedHashes) && typeof entry.createdAt === "string"
    && storedHash === recoveryHash(payload);
};

export const readIntegrityInterruptionArtifacts = async (revisionDir: string): Promise<IntegrityInterruptionArtifact[]> => {
  let names: string[];
  try { names = await readdir(recoveryDirectory(revisionDir)); }
  catch (error: unknown) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return [];
    throw error;
  }
  const artifacts: IntegrityInterruptionArtifact[] = [];
  for (const name of names.filter((entry) => /^integrity-interruption-[a-z0-9-]+\.json$/i.test(entry)).sort()) {
    const parsed = JSON.parse(await readFile(path.join(recoveryDirectory(revisionDir), name), "utf8")) as IntegrityInterruptionArtifact;
    if (!validIntegrityInterruption(parsed)) throw new Error("invalid V7 integrity interruption artifact");
    artifacts.push(parsed);
  }
  return artifacts;
};

export const writeSourceAbandonmentArtifact = async ({
  revisionDir,
  state,
  sourceRunRevision,
  sourceRecoveryHash,
  reasonCode,
  createdAt = new Date().toISOString(),
}: {
  revisionDir: string;
  state: LifecycleState;
  sourceRunRevision: number;
  sourceRecoveryHash: string;
  reasonCode: string;
  createdAt?: string;
}): Promise<SourceAbandonmentArtifact> => {
  if (!reasonCode.trim() || !sourceRecoveryHash) throw new Error("V7 abandonment requires integrity evidence and reason");
  const payload = { version: 7 as const, workflowId: state.workflowId, runRevision: state.runRevision, sourceRunRevision, sourceRecoveryHash, reasonCode, createdAt };
  const entry: SourceAbandonmentArtifact = { ...payload, recoveryHash: recoveryHash(payload) };
  await mkdir(recoveryDirectory(revisionDir), { recursive: true });
  const target = sourceAbandonmentArtifactPath(revisionDir);
  const handle = await open(target, "wx");
  try {
    await handle.writeFile(`${canonicalJson(entry)}\n`, "utf8");
    await handle.sync();
  } finally { await handle.close(); }
  return entry;
};

const writeRecoveryArtifact = async (revisionDir: string, payload: Omit<RecoveryArtifact, "version" | "recoveryHash">): Promise<RecoveryArtifact> => {
  const entry: RecoveryArtifact = { version: 7, ...payload, recoveryHash: recoveryHash({ version: 7, ...payload }) };
  await mkdir(recoveryDirectory(revisionDir), { recursive: true });
  const artifactPath = recoveryArtifactPath(revisionDir, entry.stage, entry.attempt);
  try {
    const handle = await open(artifactPath, "wx");
    try {
      await handle.writeFile(`${canonicalJson(entry)}\n`, "utf8");
      await handle.sync();
    } finally { await handle.close(); }
    return entry;
  } catch (error: unknown) {
    if ((error as NodeJS.ErrnoException).code !== "EEXIST") throw error;
    const existing = JSON.parse(await readFile(artifactPath, "utf8")) as RecoveryArtifact;
    const { recoveryHash: storedHash, ...existingPayload } = existing;
    if (storedHash !== recoveryHash(existingPayload) || canonicalJson(existing) !== canonicalJson(entry)) throw new Error("V7 recovery artifact collision or tamper");
    return existing;
  }
};

export const readRecoveryArtifact = async (revisionDir: string, stage: LifecycleState["currentStage"], attempt: number): Promise<RecoveryArtifact> => {
  const entry = JSON.parse(await readFile(recoveryArtifactPath(revisionDir, stage, attempt), "utf8")) as RecoveryArtifact;
  const { recoveryHash: storedHash, ...payload } = entry;
  if (entry.version !== 7 || entry.stage !== stage || entry.attempt !== attempt || !entry.reasonCode || recoveryHash(payload) !== storedHash) {
    throw new Error("invalid V7 recovery artifact");
  }
  return entry;
};

export const recordIntegrityInterruption = async ({
  rootDir,
  revisionDir,
  state,
  reasonCode,
  observedHashes = [],
  recoveryId,
}: {
  rootDir: string;
  revisionDir: string;
  state: LifecycleState;
  reasonCode: string;
  observedHashes?: string[];
  recoveryId: string;
}): Promise<IntegrityInterruptionArtifact> => {
  if (!reasonCode || !recoveryId) throw new Error("integrity interruption requires reason and recovery identity");
  const payload = { version: 7 as const, workflowId: state.workflowId, runRevision: state.runRevision, reasonCode, observedHashes: [...observedHashes].sort(), createdAt: new Date().toISOString() };
  const entry: IntegrityInterruptionArtifact = { ...payload, recoveryHash: recoveryHash(payload) };
  await mkdir(recoveryDirectory(revisionDir), { recursive: true });
  const handle = await open(integrityInterruptionArtifactPath(revisionDir, recoveryId), "wx");
  try {
    await handle.writeFile(`${canonicalJson(entry)}\n`, "utf8");
    await handle.sync();
  } finally { await handle.close(); }
  const interrupted = { ...state, runOutcome: "interrupted" as const, updatedAt: new Date().toISOString() };
  await writeLifecycleState(rootDir, interrupted);
  await regenerateLifecycleReport(revisionDir, interrupted);
  return entry;
};

export const writeStageCompletionArtifact = async ({
  revisionDir,
  workflowId,
  runRevision,
  stage,
  attempt,
  sessionId,
  outcome,
  tokenUsage,
  completedAt,
}: Omit<StageCompletionArtifact, "version" | "artifactHash"> & { revisionDir: string }): Promise<StageCompletionArtifact> => {
  if (!sessionId || !isValidLifecycleTokenUsage(tokenUsage, false) || !completionOutcome(outcome)) throw new Error("invalid Codex completion artifact");
  const payload = { version: 7 as const, workflowId, runRevision, stage, attempt, sessionId, outcome, tokenUsage, completedAt };
  const entry: StageCompletionArtifact = { ...payload, artifactHash: artifactHash(payload) };
  await mkdir(revisionDir, { recursive: true });
  const handle = await open(stageCompletionArtifactPath(revisionDir, stage, attempt), "wx");
  try {
    await handle.writeFile(`${canonicalJson(entry)}\n`, "utf8");
    await handle.sync();
  } finally { await handle.close(); }
  return entry;
};

export const readStageCompletionArtifact = async (revisionDir: string, stage: LifecycleState["currentStage"], attempt: number): Promise<StageCompletionArtifact> => {
  const parsed = JSON.parse(await readFile(stageCompletionArtifactPath(revisionDir, stage, attempt), "utf8")) as StageCompletionArtifact;
  const { artifactHash: storedHash, ...payload } = parsed;
  if (!completionOutcome(parsed.outcome) || !parsed.sessionId || !isValidLifecycleTokenUsage(parsed.tokenUsage, false) || artifactHash(payload) !== storedHash) {
    throw new Error("invalid V7 stage completion artifact");
  }
  return parsed;
};

export const recoverInterruptedLifecycle = async ({
  rootDir,
  revisionDir,
  state,
  evidence,
}: {
  rootDir: string;
  revisionDir: string;
  state: LifecycleState;
  evidence: InterruptedAttemptEvidence;
}): Promise<LifecycleState> => {
  const records = await (await import("./lifecycle-ledger.ts")).readLifecycleLedger(revisionDir);
  const startedAt = state.updatedAt;
  const completedAt = new Date().toISOString();
  // A caller assertion is never proof. Only the immutable artifact/session/ledger
  // tuple accepted by recoverInterruptedLifecycleFromArtifact may advance a run.
  const provable = false;
  const outcome = provable ? "succeeded" : "interrupted";
  await appendLifecycleLedgerRecord(revisionDir, {
    workflowId: state.workflowId,
    runRevision: state.runRevision,
    stage: state.currentStage,
    attempt: records.filter((record) => record.stage === state.currentStage).length + 1,
    outcome,
    startedAt,
    completedAt,
    durationMs: Math.max(0, Date.parse(completedAt) - Date.parse(startedAt)),
    sessionId: evidence.sessionId,
    tokenUsage: evidence.tokenUsage ?? { inputTokens: 0, cachedInputTokens: 0, uncachedInputTokens: 0, outputTokens: 0, reasoningTokens: 0, totalTokens: 0 },
    evidence: provable ? evidence.reason : "Interrupted Codex attempt cannot be proved from exact session and token evidence; explicit retry required.",
  });
  const next = transitionLifecycle(state, outcome, completedAt).state;
  await writeLifecycleState(rootDir, next);
  await regenerateLifecycleReport(revisionDir, next);
  return next;
};

export const recoverInterruptedLifecycleFromArtifact = async ({
  rootDir,
  revisionDir,
  state,
  stage,
  attempt,
  sessionId,
  tokenUsage,
}: {
  rootDir: string;
  revisionDir: string;
  state: LifecycleState;
  stage: LifecycleState["currentStage"];
  attempt: number;
  sessionId: string;
  tokenUsage: LifecycleTokenUsage;
}): Promise<LifecycleState> => {
  if (state.currentStage !== stage || !Number.isSafeInteger(attempt) || attempt < 1 || !isValidLifecycleTokenUsage(tokenUsage, false)) {
    throw new Error("invalid V7 recovery proof identity");
  }
  const artifact = await readStageCompletionArtifact(revisionDir, stage, attempt);
  if (artifact.workflowId !== state.workflowId || artifact.runRevision !== state.runRevision || artifact.sessionId !== sessionId
    || canonicalJson(artifact.tokenUsage) !== canonicalJson(tokenUsage)) {
    throw new Error("V7 recovery proof does not match immutable completion artifact");
  }
  const { readLifecycleLedger, verifyLifecycleLedger } = await import("./lifecycle-ledger.ts");
  const records = await readLifecycleLedger(revisionDir);
  const integrity = verifyLifecycleLedger(records);
  if (!integrity.valid) throw new Error(`V7 recovery proof rejected: ${integrity.reason}`);
  const existing = records.find((record) => record.recordKind === "stage-attempt" && record.stage === stage && record.attempt === attempt);
  if (existing && (existing.sessionId !== artifact.sessionId || existing.artifactHash !== artifact.artifactHash || existing.outcome !== artifact.outcome)) {
    throw new Error("V7 recovery proof conflicts with existing ledger attempt");
  }
  const original = existing ?? await appendLifecycleLedgerRecord(revisionDir, {
      workflowId: state.workflowId,
      runRevision: state.runRevision,
      stage,
      attempt,
      outcome: artifact.outcome,
      startedAt: state.updatedAt,
      completedAt: artifact.completedAt,
      durationMs: Math.max(0, Date.parse(artifact.completedAt) - Date.parse(state.updatedAt)),
      sessionId: artifact.sessionId,
      tokenUsage: artifact.tokenUsage,
      artifactHash: artifact.artifactHash,
      evidence: "Recovered from immutable stage completion artifact and exact-session token proof.",
    });
  const recovery = await writeRecoveryArtifact(revisionDir, {
    workflowId: state.workflowId,
    runRevision: state.runRevision,
    stage,
    attempt,
    disposition: "completed",
    completionArtifactHash: artifact.artifactHash,
    ledgerRecordHash: original.contentHash,
    reasonCode: "artifact-ledger-session-proof",
    recoveredAt: artifact.completedAt,
  });
  const refreshed = await readLifecycleLedger(revisionDir);
  if (!refreshed.some((record) => record.recordKind === "recovery" && record.stage === stage && record.relatedAttempt === attempt && record.artifactHash === recovery.recoveryHash)) {
    const now = new Date().toISOString();
    await appendLifecycleLedgerRecord(revisionDir, {
      recordKind: "recovery", workflowId: state.workflowId, runRevision: state.runRevision, stage, relatedAttempt: attempt,
      outcome: "zero-token", startedAt: now, completedAt: now, durationMs: 0,
      tokenUsage: { inputTokens: 0, cachedInputTokens: 0, uncachedInputTokens: 0, outputTokens: 0, reasoningTokens: 0, totalTokens: 0 },
      artifactHash: recovery.recoveryHash, evidence: "Immutable recovery proof applied.",
    });
  }
  const next = transitionLifecycle(state, artifact.outcome, artifact.completedAt).state;
  await writeLifecycleState(rootDir, next);
  await regenerateLifecycleReport(revisionDir, next);
  return next;
};

export const recoverStaleLockWithEvidence = async ({
  rootDir,
  revisionDir,
  state,
  staleAfterMs,
  reason,
}: {
  rootDir: string;
  revisionDir: string;
  state: LifecycleState;
  staleAfterMs: number;
  reason: string;
}): Promise<LifecycleState> => {
  await recoverStaleLifecycleLock(revisionDir, staleAfterMs, reason);
  return recordRecoveryEvidence({ rootDir, revisionDir, state, reason: `Stale lifecycle lock recovered: ${reason}` });
};

const recordRecoveryEvidence = async ({ rootDir, revisionDir, state, reason }: { rootDir: string; revisionDir: string; state: LifecycleState; reason: string }): Promise<LifecycleState> => {
  const now = new Date().toISOString();
  await appendLifecycleLedgerRecord(revisionDir, {
    recordKind: "recovery",
    workflowId: state.workflowId,
    runRevision: state.runRevision,
    stage: state.currentStage,
    outcome: "zero-token",
    startedAt: now,
    completedAt: now,
    durationMs: 0,
    tokenUsage: { inputTokens: 0, cachedInputTokens: 0, uncachedInputTokens: 0, outputTokens: 0, reasoningTokens: 0, totalTokens: 0 },
    evidence: reason,
  });
  await writeLifecycleState(rootDir, state);
  await regenerateLifecycleReport(revisionDir, state);
  return state;
};
