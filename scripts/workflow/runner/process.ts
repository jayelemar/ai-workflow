import { spawn } from "node:child_process";
import { homedir } from "node:os";
import path from "node:path";
import type { Writable } from "node:stream";
import {
  CODEX_SELECTED_MODEL_CAPACITY_MESSAGE,
  WORKFLOW_RUNNER_CODEX_PROFILE,
  type CodexExecutionConfig,
  type CodexProfile,
} from "../config/codex.ts";
import { COMMIT_SUMMARY_PROMPT_PATH } from "../contracts/stage.ts";
import type { ProcessResult, ProcessRunner, WorkflowProcessStdio, WorkflowRunnerCodexRuntime } from "./types.ts";

const CODEX_PROFILE_PATTERN = /^[A-Za-z0-9][A-Za-z0-9_-]*$/;
export const CODEX_BINARY_COMMAND = "codex";
const CODEX_WORK_NODE_VERSION = "v20.20.2";
export const CODEX_TURN_COMPLETION_GRACE_MS = 1_000;

const codexTurnCompleted = (output: string): boolean =>
  /"type"\s*:\s*"turn\.completed"/.test(output);

const prependPath = (pathValue: string, entry: string): string => {
  const entries = pathValue.split(path.delimiter).filter(Boolean);
  if (entries.includes(entry)) {
    return pathValue;
  }
  return [entry, pathValue].filter(Boolean).join(path.delimiter);
};

export const isValidCodexProfile = (value: string): boolean =>
  CODEX_PROFILE_PATTERN.test(value);

const workflowRunnerCodexHomeDirectory = (codexProfile: CodexProfile): string =>
  `.${codexProfile}`;

export const workflowRunnerCodexExecLabel = (codexProfile: CodexProfile): string =>
  `${codexProfile} exec`;

export const createWorkflowRunnerCodexRuntime = (
  codexProfile: CodexProfile,
): WorkflowRunnerCodexRuntime => ({
  profile: codexProfile,
  command: codexProfile,
  execLabel: workflowRunnerCodexExecLabel(codexProfile),
});

export const codexWorkEnvironment = (
  baseEnv: NodeJS.ProcessEnv = process.env,
  codexProfile: CodexProfile = WORKFLOW_RUNNER_CODEX_PROFILE,
): NodeJS.ProcessEnv => {
  const home = baseEnv.HOME ?? homedir();
  const nodeBinPath = path.join(
    home,
    ".nvm",
    "versions",
    "node",
    CODEX_WORK_NODE_VERSION,
    "bin",
  );

  return {
    ...baseEnv,
    CODEX_HOME: path.join(home, workflowRunnerCodexHomeDirectory(codexProfile)),
    PATH: prependPath(baseEnv.PATH ?? "", nodeBinPath),
  };
};

export const processStdioForInput = (input: string): WorkflowProcessStdio => [
  input.length > 0 ? "pipe" : "ignore",
  "pipe",
  "pipe",
];

export const writeProcessInput = (
  stdin: Writable | null | undefined,
  input: string,
  onError: (error: Error) => void = () => {},
): void => {
  if (!stdin || input.length === 0) {
    return;
  }
  stdin.on("error", onError);
  stdin.end(input);
};

export const codexExecArgs = ({
  executionConfig,
  promptPath,
  prompt,
  rootDir,
}: {
  executionConfig: CodexExecutionConfig;
  promptPath: string;
  prompt: string;
  rootDir: string;
}): string[] => {
  const args = [
    "exec",
    "--json",
    "--model",
    executionConfig.model,
    "-c",
    `model_reasoning_effort="${executionConfig.reasoning}"`,
  ];

  if (promptPath === COMMIT_SUMMARY_PROMPT_PATH) {
    args.push("--add-dir", path.join(rootDir, ".git"));
  }

  args.push(prompt);
  return args;
};

export const codexResultContainsSelectedModelCapacity = (
  result: ProcessResult,
): boolean =>
  result.launched &&
  result.exitCode !== 0 &&
  `${result.stdout}\n${result.stderr}`.includes(
    CODEX_SELECTED_MODEL_CAPACITY_MESSAGE,
  );


export const defaultProcessRunner: ProcessRunner = (call) =>
  new Promise((resolve) => {
    const executable = call.binaryCommand
      ? {
          command: call.binaryCommand,
          args: call.args,
          env: call.env ?? process.env,
        }
      : {
          command: call.command,
          args: call.args,
          env: call.env ?? process.env,
        };

    const child = spawn(executable.command, executable.args, {
      cwd: call.cwd,
      env: executable.env,
      stdio: processStdioForInput(call.input),
    });
    let stdout = "";
    let stderr = "";
    let stdinError = "";
    let settled = false;
    let completionWatchdog: ReturnType<typeof setTimeout> | undefined;
    let completionWatchdogTriggered = false;

    const clearCompletionWatchdog = () => {
      if (!completionWatchdog) {
        return;
      }
      clearTimeout(completionWatchdog);
      completionWatchdog = undefined;
    };

    const armCompletionWatchdog = () => {
      if (
        completionWatchdog ||
        call.binaryCommand !== CODEX_BINARY_COMMAND ||
        call.promptPath !== COMMIT_SUMMARY_PROMPT_PATH ||
        call.abortSignal?.aborted ||
        !codexTurnCompleted(stdout)
      ) {
        return;
      }
      completionWatchdog = setTimeout(() => {
        completionWatchdog = undefined;
        if (settled || call.abortSignal?.aborted) {
          return;
        }
        completionWatchdogTriggered = true;
        child.kill("SIGTERM");
      }, CODEX_TURN_COMPLETION_GRACE_MS);
      completionWatchdog.unref?.();
    };

    child.stdout?.setEncoding("utf8");
    child.stderr?.setEncoding("utf8");
    child.stdout?.on("data", (chunk) => {
      stdout += chunk;
      call.onStdout?.(chunk);
      armCompletionWatchdog();
    });
    child.stderr?.on("data", (chunk) => {
      stderr += chunk;
      call.onStderr?.(chunk);
    });

    const abortChild = () => {
      const requestedSignal =
        call.abortSignal?.reason === "SIGTERM" ? "SIGTERM" : "SIGINT";
      child.kill(requestedSignal);
    };

    if (call.abortSignal?.aborted) {
      abortChild();
    } else {
      call.abortSignal?.addEventListener("abort", abortChild, { once: true });
    }

    child.on("error", (error) => {
      if (settled) {
        return;
      }
      clearCompletionWatchdog();
      call.abortSignal?.removeEventListener("abort", abortChild);
      settled = true;
      resolve({
        launched: false,
        stdout,
        stderr: [stderr, stdinError].filter(Boolean).join("\n"),
        error: String(error),
      });
    });

    child.on("close", (exitCode, signal) => {
      if (settled) {
        return;
      }
      clearCompletionWatchdog();
      call.abortSignal?.removeEventListener("abort", abortChild);
      settled = true;
      resolve({
        launched: true,
        stdout,
        stderr: [stderr, stdinError].filter(Boolean).join("\n"),
        exitCode:
          completionWatchdogTriggered
            ? 0
            : (exitCode ??
              (signal === "SIGINT" ? 130 : signal === "SIGTERM" ? 143 : 1)),
        exitSignal: completionWatchdogTriggered ? undefined : signal,
      });
    });

    writeProcessInput(child.stdin, call.input, (error) => {
      stdinError = [stdinError, `stdin: ${String(error)}`]
        .filter(Boolean)
        .join("\n");
    });
  });
