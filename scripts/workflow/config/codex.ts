export type CodexProfile = string;
export type CodexModel =
  | "gpt-5.6-terra"
  | "gpt-5.6-luna"
  | "gpt-5.6-sol"
  | "gpt-5.5"
  | "gpt-5.4"
  | "gpt-5.4-mini"
  | "gpt-5.3-codex-spark";
export type ReasoningEffort = "medium" | "high" | "xhigh";
export type CodexExecutionConfig = {
  model: CodexModel;
  reasoning: ReasoningEffort;
};

import {
  WORKFLOW_RUNNER_CODEX_FALLBACK_MODEL,
  workflowStageContractForPrompt,
} from "../contracts/stage.ts";
export { WORKFLOW_RUNNER_CODEX_FALLBACK_MODEL } from "../contracts/stage.ts";

export const WORKFLOW_RUNNER_CODEX_PROFILE: CodexProfile = "codex-work";
export const CODEX_SELECTED_MODEL_CAPACITY_MESSAGE =
  "Selected model is at capacity" as const;
export const CODEX_SELECTED_MODEL_CAPACITY_PRIMARY_ATTEMPTS = 3;
export const CODEX_SELECTED_MODEL_CAPACITY_FALLBACK_ATTEMPTS = 2;

export const codexExecutionConfig = (
  promptPath: string,
): CodexExecutionConfig => {
  const config = workflowStageContractForPrompt(promptPath);
  if (!config) {
    throw new Error(
      `workflow runner codex config missing for prompt: ${promptPath}`,
    );
  }
  return { model: config.model, reasoning: config.reasoning };
};

export const codexCapacityFallbackConfig = (
  executionConfig: CodexExecutionConfig,
): CodexExecutionConfig | undefined =>
  executionConfig.model === WORKFLOW_RUNNER_CODEX_FALLBACK_MODEL
    ? undefined
    : { ...executionConfig, model: WORKFLOW_RUNNER_CODEX_FALLBACK_MODEL };
