import assert from "node:assert/strict";
import test from "node:test";

import { parseCodexTokenUsage, parseContextUsage } from "./token-usage.ts";

const tokenCountLine = (usedTokens: number, contextWindowTokens: number) =>
  JSON.stringify({
    type: "event_msg",
    payload: {
      type: "token_count",
      info: {
        last_token_usage: { total_tokens: usedTokens },
        model_context_window: contextWindowTokens,
      },
    },
  });

const turnCompletedUsageLine = (inputTokens: number) =>
  JSON.stringify({
    type: "turn.completed",
    usage: {
      input_tokens: inputTokens,
      cached_input_tokens: Math.floor(inputTokens / 2),
      output_tokens: 1234,
      reasoning_output_tokens: 456,
    },
  });

const turnCompletedUsageDetailLine = ({
  inputTokens,
  cachedInputTokens,
  outputTokens,
  reasoningOutputTokens,
}: {
  inputTokens: number;
  cachedInputTokens: number;
  outputTokens: number;
  reasoningOutputTokens: number;
}) =>
  JSON.stringify({
    type: "turn.completed",
    usage: {
      input_tokens: inputTokens,
      cached_input_tokens: cachedInputTokens,
      output_tokens: outputTokens,
      reasoning_output_tokens: reasoningOutputTokens,
    },
  });

test("parses context usage from the final valid codex token_count event", () => {
  assert.deepEqual(parseContextUsage([
    "not json", tokenCountLine(100, 1000),
    JSON.stringify({ type: "event_msg", payload: { type: "token_count", info: {} } }),
    tokenCountLine(129200, 258400), turnCompletedUsageLine(999999),
  ].join("\n")), {
    contextWindowTokens: 258400,
    contextWindowUsedTokens: 129200,
    contextWindowUsedPercent: "50.00",
  });
});

test("parses detailed codex turn completed token usage", () => {
  assert.deepEqual(parseCodexTokenUsage([
    "not json", tokenCountLine(333, 999),
    turnCompletedUsageDetailLine({ inputTokens: 1200, cachedInputTokens: 450, outputTokens: 80, reasoningOutputTokens: 25 }),
  ].join("\n")), {
    usageAvailable: true, inputTokens: 1200, cachedInputTokens: 450,
    uncachedInputTokens: 750, outputTokens: 80, reasoningOutputTokens: 25,
    totalTokens: 1280, contextWindowTokens: 999, contextWindowUsedTokens: 333,
    contextWindowUsedPercent: "33.33",
  });
});

test("token usage parsing keeps context-window usage when detailed usage is unavailable", () => {
  assert.deepEqual(parseCodexTokenUsage(["plain", tokenCountLine(200, 1000)].join("\n")), {
    usageAvailable: false, inputTokens: null, cachedInputTokens: null,
    uncachedInputTokens: null, outputTokens: null, reasoningOutputTokens: null,
    totalTokens: null, contextWindowTokens: 1000, contextWindowUsedTokens: 200,
    contextWindowUsedPercent: "20.00",
  });
});

test("parses current codex turn.completed usage when token_count events are absent", () => {
  assert.deepEqual(parseContextUsage(["not json", turnCompletedUsageLine(6070935)].join("\n")), {
    contextWindowTokens: "unavailable", contextWindowUsedTokens: 6070935,
    contextWindowUsedPercent: "unavailable",
  });
});

test("context usage parsing returns unavailable when codex usage data is missing", () => {
  assert.deepEqual(parseContextUsage("plain stdout\n{}"), {
    contextWindowTokens: "unavailable", contextWindowUsedTokens: "unavailable",
    contextWindowUsedPercent: "unavailable",
  });
});
