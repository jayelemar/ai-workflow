import { createHash } from "node:crypto";
import { mkdir, open, readdir, readFile } from "node:fs/promises";
import path from "node:path";

import { appendLifecycleLedgerRecord, canonicalJson, isValidLifecycleTokenUsage, readLifecycleLedger, type LifecycleTokenUsage } from "../lifecycle/lifecycle-ledger.ts";
import { regenerateLifecycleReport } from "../lifecycle/lifecycle-report.ts";
import { NO_CODEX_COMPLETING_STAGES, resumeAfterDecision, routeDecisionNeeded, routePreRunArtifactRepair, transitionLifecycle, type LifecycleOutcome, type LifecycleState } from "../lifecycle/lifecycle.ts";
import { lifecycleRevisionDir, writeLifecycleState } from "../lifecycle/lifecycle-store.ts";
import { writeStageCompletionArtifact } from "../lifecycle/lifecycle-recovery.ts";
import { assertV7StagePolicy } from "../lifecycle/stage-policy.ts";

const zeroUsage: LifecycleTokenUsage = { inputTokens: 0, cachedInputTokens: 0, uncachedInputTokens: 0, outputTokens: 0, reasoningTokens: 0, totalTokens: 0 };
export type ReviewFinding = {
  findingCode: string;
  severity: "LOW" | "MEDIUM" | "HIGH";
  material: boolean;
  deterministic: boolean;
  message: string;
  options?: Array<{ id: string; summary: string }>;
  recommendationId?: string;
};
export type ReviewResponse = {
  sessionId: string;
  model?: string;
  reasoning?: string;
  tokenUsage: LifecycleTokenUsage;
  verdict: "OKAY" | "FINDINGS";
  findings?: ReviewFinding[];
  coveredDecisionIds?: string[];
};

export type DecisionNeededArtifact = {
  version: 7;
  workflowId: string;
  runRevision: number;
  stage: "plan-review";
  attempt: number;
  findingCode: string;
  severity: ReviewFinding["severity"];
  options: Array<{ id: string; summary: string }>;
  recommendationId?: string;
  createdAt: string;
  decisionHash: string;
};
export type DecisionResolutionArtifact = {
  version: 7;
  workflowId: string;
  runRevision: number;
  findingCode: string;
  resolutionId: string;
  decisionHash: string;
  selectedOptionId: string;
  resolvedAt: string;
  resolutionHash: string;
};

const decisionDirectory = (revisionDir: string): string => path.join(revisionDir, "decisions");
export const decisionNeededArtifactPath = (revisionDir: string, attempt: number): string => path.join(decisionDirectory(revisionDir), `decision-needed-${attempt}.json`);
export const decisionResolutionArtifactPath = (revisionDir: string, resolutionId: string): string => path.join(decisionDirectory(revisionDir), `decision-resolution-${resolutionId}.json`);
const decisionHash = (payload: Omit<DecisionNeededArtifact, "decisionHash">): string => createHash("sha256").update(canonicalJson(payload), "utf8").digest("hex");
const resolutionHash = (payload: Omit<DecisionResolutionArtifact, "resolutionHash">): string => createHash("sha256").update(canonicalJson(payload), "utf8").digest("hex");

export const writeDecisionNeededArtifact = async ({
  revisionDir,
  state,
  finding,
  attempt,
  createdAt = new Date().toISOString(),
}: {
  revisionDir: string;
  state: LifecycleState;
  finding: ReviewFinding;
  attempt: number;
  createdAt?: string;
}): Promise<DecisionNeededArtifact> => {
  if (!finding.findingCode || !Number.isSafeInteger(attempt) || attempt < 1) throw new Error("Decision Needed requires a finding identity and Plan Review attempt");
  const options = (finding.options?.length ? finding.options : [{ id: "operator-review", summary: "Operator review required." }])
    .map((option) => ({ id: option.id, summary: `Redacted option summary (${option.summary.length} characters withheld).` }));
  if (options.some((option) => !option.id)) throw new Error("Decision Needed options require stable IDs");
  const payload = {
    version: 7 as const,
    workflowId: state.workflowId,
    runRevision: state.runRevision,
    stage: "plan-review" as const,
    attempt,
    findingCode: finding.findingCode,
    severity: finding.severity,
    options,
    recommendationId: finding.recommendationId,
    createdAt,
  };
  const entry: DecisionNeededArtifact = { ...payload, decisionHash: decisionHash(payload) };
  await mkdir(decisionDirectory(revisionDir), { recursive: true });
  const handle = await open(decisionNeededArtifactPath(revisionDir, attempt), "wx");
  try {
    await handle.writeFile(`${canonicalJson(entry)}\n`, "utf8");
    await handle.sync();
  } finally { await handle.close(); }
  return entry;
};

