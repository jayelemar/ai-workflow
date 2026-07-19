import {
  EXECUTE_PLAN_PROMPT_PATH,
  PLAN_VALIDATOR_PROMPT_PATH,
  REOPEN_PLAN_PROMPT_PATH,
  REVIEW_CHANGES_PROMPT_PATH,
  SYNC_PLAN_ARTIFACTS_PROMPT_PATH,
  UNBLOCK_PLAN_PROMPT_PATH,
  workflowStageContractForState,
} from "../contracts/stage.ts";
import type { Failure, NextAction, ParsedPlan, Status } from "./types.ts";

export type Route =
  | { executable: true; promptPath: string; terminal: boolean }
  | { executable: false; reason: string };

export const routeFor = (status: Status, nextAction: NextAction): Route => {
  const contract = workflowStageContractForState(status, nextAction);
  if (!contract) {
    return {
      executable: false,
      reason: `undefined status/next action pair: ${status} + ${nextAction}`,
    };
  }

  return {
    executable: true,
    promptPath: contract.promptPath,
    terminal: status === "completed" && nextAction === "commit-summary",
  };
};

export const transitionAllowed = (
  promptPath: string,
  _previous: ParsedPlan,
  next: ParsedPlan,
): { ok: true } | Failure => {
  if (promptPath === SYNC_PLAN_ARTIFACTS_PROMPT_PATH) {
    const allowedDraftValidator =
      next.status === "draft" && next.nextAction === "plan-validator";
    const allowedDraftSync =
      next.status === "draft" && next.nextAction === "sync-plan-artifacts";
    if (!allowedDraftValidator && !allowedDraftSync) {
      return {
        ok: false,
        reason: `sync-plan-artifacts may only hand off to draft + plan-validator or remain draft + sync-plan-artifacts, got ${next.status} + ${next.nextAction}`,
      };
    }
  }
  if (promptPath === PLAN_VALIDATOR_PROMPT_PATH) {
    const allowedApproved =
      next.status === "approved" && next.nextAction === "execute-plan";
    const allowedDraftValidator =
      next.status === "draft" && next.nextAction === "plan-validator";
    if (!allowedApproved && !allowedDraftValidator) {
      return {
        ok: false,
        reason: `plan-validator may only hand off to approved + execute-plan or remain draft + plan-validator, got ${next.status} + ${next.nextAction}`,
      };
    }
  }
  if (promptPath === EXECUTE_PLAN_PROMPT_PATH) {
    const allowedReview =
      next.status === "review" && next.nextAction === "review-plan";
    const allowedActive =
      next.status === "active" && next.nextAction === "execute-plan";
    const allowedBlocked =
      next.status === "blocked" &&
      (next.nextAction === "unblock-plan" ||
        next.nextAction === "execute-plan");
    if (!allowedReview && !allowedActive && !allowedBlocked) {
      return {
        ok: false,
        reason: `execute-plan may only hand off to review + review-plan, active + execute-plan, or blocked + unblock-plan, got ${next.status} + ${next.nextAction}`,
      };
    }
  }
  if (promptPath === REVIEW_CHANGES_PROMPT_PATH) {
    const allowedActive =
      next.status === "active" && next.nextAction === "execute-plan";
    const allowedCompleted =
      next.status === "completed" && next.nextAction === "commit-summary";
    if (!allowedActive && !allowedCompleted) {
      return {
        ok: false,
        reason: `review-changes may only hand off to active + execute-plan or completed + commit-summary, got ${next.status} + ${next.nextAction}`,
      };
    }
  }
  if (promptPath === UNBLOCK_PLAN_PROMPT_PATH) {
    const allowedActive =
      next.status === "active" && next.nextAction === "execute-plan";
    const allowedBlocked =
      next.status === "blocked" &&
      (next.nextAction === "unblock-plan" ||
        next.nextAction === "execute-plan");
    if (!allowedActive && !allowedBlocked) {
      return {
        ok: false,
        reason: `unblock-plan may only hand off to active + execute-plan or remain blocked, got ${next.status} + ${next.nextAction}`,
      };
    }
  }
  if (promptPath === REOPEN_PLAN_PROMPT_PATH) {
    const allowedActive =
      next.status === "active" && next.nextAction === "execute-plan";
    if (!allowedActive) {
      return {
        ok: false,
        reason: `reopen-plan may only hand off to active + execute-plan, got ${next.status} + ${next.nextAction}`,
      };
    }
  }
  return { ok: true };
};
