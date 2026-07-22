const WORKFLOW_CONTEXT_PLAN_SIZE_WARNING_BYTES = 100 * 1024;
export const WORKFLOW_STAGE_INPUT_WARNING_TOKENS = 300_000;
export const WORKFLOW_STAGE_UNCACHED_WARNING_TOKENS = 40_000;
export const WORKFLOW_REVIEW_FULL_DIFF_BYTE_LIMIT = 80 * 1024;
export const WORKFLOW_REVIEW_PRIMARY_PATH_LIMIT = 8;
export const WORKFLOW_AUTO_NARROW_PASS_LIMIT = 3;

export type WorkflowThresholdTokenUsage = {
  stageInputTokens?: number | null;
  stageUncachedInputTokens?: number | null;
};

export type WorkflowAutoNarrowDecision = {
  shouldNarrow: boolean;
  nextPass: number;
  reason?: string;
};

const isFiniteNumber = (value: unknown): value is number =>
  typeof value === 'number' && Number.isFinite(value);

const formatKilobytes = (bytes: number): string => `${(bytes / 1024).toFixed(1)} KB`;

export const exceedsWorkflowTokenThresholds = (
  latestTokenUsage?: WorkflowThresholdTokenUsage,
): boolean =>
  (isFiniteNumber(latestTokenUsage?.stageInputTokens) &&
    latestTokenUsage.stageInputTokens >= WORKFLOW_STAGE_INPUT_WARNING_TOKENS) ||
  (isFiniteNumber(latestTokenUsage?.stageUncachedInputTokens) &&
    latestTokenUsage.stageUncachedInputTokens >= WORKFLOW_STAGE_UNCACHED_WARNING_TOKENS);

export const decideWorkflowAutoNarrow = ({
  currentPass = 0,
  diffBytes,
  cleanupDiffBytes,
}: {
  currentPass?: number;
  diffBytes?: number;
  cleanupDiffBytes?: number;
}): WorkflowAutoNarrowDecision => {
  const reasons = [
    isFiniteNumber(diffBytes) && diffBytes > WORKFLOW_REVIEW_FULL_DIFF_BYTE_LIMIT
      ? `review full diff ${diffBytes} bytes > ${WORKFLOW_REVIEW_FULL_DIFF_BYTE_LIMIT} bytes`
      : undefined,
    isFiniteNumber(cleanupDiffBytes) &&
    cleanupDiffBytes > WORKFLOW_REVIEW_FULL_DIFF_BYTE_LIMIT
      ? `scope cleanup diff ${cleanupDiffBytes} bytes > ${WORKFLOW_REVIEW_FULL_DIFF_BYTE_LIMIT} bytes`
      : undefined,
  ].filter((reason): reason is string => Boolean(reason));

  if (reasons.length === 0) {
    return { shouldNarrow: false, nextPass: currentPass };
  }

  const nextPass = Math.min(currentPass + 1, WORKFLOW_AUTO_NARROW_PASS_LIMIT);
  return {
    shouldNarrow: currentPass < WORKFLOW_AUTO_NARROW_PASS_LIMIT,
    nextPass,
    reason: reasons.join("; "),
  };
};

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
    (isFiniteNumber(latestTokenUsage?.stageInputTokens) &&
      latestTokenUsage.stageInputTokens >= WORKFLOW_STAGE_INPUT_WARNING_TOKENS) ||
    (isFiniteNumber(latestTokenUsage?.stageUncachedInputTokens) &&
      latestTokenUsage.stageUncachedInputTokens >=
        WORKFLOW_STAGE_UNCACHED_WARNING_TOKENS)
  ) {
    warnings.push(
      'Stage token usage is high; the next guarded workflow stage will use snapshot-first guidance.',
    );
  }

  return warnings;
};
