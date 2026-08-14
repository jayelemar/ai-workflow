export type TokenUsageTotals = {
  inputTokens: number;
  cachedInputTokens: number;
  uncachedInputTokens: number;
  outputTokens: number;
  reasoningOutputTokens: number;
  totalTokens: number;
};

export type ContextUsage = {
  contextWindowTokens: number | "unavailable";
  contextWindowUsedTokens: number | "unavailable";
  contextWindowUsedPercent: string;
};

export type SessionTokenSnapshot = {
  sessionId: string;
  sessionFilePath: string;
  timestamp: string;
  model: string;
  totals: TokenUsageTotals;
  contextUsage: ContextUsage;
};

const unavailableContextUsage = (): ContextUsage => ({
  contextWindowTokens: "unavailable",
  contextWindowUsedTokens: "unavailable",
  contextWindowUsedPercent: "unavailable",
});

const asRecord = (value: unknown): Record<string, unknown> | null =>
  typeof value === "object" && value !== null
    ? (value as Record<string, unknown>)
    : null;

const isFiniteNumber = (value: unknown): value is number =>
  typeof value === "number" && Number.isFinite(value);

const clampNonNegative = (value: number): number => Math.max(0, value);

const toSessionTotals = (
  usage: Record<string, unknown>,
): TokenUsageTotals | null => {
  const inputTokens = usage.input_tokens;
  const cachedInputTokens = usage.cached_input_tokens;
  const outputTokens = usage.output_tokens;
  const reasoningOutputTokens = usage.reasoning_output_tokens;
  const totalTokens = usage.total_tokens;
  if (
    !isFiniteNumber(inputTokens) ||
    !isFiniteNumber(cachedInputTokens) ||
    !isFiniteNumber(outputTokens) ||
    !isFiniteNumber(reasoningOutputTokens) ||
    !isFiniteNumber(totalTokens)
  ) {
    return null;
  }

  return {
    inputTokens: clampNonNegative(inputTokens),
    cachedInputTokens: clampNonNegative(cachedInputTokens),
    uncachedInputTokens: clampNonNegative(inputTokens - cachedInputTokens),
    outputTokens: clampNonNegative(outputTokens),
    reasoningOutputTokens: clampNonNegative(reasoningOutputTokens),
    totalTokens: clampNonNegative(totalTokens),
  };
};

export const parseSessionTokenSnapshot = (
  content: string,
  sessionFilePath: string,
  targetCwd: string,
): SessionTokenSnapshot | null => {
  let sessionId: string | undefined;
  let latestTurnContextModel: string | undefined;
  let latestTokenTotals: TokenUsageTotals | undefined;
  let latestContextUsage: ContextUsage | undefined;
  let latestTimestamp: string | undefined;
  let sawTargetCwd = false;

  for (const line of content.split(/\r?\n/)) {
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
    if (!event) {
      continue;
    }

    if (event.type === "session_meta") {
      const payload = asRecord(event.payload);
      const payloadSessionId =
        typeof payload?.session_id === "string"
          ? payload.session_id
          : typeof payload?.id === "string"
            ? payload.id
            : undefined;
      const payloadCwd =
        typeof payload?.cwd === "string" ? payload.cwd : undefined;
      const payloadTimestamp =
        typeof payload?.timestamp === "string"
          ? payload.timestamp
          : typeof event.timestamp === "string"
            ? event.timestamp
            : undefined;

      sessionId ??= payloadSessionId;
      latestTimestamp ??= payloadTimestamp;
      if (payloadCwd === targetCwd) {
        sawTargetCwd = true;
      }
      continue;
    }

    const payload = asRecord(event.payload);
    if (!payload) {
      continue;
    }

    if (event.type === "turn_context") {
      const cwd = typeof payload.cwd === "string" ? payload.cwd : undefined;
      if (cwd === targetCwd) {
        sawTargetCwd = true;
      }
      if (
        cwd === targetCwd &&
        typeof payload.model === "string" &&
        payload.model.length > 0
      ) {
        latestTurnContextModel = payload.model;
      }
      continue;
    }

    if (event.type !== "event_msg" || payload.type !== "token_count") {
      continue;
    }

    const info = asRecord(payload.info);
    const totalTokenUsage = asRecord(info?.total_token_usage);
    const lastTokenUsage = asRecord(info?.last_token_usage);
    const totals = totalTokenUsage ? toSessionTotals(totalTokenUsage) : null;
    if (!totals) {
      continue;
    }

    const lastTotalTokens = lastTokenUsage?.total_tokens;
    const contextWindowTokens = info?.model_context_window;
    latestTokenTotals = totals;
    latestTimestamp =
      typeof event.timestamp === "string" ? event.timestamp : latestTimestamp;
    if (
      isFiniteNumber(lastTotalTokens) &&
      isFiniteNumber(contextWindowTokens) &&
      contextWindowTokens > 0
    ) {
      latestContextUsage = {
        contextWindowTokens,
        contextWindowUsedTokens: clampNonNegative(lastTotalTokens),
        contextWindowUsedPercent: (
          (clampNonNegative(lastTotalTokens) / contextWindowTokens) *
          100
        ).toFixed(2),
      };
    } else {
      latestContextUsage = unavailableContextUsage();
    }
  }

  if (!sawTargetCwd || !sessionId || !latestTokenTotals || !latestTimestamp) {
    return null;
  }

  return {
    sessionId,
    sessionFilePath,
    timestamp: latestTimestamp,
    model: latestTurnContextModel ?? "unknown",
    totals: latestTokenTotals,
    contextUsage: latestContextUsage ?? unavailableContextUsage(),
  };
};
