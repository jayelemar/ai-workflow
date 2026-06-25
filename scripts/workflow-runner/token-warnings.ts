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
      `Plan file is ${formatKilobytes(planByteSize)} (> 100 KB). This workflow is becoming pathological; move bulky workflow detail into .ai/artifacts/<plan-name>/events/ and keep the plan thin.`,
    );
  }

  if (
    isFiniteNumber(latestTokenUsage?.stageInputTokens) &&
    latestTokenUsage.stageInputTokens > WORKFLOW_CONTEXT_STAGE_INPUT_WARNING_TOKENS
  ) {
    const stageInputPrefix = `Latest stage total input tokens are ${latestTokenUsage.stageInputTokens.toLocaleString('en-US')} (> 2,000,000). This workflow is becoming pathological;`;
    warnings.push(
      planIsLarge
        ? `${stageInputPrefix} move bulky workflow detail into .ai/artifacts/<plan-name>/events/ and keep the plan thin.`
        : `${stageInputPrefix} plan is already thin, so the likely source is a long stage with repeated cached context, broad artifact reads, or large tool output. Split execute/review earlier and inspect .ai/artifacts/<plan-name>/logs/token-usage.jsonl.`,
    );
  }

  if (
    isFiniteNumber(latestTokenUsage?.stageUncachedInputTokens) &&
    latestTokenUsage.stageUncachedInputTokens > WORKFLOW_CONTEXT_STAGE_UNCACHED_WARNING_TOKENS
  ) {
    const stageUncachedPrefix = `Latest stage uncached input tokens are ${latestTokenUsage.stageUncachedInputTokens.toLocaleString('en-US')} (> 100,000). This workflow is becoming pathological;`;
    warnings.push(
      planIsLarge
        ? `${stageUncachedPrefix} move bulky workflow detail into .ai/artifacts/<plan-name>/events/ and keep the plan thin.`
        : `${stageUncachedPrefix} plan is already thin, so fresh uncached input likely comes from broad context loading, broad artifact reads, or large tool output. Use the context snapshot first and open event artifacts only for specific evidence.`,
    );
  }

  return warnings;
};