export const readDecisionNeededArtifact = async (decisionPath: string): Promise<DecisionNeededArtifact> => {
  const entry = JSON.parse(await readFile(decisionPath, "utf8")) as DecisionNeededArtifact;
  const { decisionHash: storedHash, ...payload } = entry;
  if (!entry.findingCode || !Number.isSafeInteger(entry.attempt) || entry.attempt < 1 || !Array.isArray(entry.options)
    || decisionHash(payload) !== storedHash) throw new Error("invalid V7 Decision Needed artifact");
  return entry;
};

export const writeDecisionResolutionArtifact = async ({
  revisionDir,
  decision,
  resolutionId,
  selectedOptionId,
  resolvedAt = new Date().toISOString(),
}: {
  revisionDir: string;
  decision: DecisionNeededArtifact;
  resolutionId: string;
  selectedOptionId: string;
  resolvedAt?: string;
}): Promise<DecisionResolutionArtifact> => {
  if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(resolutionId)
    || !decision.options.some((option) => option.id === selectedOptionId)) throw new Error("invalid V7 decision resolution input");
  const payload = { version: 7 as const, workflowId: decision.workflowId, runRevision: decision.runRevision, findingCode: decision.findingCode, resolutionId, decisionHash: decision.decisionHash, selectedOptionId, resolvedAt };
  const entry: DecisionResolutionArtifact = { ...payload, resolutionHash: resolutionHash(payload) };
  const handle = await open(decisionResolutionArtifactPath(revisionDir, resolutionId), "wx");
  try {
    await handle.writeFile(`${canonicalJson(entry)}\n`, "utf8");
    await handle.sync();
  } finally { await handle.close(); }
  return entry;
};

export const readDecisionResolutionArtifact = async (resolutionPath: string): Promise<DecisionResolutionArtifact> => {
  const entry = JSON.parse(await readFile(resolutionPath, "utf8")) as DecisionResolutionArtifact;
  const { resolutionHash: storedHash, ...payload } = entry;
  if (!entry.resolutionId || !entry.decisionHash || resolutionHash(payload) !== storedHash) throw new Error("invalid V7 decision resolution artifact");
  return entry;
};

