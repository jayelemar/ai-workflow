import {
  parseCodexTokenUsage,
  type parseContextUsage,
} from "../../telemetry/token-usage.ts";
import { collectWorkflowThresholdWarnings } from "../../telemetry/token-warnings.ts";
import { type CodexExecutionConfig } from "../../config/codex.ts";
import {
  classifyFailureForLog,
  createWorkflowFailureDebugRecord,
} from "../terminal/codex-events.ts";
import type {
  CommitProgress,
  EditedFileSummary,
  Failure,
  ParsedPlan,
  ProcessResult,
  ProcessRunner,
  ReviewCleanupProcess,
  ReviewScopeMetadata,
  ReviewStagingProcess,
  TokenUsageTotals,
  WorkflowTaskContext,
} from "../types.ts";
import { appendLog } from "./logging.ts";
import { workflowIterationLogFields } from "./log-fields.ts";
import { workflowHeadSha } from "./preflight.ts";
import {
  addTokenUsageToTotals,
  appendFailureDebugLedger,
  appendTokenUsageLedger,
} from "./records.ts";

export const appendWorkflowIterationRecord = async ({
  rootDir,
  plan,
  endingPlan,
  promptPath,
  iteration,
  timestamp,
  durationMs,
  result,
  executionConfig,
  contextUsage,
  editedFiles,
  stopReason,
  interruptSignal,
  staging,
  reviewCleanup,
  taskContext,
  currentBranch,
  startingHeadSha,
  processRunner,
  commitProgress,
  reviewScope,
  tokenUsageTotals,
  emitWorkflowThresholdWarnings,
}: {
  rootDir: string;
  plan: ParsedPlan;
  endingPlan?: ParsedPlan;
  promptPath: string;
  iteration: number;
  timestamp: () => string;
  durationMs: number;
  result: ProcessResult;
  executionConfig: CodexExecutionConfig;
  contextUsage: ReturnType<typeof parseContextUsage>;
  editedFiles: EditedFileSummary[];
  stopReason?: string;
  interruptSignal?: NodeJS.Signals;
  staging?: ReviewStagingProcess;
  reviewCleanup?: ReviewCleanupProcess;
  taskContext?: WorkflowTaskContext;
  currentBranch?: string;
  startingHeadSha: string | undefined;
  processRunner: ProcessRunner;
  commitProgress?: CommitProgress;
  reviewScope?: ReviewScopeMetadata;
  tokenUsageTotals: TokenUsageTotals;
  emitWorkflowThresholdWarnings: (warnings: string[]) => void;
}): Promise<
  | {
      ok: true;
      tokenUsageTotals: TokenUsageTotals;
      failureDebugPath?: string;
      workflowLogCreated: boolean;
      tokenUsageLogCreated: boolean;
    }
  | Failure
> => {
  const logTimestamp = timestamp();
  const tokenUsage = parseCodexTokenUsage(result.stdout);
  const cumulativeTokenUsage = result.launched
    ? addTokenUsageToTotals(tokenUsageTotals, tokenUsage)
    : tokenUsageTotals;
  emitWorkflowThresholdWarnings(
    collectWorkflowThresholdWarnings({
      planByteSize: Buffer.byteLength((endingPlan ?? plan).content, "utf8"),
      latestTokenUsage: {
        stageInputTokens: tokenUsage.inputTokens,
        stageUncachedInputTokens: tokenUsage.uncachedInputTokens,
        stageOutputTokens: tokenUsage.outputTokens,
        stageReasoningOutputTokens: tokenUsage.reasoningOutputTokens,
        stageTotalTokens: tokenUsage.totalTokens,
      },
    }),
  );
  const failureMetadata = stopReason
    ? classifyFailureForLog(stopReason)
    : undefined;
  let failureDebugPath: string | undefined;

  if (stopReason && failureMetadata) {
    const failureDebugResult = await appendFailureDebugLedger(
      rootDir,
      plan.planName,
      createWorkflowFailureDebugRecord({
        timestamp: logTimestamp,
        iteration,
        planPath: plan.planPath,
        workflowState: plan.workflowState,
        promptPath,
        result: result.launched ? "launched" : "launch-failed",
        exitCode: result.launched ? result.exitCode : undefined,
        stopReason,
        failureMetadata,
        stdout: result.stdout,
        stderr: result.stderr,
        staging,
        cleanup: reviewCleanup,
      }),
    );
    if (!failureDebugResult.ok) {
      return failureDebugResult;
    }
    failureDebugPath = failureDebugResult.pointer;
  }

  const logResult = await appendLog(
    rootDir,
    plan.planName,
    workflowIterationLogFields({
      timestamp: logTimestamp,
      iteration,
      planPath: plan.planPath,
      workflowState: plan.workflowState,
      promptPath,
      model: executionConfig.model,
      reasoning: executionConfig.reasoning,
      contextUsage,
      result: result.launched ? "launched" : "launch-failed",
      exitCode: result.launched ? result.exitCode : undefined,
      durationMs,
      stopReason,
      failureDebugPath,
      editedFiles,
      stdout: result.stdout,
      stderr: result.stderr,
      staging,
      cleanup: reviewCleanup,
      taskContext,
      currentBranch,
      startingHeadSha,
      endingHeadSha: await workflowHeadSha(rootDir, processRunner),
      commitProgress,
      reviewScope,
      latestStageTokenUsage: tokenUsage,
      cumulativeTokenUsage,
    }),
  );
  if (!logResult.ok || !result.launched) {
    return logResult;
  }

  const ledgerResult = await appendTokenUsageLedger(rootDir, plan.planName, {
    timestamp: timestamp(),
    iteration,
    planPath: plan.planPath,
    startingWorkflowState: plan.workflowState,
    promptPath,
    endingWorkflowState: endingPlan?.workflowState,
    model: executionConfig.model,
    reasoning: executionConfig.reasoning,
    result: interruptSignal ? "interrupted" : stopReason ? "failed" : "success",
    signal: interruptSignal ?? null,
    usageAvailable: tokenUsage.usageAvailable,
    stageInputTokens: tokenUsage.inputTokens,
    stageCachedInputTokens: tokenUsage.cachedInputTokens,
    stageUncachedInputTokens: tokenUsage.uncachedInputTokens,
    stageOutputTokens: tokenUsage.outputTokens,
    stageReasoningOutputTokens: tokenUsage.reasoningOutputTokens,
    stageTotalTokens: tokenUsage.totalTokens,
    contextWindowTokens: tokenUsage.contextWindowTokens,
    contextWindowUsedTokens: tokenUsage.contextWindowUsedTokens,
    contextWindowUsedPercent: tokenUsage.contextWindowUsedPercent,
    narrowPass: reviewScope?.narrowPass,
    reviewAllPaths: reviewScope?.reviewAllPaths,
    reviewPrimaryPaths: reviewScope?.reviewPrimaryPaths,
    diffBytes: reviewScope?.diffBytes,
    autoNarrowReason: reviewScope?.autoNarrowReason,
    ...cumulativeTokenUsage,
  });
  if (!ledgerResult.ok) {
    return ledgerResult;
  }
  return {
    ok: true,
    tokenUsageTotals: cumulativeTokenUsage,
    failureDebugPath,
    workflowLogCreated: true,
    tokenUsageLogCreated: true,
  };
};
