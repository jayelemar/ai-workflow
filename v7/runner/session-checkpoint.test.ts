import assert from "node:assert/strict";
import { mkdtemp, mkdir, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";

import { readExactSessionCheckpoint } from "./session-checkpoint.ts";

test("exact session checkpoint rejects omitted session; no latest fallback", async () => {
  await assert.rejects(() => readExactSessionCheckpoint({ sessionId: undefined, rootDir: "/repo", codexHome: "/missing" }), /explicit --session ID/);
});

test("exact session checkpoint accepts only requested session in workspace", async () => {
  const dir = await mkdtemp(path.join(os.tmpdir(), "v7-session-"));
  try {
    const sessions = path.join(dir, "sessions", "2026", "01");
    await mkdir(sessions, { recursive: true });
    const sessionId = "3d1941a3-7193-4bdc-9ae5-3e48c7d548fb";
    await writeFile(path.join(sessions, "one.jsonl"), `${JSON.stringify({ type: "session_meta", payload: { session_id: sessionId, cwd: "/repo" } })}\n${JSON.stringify({ type: "turn_context", payload: { cwd: "/repo", model: "gpt" } })}\n${JSON.stringify({ type: "event_msg", payload: { type: "token_count", info: { total_token_usage: { input_tokens: 10, cached_input_tokens: 4, output_tokens: 3, reasoning_output_tokens: 1, total_tokens: 13 } } } })}\n`);
    const checkpoint = await readExactSessionCheckpoint({ sessionId, rootDir: "/repo", codexHome: dir, invocationStartedAt: new Date(0).toISOString() });
    assert.equal(checkpoint.tokenUsage.uncachedInputTokens, 6);
    await assert.rejects(() => readExactSessionCheckpoint({ sessionId: "two", rootDir: "/repo", codexHome: dir, invocationStartedAt: new Date(0).toISOString() }), /unreadable/);
  } finally { await rm(dir, { recursive: true, force: true }); }
});

test("exact session checkpoint rejects a partial final token record", async () => {
  const dir = await mkdtemp(path.join(os.tmpdir(), "v7-session-final-"));
  try {
    const sessions = path.join(dir, "sessions");
    await mkdir(sessions, { recursive: true });
    const sessionId = "3d1941a3-7193-4bdc-9ae5-3e48c7d548fb";
    await writeFile(path.join(sessions, "partial.jsonl"), `${JSON.stringify({ type: "session_meta", payload: { session_id: sessionId, cwd: "/repo" } })}\n${JSON.stringify({ type: "event_msg", payload: { type: "token_count", info: { total_token_usage: { input_tokens: 1, cached_input_tokens: 0, output_tokens: 1, reasoning_output_tokens: 0, total_tokens: 2 } } } })}\n${JSON.stringify({ type: "event_msg", payload: { type: "token_count", info: {} } })}\n`);
    await assert.rejects(() => readExactSessionCheckpoint({ sessionId, rootDir: "/repo", codexHome: dir, invocationStartedAt: new Date(0).toISOString() }), /unreadable/);
  } finally { await rm(dir, { recursive: true, force: true }); }
});