export const recordLifecycleAttempt = async ({
  rootDir,
  state,
  outcome,
  codexBacked = false,
  sessionId,
  model,
  reasoning,
  tokenUsage = zeroUsage,
  taskId,
  taskOwnershipHash,
  remediationHash,
  evidence,
  advance,
  startedAt = new Date().toISOString(),
  completedAt = new Date().toISOString(),
}: {
  rootDir: string;
  state: LifecycleState;
  outcome: LifecycleOutcome;
  codexBacked?: boolean;
  sessionId?: string;
  model?: string;
  reasoning?: string;
  tokenUsage?: LifecycleTokenUsage;
  taskId?: string;
  taskOwnershipHash?: string;
  remediationHash?: string;
  evidence?: string;
  advance?: boolean;
  startedAt?: string;
  completedAt?: string;
}): Promise<LifecycleState> => {
  await assertV7StagePolicy(state.currentStage);
  const revisionDir = lifecycleRevisionDir(rootDir, state.workflowName, state.runRevision);
  const records = await readLifecycleLedger(revisionDir);
  if (sessionId && records.some((record) => record.sessionId === sessionId)) throw new Error("V7 exact Codex session ID is already bound to this lifecycle revision");
  const stageRequiresCodex = !NO_CODEX_COMPLETING_STAGES.includes(state.currentStage);
  if (codexBacked !== stageRequiresCodex) throw new Error(`V7 stage Codex policy mismatch: ${state.currentStage}`);
  if (!codexBacked && (sessionId || tokenUsage.totalTokens !== 0)) throw new Error(`no-Codex V7 stage requires all-zero usage and no session: ${state.currentStage}`);
  if (codexBacked && outcome === "skipped") throw new Error(`Codex-backed V7 stage cannot be skipped: ${state.currentStage}`);
  if (!codexBacked && outcome === "succeeded") throw new Error(`no-Codex V7 stage must use zero-token success: ${state.currentStage}`);
  const invalidUsage = codexBacked && (!sessionId || !isValidLifecycleTokenUsage(tokenUsage, false));
  const effectiveOutcome: LifecycleOutcome = invalidUsage ? "usage-unavailable" : outcome;
  const effectiveTokenUsage = invalidUsage ? zeroUsage : tokenUsage;
  const attempt = records.filter((record) => record.recordKind === "stage-attempt" && record.stage === state.currentStage).length + 1;
  const completion = codexBacked && effectiveOutcome !== "usage-unavailable" && sessionId && effectiveTokenUsage.totalTokens > 0
    ? await writeStageCompletionArtifact({ revisionDir, workflowId: state.workflowId, runRevision: state.runRevision, stage: state.currentStage, attempt, sessionId, outcome: effectiveOutcome, tokenUsage: effectiveTokenUsage, completedAt })
    : undefined;
  await appendLifecycleLedgerRecord(revisionDir, {
    workflowId: state.workflowId,
    runRevision: state.runRevision,
    stage: state.currentStage,
    attempt,
    outcome: effectiveOutcome,
    startedAt,
    completedAt,
    durationMs: Math.max(0, Date.parse(completedAt) - Date.parse(startedAt)),
    sessionId,
    model,
    reasoning,
    tokenUsage: effectiveTokenUsage,
    taskId,
    taskOwnershipHash,
    remediationHash,
    artifactHash: completion?.artifactHash,
    evidence: invalidUsage ? "Codex call missing explicit readable exact-session token usage." : evidence,
  });
  const next = transitionLifecycle(state, effectiveOutcome, completedAt, { advance }).state;
  await writeLifecycleState(rootDir, next);
  await regenerateLifecycleReport(revisionDir, next);
  return next;
};

export const isAllowedPreRunRepairPath = ({ rootDir, workflowName, specPath, planPath, candidate }: {
  rootDir: string;
  workflowName: string;
  specPath: string;
  planPath: string;
  candidate: string;
}): boolean => {
  const absolute = path.resolve(rootDir, candidate);
  const allowed = [path.resolve(rootDir, specPath), path.resolve(rootDir, planPath)];
  const artifacts = path.resolve(rootDir, ".ai", "artifacts", workflowName, "v7");
  return allowed.includes(absolute) || absolute.startsWith(`${artifacts}${path.sep}`);
};

const filesBelow = async (directory: string): Promise<string[]> => {
  try {
    const entries = await readdir(directory, { withFileTypes: true });
    return (await Promise.all(entries.map((entry) => entry.isDirectory() ? filesBelow(path.join(directory, entry.name)) : entry.isFile() ? [path.join(directory, entry.name)] : []))).flat();
  } catch { return []; }
};

const fileContent = async (filePath: string): Promise<string> => {
  try { return await readFile(filePath, "utf8"); } catch { return "<missing>"; }
};

const repairBaseline = async ({ rootDir, workflowName, specPath, planPath }: Pick<Parameters<typeof isAllowedPreRunRepairPath>[0], "rootDir" | "workflowName" | "specPath" | "planPath">): Promise<Map<string, string>> => {
  const artifacts = path.resolve(rootDir, ".ai", "artifacts", workflowName, "v7");
  const paths = [path.resolve(rootDir, specPath), path.resolve(rootDir, planPath), ...(await filesBelow(artifacts))];
  return new Map(await Promise.all(paths.map(async (filePath) => [filePath, await fileContent(filePath)] as const)));
};

