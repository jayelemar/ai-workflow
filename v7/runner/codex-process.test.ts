import assert from "node:assert/strict";
import { mkdtemp, mkdir, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";

import { V7_CODEX_EXECUTION_POLICY, v7CodexExecutionConfig } from "../config/codex-config.ts";
import { buildV7CodexArgs, exactSessionIdFromCodexOutput, runDedicatedCodexStage } from "./codex-process.ts";

test("V7 preserves current routing policy values", () => {
  assert.equal(V7_CODEX_EXECUTION_POLICY.profile, "codex-work");
  assert.equal(V7_CODEX_EXECUTION_POLICY.command, "codex");
  assert.equal(Object.keys(V7_CODEX_EXECUTION_POLICY.promptModels).length, 18);
  assert.equal(v7CodexExecutionConfig(".ai/v7/wrappers/stages/task-implementation.md").sandbox, "workspace-write");
  assert.equal(v7CodexExecutionConfig(".ai/prompts/execute-plan.md").model, "gpt-5.5");
  assert.equal(v7CodexExecutionConfig(".ai/prompts/review-changes.md").reasoning, "xhigh");
});

test("dedicated stage requires session emitted by process and reads exact usage", async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), "v7-codex-"));
  try {
    const sessions = path.join(root, ".codex-work", "sessions", "2026", "01");
    await mkdir(sessions, { recursive: true });
    let receivedHome = "";
    const checkpoint = await runDedicatedCodexStage({ rootDir: root, promptPath: ".ai/prompts/execute-plan.md", prompt: "ignored", codexHome: path.join(root, ".codex-work"), runProcess: async ({ env }) => {
      receivedHome = env?.CODEX_HOME ?? "";
      const sessionId = "3d1941a3-7193-4bdc-9ae5-3e48c7d548fb";
      await writeFile(path.join(sessions, "stage.jsonl"), `${JSON.stringify({ type: "session_meta", payload: { session_id: sessionId, cwd: root } })}\n${JSON.stringify({ type: "turn_context", payload: { cwd: root, model: "gpt-5.5" } })}\n${JSON.stringify({ type: "event_msg", payload: { type: "token_count", info: { total_token_usage: { input_tokens: 5, cached_input_tokens: 2, output_tokens: 2, reasoning_output_tokens: 1, total_tokens: 7 } } } })}\n`);
      return { exitCode: 0, stdout: `{\"type\":\"session_meta\",\"payload\":{\"session_id\":\"${sessionId}\"}}\n`, stderr: "" };
    } });
    assert.equal(checkpoint.tokenUsage.totalTokens, 7);
    assert.equal(receivedHome, path.join(root, ".codex-work"));
  } finally { await rm(root, { recursive: true, force: true }); }
});

test("V7 Codex arguments retain model, reasoning, and commit git access", () => {
  const args = buildV7CodexArgs({ promptPath: ".ai/prompts/commit-summary.md", prompt: "do not persist me", rootDir: "/repo" });
  assert.deepEqual(args.slice(0, 7), ["exec", "--json", "--model", "gpt-5.6-terra", "-c", "model_reasoning_effort=\"medium\"", "--add-dir"]);
  assert.equal(args.at(-1), "do not persist me");
  assert.equal(exactSessionIdFromCodexOutput('{"type":"session_meta","payload":{"session_id":"session-1"}}'), "session-1");
  assert.equal(exactSessionIdFromCodexOutput('{"type":"thread.started","thread_id":"thread-1"}'), "thread-1");
});
