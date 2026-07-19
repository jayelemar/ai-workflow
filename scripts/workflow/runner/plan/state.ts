import { existsSync } from 'node:fs';
import { readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { normalizePlanArgument } from '../cli.ts';
import { parseFileOwnershipArtifact } from '../../ownership/file-ownership.ts';
import { validateThinPlanContract } from '../thin-plan.ts';
import {
  asRecord,
  isFailure,
  type Failure,
  type FileOwnershipArtifact,
  type NextAction,
  type ParsedPlan,
  type ParsePlanOptions,
  type Status,
  type ThinPlanV2FilesState,
  type ThinPlanV2WorkflowState,
} from '../types.ts';
import {
  extractPlanInstructionPaths,
  extractSectionValue,
  isNextAction,
  isStatus,
  normalizeWorkflowStateValue,
} from './parser.ts';

const rel = (...segments: string[]) => segments.join('/');
const asStringArray = (value: unknown): string[] | undefined =>
  Array.isArray(value) && value.every((item) => typeof item === 'string')
    ? (value as string[])
    : undefined;
export const thinPlanV2ArtifactPath = (
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
      reason: `thin-plan-v2 artifact cannot be read: ${relativePath}: ${String(error)}`,
    };
  }
  try {
    return JSON.parse(raw) as unknown;
  } catch {
    return {
      ok: false,
      reason: `thin-plan-v2 artifact is malformed JSON: ${relativePath}`,
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

export const parseThinPlanV2WorkflowState = (
  raw: unknown,
  expectedPlanPath: string,
  artifactPath: string,
): ThinPlanV2WorkflowState | Failure => {
  const record = asRecord(raw);
  const planPath = record?.planPath;
  const status = record?.status;
  const nextAction = record?.nextAction;
  const updatedAt = record?.updatedAt;
  const unresolvedBlockers = asStringArray(record?.unresolvedBlockers) ?? [];
  const history = normalizeWorkflowEventHistory(record?.history);

  if (
    typeof planPath !== "string" ||
    planPath !== expectedPlanPath ||
    typeof status !== "string" ||
    !isStatus(status) ||
    typeof nextAction !== "string" ||
    !isNextAction(nextAction) ||
    typeof updatedAt !== "string"
  ) {
    return {
      ok: false,
      reason: `thin-plan-v2 workflow state is malformed: ${artifactPath}`,
    };
  }

  const latest = asRecord(record?.latest) ?? undefined;
  const latestReview = asRecord(latest?.review);
  const reviewSummary =
    typeof latestReview?.summary === "string"
      ? latestReview.summary.toUpperCase()
      : "";
  const reviewDecision =
    typeof latestReview?.decision === "string"
      ? latestReview.decision.toLowerCase()
      : "";
  if (
    unresolvedBlockers.length === 0 &&
    reviewDecision === "active" &&
    /\b(?:NEEDS FIX|HIGH RISK)\b/.test(reviewSummary) &&
    !workflowReviewSupersededByProgress(latest, history)
  ) {
    return {
      ok: false,
      reason: `thin-plan-v2 workflow state is inconsistent: latest review requires fixes but unresolvedBlockers is empty in ${artifactPath}`,
    };
  }

  return {
    planPath,
    status,
    nextAction,
    latest,
    history,
    unresolvedBlockers,
    updatedAt,
  };
};

export const parseThinPlanV2FilesState = (
  raw: unknown,
  artifactPath: string,
): ThinPlanV2FilesState | Failure => {
  const record = asRecord(raw);
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
      reason: `thin-plan-v2 files state is malformed: ${artifactPath}`,
    };
  }
  return {
    created,
    modified,
    deleted,
    changedFiles,
    released,
    headSha,
  };
};

export const readTextArtifact = async (
  rootDir: string,
  relativePath: string,
): Promise<{ ok: true; content: string } | Failure> => {
  try {
    return {
      ok: true,
      content: await readFile(path.join(rootDir, relativePath), "utf8"),
    };
  } catch (error) {
    return {
      ok: false,
      reason: `thin-plan-v2 artifact cannot be read: ${relativePath}: ${String(error)}`,
    };
  }
};

