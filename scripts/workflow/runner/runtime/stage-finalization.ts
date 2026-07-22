import { createHash } from "node:crypto";
import { mkdir, readFile, readdir, rm, writeFile } from "node:fs/promises";
import path from "node:path";

import type { WorkflowState } from "../../contracts/stage.ts";
import { DOCUMENT_FORMATS } from "../../document-formats.ts";
import { extractSectionValue } from "../plan/parser.ts";
import {
  readJsonArtifact,
  thinPlanArtifactPath,
} from "../plan/thin-plan-sidecars.ts";
import { writeManifestWorkflowState } from "../plan/state.ts";
import { asRecord, isFailure, type Failure, type ParsedPlan } from "../types.ts";

export type RunnerStageKind =
  | "sync"
  | "validation"
  | "execution"
  | "unblock"
  | "review"
  | "reopen";

export type RunnerStageDescriptor = {
  stage: RunnerStageKind;
  sourceWorkflowState: WorkflowState;
  version: number;
  eventPath: string;
};

type RoutingSnapshot = {
  manifest: string;
  workflow: string;
  files: string;
  ownership: string;
  manifestHash: string;
  workflowHash: string;
  filesHash: string;
  ownershipHash: string;
};

type TransitionJournal = {
  documentFormat: "workflow-transition@1";
  descriptor: RunnerStageDescriptor;
  source: RoutingSnapshot;
  target?: RoutingSnapshot;
  status: "reserved" | "finalizing" | "finalized";
};

type ParsedStageEvent = {
  outcome: string;
  summary: string;
  evidence: string;
  remediation: string[];
};

const isRoutingSnapshot = (value: unknown): value is RoutingSnapshot => {
  const snapshot = asRecord(value);
  return !!snapshot &&
    typeof snapshot.manifest === "string" &&
    typeof snapshot.workflow === "string" &&
    typeof snapshot.files === "string" &&
    typeof snapshot.ownership === "string" &&
    typeof snapshot.manifestHash === "string" &&
    typeof snapshot.workflowHash === "string" &&
    typeof snapshot.filesHash === "string" &&
    typeof snapshot.ownershipHash === "string";
};

const digest = (content: string): string =>
  createHash("sha256").update(content).digest("hex");

const workflowStatePath = (planName: string): string =>
  thinPlanArtifactPath(planName, "state", "workflow.json");

const filesStatePath = (planName: string): string =>
  thinPlanArtifactPath(planName, "state", "files.json");

const fileOwnershipPath = (planName: string): string =>
  thinPlanArtifactPath(planName, "state", "file-ownership.json");

const transitionJournalPath = (planName: string): string =>
  thinPlanArtifactPath(planName, "state", "transition.json");

const stageForState = (state: WorkflowState): RunnerStageKind => {
  switch (state) {
    case "draft-artifact-sync": return "sync";
    case "draft-validation": return "validation";
    case "approved":
    case "active": return "execution";
    case "blocked": return "unblock";
    case "review": return "review";
    case "reopening": return "reopen";
    case "completed": throw new Error("completed has no nonterminal stage event");
  }
};

const titleForStage = (stage: RunnerStageKind): string =>
  `${stage.slice(0, 1).toUpperCase()}${stage.slice(1)}`;

const asStringArray = (value: unknown): string[] =>
  Array.isArray(value) && value.every((item) => typeof item === "string")
    ? value
    : [];

const readRoutingSnapshot = async ({
  rootDir,
  plan,
}: {
  rootDir: string;
  plan: ParsedPlan;
}): Promise<RoutingSnapshot | Failure> => {
  try {
    const [manifest, workflow, files, ownership] = await Promise.all([
      readFile(plan.absolutePlanPath, "utf8"),
      readFile(path.join(rootDir, workflowStatePath(plan.planName)), "utf8"),
      readFile(path.join(rootDir, filesStatePath(plan.planName)), "utf8"),
      readFile(path.join(rootDir, fileOwnershipPath(plan.planName)), "utf8"),
    ]);
    return {
      manifest,
      workflow,
      files,
      ownership,
      manifestHash: digest(manifest),
      workflowHash: digest(workflow),
      filesHash: digest(files),
      ownershipHash: digest(ownership),
    };
  } catch (error) {
    return { ok: false, reason: `runner transition source cannot be read: ${String(error)}` };
  }
};

