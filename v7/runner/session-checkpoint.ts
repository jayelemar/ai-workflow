import { readdir, readFile, stat } from "node:fs/promises";
import path from "node:path";

import type { LifecycleTokenUsage } from "../lifecycle/lifecycle-ledger.ts";

export type ExactSessionCheckpoint = {
  sessionId: string;
  model: string;
  tokenUsage: LifecycleTokenUsage;
};

type RawTotals = { inputTokens: number; cachedInputTokens: number; outputTokens: number; reasoningTokens: number; totalTokens: number };
const record = (value: unknown): Record<string, unknown> | null => typeof value === "object" && value !== null ? value as Record<string, unknown> : null;
const integer = (value: unknown): value is number => typeof value === "number" && Number.isInteger(value) && value >= 0;

const parseExactSession = (content: string, sessionId: string, rootDir: string): ExactSessionCheckpoint | null => {
  let actualId: string | undefined;
  let sawWorkspace = false;
  let invalidIdentity = false;
  let model = "unknown";
  let totals: RawTotals | undefined;
  let finalTokenCountWasComplete = false;
  for (const line of content.split(/\r?\n/)) {
    if (!line) continue;
    try {
      const event = record(JSON.parse(line));
      const payload = record(event?.payload);
      if (!event || !payload) return null;
      if (event.type === "session_meta") {
        const candidate = typeof payload.session_id === "string" ? payload.session_id : typeof payload.id === "string" ? payload.id : undefined;
        if (!candidate || (actualId && actualId !== candidate)) invalidIdentity = true;
        actualId ??= candidate;
        if (typeof payload.cwd === "string" && path.isAbsolute(payload.cwd) && path.resolve(payload.cwd) === rootDir) sawWorkspace = true;
      }
      if (event.type === "turn_context") {
        if (typeof payload.cwd === "string" && path.isAbsolute(payload.cwd) && path.resolve(payload.cwd) === rootDir) sawWorkspace = true;
        if (typeof payload.model === "string") model = payload.model;
      }
      if (event.type !== "event_msg") continue;
      if (payload.type !== "token_count") continue;
      finalTokenCountWasComplete = false;
      const usage = record(record(payload.info)?.total_token_usage);
      if (!usage || !integer(usage.input_tokens) || !integer(usage.cached_input_tokens) || !integer(usage.output_tokens) || !integer(usage.reasoning_output_tokens) || !integer(usage.total_tokens)
        || usage.cached_input_tokens > usage.input_tokens || usage.reasoning_output_tokens > usage.output_tokens || usage.total_tokens !== usage.input_tokens + usage.output_tokens) {
        totals = undefined;
        continue;
      }
      totals = { inputTokens: usage.input_tokens, cachedInputTokens: usage.cached_input_tokens, outputTokens: usage.output_tokens, reasoningTokens: usage.reasoning_output_tokens, totalTokens: usage.total_tokens };
      finalTokenCountWasComplete = true;
    } catch { return null; }
  }
  if (invalidIdentity || actualId !== sessionId || !sawWorkspace || !totals || totals.totalTokens <= 0 || !finalTokenCountWasComplete) return null;
  return { sessionId, model, tokenUsage: { ...totals, uncachedInputTokens: Math.max(0, totals.inputTokens - totals.cachedInputTokens) } };
};

const sessionFiles = async (directory: string): Promise<string[]> => {
  let entries;
  try { entries = await readdir(directory, { withFileTypes: true }); } catch { return []; }
  return (await Promise.all(entries.map(async (entry) => entry.isDirectory() ? sessionFiles(path.join(directory, entry.name)) : entry.isFile() && entry.name.endsWith(".jsonl") ? [path.join(directory, entry.name)] : []))).flat();
};

export const readExactSessionCheckpoint = async ({
  sessionId,
  rootDir,
  codexHome,
  invocationStartedAt,
}: {
  sessionId: string | undefined;
  rootDir: string;
  codexHome: string;
  invocationStartedAt?: string;
}): Promise<ExactSessionCheckpoint> => {
  if (!sessionId?.trim()) throw new Error("V7 Codex-backed lifecycle attempt requires explicit --session ID");
  const startedAt = invocationStartedAt ? Date.parse(invocationStartedAt) : Number.NaN;
  if (!Number.isFinite(startedAt)) throw new Error("V7 Codex-backed lifecycle attempt requires invocation start timestamp");
  const normalizedRoot = path.resolve(rootDir);
  const matches = await Promise.all((await sessionFiles(path.join(codexHome, "sessions"))).map(async (filePath) => {
    const file = await stat(filePath);
    if (Math.max(file.birthtimeMs, file.mtimeMs) < startedAt) return null;
    return parseExactSession(await readFile(filePath, "utf8"), sessionId, normalizedRoot);
  }));
  const exact = matches.filter((checkpoint): checkpoint is ExactSessionCheckpoint => checkpoint !== null);
  if (exact.length !== 1) throw new Error(`exact Codex session is unreadable, ambiguous, or outside workflow workspace: ${sessionId}`);
  return exact[0];
};
