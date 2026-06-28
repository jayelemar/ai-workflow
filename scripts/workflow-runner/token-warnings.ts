const WORKFLOW_CONTEXT_PLAN_SIZE_WARNING_BYTES = 100 * 1024;
const WORKFLOW_CONTEXT_STAGE_INPUT_WARNING_TOKENS = 2_000_000;
const WORKFLOW_CONTEXT_STAGE_UNCACHED_WARNING_TOKENS = 100_000;

export type WorkflowThresholdTokenUsage = {
  stageInputTokens?: number | null;
  stageUncachedInputTokens?: number | null;
};

const isFiniteNumber = (value: unknown): value is number =>
  typeof value === 'number' && Number.isFinite(value);

const formatKilobytes = (bytes: number): string => `${(bytes / 1024).toFixed(1)} KB`;

export const exceedsWorkflowTokenThresholds = (
  latestTokenUsage?: WorkflowThresholdTokenUsage,
): boolean =>
  (isFiniteNumber(latestTokenUsage?.stageInputTokens) &&
    latestTokenUsage.stageInputTokens > WORKFLOW_CONTEXT_STAGE_INPUT_WARNING_TOKENS) ||
  (isFiniteNumber(latestTokenUsage?.stageUncachedInputTokens) &&
    latestTokenUsage.stageUncachedInputTokens > WORKFLOW_CONTEXT_STAGE_UNCACHED_WARNING_TOKENS);

export const collectWorkflowThresholdWarnings = ({
  planByteSize,
  latestTokenUsage,
}: {
  planByteSize: number;
  latestTokenUsage?: WorkflowThresholdTokenUsage;
}): string[] => {
  const warnings: string[] = [];
  const planIsLarge = planByteSize > WORKFLOW_CONTEXT_PLAN_SIZE_WARNING_BYTES;

  if (planIsLarge) {
    warnings.push(
      `Plan file is ${formatKilobytes(planByteSize)} (> 100 KB). Move review notes, logs, and long summaries to .ai/artifacts/<plan-name>/events/.`,
    );
  }

  if (
    isFiniteNumber(latestTokenUsage?.stageInputTokens) &&
    latestTokenUsage.stageInputTokens > WORKFLOW_CONTEXT_STAGE_INPUT_WARNING_TOKENS
  ) {
    warnings.push(
      `Advisory only: stage input tokens were ${latestTokenUsage.stageInputTokens.toLocaleString('en-US')} (> 2,000,000). If the next stage is execute-plan, the runner will add stricter snapshot-first guidance.`,
    );
  }

  if (
    isFiniteNumber(latestTokenUsage?.stageUncachedInputTokens) &&
    latestTokenUsage.stageUncachedInputTokens > WORKFLOW_CONTEXT_STAGE_UNCACHED_WARNING_TOKENS
  ) {
    warnings.push(
      `Advisory only: stage uncached input tokens were ${latestTokenUsage.stageUncachedInputTokens.toLocaleString('en-US')} (> 100,000). If the next stage is execute-plan, the runner will keep it snapshot-first with exact-file fallback.`,
    );
  }

  return warnings;
};
