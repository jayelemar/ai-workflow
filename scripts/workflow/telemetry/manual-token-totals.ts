import type { TokenUsageTotals } from "./session-snapshot.ts";

export const zeroTotals = (): TokenUsageTotals => ({
  inputTokens: 0,
  cachedInputTokens: 0,
  uncachedInputTokens: 0,
  outputTokens: 0,
  reasoningOutputTokens: 0,
  totalTokens: 0,
});

export const addTotals = (
  left: TokenUsageTotals,
  right: TokenUsageTotals,
): TokenUsageTotals => ({
  inputTokens: left.inputTokens + right.inputTokens,
  cachedInputTokens: left.cachedInputTokens + right.cachedInputTokens,
  uncachedInputTokens: left.uncachedInputTokens + right.uncachedInputTokens,
  outputTokens: left.outputTokens + right.outputTokens,
  reasoningOutputTokens:
    left.reasoningOutputTokens + right.reasoningOutputTokens,
  totalTokens: left.totalTokens + right.totalTokens,
});

export const subtractTotals = (
  current: TokenUsageTotals,
  previous: TokenUsageTotals,
): TokenUsageTotals | null => {
  const diff = {
    inputTokens: current.inputTokens - previous.inputTokens,
    cachedInputTokens: current.cachedInputTokens - previous.cachedInputTokens,
    uncachedInputTokens:
      current.uncachedInputTokens - previous.uncachedInputTokens,
    outputTokens: current.outputTokens - previous.outputTokens,
    reasoningOutputTokens:
      current.reasoningOutputTokens - previous.reasoningOutputTokens,
    totalTokens: current.totalTokens - previous.totalTokens,
  };
  return Object.values(diff).every((value) => value >= 0) ? diff : null;
};
