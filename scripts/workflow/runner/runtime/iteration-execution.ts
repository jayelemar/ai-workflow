import {
  CODEX_SELECTED_MODEL_CAPACITY_FALLBACK_ATTEMPTS,
  CODEX_SELECTED_MODEL_CAPACITY_PRIMARY_ATTEMPTS,
  codexCapacityFallbackConfig,
  type CodexExecutionConfig,
} from "../../config/codex.ts";
import {
  CODEX_BINARY_COMMAND,
  codexExecArgs,
  codexResultContainsSelectedModelCapacity,
  codexWorkEnvironment,
} from "../process.ts";
import {
  createCodexLiveOutputFormatter,
} from "../terminal/codex-events.ts";
import {
  createWorkflowWaitNotice,
  formatEditedFilesForTerminal,
} from "../terminal/formatters.ts";
import type {
  ConsoleLike,
  EditedFileSummary,
  OutputStream,
  ProcessResult,
  ProcessRunner,
  WorkflowRunnerCodexRuntime,
} from "../types.ts";
import {
  parseEditedFileSummaryPaths,
  readEditedFileSnapshot,
  summarizeEditedFiles,
} from "./iteration.ts";

type CommitBoundaryProgress = {
  taskPosition: number;
  taskTotal: number;
  taskLabel: string;
  boundaryTotal: number;
};

export const executeWorkflowIteration = async ({
  rootDir,
  planContent,
  promptPath,
  generatedPrompt,
  codexRuntime,
  executionConfig,
  processRunner,
  abortSignal,
  outputStream,
  streamOutput,
  colorOutput,
  commitBoundaryProgress,
  now,
  startedAt,
  logger,
}: {
  rootDir: string;
  planContent: string;
  promptPath: string;
  generatedPrompt: string;
  codexRuntime: WorkflowRunnerCodexRuntime;
  executionConfig: CodexExecutionConfig;
  processRunner: ProcessRunner;
  abortSignal?: AbortSignal;
  outputStream: OutputStream;
  streamOutput: boolean;
  colorOutput: boolean;
  commitBoundaryProgress?: CommitBoundaryProgress;
  now: () => number;
  startedAt: number;
  logger: ConsoleLike;
}): Promise<{
  result: ProcessResult;
  durationMs: number;
  effectiveExecutionConfig: CodexExecutionConfig;
  editedFiles: EditedFileSummary[];
}> => {
  const editedSummaryPaths = await parseEditedFileSummaryPaths(rootDir, planContent);
  const editedFileSnapshot = await readEditedFileSnapshot(rootDir, editedSummaryPaths);
  const waitNotice = createWorkflowWaitNotice({
    outputStream,
    enabled: streamOutput,
    promptPath,
    now,
    startedAt,
    color: colorOutput,
  });
  const liveOutput = streamOutput
    ? createCodexLiveOutputFormatter(
        {
          ...outputStream,
          stdout: (chunk: string) => {
            waitNotice.markActivity();
            outputStream.stdout(chunk);
          },
          stderr: (chunk: string) => {
            waitNotice.markActivity();
            outputStream.stderr(chunk);
          },
        },
        { color: colorOutput, commitBoundaryProgress },
      )
    : undefined;
  waitNotice.start();
  let effectiveExecutionConfig = executionConfig;
  const runCodexAttempt = async (
    attemptExecutionConfig: CodexExecutionConfig,
  ): Promise<ProcessResult> =>
    processRunner({
      command: codexRuntime.command,
      binaryCommand: CODEX_BINARY_COMMAND,
      args: codexExecArgs({
        executionConfig: attemptExecutionConfig,
        promptPath,
        prompt: generatedPrompt,
        rootDir,
      }),
      cwd: rootDir,
      input: "",
      promptPath,
      env: codexWorkEnvironment(process.env, codexRuntime.profile),
      abortSignal,
      onStdout: liveOutput?.stdout,
      onStderr: liveOutput?.stderr,
    }).catch(
      (error): ProcessResult => ({
        launched: false,
        stdout: "",
        stderr: "",
        error: String(error),
      }),
    );
  let result: ProcessResult;
  try {
    const retryNotices: string[] = [];
    result = await runCodexAttempt(executionConfig);
    for (
      let attempt = 2;
      attempt <= CODEX_SELECTED_MODEL_CAPACITY_PRIMARY_ATTEMPTS &&
      codexResultContainsSelectedModelCapacity(result);
      attempt += 1
    ) {
      const retryNotice = `[workflow-runner] ${executionConfig.model} reported capacity; retrying ${promptPath} with the same model (${attempt}/${CODEX_SELECTED_MODEL_CAPACITY_PRIMARY_ATTEMPTS}).`;
      retryNotices.push(retryNotice);
      logger.log(streamOutput ? `${retryNotice}\n` : retryNotice);
      result = await runCodexAttempt(executionConfig);
    }
    const fallbackExecutionConfig = codexResultContainsSelectedModelCapacity(result)
      ? codexCapacityFallbackConfig(executionConfig)
      : undefined;
    if (fallbackExecutionConfig) {
      effectiveExecutionConfig = fallbackExecutionConfig;
      for (
        let attempt = 1;
        attempt <= CODEX_SELECTED_MODEL_CAPACITY_FALLBACK_ATTEMPTS &&
        codexResultContainsSelectedModelCapacity(result);
        attempt += 1
      ) {
        const retryNotice = `[workflow-runner] ${executionConfig.model} still reported capacity after ${CODEX_SELECTED_MODEL_CAPACITY_PRIMARY_ATTEMPTS} attempts; retrying ${promptPath} with fallback model ${fallbackExecutionConfig.model} (${attempt}/${CODEX_SELECTED_MODEL_CAPACITY_FALLBACK_ATTEMPTS}).`;
        retryNotices.push(retryNotice);
        logger.log(streamOutput ? `${retryNotice}\n` : retryNotice);
        result = await runCodexAttempt(fallbackExecutionConfig);
      }
    }
    if (result.launched && retryNotices.length > 0) {
      result = {
        ...result,
        stderr: [...retryNotices, result.stderr]
          .filter((part) => part.length > 0)
          .join("\n"),
      };
    }
  } finally {
    waitNotice.stop();
  }
  liveOutput?.flush({ includePendingTurnCompleted: false });
  const durationMs = Math.max(0, now() - startedAt);
  const editedFiles = result.launched
    ? await summarizeEditedFiles(rootDir, editedFileSnapshot)
    : [];
  if (streamOutput && editedFiles.length > 0) {
    logger.log(formatEditedFilesForTerminal(editedFiles, colorOutput));
    outputStream.stdout("\n");
  }
  liveOutput?.flush();
  return { result, durationMs, effectiveExecutionConfig, editedFiles };
};
