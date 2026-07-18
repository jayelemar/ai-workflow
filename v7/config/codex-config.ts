export type CodexModel = "gpt-5.6-terra" | "gpt-5.6-luna" | "gpt-5.6-sol" | "gpt-5.5" | "gpt-5.4" | "gpt-5.4-mini" | "gpt-5.3-codex-spark";
export type ReasoningEffort = "medium" | "high" | "xhigh";
export type V7CodexExecutionConfig = { model: CodexModel; reasoning: ReasoningEffort };

/**
 * Edit this policy to change the Codex model or reasoning effort used for a
 * V7 prompt. The runner retries the selected model before using fallbackModel.
 */
export const V7_CODEX_EXECUTION_POLICY = {
  profile: "codex-work",
  command: "codex",
  fallbackModel: "gpt-5.5" as CodexModel,
  promptModels: {
    ".ai/prompts/sync-plan-artifacts.md": { model: "gpt-5.6-luna", reasoning: "medium" },
    ".ai/prompts/plan-validator.md": { model: "gpt-5.6-terra", reasoning: "medium" },
    ".ai/prompts/execute-plan.md": { model: "gpt-5.5", reasoning: "high" },
    ".ai/prompts/unblock-plan.md": { model: "gpt-5.6-luna", reasoning: "medium" },
    ".ai/prompts/review-changes.md": { model: "gpt-5.6-terra", reasoning: "xhigh" },
    ".ai/prompts/reopen-plan.md": { model: "gpt-5.6-luna", reasoning: "medium" },
    ".ai/prompts/commit-summary.md": { model: "gpt-5.6-terra", reasoning: "medium" },
    ".ai/prompts/scope-cleanup.md": { model: "gpt-5.6-terra", reasoning: "high" },
  },
} as const satisfies { profile: string; command: string; fallbackModel: CodexModel; promptModels: Record<string, V7CodexExecutionConfig> };

export const v7CodexExecutionConfig = (promptPath: string): V7CodexExecutionConfig => {
  const config = V7_CODEX_EXECUTION_POLICY.promptModels[promptPath as keyof typeof V7_CODEX_EXECUTION_POLICY.promptModels];
  if (!config) throw new Error(`V7 Codex config missing for prompt: ${promptPath}`);
  return config;
};
