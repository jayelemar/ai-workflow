import type { CodexModel, ReasoningEffort } from "../config/codex.ts";

export type WorkflowState =
  | "draft-artifact-sync"
  | "draft-validation"
  | "approved"
  | "active"
  | "blocked"
  | "review"
  | "reopening"
  | "completed";

export type WorkflowAction =
  | "sync-plan-artifacts"
  | "plan-validator"
  | "execute-plan"
  | "unblock-plan"
  | "review-changes"
  | "reopen-plan"
  | "commit-summary";

export type WorkflowStageContract = {
  id: WorkflowAction | "scope-cleanup";
  workflowState?: WorkflowState;
  promptPath: string;
  humanLabel: string;
  model: CodexModel;
  reasoning: ReasoningEffort;
  fallbackModel?: CodexModel;
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
    workflowState: "draft-artifact-sync",
    model: "gpt-5.6-luna",
    reasoning: "medium",
    promptPath: SYNC_PLAN_ARTIFACTS_PROMPT_PATH,
    humanLabel: "Sync artifacts",
    fallbackModel: WORKFLOW_RUNNER_CODEX_FALLBACK_MODEL
  },
  {
    id: "plan-validator",
    workflowState: "draft-validation",
    model: "gpt-5.5",
    reasoning: "medium",
    promptPath: PLAN_VALIDATOR_PROMPT_PATH,
    humanLabel: "Validate",
    fallbackModel: WORKFLOW_RUNNER_CODEX_FALLBACK_MODEL
  },
  {
    id: "execute-plan",
    workflowState: "approved",
    model: "gpt-5.5",
    reasoning: "high",
    promptPath: EXECUTE_PLAN_PROMPT_PATH,
    humanLabel: "Execute",
  },
  {
    id: "execute-plan",
    workflowState: "active",
    model: "gpt-5.5",
    reasoning: "high",
    promptPath: EXECUTE_PLAN_PROMPT_PATH,
    humanLabel: "Execute",
  },
  {
    id: "unblock-plan",
    workflowState: "blocked",
    model: "gpt-5.6-luna",
    reasoning: "medium",
    promptPath: UNBLOCK_PLAN_PROMPT_PATH,
    humanLabel: "Unblock",
    fallbackModel: WORKFLOW_RUNNER_CODEX_FALLBACK_MODEL
  },
  {
    id: "review-changes",
    workflowState: "review",
    promptPath: REVIEW_CHANGES_PROMPT_PATH,
    humanLabel: "Review",
    model: "gpt-5.6-sol",
    reasoning: "xhigh",
    fallbackModel: WORKFLOW_RUNNER_CODEX_FALLBACK_MODEL
  },
  {
    id: "reopen-plan",
    workflowState: "reopening",
    promptPath: REOPEN_PLAN_PROMPT_PATH,
    humanLabel: "Reopen",
    model: "gpt-5.6-luna",
    reasoning: "medium",
    fallbackModel: WORKFLOW_RUNNER_CODEX_FALLBACK_MODEL
  },
  {
    id: "commit-summary",
    workflowState: "completed",
    promptPath: COMMIT_SUMMARY_PROMPT_PATH,
    humanLabel: "Commit summary",
    model: "gpt-5.5",
    reasoning: "medium",
    fallbackModel: WORKFLOW_RUNNER_CODEX_FALLBACK_MODEL
  },
  {
    id: "scope-cleanup",
    promptPath: SCOPE_CLEANUP_PROMPT_PATH,
    humanLabel: "Scope cleanup",
    model: "gpt-5.6-terra",
    reasoning: "high",
    fallbackModel: WORKFLOW_RUNNER_CODEX_FALLBACK_MODEL
  },
] as const satisfies ReadonlyArray<WorkflowStageContract>;

type WorkflowStateStageContract = Extract<
  (typeof WORKFLOW_STAGE_CONTRACTS)[number],
  { workflowState: WorkflowState; id: WorkflowAction }
>;

const isWorkflowStateStageContract = (
  contract: (typeof WORKFLOW_STAGE_CONTRACTS)[number],
): contract is WorkflowStateStageContract => "workflowState" in contract;

const stateContracts = WORKFLOW_STAGE_CONTRACTS.filter(
  isWorkflowStateStageContract,
);

export const workflowStageContractForPrompt = (promptPath: string) =>
  WORKFLOW_STAGE_CONTRACTS.find((contract) => contract.promptPath === promptPath);

export const workflowStageContractForState = (workflowState: WorkflowState) =>
  stateContracts.find((contract) => contract.workflowState === workflowState);

export const workflowStagePromptPaths = new Set(
  WORKFLOW_STAGE_CONTRACTS.map((contract) => contract.promptPath),
);
