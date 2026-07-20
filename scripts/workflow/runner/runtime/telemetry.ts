import type { TokenUsageTotals } from "../types.ts";

export const createZeroTokenUsageTotals = (): TokenUsageTotals => ({
  inputTokens: 0,
  cachedInputTokens: 0,
  uncachedInputTokens: 0,
  outputTokens: 0,
  reasoningOutputTokens: 0,
  totalTokens: 0,
});