const writeJournal = async (
  rootDir: string,
  planName: string,
  journal: TransitionJournal,
): Promise<{ ok: true } | Failure> => {
  try {
    const journalPath = transitionJournalPath(planName);
    await mkdir(path.dirname(path.join(rootDir, journalPath)), { recursive: true });
    await writeFile(path.join(rootDir, journalPath), `${JSON.stringify(journal, null, 2)}\n`, "utf8");
    return { ok: true };
  } catch (error) {
    return { ok: false, reason: `runner transition journal cannot be written: ${String(error)}` };
  }
};

const readJournal = async (
  rootDir: string,
  planName: string,
): Promise<TransitionJournal | undefined | Failure> => {
  const journalPath = transitionJournalPath(planName);
  let raw: string;
  try {
    raw = await readFile(path.join(rootDir, journalPath), "utf8");
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return undefined;
    return { ok: false, reason: `runner transition journal cannot be read: ${String(error)}` };
  }
  try {
    const journal = JSON.parse(raw) as Partial<TransitionJournal>;
    if (
      journal.documentFormat !== "workflow-transition@1" ||
      !journal.descriptor ||
      !isRoutingSnapshot(journal.source) ||
      (journal.target !== undefined && !isRoutingSnapshot(journal.target)) ||
      !["reserved", "finalizing", "finalized"].includes(String(journal.status))
    ) {
      return { ok: false, reason: `runner transition journal is malformed: ${journalPath}` };
    }
    return journal as TransitionJournal;
  } catch {
    return { ok: false, reason: `runner transition journal is malformed JSON: ${journalPath}` };
  }
};

const clearJournal = async (
  rootDir: string,
  planName: string,
): Promise<{ ok: true } | Failure> => {
  try {
    await rm(path.join(rootDir, transitionJournalPath(planName)), { force: true });
    return { ok: true };
  } catch (error) {
    return { ok: false, reason: `runner transition journal cannot be cleared: ${String(error)}` };
  }
};

const eventSection = (content: string, heading: string): string[] => {
  const lines = content.split(/\r?\n/);
  const start = lines.findIndex((line) => line.trim() === heading);
  if (start < 0) return [];
  const values: string[] = [];
  for (const line of lines.slice(start + 1)) {
    if (line.trim().startsWith("## ")) break;
    if (line.trim().length > 0) values.push(line.trim());
  }
  return values;
};

const parseEvent = async ({
  rootDir,
  descriptor,
}: {
  rootDir: string;
  descriptor: RunnerStageDescriptor;
}): Promise<ParsedStageEvent | Failure> => {
  let content: string;
  try {
    content = await readFile(path.join(rootDir, descriptor.eventPath), "utf8");
  } catch (error) {
    return { ok: false, reason: `reserved stage event cannot be read: ${descriptor.eventPath}: ${String(error)}` };
  }
  const expectedTitle = `# ${titleForStage(descriptor.stage)} v${descriptor.version}`;
  if (!content.split(/\r?\n/).some((line) => line.trim() === expectedTitle)) {
    return { ok: false, reason: `stage event must contain ${expectedTitle}: ${descriptor.eventPath}` };
  }
  const outcome = extractSectionValue(content, "## Outcome")?.trim().toLowerCase();
  const summary = eventSection(content, "## Summary").join(" ").trim();
  const evidence = eventSection(content, "## Evidence").join(" ").trim();
  if (!outcome || !summary || !evidence) {
    return { ok: false, reason: `stage event requires non-empty ## Outcome, ## Summary, and ## Evidence: ${descriptor.eventPath}` };
  }
  const remediation = eventSection(content, "## Remediation")
    .map((line) => line.replace(/^[*-]\s*/, "").trim())
    .filter(Boolean);
  return { outcome, summary, evidence, remediation };
};

