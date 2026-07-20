import { readFile, writeFile } from "node:fs/promises";
import path from "node:path";

import {
  asRecord,
  isFailure,
  type Failure,
  type ParsedPlan,
} from "../types.ts";
import type { WorkflowState } from "../../contracts/stage.ts";
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

const replaceManifestWorkflowState = (
  content: string,
  workflowState: WorkflowState,
): string => replaceManifestWorkflowValue(content, "## Workflow State", workflowState);

const canonicalWorkflowJson = (
  record: Record<string, unknown>,
  workflowState: WorkflowState,
): string => {
  return `${JSON.stringify({ ...record, workflowState, updatedAt: new Date().toISOString() }, null, 2)}\n`;
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

  if (workflow.workflowState === plan.workflowState) {
    return { ok: true, repaired: false };
  }

  const repairedContent = replaceManifestWorkflowState(manifestContent, workflow.workflowState);
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
    previous.workflowState !== "active" ||
    updated.workflowState !== "active"
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
    workflowRecord.workflowState !== "active"
  ) {
    return { ok: true, recovered: false };
  }

  const manifestContent = replaceManifestWorkflowState(updated.manifestContent, "review");
  const workflowContent = canonicalWorkflowJson(workflowRecord, "review");

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
  manifestWorkflowState,
}: {
  rootDir: string;
  planName: string;
  planPath: string;
  manifestContent: string;
  manifestWorkflowState: WorkflowState;
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

  const workflowState = workflowRecord.workflowState;
  const isReviewHandoff = workflowState === "review";
  const isActiveHandoff = workflowState === "active";
  const isBlockedHandoff = workflowState === "blocked";
  const manifestHasRecoverableHandoff =
    manifestWorkflowState === "review" ||
    manifestWorkflowState === "active" ||
    manifestWorkflowState === "blocked";
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

  const nextManifestContent = replaceManifestWorkflowState(manifestContent, "active");
  const nextWorkflow = {
    ...workflowRecord,
    workflowState: "active",
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
      canonicalWorkflowJson(nextWorkflow, "active"),
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
    plan.workflowState !== "active"
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

  const nextManifestContent = replaceManifestWorkflowState(plan.manifestContent, "blocked");
  const nextWorkflow = {
    ...workflowRecord,
    workflowState: "blocked",
    updatedAt: new Date().toISOString(),
  };

  try {
    await writeFile(
      path.join(rootDir, workflowPath),
      canonicalWorkflowJson(nextWorkflow, "blocked"),
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
