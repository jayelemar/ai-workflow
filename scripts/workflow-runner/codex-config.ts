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

export const WORKFLOW_RUNNER_CODEX_PROFILE: CodexProfile = "codex-work";
export const WORKFLOW_RUNNER_CODEX_FALLBACK_MODEL: CodexModel = "gpt-5.5";
export const CODEX_SELECTED_MODEL_CAPACITY_MESSAGE =
  "Selected model is at capacity" as const;
export const CODEX_SELECTED_MODEL_CAPACITY_PRIMARY_ATTEMPTS = 3;
export const CODEX_SELECTED_MODEL_CAPACITY_FALLBACK_ATTEMPTS = 2;

const promptConfigs: Record<string, CodexExecutionConfig> = {
  ".ai/prompts/sync-plan-artifacts.md": {
    model: "gpt-5.6-luna",
    reasoning: "medium",
  },
  ".ai/prompts/plan-validator.md": {
    model: "gpt-5.6-terra",
    reasoning: "medium",
  },
  ".ai/prompts/execute-plan.md": { model: "gpt-5.5", reasoning: "high" },
  ".ai/prompts/unblock-plan.md": { model: "gpt-5.6-luna", reasoning: "medium" },
  ".ai/prompts/review-changes.md": {
    model: "gpt-5.6-terra",
    reasoning: "xhigh",
  },
  ".ai/prompts/reopen-plan.md": { model: "gpt-5.6-luna", reasoning: "medium" },
  ".ai/prompts/commit-summary.md": {
    model: "gpt-5.6-terra",
    reasoning: "medium",
  },
  ".ai/prompts/scope-cleanup.md": {
    model: "gpt-5.6-terra",
    reasoning: "high",
  },
};

export const codexExecutionConfig = (
  promptPath: string,
): CodexExecutionConfig => {
  const config = promptConfigs[promptPath];
  if (!config) {
    throw new Error(
      `workflow runner codex config missing for prompt: ${promptPath}`,
    );
  }
  return config;
};

export const codexCapacityFallbackConfig = (
  executionConfig: CodexExecutionConfig,
): CodexExecutionConfig | undefined =>
  executionConfig.model === WORKFLOW_RUNNER_CODEX_FALLBACK_MODEL
    ? undefined
    : { ...executionConfig, model: WORKFLOW_RUNNER_CODEX_FALLBACK_MODEL };