export const readStageEventOutcome = async ({
  rootDir,
  descriptor,
}: {
  rootDir: string;
  descriptor: RunnerStageDescriptor;
}): Promise<{ ok: true; outcome: string } | Failure> => {
  const event = await parseEvent({ rootDir, descriptor });
  return isFailure(event)
    ? event
    : { ok: true, outcome: event.outcome };
};

const validateEventTransition = async ({
  rootDir,
  descriptor,
}: {
  rootDir: string;
  descriptor: RunnerStageDescriptor;
}): Promise<{ ok: true; event: ParsedStageEvent; targetState: WorkflowState } | Failure> => {
  const event = await parseEvent({ rootDir, descriptor });
  if (isFailure(event)) return event;
  if (descriptor.stage === "reopen" && event.remediation.length === 0) {
    return { ok: false, reason: `reopen event requires non-empty ## Remediation: ${descriptor.eventPath}` };
  }
  if (descriptor.stage === "review" && event.outcome === "active" && event.remediation.length === 0) {
    return { ok: false, reason: `failed review event requires non-empty ## Remediation: ${descriptor.eventPath}` };
  }
  const targetState = targetFor(descriptor.sourceWorkflowState, event.outcome);
  if (!targetState) {
    return { ok: false, reason: `invalid ${descriptor.stage} outcome ${event.outcome} for ${descriptor.sourceWorkflowState}: ${descriptor.eventPath}` };
  }
  return { ok: true, event, targetState };
};

const targetFor = (
  source: WorkflowState,
  outcome: string,
): WorkflowState | undefined => ({
  "draft-artifact-sync:ready": "draft-validation",
  "draft-artifact-sync:retry": "draft-artifact-sync",
  "draft-validation:approved": "approved",
  "draft-validation:retry": "draft-validation",
  "draft-validation:blocked": "blocked",
  "approved:review-ready": "review",
  "approved:active": "active",
  "approved:blocked": "blocked",
  "active:review-ready": "review",
  "active:active": "active",
  "active:blocked": "blocked",
  "blocked:active": "active",
  "blocked:blocked": "blocked",
  "review:active": "active",
  "review:completed": "completed",
  "reopening:active": "active",
}[`${source}:${outcome}`] as WorkflowState | undefined);

const canonicalWorkflowTarget = ({
  source,
  targetState,
  descriptor,
  event,
}: {
  source: Record<string, unknown>;
  targetState: WorkflowState;
  descriptor: RunnerStageDescriptor;
  event: ParsedStageEvent;
}): Record<string, unknown> => {
  const latest = asRecord(source.latest) ?? {};
  const record: Record<string, unknown> = {
    version: descriptor.version,
    outcome: event.outcome,
    summary: event.summary,
    evidence: descriptor.eventPath,
  };
  if (descriptor.stage === "review" && event.outcome === "active") {
    record.unresolvedFindings = event.remediation;
  }
  const blockers =
    descriptor.stage === "review" && event.outcome === "active"
      ? event.remediation
      : targetState === "blocked"
        ? event.remediation.length > 0
          ? event.remediation
          : [event.summary]
        : [];
  const history = asStringArray(source.history);
  return {
    documentFormat: DOCUMENT_FORMATS.workflowState,
    ...source,
    workflowState: targetState,
    latest: { ...latest, [descriptor.stage]: record },
    history: history.includes(descriptor.eventPath)
      ? history
      : [...history, descriptor.eventPath],
    unresolvedBlockers: blockers,
    updatedAt: new Date().toISOString(),
  };
};

