import { classifyFailureForLog } from "../terminal/codex-events.ts";
import {
  compactCapturedOutputForLog,
  formatEditedFilesForLog,
} from "../terminal/formatters.ts";
import type {
  CommitProgress,
  EditedFileSummary,
  ReviewCleanupProcess,
  ReviewScopeMetadata,
  ReviewStagingProcess,
  TokenUsageTotals,
  WorkflowTaskContext,
} from "../types.ts";
import type {
  CodexTokenUsage,
  ContextUsageLogFields,
} from "../../telemetry/token-usage.ts";

export const workflowIterationLogFields = ({
  timestamp,
  iteration,
  planPath,
  workflowState,
  promptPath,
  model,
  reasoning,
  contextUsage,
  result,
  exitCode,
  durationMs,
  stopReason,
  failureDebugPath,
  editedFiles,
  stdout,
  stderr,
  staging,
  cleanup,
  taskContext,
  currentBranch,
  startingHeadSha,
  endingHeadSha,
  commitProgress,
  reviewScope,
  latestStageTokenUsage,
  cumulativeTokenUsage,
}: {
  timestamp: string;
  iteration: number;
  planPath: string;
  workflowState: import("../../contracts/stage.ts").WorkflowState;
  promptPath: string;
  model: string;
  reasoning: string;
  contextUsage: ContextUsageLogFields;
  result: string;
  exitCode?: number;
  durationMs: number;
  stopReason?: string;
  failureDebugPath?: string;
  editedFiles?: EditedFileSummary[];
  stdout: string;
  stderr: string;
  staging?: ReviewStagingProcess;
  cleanup?: ReviewCleanupProcess;
  taskContext?: WorkflowTaskContext;
  currentBranch?: string;
  startingHeadSha?: string;
  endingHeadSha?: string;
  commitProgress?: CommitProgress;
  reviewScope?: ReviewScopeMetadata;
  latestStageTokenUsage?: CodexTokenUsage;
  cumulativeTokenUsage?: TokenUsageTotals;
}): Array<[string, string | number | undefined]> => {
  const failureMetadata = stopReason
    ? classifyFailureForLog(stopReason)
    : undefined;
  const editedFilesLog = editedFiles
    ? formatEditedFilesForLog(editedFiles)
    : undefined;
  return [
    ["timestamp", timestamp],
    ["iteration", iteration],
    ["workflowState", workflowState],
    ["promptPath", promptPath],
    ["model", model],
    ["reasoning", reasoning],
    ["contextWindowTokens", contextUsage.contextWindowTokens],
    ["contextWindowUsedTokens", contextUsage.contextWindowUsedTokens],
    ["contextWindowUsedPercent", contextUsage.contextWindowUsedPercent],
    ["planPath", planPath],
    ["startingWorkflowState", workflowState],
    ["currentBranch", currentBranch],
    ["startingHeadSha", startingHeadSha],
    ["endingHeadSha", endingHeadSha],
    ...(commitProgress
      ? ([
          [
            "commitProgress",
            `${commitProgress.completed}/${commitProgress.total}`,
          ],
          ["commitProgressDescription", commitProgress.description],
        ] as Array<[string, string | number | undefined]>)
      : []),
    ["taskId", taskContext?.task.id],
    ["taskName", taskContext?.task.name],
    ["taskStage", taskContext?.stage],
    ["taskArtifact", taskContext?.artifactPath],
    ["commitSha", taskContext?.commitSha],
    ["narrowPass", reviewScope?.narrowPass],
    [
      "reviewAllPaths",
      reviewScope?.reviewAllPaths.length
        ? reviewScope.reviewAllPaths.join(",")
        : undefined,
    ],
    [
      "reviewPrimaryPaths",
      reviewScope?.reviewPrimaryPaths.length
        ? reviewScope.reviewPrimaryPaths.join(",")
        : undefined,
    ],
    ["diffBytes", reviewScope?.diffBytes],
    ["autoNarrowReason", reviewScope?.autoNarrowReason],
    ["latestStageInputTokens", latestStageTokenUsage?.inputTokens],
    [
      "latestStageUncachedInputTokens",
      latestStageTokenUsage?.uncachedInputTokens,
    ],
    ["latestStageTotalTokens", latestStageTokenUsage?.totalTokens],
    ["cumulativeInputTokens", cumulativeTokenUsage?.inputTokens],
    [
      "cumulativeUncachedInputTokens",
      cumulativeTokenUsage?.uncachedInputTokens,
    ],
    ["cumulativeTotalTokens", cumulativeTokenUsage?.totalTokens],
    ["result", result],
    ["exitCode", exitCode],
    ["durationMs", durationMs],
    ["stopReason", stopReason],
    ...(failureDebugPath
      ? ([["failureDebugPath", failureDebugPath]] as Array<
          [string, string | number | undefined]
        >)
      : []),
    ...(failureMetadata
      ? ([
          ["failureKind", failureMetadata.failureKind],
          ["failureReason", failureMetadata.failureReason],
          ["nextSuggestedAction", failureMetadata.nextSuggestedAction],
        ] as Array<[string, string | number | undefined]>)
      : []),
    ...(editedFilesLog
      ? ([["editedFiles", editedFilesLog]] as Array<
          [string, string | number | undefined]
        >)
      : []),
    ["stdout", compactCapturedOutputForLog(stdout)],
    ["stderr", compactCapturedOutputForLog(stderr)],
    ...(staging
      ? ([
          ["reviewStagingCommand", staging.command],
          ["reviewStagingExitCode", staging.exitCode],
          ["reviewStagingStdout", compactCapturedOutputForLog(staging.stdout)],
          ["reviewStagingStderr", compactCapturedOutputForLog(staging.stderr)],
        ] as Array<[string, string | number | undefined]>)
      : []),
    ...(cleanup
      ? ([
          ["reviewCleanupCommand", cleanup.command],
          ["reviewCleanupExitCode", cleanup.exitCode],
          ["reviewCleanupStdout", compactCapturedOutputForLog(cleanup.stdout)],
          ["reviewCleanupStderr", compactCapturedOutputForLog(cleanup.stderr)],
        ] as Array<[string, string | number | undefined]>)
      : []),
  ];
};