export const replaceManifestWorkflowValue = (
  content: string,
  heading: string,
  value: string,
): string => {
  const lines = content.split(/\r?\n/);
  const headingIndex = lines.findIndex((line) => line.trim() === heading);
  if (headingIndex === -1) {
    return content;
  }
  for (let index = headingIndex + 1; index < lines.length; index += 1) {
    if (lines[index].trim().startsWith("##")) {
      return content;
    }
    if (lines[index].trim().length > 0) {
      lines[index] = value;
      return lines.join("\n");
    }
  }
  lines.splice(headingIndex + 1, 0, "", value);
  return lines.join("\n");
};

export const repairThinPlanV2ManifestStateFromWorkflow = async ({
  rootDir,
  plan,
}: {
  rootDir: string;
  plan: ParsedPlan;
}): Promise<{ ok: true; repaired: boolean } | Failure> => {
  if (plan.thinPlanContract !== "thin-plan-v2") {
    return { ok: true, repaired: false };
  }

  let manifestContent: string;
  try {
    manifestContent = await readFile(plan.absolutePlanPath, "utf8");
  } catch (error) {
    return {
      ok: false,
      reason: `plan file cannot be read: ${plan.planPath}: ${String(error)}`,
    };
  }

  const manifestStatus = extractSectionValue(manifestContent, "## Status");
  const manifestNextAction = extractSectionValue(
    manifestContent,
    "## Next Action",
  );
  if (manifestStatus === null) {
    return { ok: false, reason: "plan is missing ## Status" };
  }
  if (manifestNextAction === null) {
    return { ok: false, reason: "plan is missing ## Next Action" };
  }

  const rawStatus = normalizeWorkflowStateValue(manifestStatus);
  const rawNextAction = normalizeWorkflowStateValue(manifestNextAction);
  if (!isStatus(rawStatus)) {
    return { ok: false, reason: `unknown status value: ${rawStatus}` };
  }
  if (!isNextAction(rawNextAction)) {
    return { ok: false, reason: `unknown next action value: ${rawNextAction}` };
  }

  const workflowPath = thinPlanV2ArtifactPath(
    plan.planName,
    "state",
    "workflow.json",
  );
  const workflowRaw = await readJsonArtifact(rootDir, workflowPath);
  if (isFailure(workflowRaw)) {
    return workflowRaw;
  }
  const workflow = parseThinPlanV2WorkflowState(
    workflowRaw,
    plan.planPath,
    workflowPath,
  );
  if (isFailure(workflow)) {
    return workflow;
  }

  if (
    rawStatus === workflow.status &&
    rawNextAction === workflow.nextAction
  ) {
    return { ok: true, repaired: false };
  }

  if (rawStatus !== plan.status || rawNextAction !== plan.nextAction) {
    return { ok: true, repaired: false };
  }

  const repairedContent = replaceManifestWorkflowValue(
    replaceManifestWorkflowValue(manifestContent, "## Status", workflow.status),
    "## Next Action",
    workflow.nextAction,
  );
  if (repairedContent === manifestContent) {
    return { ok: true, repaired: false };
  }

  try {
    await writeFile(plan.absolutePlanPath, repairedContent, "utf8");
  } catch (error) {
    return {
      ok: false,
      reason: `plan file cannot be written: ${plan.planPath}: ${String(error)}`,
    };
  }

  return { ok: true, repaired: true };
};

export const recoverThinPlanV2PartialExecuteReviewHandoff = async ({
  rootDir,
  previous,
  updated,
}: {
  rootDir: string;
  previous: ParsedPlan;
  updated: ParsedPlan;
}): Promise<{ ok: true; recovered: boolean } | Failure> => {
  if (
    previous.thinPlanContract !== "thin-plan-v2" ||
    previous.status !== "active" ||
    previous.nextAction !== "execute-plan" ||
    updated.status !== "active" ||
    updated.nextAction !== "review-plan"
  ) {
    return { ok: true, recovered: false };
  }

  const workflowPath = thinPlanV2ArtifactPath(
    updated.planName,
    "state",
    "workflow.json",
  );
  const workflowRaw = await readJsonArtifact(rootDir, workflowPath);
  if (isFailure(workflowRaw)) {
    return workflowRaw;
  }
  const workflowRecord = asRecord(workflowRaw);
  if (
    !workflowRecord ||
    workflowRecord.status !== "active" ||
    workflowRecord.nextAction !== "review-plan"
  ) {
    return { ok: true, recovered: false };
  }

  const manifestContent = replaceManifestWorkflowValue(
    updated.manifestContent,
    "## Status",
    "review",
  );
  const workflowContent = `${JSON.stringify(
    {
      ...workflowRecord,
      status: "review",
      nextAction: "review-plan",
      updatedAt: new Date().toISOString(),
    },
    null,
    2,
  )}\n`;

  try {
    await writeFile(updated.absolutePlanPath, manifestContent, "utf8");
    await writeFile(path.join(rootDir, workflowPath), workflowContent, "utf8");
  } catch (error) {
    return {
      ok: false,
      reason: `thin-plan-v2 partial execute review handoff could not be repaired: ${String(error)}`,
    };
  }

  return { ok: true, recovered: true };
};

