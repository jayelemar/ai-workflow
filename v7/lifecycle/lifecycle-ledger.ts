import { createHash } from "node:crypto";
import { mkdir, open, readFile } from "node:fs/promises";
import path from "node:path";

import type { LifecycleOutcome, LifecycleStage } from "./lifecycle.ts";

export type LifecycleTokenUsage = {
  inputTokens: number;
  cachedInputTokens: number;
  uncachedInputTokens: number;
  outputTokens: number;
  reasoningTokens: number;
  totalTokens: number;
};

export type LifecycleLedgerRecord = {
  version: 7;
  recordKind: "stage-attempt" | "decision" | "recovery";
  workflowId: string;
  runRevision: number;
  stage: LifecycleStage;
  attempt?: number;
  relatedAttempt?: number;
  outcome: LifecycleOutcome;
  startedAt: string;
  completedAt: string;
  durationMs: number;
  sessionId?: string;
  model?: string;
  reasoning?: string;
  taskId?: string;
  taskOwnershipHash?: string;
  remediationHash?: string;
  artifactHash?: string;
  tokenUsage: LifecycleTokenUsage;
  evidence?: string;
  previousHash: string | null;
  contentHash: string;
};

export type LedgerRecordInput = Omit<LifecycleLedgerRecord, "version" | "recordKind" | "previousHash" | "contentHash"> & {
  recordKind?: LifecycleLedgerRecord["recordKind"];
};
export type LedgerVerification = { valid: true; records: LifecycleLedgerRecord[] } | { valid: false; records: LifecycleLedgerRecord[]; reason: string };
export type LifecycleLedgerRead = { records: LifecycleLedgerRecord[]; parseError?: string };

