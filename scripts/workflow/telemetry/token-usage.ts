export type ContextUsageLogFields = {
  contextWindowTokens: number | 'unavailable';
  contextWindowUsedTokens: number | 'unavailable';
  contextWindowUsedPercent: string;
};

export type CodexTokenUsage = {
  usageAvailable: boolean;
  inputTokens: number | null;
  cachedInputTokens: number | null;
  uncachedInputTokens: number | null;
  outputTokens: number | null;
  reasoningOutputTokens: number | null;
  totalTokens: number | null;
  contextWindowTokens: number | 'unavailable';
  contextWindowUsedTokens: number | 'unavailable';
  contextWindowUsedPercent: string;
};

export const unavailableContextUsage: ContextUsageLogFields = {
  contextWindowTokens: 'unavailable',
  contextWindowUsedTokens: 'unavailable',
  contextWindowUsedPercent: 'unavailable',
};

const asRecord = (value: unknown): Record<string, unknown> | null =>
  typeof value === 'object' && value !== null ? (value as Record<string, unknown>) : null;

const isFiniteNumber = (value: unknown): value is number =>
  typeof value === 'number' && Number.isFinite(value);

export const parseContextUsage = (stdout: string): ContextUsageLogFields => {
  let latest: ContextUsageLogFields | undefined;
  let sawTokenCount = false;

  for (const line of stdout.split(/\r?\n/)) {
    const trimmed = line.trim();
    if (!trimmed) {
      continue;
    }

    let parsed: unknown;
    try {
      parsed = JSON.parse(trimmed);
    } catch {
      continue;
    }

    const event = asRecord(parsed);
    const payload = asRecord(event?.payload);
    if (payload?.type === 'token_count') {
      const info = asRecord(payload.info);
      const lastTokenUsage = asRecord(info?.last_token_usage);
      const usedTokens = lastTokenUsage?.total_tokens;
      const contextWindowTokens = info?.model_context_window;
      if (!isFiniteNumber(usedTokens) || usedTokens < 0) {
        continue;
      }
      if (!isFiniteNumber(contextWindowTokens) || contextWindowTokens <= 0) {
        continue;
      }

      sawTokenCount = true;
      latest = {
        contextWindowTokens,
        contextWindowUsedTokens: usedTokens,
        contextWindowUsedPercent: ((usedTokens / contextWindowTokens) * 100).toFixed(2),
      };
      continue;
    }

    if (!sawTokenCount && event?.type === 'turn.completed') {
      const usage = asRecord(event.usage);
      const usedTokens = usage?.input_tokens;
      if (!isFiniteNumber(usedTokens) || usedTokens < 0) {
        continue;
      }

      latest = {
        contextWindowTokens: 'unavailable',
        contextWindowUsedTokens: usedTokens,
        contextWindowUsedPercent: 'unavailable',
      };
    }
  }

  return latest ?? unavailableContextUsage;
};

export const parseCodexTokenUsage = (stdout: string): CodexTokenUsage => {
  const contextUsage = parseContextUsage(stdout);
  let detailedUsage: Omit<
    CodexTokenUsage,
    'contextWindowTokens' | 'contextWindowUsedTokens' | 'contextWindowUsedPercent'
  > | null = null;

  for (const line of stdout.split(/\r?\n/)) {
    const trimmed = line.trim();
    if (!trimmed) {
      continue;
    }

    let parsed: unknown;
    try {
      parsed = JSON.parse(trimmed);
    } catch {
      continue;
    }

    const event = asRecord(parsed);
    if (event?.type !== 'turn.completed') {
      continue;
    }

    const usage = asRecord(event.usage);
    const inputTokens = usage?.input_tokens;
    const outputTokens = usage?.output_tokens;
    if (!isFiniteNumber(inputTokens) || inputTokens < 0) {
      continue;
    }
    if (!isFiniteNumber(outputTokens) || outputTokens < 0) {
      continue;
    }

    const cachedInputTokens = isFiniteNumber(usage?.cached_input_tokens)
      ? Math.max(0, usage.cached_input_tokens)
      : 0;
    const reasoningOutputTokens = isFiniteNumber(usage?.reasoning_output_tokens)
      ? Math.max(0, usage.reasoning_output_tokens)
      : 0;
    const uncachedInputTokens = Math.max(0, inputTokens - cachedInputTokens);

    detailedUsage = {
      usageAvailable: true,
      inputTokens,
      cachedInputTokens,
      uncachedInputTokens,
      outputTokens,
      reasoningOutputTokens,
      totalTokens: inputTokens + outputTokens,
    };
  }

  return {
    ...(detailedUsage ?? {
      usageAvailable: false,
      inputTokens: null,
      cachedInputTokens: null,
      uncachedInputTokens: null,
      outputTokens: null,
      reasoningOutputTokens: null,
      totalTokens: null,
    }),
    ...contextUsage,
  };
};
