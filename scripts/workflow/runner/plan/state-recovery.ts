import { readFile, writeFile } from "node:fs/promises";
import path from "node:path";

import {
  asRecord,
  isFailure,
  type Failure,
  type ParsedPlan,
} from "../types.ts";
import {
  extractSectionValue,
  isNextAction,
  isStatus,
  normalizeWorkflowStateValue,
} from "./parser.ts";
import {
  normalizeWorkflowEventHistory,
  parseThinPlanV2WorkflowState,
  readJsonArtifact,
  thinPlanV2ArtifactPath,
  workflowReviewSupersededByProgress,
} from "./thin-plan-sidecars.ts";

const asStringArray = (value: unknown): string[] | undefined =>
  Array.isArray(value) && value.every((item) => typeof item === "string")
    ? (value as string[])
    : undefined;

const latestString = (
  record: Record<string, unknown> | undefined,
  key: string,
): string | undefined =>
  typeof record?.[key] === "string" ? record[key] : undefined;

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