export const runPlanReviewLoop = async ({
  rootDir,
  state,
  specPath,
  planPath,
  review,
  repair,
}: {
  rootDir: string;
  state: LifecycleState;
  specPath: string;
  planPath: string;
  review: () => Promise<ReviewResponse>;
  repair: (findings: ReviewFinding[]) => Promise<{ changedPaths: string[] }>;
}): Promise<{ state: LifecycleState; result: "approved" | "decision-needed" | "operator-needed" }> => {
  let current = state;
  const revisionDir = lifecycleRevisionDir(rootDir, current.workflowName, current.runRevision);
  const seenFindings = new Set<string>();
  while (current.currentStage === "plan-review" && current.runOutcome === "active") {
    const reviewResult = await review();
    const records = await readLifecycleLedger(revisionDir);
    if (records.some((record) => record.stage === "plan-review" && record.sessionId === reviewResult.sessionId)) {
      throw new Error("every Plan Review attempt requires a fresh isolated Codex session");
    }
    if (reviewResult.verdict === "OKAY") {
      await validateCoveredDecisionIds(revisionDir, reviewResult.coveredDecisionIds ?? []);
      current = await recordLifecycleAttempt({ rootDir, state: current, outcome: "succeeded", codexBacked: true, ...reviewResult, evidence: "Plan Review returned OKAY." });
      return { state: current, result: "approved" };
    }
    const findings = reviewResult.findings ?? [];
    if (!findings.length) throw new Error("Plan Review FINDINGS response requires at least one finding");
    current = await recordLifecycleAttempt({ rootDir, state: current, outcome: "succeeded", codexBacked: true, ...reviewResult, advance: false, evidence: `Plan Review found ${findings.length} material finding(s).` });
    const fingerprint = findings.map((finding) => `${finding.severity}:${finding.findingCode}`).sort().join("|");
    const decisionReason = findings.some((finding) => finding.severity === "HIGH")
      ? "HIGH Plan Review finding requires operator direction."
      : findings.some((finding) => finding.findingCode === "insufficient-evidence")
        ? "Insufficient evidence requires operator direction."
      : findings.some((finding) => !finding.deterministic)
        ? "Non-deterministic Plan Review finding requires operator direction."
        : seenFindings.has(fingerprint)
          ? "Repeated Plan Review finding requires a fresh operator-directed review."
          : undefined;
    if (decisionReason) return routePlanReviewDecision({ rootDir, revisionDir, state: current, findings, reason: decisionReason });
    seenFindings.add(fingerprint);
    current = routePreRunArtifactRepair(current);
    await writeLifecycleState(rootDir, current);
    const baseline = await repairBaseline({ rootDir, workflowName: current.workflowName, specPath, planPath });
    const repairResult = await repair(findings);
    const changed = await Promise.all(repairResult.changedPaths.map(async (candidate) => {
      const absolute = path.resolve(rootDir, candidate);
      return isAllowedPreRunRepairPath({ rootDir, workflowName: current.workflowName, specPath, planPath, candidate }) && baseline.get(absolute) !== await fileContent(absolute);
    }));
    if (repairResult.changedPaths.length === 0 || changed.some((didChange) => !didChange)) {
      return routePlanReviewDecision({
        rootDir,
        revisionDir,
        state: current,
        findings: [{ ...findings[0], findingCode: "review-no-progress", deterministic: false, message: "No allowed repair progress." }],
        reason: "Pre-Run Artifact Repair made no allowed-file progress; operator direction and fresh review required.",
      });
    }
    current = await recordLifecycleAttempt({ rootDir, state: current, outcome: "zero-token", evidence: "Pre-Run Artifact Repair completed within allowed boundary." });
  }
  throw new Error(`cannot begin Plan Review loop from ${current.currentStage}/${current.runOutcome}`);
};

const routePlanReviewDecision = async ({ rootDir, revisionDir, state, findings, reason }: {
  rootDir: string;
  revisionDir: string;
  state: LifecycleState;
  findings: ReviewFinding[];
  reason: string;
}): Promise<{ state: LifecycleState; result: "decision-needed" }> => {
  const records = await readLifecycleLedger(revisionDir);
  const attempt = records.filter((record) => record.recordKind === "stage-attempt" && record.stage === "plan-review").at(-1)?.attempt;
  if (!attempt) throw new Error("Decision Needed requires a completed Plan Review attempt");
  const finding = findings[0];
  const decision = await writeDecisionNeededArtifact({ revisionDir, state, finding, attempt });
  const current = routeDecisionNeeded(state);
  const now = new Date().toISOString();
  await appendLifecycleLedgerRecord(revisionDir, {
    recordKind: "decision", workflowId: current.workflowId, runRevision: current.runRevision, stage: "decision-needed",
    outcome: "zero-token", startedAt: now, completedAt: now, durationMs: 0, tokenUsage: zeroUsage,
    artifactHash: decision.decisionHash, evidence: `Decision Needed: ${reason}`,
  });
  await writeLifecycleState(rootDir, current);
  await regenerateLifecycleReport(revisionDir, current);
  return { state: current, result: "decision-needed" };
};