const restoreRoutingDocuments = async ({
  rootDir,
  plan,
  source,
}: {
  rootDir: string;
  plan: ParsedPlan;
  source: RoutingSnapshot;
}): Promise<{ ok: true } | Failure> => {
  try {
    await writeFile(plan.absolutePlanPath, source.manifest, "utf8");
    await writeFile(path.join(rootDir, workflowStatePath(plan.planName)), source.workflow, "utf8");
    await writeFile(path.join(rootDir, filesStatePath(plan.planName)), source.files, "utf8");
    await writeFile(path.join(rootDir, fileOwnershipPath(plan.planName)), source.ownership, "utf8");
    return { ok: true };
  } catch (error) {
    return { ok: false, reason: `runner transition source cannot be restored: ${String(error)}` };
  }
};

const nextVersion = async ({
  rootDir,
  planName,
  stage,
}: {
  rootDir: string;
  planName: string;
  stage: RunnerStageKind;
}): Promise<number> => {
  let entries: string[] = [];
  try {
    entries = await readdir(path.join(rootDir, thinPlanArtifactPath(planName, "events")));
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
  }
  const pattern = new RegExp(`^${stage}-v(\\d+)\\.md$`);
  return entries.reduce((max, entry) => {
    const value = Number(pattern.exec(entry)?.[1] ?? 0);
    return Number.isInteger(value) ? Math.max(max, value) : max;
  }, 0) + 1;
};

export const reserveStageDescriptor = async ({
  rootDir,
  plan,
}: {
  rootDir: string;
  plan: ParsedPlan;
}): Promise<RunnerStageDescriptor | Failure> => {
  if (plan.thinPlanContract !== "thin-plan") {
    return { ok: false, reason: "runner stage finalization requires a thin-plan" };
  }
  const existing = await readJournal(rootDir, plan.planName);
  if (isFailure(existing)) return existing;
  if (existing) return { ok: false, reason: `runner transition journal is active: ${transitionJournalPath(plan.planName)}` };
  const source = await readRoutingSnapshot({ rootDir, plan });
  if (isFailure(source)) return source;
  const stage = stageForState(plan.workflowState);
  let version: number;
  try {
    version = await nextVersion({ rootDir, planName: plan.planName, stage });
  } catch (error) {
    return { ok: false, reason: `runner event version cannot be reserved: ${String(error)}` };
  }
  const descriptor: RunnerStageDescriptor = {
    stage,
    sourceWorkflowState: plan.workflowState,
    version,
    eventPath: thinPlanArtifactPath(plan.planName, "events", `${stage}-v${version}.md`),
  };
  const journal = await writeJournal(rootDir, plan.planName, {
    documentFormat: "workflow-transition@1",
    descriptor,
    source,
    status: "reserved",
  });
  return journal.ok ? descriptor : journal;
};

export const abandonStageDescriptor = async ({
  rootDir,
  planName,
}: {
  rootDir: string;
  planName: string;
}): Promise<{ ok: true } | Failure> => clearJournal(rootDir, planName);

export const rollbackStageDescriptor = async ({
  rootDir,
  plan,
}: {
  rootDir: string;
  plan: ParsedPlan;
}): Promise<{ ok: true } | Failure> => {
  const journal = await readJournal(rootDir, plan.planName);
  if (isFailure(journal)) return journal;
  if (!journal) return { ok: true };
  const restored = await restoreRoutingDocuments({ rootDir, plan, source: journal.source });
  if (!restored.ok) return restored;
  return await clearJournal(rootDir, plan.planName);
};

