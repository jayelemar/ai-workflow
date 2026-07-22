import { readFile } from "node:fs/promises";
import path from "node:path";

import {
  asRecord,
  type Failure,
  type ThinPlanFilesState,
  type ThinPlanWorkflowState,
} from "../types.ts";
import { DOCUMENT_FORMATS, validateDocumentFormat } from "../../document-formats.ts";
import { isWorkflowState } from "./parser.ts";
const rel = (...segments: string[]) => segments.join("/");
const asStringArray = (value: unknown): string[] | undefined =>
  Array.isArray(value) && value.every((item) => typeof item === "string")
    ? (value as string[])
    : undefined;
export const thinPlanArtifactPath = (
  planName: string,
  ...segments: string[]
): string => rel(".ai", "artifacts", planName, ...segments);

export const readJsonArtifact = async (
  rootDir: string,
  relativePath: string,
): Promise<unknown | Failure> => {
  let raw: string;
  try {
    raw = await readFile(path.join(rootDir, relativePath), "utf8");
  } catch (error) {
    return {
      ok: false,
      reason: `thin-plan artifact cannot be read: ${relativePath}: ${String(error)}`,
    };
  }
  try {
    return JSON.parse(raw) as unknown;
  } catch {
    return {
      ok: false,
      reason: `thin-plan artifact is malformed JSON: ${relativePath}`,
    };
  }
};

const workflowEventHistoryIndex = (
  history: string[] | undefined,
  event: Record<string, unknown> | undefined,
): number => {
  if (!history || history.length === 0 || !event) {
    return -1;
  }
  const candidates = [event.path, event.evidence].filter(
    (value): value is string => typeof value === "string" && value.length > 0,
  );
  const indexes = candidates
    .map((candidate) => history.indexOf(candidate))
    .filter((index) => index >= 0);
  return indexes.length > 0 ? Math.min(...indexes) : -1;
};

const canonicalLatestRecord = (
  stage: string,
  value: unknown,
  artifactPath: string,
): Failure | undefined => {
  const record = asRecord(value);
  if (!record) {
    return { ok: false, reason: `thin-plan latest.${stage} is malformed: ${artifactPath}` };
  }
  const allowed = new Set(
    stage === "review" && record.outcome === "active"
      ? ["version", "outcome", "summary", "evidence", "unresolvedFindings"]
      : ["version", "outcome", "summary", "evidence"],
  );
  if (
    !Number.isInteger(record.version) ||
    (record.version as number) <= 0 ||
    typeof record.outcome !== "string" ||
    typeof record.summary !== "string" ||
    typeof record.evidence !== "string" ||
    Object.keys(record).some((key) => !allowed.has(key)) ||
    ("unresolvedFindings" in record &&
      (!Array.isArray(record.unresolvedFindings) ||
        !record.unresolvedFindings.every((item) => typeof item === "string")))
  ) {
    return {
      ok: false,
      reason: `thin-plan latest.${stage} must use canonical version, outcome, summary, and evidence fields: ${artifactPath}`,
    };
  }
  return undefined;
};

export const normalizeWorkflowEventHistory = (
  value: unknown,
): string[] | undefined => {
  if (!Array.isArray(value)) {
    return undefined;
  }
  const history = value.map((entry) => {
    if (typeof entry === "string") {
      return entry;
    }
    const event = asRecord(entry);
    const pointer = event?.path ?? event?.evidence;
    return typeof pointer === "string" && pointer.length > 0
      ? pointer
      : undefined;
  });
  return history.every((entry): entry is string => typeof entry === "string")
    ? history
    : undefined;
};

export const workflowReviewSupersededByProgress = (
  latest: Record<string, unknown> | undefined,
  history: string[] | undefined,
): boolean => {
  const reviewIndex = workflowEventHistoryIndex(
    history,
    asRecord(latest?.review) ?? undefined,
  );
  if (reviewIndex < 0) {
    return false;
  }
  return ["execution", "validation"].some((kind) => {
    const eventIndex = workflowEventHistoryIndex(
      history,
      asRecord(latest?.[kind]) ?? undefined,
    );
    return eventIndex > reviewIndex;
  });
};

export const parseThinPlanWorkflowState = (
  raw: unknown,
  expectedPlanPath: string,
  artifactPath: string,
): ThinPlanWorkflowState | Failure => {
  const record = asRecord(raw);
  const format = validateDocumentFormat("workflowState", raw, artifactPath);
  if (format.ok === false) return { ok: false, reason: format.reason };
  const planPath = record?.planPath;
  const workflowState = record?.workflowState;
  if (record?.status !== undefined || record?.nextAction !== undefined) {
    return { ok: false, reason: `thin-plan workflow state must use only workflowState: ${artifactPath}` };
  }
  const updatedAt = record?.updatedAt;
  const unresolvedBlockers = asStringArray(record?.unresolvedBlockers) ?? [];
  const history = normalizeWorkflowEventHistory(record?.history);

  if (typeof planPath !== "string" || planPath !== expectedPlanPath || typeof updatedAt !== "string") {
    return {
      ok: false,
      reason: `thin-plan workflow state is malformed: ${artifactPath}`,
    };
  }
  if (typeof workflowState !== "string" || !isWorkflowState(workflowState)) {
    return { ok: false, reason: `unknown workflowState value: ${String(workflowState)}` };
  }

  const latest = asRecord(record?.latest) ?? undefined;
  if (latest) {
    for (const [stage, value] of Object.entries(latest)) {
      const invalid = canonicalLatestRecord(stage, value, artifactPath);
      if (invalid) return invalid;
    }
  }
  return {
    documentFormat: DOCUMENT_FORMATS.workflowState,
    planPath,
    workflowState,
    latest,
    history,
    unresolvedBlockers,
    updatedAt,
  };
};

export const parseThinPlanFilesState = (
  raw: unknown,
  artifactPath: string,
): ThinPlanFilesState | Failure => {
  const record = asRecord(raw);
  const format = validateDocumentFormat("filesState", raw, artifactPath);
  if (format.ok === false) return { ok: false, reason: format.reason };
  const created = asStringArray(record?.created);
  const modified = asStringArray(record?.modified);
  const deleted = asStringArray(record?.deleted);
  const changedFiles = asStringArray(record?.changedFiles);
  const released = asStringArray(record?.released);
  const headSha = record?.headSha;
  if (
    !created ||
    !modified ||
    !deleted ||
    !changedFiles ||
    !released ||
    typeof headSha !== "string"
  ) {
    return {
      ok: false,
      reason: `thin-plan files state is malformed: ${artifactPath}`,
    };
  }
  return {
    documentFormat: DOCUMENT_FORMATS.filesState,
    created,
    modified,
    deleted,
    changedFiles,
    released,
    headSha,
  };
};