const zeroUsage = (): LifecycleTokenUsage => ({ inputTokens: 0, cachedInputTokens: 0, uncachedInputTokens: 0, outputTokens: 0, reasoningTokens: 0, totalTokens: 0 });
export const isValidLifecycleTokenUsage = (usage: unknown, allowZero = true): usage is LifecycleTokenUsage => {
  if (!usage || typeof usage !== "object") return false;
  const value = usage as Partial<LifecycleTokenUsage>;
  const fields = [value.inputTokens, value.cachedInputTokens, value.uncachedInputTokens, value.outputTokens, value.reasoningTokens, value.totalTokens];
  if (!fields.every((field) => Number.isSafeInteger(field) && field >= 0)) return false;
  if (value.cachedInputTokens! > value.inputTokens! || value.reasoningTokens! > value.outputTokens!) return false;
  if (value.uncachedInputTokens !== value.inputTokens! - value.cachedInputTokens!) return false;
  if (value.totalTokens !== value.inputTokens! + value.outputTokens!) return false;
  return allowZero || value.totalTokens! > 0;
};
/** RFC 8785-compatible canonical JSON for V7's JSON-only evidence schemas. */
export const canonicalJson = (value: unknown): string => {
  if (value === null) return "null";
  if (typeof value === "string" || typeof value === "boolean") return JSON.stringify(value);
  if (typeof value === "number") {
    if (!Number.isFinite(value)) throw new Error("canonical JSON rejects non-finite number");
    return Object.is(value, -0) ? "0" : JSON.stringify(value);
  }
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(",")}]`;
  if (typeof value === "object") {
    const object = value as Record<string, unknown>;
    return `{${Object.keys(object).sort().map((key) => {
      if (object[key] === undefined) throw new Error(`canonical JSON rejects undefined field: ${key}`);
      return `${JSON.stringify(key)}:${canonicalJson(object[key])}`;
    }).join(",")}}`;
  }
  throw new Error(`canonical JSON rejects ${typeof value}`);
};
const hash = (value: unknown): string => createHash("sha256").update(canonicalJson(value), "utf8").digest("hex");

export const redactEvidence = (value: string | undefined): string | undefined => {
  if (!value) return undefined;
  return `Redacted evidence (${value.length} characters withheld).`;
};

const recordHashPayload = (record: Omit<LifecycleLedgerRecord, "contentHash">) => record;
const asRecord = (value: unknown): Record<string, unknown> | null => typeof value === "object" && value !== null ? value as Record<string, unknown> : null;

export const lifecycleLedgerPath = (revisionDir: string): string => path.join(revisionDir, "ledger.jsonl");

export const readLifecycleLedgerWithIntegrity = async (revisionDir: string): Promise<LifecycleLedgerRead> => {
  try {
    const content = await readFile(lifecycleLedgerPath(revisionDir), "utf8");
    const records: LifecycleLedgerRecord[] = [];
    for (const [index, line] of content.split(/\r?\n/).filter(Boolean).entries()) {
      try { records.push(JSON.parse(line) as LifecycleLedgerRecord); }
      catch { return { records, parseError: `ledger chain invalid: unreadable or truncated record ${index + 1}` }; }
    }
    return { records };
  } catch (error: unknown) {
    if (asRecord(error)?.code === "ENOENT") return { records: [] };
    throw error;
  }
};

export const readLifecycleLedger = async (revisionDir: string): Promise<LifecycleLedgerRecord[]> => {
  const result = await readLifecycleLedgerWithIntegrity(revisionDir);
  if (result.parseError) throw new Error(result.parseError);
  return result.records;
};

export const verifyLifecycleLedger = (records: LifecycleLedgerRecord[]): LedgerVerification => {
  let previousHash: string | null = null;
  for (let index = 0; index < records.length; index += 1) {
    const record = records[index];
    if (!isValidLifecycleTokenUsage(record.tokenUsage)
      || (record.recordKind === "stage-attempt" && (!Number.isSafeInteger(record.attempt) || record.attempt < 1))
      || (record.recordKind !== "stage-attempt" && record.attempt !== undefined)
      || !["stage-attempt", "decision", "recovery"].includes(record.recordKind)) {
      return { valid: false, records, reason: `ledger chain invalid at record ${index + 1}: invalid record schema` };
    }
    if (record.previousHash !== previousHash) return { valid: false, records, reason: `ledger chain broken at record ${index + 1}: previous hash mismatch` };
    const { contentHash, ...payload } = record;
    if (hash(recordHashPayload(payload)) !== contentHash) return { valid: false, records, reason: `ledger chain broken at record ${index + 1}: content hash mismatch` };
    previousHash = contentHash;
  }
  return { valid: true, records };
};

export const appendLifecycleLedgerRecord = async (
  revisionDir: string,
  input: LedgerRecordInput,
): Promise<LifecycleLedgerRecord> => {
  const recordKind = input.recordKind ?? "stage-attempt";
  if (!isValidLifecycleTokenUsage(input.tokenUsage ?? zeroUsage())) throw new Error("invalid V7 lifecycle token usage");
  if (recordKind === "stage-attempt" && (!Number.isSafeInteger(input.attempt) || input.attempt < 1)) {
    throw new Error("stage-attempt ledger record requires a positive attempt number");
  }
  if (recordKind !== "stage-attempt" && input.attempt !== undefined) {
    throw new Error("administrative V7 ledger record cannot have an attempt number");
  }
  const records = await readLifecycleLedger(revisionDir);
  const verified = verifyLifecycleLedger(records);
  if (!verified.valid) throw new Error(`refusing ledger append: ${verified.reason}`);
  const previousHash = records.at(-1)?.contentHash ?? null;
  const payload = Object.fromEntries(Object.entries({
    version: 7,
    recordKind,
    ...input,
    evidence: redactEvidence(input.evidence),
    tokenUsage: input.tokenUsage ?? zeroUsage(),
    previousHash,
  }).filter(([, value]) => value !== undefined)) as Omit<LifecycleLedgerRecord, "contentHash">;
  const entry: LifecycleLedgerRecord = { ...payload, contentHash: hash(recordHashPayload(payload)) };
  await mkdir(revisionDir, { recursive: true });
  const handle = await open(lifecycleLedgerPath(revisionDir), "a");
  try {
    await handle.writeFile(`${canonicalJson(entry)}\n`, "utf8");
    await handle.sync();
  } finally { await handle.close(); }
  const directory = await open(revisionDir, "r");
  try { await directory.sync(); } finally { await directory.close(); }
  return entry;
};