export const finalizeStageDescriptor = async ({
  rootDir,
  plan,
  descriptor,
}: {
  rootDir: string;
  plan: ParsedPlan;
  descriptor: RunnerStageDescriptor;
}): Promise<{ ok: true; targetState: WorkflowState } | Failure> => {
  const journal = await readJournal(rootDir, plan.planName);
  if (isFailure(journal)) return journal;
  if (!journal || journal.status !== "reserved") {
    return { ok: false, reason: `runner stage descriptor is not reserved: ${descriptor.eventPath}` };
  }
  if (JSON.stringify(journal.descriptor) !== JSON.stringify(descriptor)) {
    return { ok: false, reason: `runner stage descriptor does not match active transaction: ${descriptor.eventPath}` };
  }
  const current = await readRoutingSnapshot({ rootDir, plan });
  if (isFailure(current)) return current;
  if (
    current.workflowHash !== journal.source.workflowHash ||
    current.manifestHash !== journal.source.manifestHash ||
    current.filesHash !== journal.source.filesHash ||
    current.ownershipHash !== journal.source.ownershipHash
  ) {
    const restored = await restoreRoutingDocuments({ rootDir, plan, source: journal.source });
    if (!restored.ok) return restored;
    await clearJournal(rootDir, plan.planName);
    return {
      ok: false,
      reason: "stage contract violation: agent changed runner-owned workflow routing documents; restored the pre-stage manifest and workflow state",
    };
  }
  const transition = await validateEventTransition({ rootDir, descriptor });
  if (!transition.ok) return transition;
  const { event, targetState } = transition;
  const sourceWorkflowRaw = await readJsonArtifact(rootDir, workflowStatePath(plan.planName));
  if (isFailure(sourceWorkflowRaw)) return sourceWorkflowRaw;
  const sourceWorkflow = asRecord(sourceWorkflowRaw);
  if (!sourceWorkflow || sourceWorkflow.workflowState !== descriptor.sourceWorkflowState) {
    return { ok: false, reason: `runner transition source state changed before finalization: ${descriptor.eventPath}` };
  }
  const targetManifest = writeManifestWorkflowState(current.manifest, targetState);
  const targetWorkflow = `${JSON.stringify(canonicalWorkflowTarget({ source: sourceWorkflow, targetState, descriptor, event }), null, 2)}\n`;
  const target: RoutingSnapshot = {
    manifest: targetManifest,
    workflow: targetWorkflow,
    files: current.files,
    ownership: current.ownership,
    manifestHash: digest(targetManifest),
    workflowHash: digest(targetWorkflow),
    filesHash: current.filesHash,
    ownershipHash: current.ownershipHash,
  };
  const finalizing = await writeJournal(rootDir, plan.planName, { ...journal, target, status: "finalizing" });
  if (!finalizing.ok) return finalizing;
  try {
    await writeFile(plan.absolutePlanPath, target.manifest, "utf8");
    await writeFile(path.join(rootDir, workflowStatePath(plan.planName)), target.workflow, "utf8");
  } catch (error) {
    return { ok: false, reason: `runner transition cannot be finalized: ${String(error)}` };
  }
  const finalized = await writeJournal(rootDir, plan.planName, { ...journal, target, status: "finalized" });
  if (!finalized.ok) return finalized;
  return { ok: true, targetState };
};

export const completeStageFinalization = async ({
  rootDir,
  planName,
}: {
  rootDir: string;
  planName: string;
}): Promise<{ ok: true } | Failure> => clearJournal(rootDir, planName);

