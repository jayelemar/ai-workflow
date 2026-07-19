import type { CodexModel, ReasoningEffort } from "../config/codex.ts";

export type WorkflowStatus =
  | "draft"
  | "approved"
  | "active"
  | "review"
  | "reopening"
  | "completed"
  | "blocked";

export type WorkflowNextAction =
  | "sync-plan-artifacts"
  | "plan-validator"
  | "execute-plan"
  | "unblock-plan"
  | "review-plan"
  | "reopen-plan"
  | "commit-summary";

export type WorkflowStageContract = {
  id:
    | "sync-plan-artifacts"
    | "plan-validator"
    | "execute-plan"
    | "unblock-plan"
    | "review-changes"
    | "reopen-plan"
    | "commit-summary"
    | "scope-cleanup";
  promptPath: string;
  humanLabel: string;
  model: CodexModel;
  reasoning: ReasoningEffort;
  fallbackModel?: CodexModel;
  routes: ReadonlyArray<readonly [WorkflowStatus, WorkflowNextAction]>;
};

export const WORKFLOW_RUNNER_CODEX_FALLBACK_MODEL: CodexModel = "gpt-5.5";
export const SYNC_PLAN_ARTIFACTS_PROMPT_PATH = ".ai/prompts/sync-plan-artifacts.md";
export const PLAN_VALIDATOR_PROMPT_PATH = ".ai/prompts/plan-validator.md";
export const EXECUTE_PLAN_PROMPT_PATH = ".ai/prompts/execute-plan.md";
export const UNBLOCK_PLAN_PROMPT_PATH = ".ai/prompts/unblock-plan.md";
export const REVIEW_CHANGES_PROMPT_PATH = ".ai/prompts/review-changes.md";
export const REOPEN_PLAN_PROMPT_PATH = ".ai/prompts/reopen-plan.md";
export const COMMIT_SUMMARY_PROMPT_PATH = ".ai/prompts/commit-summary.md";
export const SCOPE_CLEANUP_PROMPT_PATH = ".ai/prompts/scope-cleanup.md";

export const WORKFLOW_STAGE_CONTRACTS = [
  {
    id: "sync-plan-artifacts",
    promptPath: SYNC_PLAN_ARTIFACTS_PROMPT_PATH,
    humanLabel: "Sync artifacts",
    model: "gpt-5.6-luna",
    reasoning: "medium",
    fallbackModel: WORKFLOW_RUNNER_CODEX_FALLBACK_MODEL,
    routes: [["draft", "sync-plan-artifacts"]],
  },
  {
    id: "plan-validator",
    promptPath: PLAN_VALIDATOR_PROMPT_PATH,
    humanLabel: "Validate",
    model: "gpt-5.6-terra",
    reasoning: "medium",
    fallbackModel: WORKFLOW_RUNNER_CODEX_FALLBACK_MODEL,
    routes: [["draft", "plan-validator"]],
  },
  {
    id: "execute-plan",
    promptPath: EXECUTE_PLAN_PROMPT_PATH,
    humanLabel: "Execute",
    model: "gpt-5.5",
    reasoning: "high",
    routes: [
      ["approved", "execute-plan"],
      ["active", "execute-plan"],
    ],
  },
  {
    id: "unblock-plan",
    promptPath: UNBLOCK_PLAN_PROMPT_PATH,
    humanLabel: "Unblock",
    model: "gpt-5.6-luna",
    reasoning: "medium",
    fallbackModel: WORKFLOW_RUNNER_CODEX_FALLBACK_MODEL,
    routes: [
      ["blocked", "execute-plan"],
      ["blocked", "unblock-plan"],
    ],
  },
  {
    id: "review-changes",
    promptPath: REVIEW_CHANGES_PROMPT_PATH,
    humanLabel: "Review",
    model: "gpt-5.6-terra",
    reasoning: "xhigh",
    fallbackModel: WORKFLOW_RUNNER_CODEX_FALLBACK_MODEL,
    routes: [["review", "review-plan"]],
  },
  {
    id: "reopen-plan",
    promptPath: REOPEN_PLAN_PROMPT_PATH,
    humanLabel: "Reopen",
    model: "gpt-5.6-luna",
    reasoning: "medium",
    fallbackModel: WORKFLOW_RUNNER_CODEX_FALLBACK_MODEL,
    routes: [["reopening", "reopen-plan"]],
  },
  {
    id: "commit-summary",
    promptPath: COMMIT_SUMMARY_PROMPT_PATH,
    humanLabel: "Commit summary",
    model: "gpt-5.6-terra",
    reasoning: "medium",
    fallbackModel: WORKFLOW_RUNNER_CODEX_FALLBACK_MODEL,
    routes: [["completed", "commit-summary"]],
  },
  {
    id: "scope-cleanup",
    promptPath: SCOPE_CLEANUP_PROMPT_PATH,
    humanLabel: "Scope cleanup",
    model: "gpt-5.6-terra",
    reasoning: "high",
    fallbackModel: WORKFLOW_RUNNER_CODEX_FALLBACK_MODEL,
    routes: [],
  },
] as const satisfies ReadonlyArray<WorkflowStageContract>;

export const workflowStageContractForPrompt = (promptPath: string) =>
  WORKFLOW_STAGE_CONTRACTS.find((contract) => contract.promptPath === promptPath);

export const workflowStageContractForState = (
  status: WorkflowStatus,
  nextAction: WorkflowNextAction,
) =>
  WORKFLOW_STAGE_CONTRACTS.find((contract) =>
    contract.routes.some(
      ([routeStatus, routeNextAction]) =>
        routeStatus === status && routeNextAction === nextAction,
    ),
  );

export const workflowStagePromptPaths = new Set(
  WORKFLOW_STAGE_CONTRACTS.map((contract) => contract.promptPath),
);
