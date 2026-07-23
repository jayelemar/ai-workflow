import { asRecord, type ThinPlanWorkflowState } from "../types.ts";
import { workflowReviewSupersededByProgress } from "./thin-plan-sidecars.ts";

const asStringArray = (value: unknown): string[] | undefined =>
  Array.isArray(value) && value.every((item) => typeof item === "string")
    ? (value as string[])
    : undefined;

export const latestRecord = (
  workflow: ThinPlanWorkflowState,
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

export type RelevantWorkflowEvent = {
  kind: "execution" | "validation" | "review" | "unblock" | "reopen";
  label: "Execution" | "Validation" | "Review" | "Unblock" | "Reopen";
  stateField: "Outcome";
  stateValue?: string;
  summary?: string;
  evidence?: string;
  reason: string;
};

const details = (
  kind: RelevantWorkflowEvent["kind"],
  latest: Record<string, unknown> | undefined,
  reason: string,
): RelevantWorkflowEvent | undefined => {
  if (!latestNumber(latest)) return undefined;
  return {
    kind,
    label: kind === "execution" ? "Execution" : kind === "validation" ? "Validation" : kind === "review" ? "Review" : kind === "unblock" ? "Unblock" : "Reopen",
    stateField: "Outcome",
    stateValue: latestString(latest, "outcome"),
    summary: latestString(latest, "summary"),
    evidence: latestString(latest, "evidence"),
    reason,
  };
};

const supersededByProgress = (
  workflow: ThinPlanWorkflowState,
  event: Record<string, unknown> | undefined,
): boolean => {
  const history = workflow.history ?? [];
  const evidence = latestString(event, "evidence");
  const index = evidence ? history.indexOf(evidence) : -1;
  if (index < 0) return false;
  return ["execution", "validation"].some((kind) => {
    const laterEvidence = latestString(latestRecord(workflow, kind), "evidence");
    return Boolean(laterEvidence && history.indexOf(laterEvidence) > index);
  });
};

const occurredAfter = (
  workflow: ThinPlanWorkflowState,
  candidate: Record<string, unknown> | undefined,
  earlier: Record<string, unknown> | undefined,
): boolean => {
  const history = workflow.history ?? [];
  const candidateEvidence = latestString(candidate, "evidence");
  const earlierEvidence = latestString(earlier, "evidence");
  if (!candidateEvidence) return false;
  const candidateIndex = history.indexOf(candidateEvidence);
  if (candidateIndex < 0) return false;
  if (!earlierEvidence) return true;
  const earlierIndex = history.indexOf(earlierEvidence);
  return earlierIndex < 0 || candidateIndex > earlierIndex;
};

export const selectRelevantWorkflowEvent = (
  _planContent: string,
  workflow: ThinPlanWorkflowState | undefined,
): RelevantWorkflowEvent | undefined => {
  if (!workflow) return undefined;
  const execution = latestRecord(workflow, "execution");
  const validation = latestRecord(workflow, "validation");
  const review = latestRecord(workflow, "review");
  const unblock = latestRecord(workflow, "unblock");
  const reopen = latestRecord(workflow, "reopen");
  const reviewFindings = asStringArray(review?.unresolvedFindings) ?? [];
  const workflowState = workflow.workflowState;
  if (workflowState === "approved" || workflowState === "active") {
    if (
      workflowState === "active" &&
      latestString(unblock, "outcome") === "active" &&
      occurredAfter(workflow, unblock, execution)
    ) {
      return details("unblock", unblock, "latest resolved prerequisite for the next execute-plan run");
    }
    if (workflowState === "active" && reopen && !supersededByProgress(workflow, reopen)) return details("reopen", reopen, "latest reopen remediation for the next execute-plan run");
    if (workflowState === "active" && review && !workflowReviewSupersededByProgress(workflow.latest, workflow.history) && (reviewFindings.length > 0 || latestString(review, "outcome") === "active")) return details("review", review, "latest review remediation for the next execute-plan run");
    if (workflowState === "approved" && validation) return details("validation", validation, "latest approval evidence before execution starts");
    if (execution) return details("execution", execution, "latest execution checkpoint for the active implementation loop");
    if (validation) return details("validation", validation, "latest validation evidence still relevant to execution");
  }
  if (workflowState === "review") {
    if (validation) return details("validation", validation, "latest validation evidence for the current review pass");
    if (execution) return details("execution", execution, "latest execution evidence behind the current review pass");
  }
  if (workflowState === "blocked") {
    if (execution) return details("execution", execution, "latest blocking execution evidence to resolve before unblocking");
    if (unblock) return details("unblock", unblock, "latest unblock attempt for the current blocked state");
  }
  if (workflowState === "reopening") {
    if (reopen) return details("reopen", reopen, "latest reopen remediation for the next execution stage");
    if (review) return details("review", review, "latest completion review evidence behind the reopen request");
  }
  if (workflowState === "completed") {
    if (review) return details("review", review, "latest approval evidence before commit summary");
    if (execution) return details("execution", execution, "latest execution checkpoint before commit summary");
  }
  if (workflowState === "draft-validation" && validation) return details("validation", validation, "latest validation evidence for the current draft plan");
  return details("review", review, "latest review evidence") ?? details("validation", validation, "latest validation evidence") ?? details("execution", execution, "latest execution evidence") ?? details("unblock", unblock, "latest unblock evidence") ?? details("reopen", reopen, "latest reopen evidence");
};