const failedReviewSummary = (review: Record<string, unknown>): boolean =>
  typeof review.summary === "string" &&
  /\b(?:NEEDS FIX|HIGH RISK)\b/.test(review.summary.toUpperCase());

const reviewIssueFindings = (content: string): string[] => {
  const lines = content.split(/\r?\n/);
  const issuesIndex = lines.findIndex((line) => line.trim() === "## Issues");
  if (issuesIndex === -1) {
    return [];
  }

  const findings: string[] = [];
  for (const line of lines.slice(issuesIndex + 1)) {
    const trimmed = line.trim();
    if (trimmed.startsWith("## ")) {
      break;
    }
    const finding = /^\*\s+(.+)$/.exec(trimmed)?.[1]?.trim();
    if (finding) {
      findings.push(finding);
    }
  }
  return findings;
};

export const recoverThinPlanV2FailedReviewState = async ({
  rootDir,
  planName,
  planPath,
  manifestContent,
  manifestStatus,
  manifestNextAction,
}: {
  rootDir: string;
  planName: string;
  planPath: string;
  manifestContent: string;
  manifestStatus: Status;
  manifestNextAction: NextAction;
}): Promise<
  { ok: true; recovered: boolean; manifestContent: string } | Failure
> => {
  const workflowPath = thinPlanV2ArtifactPath(
    planName,
    "state",
    "workflow.json",
  );
  const workflowRaw = await readJsonArtifact(rootDir, workflowPath);
  if (isFailure(workflowRaw)) {
    return workflowRaw;
  }
  const workflowRecord = asRecord(workflowRaw);
  const latest = asRecord(workflowRecord?.latest);
  const review = asRecord(latest?.review);
  // Treat a missing or malformed list exactly like an empty list here. The
  // strict reader below will reject it, but recovery must be able to restore
  // the review findings before that rejection can strand a valid handoff.
  const unresolvedBlockers =
    asStringArray(workflowRecord?.unresolvedBlockers) ?? [];
  const history = normalizeWorkflowEventHistory(workflowRecord?.history);
  if (
    !workflowRecord ||
    !latest ||
    !review ||
    !unresolvedBlockers ||
    unresolvedBlockers.length > 0 ||
    latestString(review, "decision")?.toLowerCase() !== "active" ||
    !failedReviewSummary(review) ||
    workflowReviewSupersededByProgress(latest, history)
  ) {
    return { ok: true, recovered: false, manifestContent };
  }

  const workflowStatus = workflowRecord.status;
  const workflowNextAction = workflowRecord.nextAction;
  const isReviewHandoff =
    workflowStatus === "review" && workflowNextAction === "review-plan";
  const isActiveHandoff =
    workflowStatus === "active" && workflowNextAction === "execute-plan";
  const isBlockedHandoff =
    workflowStatus === "blocked" && workflowNextAction === "unblock-plan";
  const manifestHasRecoverableHandoff =
    (manifestStatus === "review" && manifestNextAction === "review-plan") ||
    (manifestStatus === "active" &&
      manifestNextAction === "execute-plan") ||
    (manifestStatus === "blocked" && manifestNextAction === "unblock-plan");
  if (
    (!isReviewHandoff && !isActiveHandoff && !isBlockedHandoff) ||
    !manifestHasRecoverableHandoff
  ) {
    return { ok: true, recovered: false, manifestContent };
  }

  let findings = asStringArray(review.unresolvedFindings) ?? [];
  if (findings.length === 0 && typeof review.version === "number") {
    const reviewEvent = await readTextArtifact(
      rootDir,
      thinPlanV2ArtifactPath(
        planName,
        "events",
        `review-v${review.version}.md`,
      ),
    );
    if (reviewEvent.ok) {
      findings = reviewIssueFindings(reviewEvent.content);
    }
  }
  if (findings.length === 0) {
    const evidence = latestString(review, "evidence");
    findings = [
      evidence
        ? `Latest failed review requires remediation; see ${evidence}.`
        : "Latest failed review requires remediation before another review pass.",
    ];
  }

  const nextManifestContent = replaceManifestWorkflowValue(
    replaceManifestWorkflowValue(manifestContent, "## Status", "active"),
    "## Next Action",
    "execute-plan",
  );
  const nextWorkflow = {
    ...workflowRecord,
    status: "active",
    nextAction: "execute-plan",
    latest: {
      ...latest,
      review: {
        ...review,
        unresolvedFindings: findings,
      },
    },
    unresolvedBlockers: findings,
    updatedAt: new Date().toISOString(),
  };

  try {
    await writeFile(
      path.join(rootDir, workflowPath),
      `${JSON.stringify(nextWorkflow, null, 2)}\n`,
      "utf8",
    );
    await writeFile(path.join(rootDir, planPath), nextManifestContent, "utf8");
  } catch (error) {
    return {
      ok: false,
      reason: `thin-plan-v2 failed-review recovery could not persist state: ${String(error)}`,
    };
  }

  return { ok: true, recovered: true, manifestContent: nextManifestContent };
};

