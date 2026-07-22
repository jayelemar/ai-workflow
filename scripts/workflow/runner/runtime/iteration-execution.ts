import {
  type CodexExecutionConfig,
} from "../../config/codex.ts";
import {
  CODEX_BINARY_COMMAND,
  codexExecArgs,
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
    result = await runCodexAttempt(executionConfig);
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
  return { result, durationMs, effectiveExecutionConfig: executionConfig, editedFiles };
};