const decisionArtifacts = async (revisionDir: string): Promise<DecisionNeededArtifact[]> => {
  try {
    const entries = await readdir(decisionDirectory(revisionDir));
    return Promise.all(entries.filter((entry) => /^decision-needed-\d+\.json$/.test(entry)).map((entry) => readDecisionNeededArtifact(path.join(decisionDirectory(revisionDir), entry))));
  } catch { return []; }
};

const decisionResolutionArtifacts = async (revisionDir: string): Promise<DecisionResolutionArtifact[]> => {
  try {
    const entries = await readdir(decisionDirectory(revisionDir));
    return Promise.all(entries.filter((entry) => /^decision-resolution-[0-9a-f-]+\.json$/i.test(entry)).map((entry) => readDecisionResolutionArtifact(path.join(decisionDirectory(revisionDir), entry))));
  } catch { return []; }
};

const validateCoveredDecisionIds = async (revisionDir: string, decisionHashes: string[]): Promise<void> => {
  if (new Set(decisionHashes).size !== decisionHashes.length) throw new Error("duplicate covered V7 decision ID");
  const decisions = await decisionArtifacts(revisionDir);
  const resolutions = await decisionResolutionArtifacts(revisionDir);
  const records = await readLifecycleLedger(revisionDir);
  for (const decisionHash of decisionHashes) {
    const resolution = resolutions.find((candidate) => candidate.decisionHash === decisionHash);
    if (!decisions.some((decision) => decision.decisionHash === decisionHash) || !resolution
      || !records.some((record) => record.recordKind === "decision" && record.artifactHash === resolution.resolutionHash)) {
      throw new Error("covered V7 decision is unknown, unresolved, or stale");
    }
  }
};

export const resolveV7Decision = async ({
  rootDir,
  state,
  decisionPath,
  resolutionId,
  selectedOptionId,
}: {
  rootDir: string;
  state: LifecycleState;
  decisionPath: string;
  resolutionId: string;
  selectedOptionId: string;
}): Promise<DecisionResolutionArtifact> => {
  if (state.currentStage !== "decision-needed" || state.runOutcome !== "active") throw new Error("V7 decision resolution requires active Decision Needed state");
  const revisionDir = lifecycleRevisionDir(rootDir, state.workflowName, state.runRevision);
  const decision = await readDecisionNeededArtifact(decisionPath);
  if (decision.workflowId !== state.workflowId || decision.runRevision !== state.runRevision) throw new Error("V7 decision belongs to another lifecycle revision");
  return writeDecisionResolutionArtifact({ revisionDir, decision, resolutionId, selectedOptionId });
};

export const resumeV7Decision = async ({ rootDir, state, resolutionId }: { rootDir: string; state: LifecycleState; resolutionId: string }): Promise<LifecycleState> => {
  if (state.currentStage !== "decision-needed" || state.runOutcome !== "active") throw new Error("V7 decision resume requires active Decision Needed state");
  const revisionDir = lifecycleRevisionDir(rootDir, state.workflowName, state.runRevision);
  const resolution = await readDecisionResolutionArtifact(decisionResolutionArtifactPath(revisionDir, resolutionId));
  const decision = (await decisionArtifacts(revisionDir)).find((candidate) => candidate.decisionHash === resolution.decisionHash);
  if (!decision || resolution.workflowId !== state.workflowId || resolution.runRevision !== state.runRevision || resolution.findingCode !== decision.findingCode
    || !decision.options.some((option) => option.id === resolution.selectedOptionId)) throw new Error("V7 decision resolution is stale or mismatched");
  const records = await readLifecycleLedger(revisionDir);
  if (records.some((record) => record.recordKind === "decision" && record.artifactHash === resolution.resolutionHash)) throw new Error("V7 decision resolution is already consumed");
  const now = new Date().toISOString();
  await appendLifecycleLedgerRecord(revisionDir, {
    recordKind: "decision", workflowId: state.workflowId, runRevision: state.runRevision, stage: "decision-needed", outcome: "zero-token",
    startedAt: now, completedAt: now, durationMs: 0, tokenUsage: zeroUsage, artifactHash: resolution.resolutionHash,
    evidence: "Decision resolution consumed; fresh Plan Review required.",
  });
  const next = resumeAfterDecision(state, now);
  await writeLifecycleState(rootDir, next);
  await regenerateLifecycleReport(revisionDir, next);
  return next;
};
