import type {
  ConsoleLike,
  OutputStream,
  ProcessRunner,
  RunnerResult,
} from "../types.ts";

export const MAX_WORKFLOW_ITERATIONS = 100;

export const WORKFLOW_RUNNER_USAGE = `Usage: pnpm exec tsx .ai/scripts/workflow/runner.ts [options] .ai/plans/<plan-name>.md

Options:
  --profile <name>       Use a Codex profile override
  --unblock-note <text>  Add operator context for unblock-plan
  -h, --help             Show this help message`;

export type RunWorkflowOptions = {
  argv?: string[];
  planName?: string;
  rootDir?: string;
  console?: ConsoleLike;
  codexProfile?: string;
  unblockNote?: string;
  processRunner?: ProcessRunner;
  now?: () => number;
  timestamp?: () => string;
  streamOutput?: boolean;
  outputStream?: OutputStream;
  abortSignal?: AbortSignal;
  interruptSignal?: () => NodeJS.Signals | undefined;
  isIgnored?: (relativePath: string) => Promise<boolean>;
};

export const defaultConsole: ConsoleLike = console;

export const failure = (
  reason: string,
  iterations = 0,
  exitCode = 1,
): RunnerResult => ({
  success: false,
  reason,
  iterations,
  exitCode,
});

export const success = (reason: string, iterations: number): RunnerResult => ({
  success: true,
  reason,
  iterations,
  exitCode: 0,
});
