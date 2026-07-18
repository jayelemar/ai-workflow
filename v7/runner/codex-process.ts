import { spawn } from "node:child_process";
import { homedir } from "node:os";
import path from "node:path";

import { V7_CODEX_EXECUTION_POLICY, v7CodexExecutionConfig, type V7CodexExecutionConfig } from "../config/codex-config.ts";
import { readExactSessionCheckpoint, type ExactSessionCheckpoint } from "./session-checkpoint.ts";

export type CodexProcessResult = { exitCode: number; stdout: string; stderr: string };

export { V7_CODEX_EXECUTION_POLICY, v7CodexExecutionConfig, type V7CodexExecutionConfig } from "../config/codex-config.ts";

export const buildV7CodexArgs = ({ promptPath, prompt, rootDir, executionConfig = v7CodexExecutionConfig(promptPath) }: { promptPath: string; prompt: string; rootDir: string; executionConfig?: V7CodexExecutionConfig }): string[] => {
  const args = ["exec", "--json", "--model", executionConfig.model, "-c", `model_reasoning_effort=\"${executionConfig.reasoning}\"`];
  if (executionConfig.sandbox) args.push("--sandbox", executionConfig.sandbox);
  if (promptPath === ".ai/prompts/commit-summary.md") args.push("--add-dir", path.join(rootDir, ".git"));
  return [...args, prompt];
};

export const runCodexProcess = async ({ command = V7_CODEX_EXECUTION_POLICY.command, args, cwd, input, env }: { command?: string; args: string[]; cwd: string; input: string; env?: NodeJS.ProcessEnv }): Promise<CodexProcessResult> => new Promise((resolve, reject) => {
  const child = spawn(command, args, { cwd, env, stdio: ["pipe", "pipe", "pipe"] });
  let stdout = "";
  let stderr = "";
  child.stdout.on("data", (chunk) => { stdout += String(chunk); });
  child.stderr.on("data", (chunk) => { stderr += String(chunk); });
  child.once("error", reject);
  child.once("close", (code) => resolve({ exitCode: code ?? 1, stdout, stderr }));
  child.stdin.end(input);
});

export const exactSessionIdFromCodexOutput = (stdout: string): string | undefined => {
  for (const line of stdout.split(/\r?\n/)) {
    try {
      const event = JSON.parse(line) as { type?: string; thread_id?: unknown; payload?: { session_id?: unknown; id?: unknown } };
      const sessionId = event.type === "thread.started" ? event.thread_id : event.type === "session_meta" ? event.payload?.session_id ?? event.payload?.id : undefined;
      if (typeof sessionId === "string" && sessionId) return sessionId;
    } catch { /* Ignore non-JSON output. */ }
  }
  return undefined;
};

const capacityFailure = (result: CodexProcessResult): boolean => result.exitCode !== 0 && `${result.stdout}\n${result.stderr}`.includes("Selected model is at capacity");

export const runDedicatedCodexStage = async ({
  rootDir,
  promptPath,
  prompt,
  codexHome = process.env.CODEX_HOME?.trim() ?? path.join(homedir(), ".codex-work"),
  runProcess = runCodexProcess,
}: {
  rootDir: string;
  promptPath: string;
  prompt: string;
  codexHome?: string;
  runProcess?: (input: { command?: string; args: string[]; cwd: string; input: string; env?: NodeJS.ProcessEnv }) => Promise<CodexProcessResult>;
}): Promise<ExactSessionCheckpoint> => {
  const result = await runDedicatedCodexStageWithOutput({ rootDir, promptPath, prompt, codexHome, runProcess });
  return result.checkpoint;
};

/** Exact session evidence plus raw JSONL output for V7-native controllers. */
export const runDedicatedCodexStageWithOutput = async ({
  rootDir,
  promptPath,
  prompt,
  codexHome = process.env.CODEX_HOME?.trim() ?? path.join(homedir(), ".codex-work"),
  runProcess = runCodexProcess,
}: {
  rootDir: string;
  promptPath: string;
  prompt: string;
  codexHome?: string;
  runProcess?: (input: { command?: string; args: string[]; cwd: string; input: string; env?: NodeJS.ProcessEnv }) => Promise<CodexProcessResult>;
}): Promise<{ checkpoint: ExactSessionCheckpoint; output: string }> => {
  const primary = v7CodexExecutionConfig(promptPath);
  const configs = [...Array(3).fill(primary), ...Array(2).fill({ ...primary, model: V7_CODEX_EXECUTION_POLICY.fallbackModel })];
  let last: CodexProcessResult | undefined;
  for (const config of configs) {
    const invocationStartedAt = new Date().toISOString();
    const result = await runProcess({ args: buildV7CodexArgs({ promptPath, prompt, rootDir, executionConfig: config }), cwd: rootDir, input: "", env: { ...process.env, CODEX_HOME: codexHome } });
    last = result;
    if (result.exitCode !== 0) {
      if (capacityFailure(result)) continue;
      throw new Error(`V7 Codex process failed for ${promptPath}: ${result.stderr || result.stdout}`);
    }
    const sessionId = exactSessionIdFromCodexOutput(result.stdout);
    if (!sessionId) throw new Error(`V7 Codex process did not return an exact session ID for ${promptPath}`);
    return { checkpoint: await readExactSessionCheckpoint({ sessionId, rootDir, codexHome, invocationStartedAt }), output: result.stdout };
  }
  throw new Error(`V7 Codex capacity retries exhausted for ${promptPath}: ${last?.stderr || last?.stdout || "no process result"}`);
};