export const recoverThinPlanV2BlockedValidationHandoff = async ({
  rootDir,
  plan,
}: {
  rootDir: string;
  plan: ParsedPlan;
}): Promise<{ ok: true; recovered: boolean } | Failure> => {
  if (
    plan.thinPlanContract !== "thin-plan-v2" ||
    plan.status !== "active" ||
    plan.nextAction !== "execute-plan"
  ) {
    return { ok: true, recovered: false };
  }

  const workflowPath = thinPlanV2ArtifactPath(
    plan.planName,
    "state",
    "workflow.json",
  );
  const workflowRaw = await readJsonArtifact(rootDir, workflowPath);
  if (isFailure(workflowRaw)) {
    return workflowRaw;
  }
  const workflowRecord = asRecord(workflowRaw);
  const latest = asRecord(workflowRecord?.latest);
  const validation = asRecord(latest?.validation);
  const unresolvedBlockers = asStringArray(workflowRecord?.unresolvedBlockers);
  if (
    !workflowRecord ||
    !latest ||
    !validation ||
    !unresolvedBlockers ||
    unresolvedBlockers.length === 0 ||
    latestString(validation, "result")?.toLowerCase() !== "blocked"
  ) {
    return { ok: true, recovered: false };
  }

  const nextManifestContent = replaceManifestWorkflowValue(
    replaceManifestWorkflowValue(plan.manifestContent, "## Status", "blocked"),
    "## Next Action",
    "unblock-plan",
  );
  const nextWorkflow = {
    ...workflowRecord,
    status: "blocked",
    nextAction: "unblock-plan",
    updatedAt: new Date().toISOString(),
  };

  try {
    await writeFile(
      path.join(rootDir, workflowPath),
      `${JSON.stringify(nextWorkflow, null, 2)}\n`,
      "utf8",
    );
    await writeFile(plan.absolutePlanPath, nextManifestContent, "utf8");
  } catch (error) {
    return {
      ok: false,
      reason: `thin-plan-v2 blocked-validation recovery could not persist state: ${String(error)}`,
    };
  }

  return { ok: true, recovered: true };
};

