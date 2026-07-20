import {
  EXECUTE_PLAN_PROMPT_PATH,
  PLAN_VALIDATOR_PROMPT_PATH,
  REOPEN_PLAN_PROMPT_PATH,
  REVIEW_CHANGES_PROMPT_PATH,
  SYNC_PLAN_ARTIFACTS_PROMPT_PATH,
  UNBLOCK_PLAN_PROMPT_PATH,
  workflowStageContractForState,
  type WorkflowState,
} from "../contracts/stage.ts";
import type { Failure, ParsedPlan } from "./types.ts";

export type Route =
  | { executable: true; promptPath: string; terminal: boolean }
  | { executable: false; reason: string };

export const routeFor = (workflowState: WorkflowState): Route => {
  const contract = workflowStageContractForState(workflowState);
  if (!contract) return { executable: false, reason: `unknown workflow state: ${workflowState}` };
  return { executable: true, promptPath: contract.promptPath, terminal: workflowState === "completed" };
};

const allowedTransitions: Partial<Record<string, readonly WorkflowState[]>> = {
  [SYNC_PLAN_ARTIFACTS_PROMPT_PATH]: ["draft-validation", "draft-artifact-sync"],
  [PLAN_VALIDATOR_PROMPT_PATH]: ["approved", "draft-validation"],
  [EXECUTE_PLAN_PROMPT_PATH]: ["review", "active", "blocked"],
  [REVIEW_CHANGES_PROMPT_PATH]: ["active", "completed"],
  [UNBLOCK_PLAN_PROMPT_PATH]: ["active", "blocked"],
  [REOPEN_PLAN_PROMPT_PATH]: ["active"],
};

export const transitionAllowed = (
  promptPath: string,
  previous: ParsedPlan,
  next: ParsedPlan,
): { ok: true } | Failure => {
  const allowed = allowedTransitions[promptPath];
  if (!allowed || allowed.includes(next.workflowState)) return { ok: true };
  return { ok: false, reason: `${previous.workflowState} stage ${promptPath} may not transition to ${next.workflowState}` };
};