export const recoverPendingStageFinalization = async ({
  rootDir,
  plan,
}: {
  rootDir: string;
  plan: ParsedPlan;
}): Promise<{ ok: true; recovered: boolean } | Failure> => {
  const journal = await readJournal(rootDir, plan.planName);
  if (isFailure(journal)) return journal;
  if (!journal) return { ok: true, recovered: false };
  const current = await readRoutingSnapshot({ rootDir, plan });
  if (isFailure(current)) return current;
  const sourceMatches =
    current.manifestHash === journal.source.manifestHash &&
    current.workflowHash === journal.source.workflowHash &&
    current.filesHash === journal.source.filesHash &&
    current.ownershipHash === journal.source.ownershipHash;
  if (journal.status === "reserved") {
    if (!sourceMatches) return { ok: false, reason: `reserved transition source mismatch: ${transitionJournalPath(plan.planName)}` };
    let eventExists = true;
    try {
      await readFile(path.join(rootDir, journal.descriptor.eventPath), "utf8");
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === "ENOENT") eventExists = false;
      else return { ok: false, reason: `reserved stage event cannot be read: ${journal.descriptor.eventPath}: ${String(error)}` };
    }
    if (eventExists) {
      const transition = await validateEventTransition({
        rootDir,
        descriptor: journal.descriptor,
      });
      if (!transition.ok) {
        const cleared = await clearJournal(rootDir, plan.planName);
        return cleared.ok ? transition : cleared;
      }
      const finalized = await finalizeStageDescriptor({
        rootDir,
        plan,
        descriptor: journal.descriptor,
      });
      if (!finalized.ok) return finalized;
      const cleared = await clearJournal(rootDir, plan.planName);
      return cleared.ok ? { ok: true, recovered: true } : cleared;
    }
    const cleared = await clearJournal(rootDir, plan.planName);
    return cleared.ok ? { ok: true, recovered: true } : cleared;
  }
  if (!journal.target) return { ok: false, reason: `finalizing transition is missing target state: ${transitionJournalPath(plan.planName)}` };
  const transition = await validateEventTransition({
    rootDir,
    descriptor: journal.descriptor,
  });
  if (!transition.ok) return transition;
  const targetManifestState = extractSectionValue(journal.target.manifest, "## Workflow State")?.trim();
  let targetWorkflowState: unknown;
  try {
    targetWorkflowState = asRecord(JSON.parse(journal.target.workflow))?.workflowState;
  } catch {
    return { ok: false, reason: `transition journal target is malformed: ${transitionJournalPath(plan.planName)}` };
  }
  if (targetManifestState !== transition.targetState || targetWorkflowState !== transition.targetState) {
    return { ok: false, reason: `transition journal target does not match validated stage event: ${transitionJournalPath(plan.planName)}` };
  }
  const targetMatches =
    current.manifestHash === journal.target.manifestHash &&
    current.workflowHash === journal.target.workflowHash &&
    current.filesHash === journal.target.filesHash &&
    current.ownershipHash === journal.target.ownershipHash;
  if (targetMatches) {
    const cleared = await clearJournal(rootDir, plan.planName);
    return cleared.ok ? { ok: true, recovered: true } : cleared;
  }
  const partial =
    (current.manifestHash === journal.source.manifestHash || current.manifestHash === journal.target.manifestHash) &&
    (current.workflowHash === journal.source.workflowHash || current.workflowHash === journal.target.workflowHash) &&
    (current.filesHash === journal.source.filesHash || current.filesHash === journal.target.filesHash) &&
    (current.ownershipHash === journal.source.ownershipHash || current.ownershipHash === journal.target.ownershipHash);
  if (!partial) return { ok: false, reason: `transition journal document hash mismatch: ${transitionJournalPath(plan.planName)}` };
  const restored = await restoreRoutingDocuments({ rootDir, plan, source: journal.source });
  if (!restored.ok) return restored;
  const cleared = await clearJournal(rootDir, plan.planName);
  return cleared.ok ? { ok: true, recovered: true } : cleared;
};

export const formatStageDescriptor = (descriptor: RunnerStageDescriptor): string => `
Runner-issued stage descriptor (authoritative):
- Stage: ${descriptor.stage}
- Source workflow state: ${descriptor.sourceWorkflowState}
- Reserved event version: ${descriptor.version}
- Assigned event artifact: ${descriptor.eventPath}

Write only the assigned event artifact. Do not write the plan manifest,
workflow.json, or any runner routing document. The runner validates this exact
descriptor and owns every state/history update after the event is accepted.
`;