const demoteMarkdownHeadings = (content: string): string =>
  content
    .replace(/^### /gm, "##### ")
    .replace(/^## /gm, "#### ")
    .replace(/^# /gm, "### ");

const fileSectionBullets = (paths: string[]): string =>
  (paths.length > 0 ? paths : ["None"])
    .map((filePath) => `* ${filePath}`)
    .join("\n");

export const latestRecord = (
  workflow: ThinPlanV2WorkflowState,
  kind: string,
): Record<string, unknown> | undefined => asRecord(workflow.latest?.[kind]);

export const latestNumber = (
  record: Record<string, unknown> | undefined,
): number | undefined =>
  typeof record?.version === "number" &&
  Number.isInteger(record.version) &&
  record.version > 0
    ? record.version
    : undefined;

export const latestString = (
  record: Record<string, unknown> | undefined,
  key: string,
): string | undefined =>
  typeof record?.[key] === "string" ? record[key] : undefined;

type RelevantWorkflowEvent = {
  kind: "execution" | "validation" | "review" | "unblock" | "reopen";
  label: "Execution" | "Validation" | "Review" | "Unblock" | "Reopen";
  stateField: "Result" | "Decision" | "Status";
  stateValue?: string;
  summary?: string;
  evidence?: string;
  reason: string;
};

const relevantWorkflowEventDetails = (
  kind: RelevantWorkflowEvent["kind"],
  latest: Record<string, unknown> | undefined,
  reason: string,
): RelevantWorkflowEvent | undefined => {
  if (!latestNumber(latest)) {
    return undefined;
  }

  if (kind === "execution") {
    return {
      kind,
      label: "Execution",
      stateField: "Result",
      stateValue: latestString(latest, "result"),
      summary: latestString(latest, "summary"),
      evidence: latestString(latest, "evidence"),
      reason,
    };
  }

  if (kind === "validation") {
    return {
      kind,
      label: "Validation",
      stateField: "Result",
      stateValue: latestString(latest, "result"),
      summary: latestString(latest, "summary"),
      evidence: latestString(latest, "evidence"),
      reason,
    };
  }

  if (kind === "review") {
    return {
      kind,
      label: "Review",
      stateField: "Decision",
      stateValue: latestString(latest, "decision"),
      summary: latestString(latest, "summary"),
      evidence: latestString(latest, "evidence"),
      reason,
    };
  }

  return {
    kind,
    label: kind === "unblock" ? "Unblock" : "Reopen",
    stateField: "Status",
    stateValue: latestString(latest, "status"),
    summary: latestString(latest, "summary"),
    evidence: latestString(latest, "evidence"),
    reason,
  };
};

export const selectRelevantWorkflowEvent = (
  planContent: string,
  workflow: ThinPlanV2WorkflowState | undefined,
): RelevantWorkflowEvent | undefined => {
  if (!workflow) {
    return undefined;
  }

  const execution = latestRecord(workflow, "execution");
  const validation = latestRecord(workflow, "validation");
  const review = latestRecord(workflow, "review");
  const unblock = latestRecord(workflow, "unblock");
  const reopen = latestRecord(workflow, "reopen");
  const reviewFindings = asStringArray(review?.unresolvedFindings) ?? [];
  const status =
    workflow.status || extractSectionValue(planContent, "## Status");
  const nextAction =
    workflow.nextAction || extractSectionValue(planContent, "## Next Action");

  if (nextAction === "execute-plan") {
    if (
      status === "active" &&
      review &&
      !workflowReviewSupersededByProgress(workflow.latest, workflow.history) &&
      (reviewFindings.length > 0 ||
        latestString(review, "decision") === "active")
    ) {
      return relevantWorkflowEventDetails(
        "review",
        review,
        "latest review remediation for the next execute-plan run",
      );
    }
    if (status === "approved" && validation) {
      return relevantWorkflowEventDetails(
        "validation",
        validation,
        "latest approval evidence before execution starts",
      );
    }
    if (execution) {
      return relevantWorkflowEventDetails(
        "execution",
        execution,
        "latest execution checkpoint for the active implementation loop",
      );
    }
    if (validation) {
      return relevantWorkflowEventDetails(
        "validation",
        validation,
        "latest validation evidence still relevant to execution",
      );
    }
  }

  if (nextAction === "review-plan") {
    if (validation) {
      return relevantWorkflowEventDetails(
        "validation",
        validation,
        "latest validation evidence for the current review pass",
      );
    }
    if (execution) {
      return relevantWorkflowEventDetails(
        "execution",
        execution,
        "latest execution evidence behind the current review pass",
      );
    }
  }

  if (nextAction === "unblock-plan") {
    if (execution) {
      return relevantWorkflowEventDetails(
        "execution",
        execution,
        "latest blocking execution evidence to resolve before unblocking",
      );
    }
    if (unblock) {
      return relevantWorkflowEventDetails(
        "unblock",
        unblock,
        "latest unblock attempt for the current blocked state",
      );
    }
  }

  if (nextAction === "reopen-plan") {
    if (review) {
      return relevantWorkflowEventDetails(
        "review",
        review,
        "latest completion review evidence behind the reopen request",
      );
    }
    if (reopen) {
      return relevantWorkflowEventDetails(
        "reopen",
        reopen,
        "latest reopen attempt for the current request",
      );
    }
  }

  if (nextAction === "commit-summary") {
    if (review) {
      return relevantWorkflowEventDetails(
        "review",
        review,
        "latest approval evidence before commit summary",
      );
    }
    if (execution) {
      return relevantWorkflowEventDetails(
        "execution",
        execution,
        "latest execution checkpoint before commit summary",
      );
    }
  }

  if (nextAction === "plan-validator" && validation) {
    return relevantWorkflowEventDetails(
      "validation",
      validation,
      "latest validation evidence for the current draft plan",
    );
  }

  return (
    relevantWorkflowEventDetails("review", review, "latest review evidence") ??
    relevantWorkflowEventDetails(
      "validation",
      validation,
      "latest validation evidence",
    ) ??
    relevantWorkflowEventDetails(
      "execution",
      execution,
      "latest execution evidence",
    ) ??
    relevantWorkflowEventDetails(
      "unblock",
      unblock,
      "latest unblock evidence",
    ) ??
    relevantWorkflowEventDetails("reopen", reopen, "latest reopen evidence")
  );
};

const synthesizeLatestEventSection = ({
  heading,
  label,
  stateField,
  stateValue,
  latest,
  unresolvedFindings,
}: {
  heading: string;
  label: string;
  stateField: "Result" | "Decision" | "Status";
  stateValue?: string;
  latest: Record<string, unknown> | undefined;
  unresolvedFindings?: string[];
}): string => {
  const version = latestNumber(latest);
  if (!version) {
    return `## ${heading}\n\n(empty)\n`;
  }
  const lines = [
    `## ${heading}`,
    "",
    `### ${label} v${version}`,
    "",
    `* Summary: ${latestString(latest, "summary") ?? "(none recorded)"}`,
    `* ${stateField}: ${stateValue ?? "(none recorded)"}`,
  ];
  const evidence = latestString(latest, "evidence");
  if (evidence) {
    lines.push(`* Evidence: ${evidence}`);
  }
  if (unresolvedFindings && unresolvedFindings.length > 0) {
    lines.push(
      "* Issues:",
      ...unresolvedFindings.map((finding) => `  * ${finding}`),
    );
  }
  return `${lines.join("\n")}\n`;
};

export const synthesizeThinPlanV2Content = ({
  manifestContent,
  workflow,
  files,
  fileOwnership,
  implementationMap,
}: {
  manifestContent: string;
  workflow: ThinPlanV2WorkflowState;
  files: ThinPlanV2FilesState;
  fileOwnership: FileOwnershipArtifact;
  implementationMap: string;
}): string => {
  let content = replaceManifestWorkflowValue(
    manifestContent,
    "## Status",
    workflow.status,
  );
  content = replaceManifestWorkflowValue(
    content,
    "## Next Action",
    workflow.nextAction,
  );
  const validation = latestRecord(workflow, "validation");
  const review = latestRecord(workflow, "review");
  const execution = latestRecord(workflow, "execution");
  const unblock = latestRecord(workflow, "unblock");
  const reopen = latestRecord(workflow, "reopen");
  const reviewFindings = asStringArray(review?.unresolvedFindings) ?? [];
  const blockerLines =
    workflow.unresolvedBlockers.length > 0
      ? [
          "## Blockers",
          "",
          ...workflow.unresolvedBlockers.flatMap((blocker, index) => [
            `### Blocker v${index + 1}`,
            "",
            `* Description: ${blocker}`,
            "* Status: active",
            "",
          ]),
        ].join("\n")
      : "## Blockers\n\n(empty)\n";

  const releases =
    fileOwnership.released.length > 0
      ? `## File Ownership Releases

${fileOwnership.released
  .map(
    (filePath, index) => `### Release v${index + 1}

* File: ${filePath}
* Status: transferred`,
  )
  .join("\n\n")}
`
      : "";

  return `${content.trimEnd()}

## Implementation Map

${demoteMarkdownHeadings(implementationMap).trim()}

## Ownership Scope

${fileSectionBullets(fileOwnership.owns)}

${releases}## Files (MANDATORY)

### Created files

${fileSectionBullets(files.created)}

### Modified files

${fileSectionBullets(files.modified)}

### Deleted files

${fileSectionBullets(files.deleted)}

${synthesizeLatestEventSection({
  heading: "Execution Log",
  label: "Execution",
  stateField: "Result",
  stateValue: latestString(execution, "result"),
  latest: execution,
})}
${synthesizeLatestEventSection({
  heading: "Validation History",
  label: "Validation",
  stateField: "Result",
  stateValue: latestString(validation, "result"),
  latest: validation,
})}
${synthesizeLatestEventSection({
  heading: "Review History",
  label: "Review",
  stateField: "Decision",
  stateValue: latestString(review, "decision"),
  latest: review,
  unresolvedFindings: reviewFindings,
})}
${synthesizeLatestEventSection({
  heading: "Unblock History",
  label: "Unblock",
  stateField: "Status",
  stateValue: latestString(unblock, "status"),
  latest: unblock,
})}
${synthesizeLatestEventSection({
  heading: "Reopen History",
  label: "Reopen",
  stateField: "Status",
  stateValue: latestString(reopen, "status"),
  latest: reopen,
})}
${blockerLines}`;
};

export const loadThinPlanV2WorkingContent = async ({
  rootDir,
  planName,
  planPath,
  manifestContent,
}: {
  rootDir: string;
  planName: string;
  planPath: string;
  manifestContent: string;
}): Promise<
  | {
      ok: true;
      content: string;
      status: Status;
      nextAction: NextAction;
    }
  | Failure
> => {
  const workflowPath = thinPlanV2ArtifactPath(
    planName,
    "state",
    "workflow.json",
  );
  const filesPath = thinPlanV2ArtifactPath(planName, "state", "files.json");
  const fileOwnershipPath = thinPlanV2ArtifactPath(
    planName,
    "state",
    "file-ownership.json",
  );
  const implementationMapPath = thinPlanV2ArtifactPath(
    planName,
    "implementation-map.md",
  );

  const workflowJson = await readJsonArtifact(rootDir, workflowPath);
  if (isFailure(workflowJson)) {
    return workflowJson;
  }
  const workflow = parseThinPlanV2WorkflowState(
    workflowJson,
    planPath,
    workflowPath,
  );
  if (isFailure(workflow)) {
    return workflow;
  }

  const filesJson = await readJsonArtifact(rootDir, filesPath);
  if (isFailure(filesJson)) {
    return filesJson;
  }
  const files = parseThinPlanV2FilesState(filesJson, filesPath);
  if (isFailure(files)) {
    return files;
  }

  const ownershipRaw = await readJsonArtifact(rootDir, fileOwnershipPath);
  if (isFailure(ownershipRaw)) {
    return ownershipRaw;
  }
  const fileOwnership = parseFileOwnershipArtifact(
    JSON.stringify(ownershipRaw),
    fileOwnershipPath,
  );
  if (isFailure(fileOwnership)) {
    return fileOwnership;
  }

  const implementationMap = await readTextArtifact(
    rootDir,
    implementationMapPath,
  );
  if (isFailure(implementationMap)) {
    return implementationMap;
  }

  return {
    ok: true,
    status: workflow.status,
    nextAction: workflow.nextAction,
    content: synthesizeThinPlanV2Content({
      manifestContent,
      workflow,
      files,
      fileOwnership,
      implementationMap: implementationMap.content,
    }),
  };
};

export const parsePlan = async ({
  planName,
  rootDir = process.cwd(),
}: ParsePlanOptions): Promise<ParsedPlan | Failure> => {
  const normalized = normalizePlanArgument(planName);
  if (isFailure(normalized)) {
    return normalized;
  }

  const planPath = normalized.planPath;
  const absolutePlanPath = path.join(rootDir, planPath);
  if (!existsSync(absolutePlanPath)) {
    return { ok: false, reason: `plan file does not exist: ${planPath}` };
  }

  let content: string;
  try {
    content = await readFile(absolutePlanPath, "utf8");
  } catch (error) {
    return {
      ok: false,
      reason: `plan file cannot be read: ${planPath}: ${String(error)}`,
    };
  }

  for (const instructionPath of extractPlanInstructionPaths(content)) {
    if (!existsSync(path.join(rootDir, instructionPath))) {
      return {
        ok: false,
        reason: `plan references missing instruction path: ${instructionPath}`,
      };
    }
  }

  const executionMode = extractSectionValue(content, "## Execution Mode");
  if (normalizeWorkflowStateValue(executionMode ?? "") === "manual") {
    return {
      ok: false,
      reason: `manual plan cannot be run by workflow-runner: ${planPath}. Use .ai/prompts/manual-execute-plan.md in the current conversation instead.`,
    };
  }
  if (
    executionMode !== null &&
    normalizeWorkflowStateValue(executionMode) !== "runner-managed"
  ) {
    return {
      ok: false,
      reason: `unknown execution mode in ${planPath}: ${normalizeWorkflowStateValue(executionMode) || "(empty)"}. Expected manual or runner-managed.`,
    };
  }

  const extractedStatus = extractSectionValue(content, "## Status");
  if (extractedStatus === null) {
    return { ok: false, reason: "plan is missing ## Status" };
  }
  let rawStatus = normalizeWorkflowStateValue(extractedStatus);
  if (rawStatus.length === 0) {
    return { ok: false, reason: "plan status value is empty" };
  }
  if (!isStatus(rawStatus)) {
    return { ok: false, reason: `unknown status value: ${rawStatus}` };
  }

  const extractedNextAction = extractSectionValue(content, "## Next Action");
  if (extractedNextAction === null) {
    return { ok: false, reason: "plan is missing ## Next Action" };
  }
  let rawNextAction = normalizeWorkflowStateValue(extractedNextAction);
  if (rawNextAction.length === 0) {
    return { ok: false, reason: "plan next action value is empty" };
  }
  if (!isNextAction(rawNextAction)) {
    return { ok: false, reason: `unknown next action value: ${rawNextAction}` };
  }

  const thinPlan = await validateThinPlanContract({
    rootDir,
    planName: normalized.planName,
    content,
  });
  if (isFailure(thinPlan)) {
    return thinPlan;
  }

  if (thinPlan.contract === "thin-plan-v2") {
    const recovery = await recoverThinPlanV2FailedReviewState({
      rootDir,
      planName: normalized.planName,
      planPath,
      manifestContent: content,
      manifestStatus: rawStatus,
      manifestNextAction: rawNextAction,
    });
    if (isFailure(recovery)) {
      return recovery;
    }
    if (recovery.recovered) {
      content = recovery.manifestContent;
      rawStatus = "active";
      rawNextAction = "execute-plan";
    }
    const loaded = await loadThinPlanV2WorkingContent({
      rootDir,
      planName: normalized.planName,
      planPath,
      manifestContent: content,
    });
    if (isFailure(loaded)) {
      return loaded;
    }
    if (loaded.status !== rawStatus || loaded.nextAction !== rawNextAction) {
      return {
        ok: false,
        reason: `thin-plan-v2 manifest state mismatch: plan manifest has ${rawStatus} + ${rawNextAction}, but .ai/artifacts/${normalized.planName}/state/workflow.json has ${loaded.status} + ${loaded.nextAction}`,
      };
    }

    return {
      ok: true,
      planName: normalized.planName,
      planPath,
      absolutePlanPath,
      manifestContent: content,
      content: loaded.content,
      thinPlanContract: thinPlan.contract,
      status: loaded.status,
      nextAction: loaded.nextAction,
      warnings: thinPlan.warnings,
    };
  }

  return {
    ok: true,
    planName: normalized.planName,
    planPath,
    absolutePlanPath,
    manifestContent: content,
    content,
    thinPlanContract: thinPlan.contract,
    status: rawStatus,
    nextAction: rawNextAction,
    warnings: thinPlan.warnings,
  };
};

export const preflightManualPlanExecutionMode = async ({
  planName,
  rootDir = process.cwd(),
}: ParsePlanOptions): Promise<{ ok: true } | Failure> => {
  const normalized = normalizePlanArgument(planName);
  if (isFailure(normalized)) {
    return normalized;
  }

  const absolutePlanPath = path.join(rootDir, normalized.planPath);
  if (!existsSync(absolutePlanPath)) {
    return { ok: true };
  }

  let content: string;
  try {
    content = await readFile(absolutePlanPath, "utf8");
  } catch (error) {
    return {
      ok: false,
      reason: `plan file cannot be read: ${normalized.planPath}: ${String(error)}`,
    };
  }

  if (
    normalizeWorkflowStateValue(
      extractSectionValue(content, "## Execution Mode") ?? "",
    ) === "manual"
  ) {
    return {
      ok: false,
      reason: `manual plan cannot be run by workflow-runner: ${normalized.planPath}. Use .ai/prompts/manual-execute-plan.md in the current conversation instead.`,
    };
  }

  return { ok: true };
};
