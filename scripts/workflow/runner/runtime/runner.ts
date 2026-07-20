import {
  mkdir,
  readFile,
  readdir,
  writeFile,
} from "node:fs/promises";
import path from "node:path";
import {
  parseRunnerCliArgs,
} from "../cli.ts";
import {
  canonicalFileOwnershipArtifact,
  parseFileOwnershipArtifact,
  readGitChangedFileEntries,
  readGitHeadSha,
  readThinPlanV2FileOwnershipPreflight,
  refreshAndCheckFileOwnershipArtifact,
} from "../../ownership/file-ownership.ts";
import {
  parseContextUsage,
  parseCodexTokenUsage,
  unavailableContextUsage,
  type CodexTokenUsage,
  type ContextUsageLogFields,
} from "../../telemetry/token-usage.ts";
export { analyzeTokenUsageLedger } from "../../telemetry/token-ledger.ts";
import {
  collectWorkflowThresholdWarnings,
  decideWorkflowAutoNarrow,
} from "../../telemetry/token-warnings.ts";
import {
  codexExecutionConfig,
  WORKFLOW_RUNNER_CODEX_PROFILE,
} from "../../config/codex.ts";
import {
  COMMIT_SUMMARY_PROMPT_PATH,
  EXECUTE_PLAN_PROMPT_PATH,
} from "../../contracts/stage.ts";
import { createWorkflowRunnerCodexRuntime, defaultProcessRunner, isValidCodexProfile } from "../process.ts";
import { classifyFailureForLog, codexOutputStopReason, createWorkflowFailureDebugRecord } from "../terminal/codex-events.ts";
import { compactCapturedOutputForLog, formatCommitProgressLine, formatEditedFilesForLog, formatTaskCompletedProgressLine, formatWorkflowElapsedTime, formatWorkflowProgressLine, supportsWorkflowAnsiColor } from "../terminal/formatters.ts";
import { parsePlanTasks, parseTaskCommitBoundaries, taskCommitBoundaryCount, uniquePaths, validateTaskCommitBoundaries } from "../plan/parser.ts";
import { writeWorkflowContextSnapshot } from "../plan/context-snapshot.ts";
import { generateWorkflowPrompt, isReviewPrompt, readPrompt } from "../plan/prompt.ts";
import { normalizeWorkflowEventHistory, parsePlan, parseThinPlanV2WorkflowState, preflightManualPlanExecutionMode, readJsonArtifact, recoverThinPlanV2BlockedValidationHandoff, recoverThinPlanV2PartialExecuteReviewHandoff, repairThinPlanV2ManifestStateFromWorkflow, thinPlanV2ArtifactPath, writeManifestWorkflowState } from "../plan/state.ts";
import { completedTaskCommitCount, currentTaskArtifactRelativePath, formatTaskProgressLine, nextIncompleteTask, nextTaskAfter, nextTaskArtifactRelativePath, readHeadTaskCommit, readableTaskLabel, readableTaskProgressDescription, readTaskArtifactStage, readTaskCommitRecoveryParent, writeCurrentTaskPointer, writeTaskArtifact, writeTaskStageArtifact } from "../tasks/savepoints.ts";
import { extractCommitSummarySubject, extractSummaryLines, readCompletedTaskSavepoints, writeBossSummary, writeExecutionSummary } from "../tasks/summaries.ts";
import { parseCommitSummaryPathsForPlan, readDirtyPlanOwnedPaths, verifyCommitSummaryPathsClean } from "../review/commit.ts";
import { buildReviewScopeMetadata, runScopeCleanupForPathBatches, runScopeCleanupForPaths } from "../review/scope.ts";
import { checkForPreReviewStagedWork, defaultIsIgnored, parseReviewStagingPaths, runReviewStagingForPaths, runReviewUnstageForPaths } from "../review/staging.ts";
import { routeFor, transitionAllowed } from "../transitions.ts";
import { protectedBranchPreflight, workflowHeadSha } from "./preflight.ts";
import { appendLog } from "./logging.ts";
import { replacePlanSectionValue } from "./recovery.ts";
import { createZeroTokenUsageTotals } from "./telemetry.ts";
import { addTokenUsageToTotals, appendFailureDebugLedger, appendTokenUsageLedger, readLatestTokenUsage, readTokenUsageTotals, readWorkflowTokenGuardrail, tokenUsageLedgerRelativePath } from "./records.ts";
import { blockedPlanDetail, blockedReasonSummary } from "./outcomes.ts";
import { executeWorkflowIteration } from "./iteration-execution.ts";
import { gitHeadShortSha, reopenPlanForNextTask } from "./task-recovery.ts";
import { defaultConsole, failure, MAX_WORKFLOW_ITERATIONS, success, type RunWorkflowOptions, WORKFLOW_RUNNER_USAGE } from "./lifecycle.ts";
import type { CommitProgress, EditedFileSummary, Failure, FileOwnershipArtifact, FileOwnershipPreflight, ParsedPlan, ProcessResult, ProcessRunner, ReviewCleanupProcess, ReviewScopeMetadata, ReviewStagingProcess, RunnerResult, TaskStage, TokenUsageTotals, WorkflowContextSnapshotResult, WorkflowTaskContext } from "../types.ts";
import {
  asRecord,
  boundedInlineExcerpt,
  isFailure,
} from "../types.ts";

const rel = (...segments: string[]) => segments.join("/");

const canonicalWorkflowRecord = (
  record: Record<string, unknown>,
  workflowState: import("../../contracts/stage.ts").WorkflowState,
): Record<string, unknown> => {
  return { ...record, workflowState };
};

type TokenUsageLedgerResult = "success" | "failed" | "interrupted";

const workflowOutputHasValidationPass = (stdout: string): boolean =>
  /\bvalidation\s+passed\b/i.test(stdout) ||
  /\bvalidation\s*:\s*(?:pass|passed|ok|success)\b/i.test(stdout);

const nextWorkflowEventVersion = async ({
  rootDir,
  planName,
  kind,
}: {
  rootDir: string;
  planName: string;
  kind: "execution" | "validation" | "review";
}): Promise<number> => {
  const eventsDir = path.join(
    rootDir,
    thinPlanV2ArtifactPath(planName, "events"),
  );
  let entries: string[] = [];
  try {
    entries = await readdir(eventsDir);
  } catch (error) {
    const code = (error as NodeJS.ErrnoException).code;
    if (code !== "ENOENT") {
      throw error;
    }
  }
  const pattern = new RegExp(`^${kind}-v(\\d+)\\.md$`);
  const latest = entries.reduce((max, entry) => {
    const version = Number(pattern.exec(entry)?.[1] ?? 0);
    return Number.isInteger(version) ? Math.max(max, version) : max;
  }, 0);
  return latest + 1;
};

const workflowEventBody = ({
  title,
  summary,
  evidenceLines,
}: {
  title: string;
  summary: string;
  evidenceLines: string[];
}): string => `${title}

## Summary

${summary}

## Evidence

${evidenceLines.length > 0 ? evidenceLines.map((line) => `* ${line}`).join("\n") : "* No evidence recorded."}
`;

const declaresNoCommitBoundary = (content: string): boolean =>
  /^## Commit Boundaries\s*\n\s*N\/A\b/im.test(content);

const isArtifactOnlyNoCommitReview = ({
  plan,
  artifact,
}: {
  plan: ParsedPlan;
  artifact: FileOwnershipArtifact | undefined;
}): boolean =>
  plan.thinPlanContract === "thin-plan-v2" &&
  declaresNoCommitBoundary(plan.manifestContent) &&
  (artifact?.changedFiles.length ?? 0) > 0 &&
  artifact!.changedFiles.every((filePath) => filePath.startsWith(".ai/"));

const completeArtifactOnlyNoCommitReview = async ({
  rootDir,
  plan,
  timestamp,
  continueExecution = false,
}: {
  rootDir: string;
  plan: ParsedPlan;
  timestamp: () => string;
  continueExecution?: boolean;
}): Promise<{ ok: true } | Failure> => {
  const workflowPath = thinPlanV2ArtifactPath(
    plan.planName,
    "state",
    "workflow.json",
  );
  const workflowRaw = await readJsonArtifact(rootDir, workflowPath);
  if (isFailure(workflowRaw)) {
    return workflowRaw;
  }
  const workflow = parseThinPlanV2WorkflowState(
    workflowRaw,
    plan.planPath,
    workflowPath,
  );
  if (isFailure(workflow)) {
    return workflow;
  }
  const workflowRecord = asRecord(workflowRaw);
  if (!workflowRecord) {
    return {
      ok: false,
      reason: `thin-plan-v2 workflow state is malformed: ${workflowPath}`,
    };
  }

  let reviewVersion: number;
  try {
    reviewVersion = await nextWorkflowEventVersion({
      rootDir,
      planName: plan.planName,
      kind: "review",
    });
  } catch (error) {
    return {
      ok: false,
      reason: `workflow review event version cannot be selected: ${String(error)}`,
    };
  }

  const reviewPath = thinPlanV2ArtifactPath(
    plan.planName,
    "events",
    `review-v${reviewVersion}.md`,
  );
  const latest = {
    ...(asRecord(workflowRecord.latest) ?? {}),
    review: {
      version: reviewVersion,
      summary:
        continueExecution
          ? "Runner accepted artifact-only task review; continuing to the next task."
          : "Runner accepted declared artifact-only review; no committable paths exist.",
      decision: continueExecution ? "active" : "completed",
      result: "PASS",
      evidence: reviewPath,
      noCommit: true,
      unresolvedFindings: [],
    },
  };
  const history = uniquePaths([
    ...(normalizeWorkflowEventHistory(workflowRecord.history) ?? []),
    reviewPath,
  ]);
  const now = timestamp();

  try {
    await mkdir(path.join(rootDir, path.dirname(reviewPath)), {
      recursive: true,
    });
    await writeFile(
      path.join(rootDir, reviewPath),
      workflowEventBody({
        title: `# Review v${reviewVersion}`,
        summary:
          continueExecution
            ? "Declared artifact-only task review passed; remaining tasks continue without a commit."
            : "Declared read-only plan has only .ai artifact changes and no commit boundary.",
        evidenceLines: [
          "All active plan-owned changed paths are under .ai/.",
          "Plan Commit Boundaries explicitly declares N/A.",
          "Runner skipped git staging, review Codex execution, and commit-summary Codex execution.",
        ],
      }),
      "utf8",
    );
    await writeFile(
      path.join(rootDir, workflowPath),
      `${JSON.stringify(
        {
          ...canonicalWorkflowRecord(workflowRecord, continueExecution ? "active" : "completed"),
          latest,
          history,
          unresolvedBlockers: [],
          updatedAt: now,
        },
        null,
        2,
      )}\n`,
      "utf8",
    );
    await writeFile(
      plan.absolutePlanPath,
      writeManifestWorkflowState(
        plan.manifestContent,
        continueExecution ? "active" : "completed",
      ),
      "utf8",
    );
  } catch (error) {
    return {
      ok: false,
      reason: `artifact-only no-commit review completion failed: ${String(error)}`,
    };
  }

  return { ok: true };
};

const hasArtifactOnlyNoCommitReview = async ({
  rootDir,
  plan,
}: {
  rootDir: string;
  plan: ParsedPlan;
}): Promise<{ ok: true; noCommit: boolean } | Failure> => {
  if (
    plan.thinPlanContract !== "thin-plan-v2" ||
    !declaresNoCommitBoundary(plan.manifestContent)
  ) {
    return { ok: true, noCommit: false };
  }
  const workflowPath = thinPlanV2ArtifactPath(
    plan.planName,
    "state",
    "workflow.json",
  );
  const workflowRaw = await readJsonArtifact(rootDir, workflowPath);
  if (isFailure(workflowRaw)) {
    return workflowRaw;
  }
  const review = asRecord(asRecord(workflowRaw)?.latest)?.review;
  return { ok: true, noCommit: asRecord(review)?.noCommit === true };
};

const recoverThinPlanV2ExecuteHandoff = async ({
  rootDir,
  plan,
  processRunner,
  stdout,
  timestamp,
}: {
  rootDir: string;
  plan: ParsedPlan;
  processRunner: ProcessRunner;
  stdout: string;
  timestamp: () => string;
}): Promise<{ ok: true; recovered: boolean } | Failure> => {
  if (
    plan.thinPlanContract !== "thin-plan-v2" ||
    plan.workflowState !== "active" ||
    !workflowOutputHasValidationPass(stdout)
  ) {
    return { ok: true, recovered: false };
  }

  const changed = await readGitChangedFileEntries(rootDir, processRunner);
  if (!changed.ok) {
    return changed;
  }
  const entries = changed.entries.filter(
    (entry) => !entry.path.startsWith(".ai/"),
  );
  if (entries.length === 0) {
    return { ok: true, recovered: false };
  }

  const head = await readGitHeadSha(rootDir, processRunner);
  if (!head.ok) {
    return head;
  }

  const workflowPath = thinPlanV2ArtifactPath(
    plan.planName,
    "state",
    "workflow.json",
  );
  const workflowRaw = await readJsonArtifact(rootDir, workflowPath);
  if (isFailure(workflowRaw)) {
    return workflowRaw;
  }
  const workflow = parseThinPlanV2WorkflowState(
    workflowRaw,
    plan.planPath,
    workflowPath,
  );
  if (isFailure(workflow)) {
    return workflow;
  }
  const workflowRecord = asRecord(workflowRaw);
  if (!workflowRecord) {
    return {
      ok: false,
      reason: `thin-plan-v2 workflow state is malformed: ${workflowPath}`,
    };
  }

  let executionVersion: number;
  let validationVersion: number;
  try {
    executionVersion = await nextWorkflowEventVersion({
      rootDir,
      planName: plan.planName,
      kind: "execution",
    });
    validationVersion = await nextWorkflowEventVersion({
      rootDir,
      planName: plan.planName,
      kind: "validation",
    });
  } catch (error) {
    return {
      ok: false,
      reason: `workflow event version cannot be selected: ${String(error)}`,
    };
  }

  const executionPath = thinPlanV2ArtifactPath(
    plan.planName,
    "events",
    `execution-v${executionVersion}.md`,
  );
  const validationPath = thinPlanV2ArtifactPath(
    plan.planName,
    "events",
    `validation-v${validationVersion}.md`,
  );
  const changedPaths = entries.map((entry) => entry.path);
  const created = entries
    .filter((entry) => entry.change === "created")
    .map((entry) => entry.path);
  const modified = entries
    .filter((entry) => entry.change === "modified")
    .map((entry) => entry.path);
  const deleted = entries
    .filter((entry) => entry.change === "deleted")
    .map((entry) => entry.path);
  const now = timestamp();

  const filesPath = thinPlanV2ArtifactPath(
    plan.planName,
    "state",
    "files.json",
  );
  const ownershipPath = thinPlanV2ArtifactPath(
    plan.planName,
    "state",
    "file-ownership.json",
  );
  const ownershipRaw = await readJsonArtifact(rootDir, ownershipPath);
  if (isFailure(ownershipRaw)) {
    return ownershipRaw;
  }
  const ownership = parseFileOwnershipArtifact(
    JSON.stringify(ownershipRaw),
    ownershipPath,
  );
  if (isFailure(ownership)) {
    return ownership;
  }

  const latest = {
    ...(asRecord(workflowRecord.latest) ?? {}),
    execution: {
      version: executionVersion,
      path: executionPath,
      evidence: executionPath,
      summary:
        "Runner recovered the execute-plan review handoff after successful implementation left thin-plan state unchanged.",
      state: "review-ready",
      result: "review-ready",
    },
    validation: {
      version: validationVersion,
      path: validationPath,
      evidence: validationPath,
      summary:
        "Agent output reported validation passed during execute-plan recovery.",
      result: "passed",
    },
  };
  const history = uniquePaths([
    ...(normalizeWorkflowEventHistory(workflowRecord.history) ?? []),
    executionPath,
    validationPath,
  ]);

  try {
    await mkdir(path.join(rootDir, path.dirname(executionPath)), {
      recursive: true,
    });
    await writeFile(
      path.join(rootDir, executionPath),
      workflowEventBody({
        title: `# Execution v${executionVersion}`,
        summary:
          "Runner recovered the execute-plan review handoff after successful implementation left thin-plan state unchanged.",
        evidenceLines: [
          "execute-plan exited successfully.",
          "Plan manifest and workflow state were unchanged, so the runner advanced the thin-plan state.",
          ...changedPaths.map((filePath) => `Changed file: ${filePath}`),
        ],
      }),
      "utf8",
    );
    await writeFile(
      path.join(rootDir, validationPath),
      workflowEventBody({
        title: `# Validation v${validationVersion}`,
        summary:
          "Agent output reported validation passed during execute-plan recovery.",
        evidenceLines: [
          "execute-plan stdout contained a validation passed signal.",
          "Review remains required before commit-summary.",
        ],
      }),
      "utf8",
    );
    await writeFile(
      path.join(rootDir, filesPath),
      `${JSON.stringify(
        {
          created,
          modified,
          deleted,
          changedFiles: changedPaths,
          released: [],
          headSha: head.sha,
        },
        null,
        2,
      )}\n`,
      "utf8",
    );
    await writeFile(
      path.join(rootDir, ownershipPath),
      `${JSON.stringify(
        canonicalFileOwnershipArtifact({
          ...ownership,
          resolvedFiles: changedPaths,
          changedFiles: changedPaths,
          headSha: head.sha,
          updatedAt: now,
        }),
        null,
        2,
      )}\n`,
      "utf8",
    );
    await writeFile(
      path.join(rootDir, workflowPath),
      `${JSON.stringify(
        {
          ...canonicalWorkflowRecord(workflowRecord, "review"),
          latest,
          history,
          unresolvedBlockers: [],
          updatedAt: now,
        },
        null,
        2,
      )}\n`,
      "utf8",
    );
    await writeFile(
      plan.absolutePlanPath,
      writeManifestWorkflowState(plan.manifestContent, "review"),
      "utf8",
    );
  } catch (error) {
    return {
      ok: false,
      reason: `thin-plan-v2 execute handoff recovery failed: ${String(error)}`,
    };
  }

  return { ok: true, recovered: true };
};

const logFields = ({
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

export const runWorkflowRunner = async (
  options: RunWorkflowOptions = {},
): Promise<RunnerResult> => {
  const rootDir = options.rootDir ?? process.cwd();
  const logger = options.console ?? defaultConsole;
  const cliArgs = parseRunnerCliArgs(options.argv);
  if (!cliArgs.ok) {
    logger.error(`FAILED: ${cliArgs.reason}`);
    logger.error(`- Worked for ${formatWorkflowElapsedTime(0)}`);
    return failure(cliArgs.reason);
  }
  if (cliArgs.help) {
    logger.log(WORKFLOW_RUNNER_USAGE);
    return success("workflow runner help", 0);
  }
  const planArgument = options.planName ?? cliArgs.planArgument;
  const codexProfile =
    options.codexProfile ??
    cliArgs.codexProfile ??
    WORKFLOW_RUNNER_CODEX_PROFILE;
  if (!isValidCodexProfile(codexProfile)) {
    const reason = `invalid --profile value: ${codexProfile}`;
    logger.error(`FAILED: ${reason}`);
    logger.error(`- Worked for ${formatWorkflowElapsedTime(0)}`);
    return failure(reason);
  }
  const codexRuntime = createWorkflowRunnerCodexRuntime(codexProfile);
  const unblockNote = options.unblockNote ?? cliArgs.unblockNote;
  const processRunner = options.processRunner ?? defaultProcessRunner;
  const now = options.now ?? Date.now;
  const timestamp = options.timestamp ?? (() => new Date().toISOString());
  const streamOutput = options.streamOutput ?? true;
  const outputStream = options.outputStream ?? {
    stdout: (chunk: string) => process.stdout.write(chunk),
    stderr: (chunk: string) => process.stderr.write(chunk),
    isTTY: process.stdout.isTTY,
  };
  const colorOutput = supportsWorkflowAnsiColor();
  const runStartedAt = now();
  let iterations = 0;
  let workflowLogPath: string | undefined;
  let tokenUsageLogPath: string | undefined;
  let tokenUsageTotals = createZeroTokenUsageTotals();
  const emittedWorkflowWarnings = new Set<string>();
  let currentTaskContext: WorkflowTaskContext | undefined;
  let carriedReviewStagingPaths: string[] | undefined;
  let carriedReviewStagingProcess: ReviewStagingProcess | undefined;
  let reviewNarrowPass = 0;
  let latestFailureDebugPath: string | undefined;
  const markWorkflowLogCreated = (planName: string) => {
    workflowLogPath = rel(".ai", "artifacts", planName, "logs", "runner.log");
  };
  const markTokenUsageLogCreated = (planName: string) => {
    tokenUsageLogPath = tokenUsageLedgerRelativePath(planName);
  };
  const emitWorkflowThresholdWarnings = (warnings: string[]) => {
    for (const warning of warnings) {
      if (emittedWorkflowWarnings.has(warning)) {
        continue;
      }
      emittedWorkflowWarnings.add(warning);
      logger.error(`WARNING: ${warning}`);
    }
  };
  const currentInterruptSignal = (): NodeJS.Signals | undefined => {
    const explicitSignal = options.interruptSignal?.();
    if (explicitSignal) {
      return explicitSignal;
    }
    const abortReason = options.abortSignal?.reason;
    return abortReason === "SIGINT" || abortReason === "SIGTERM"
      ? abortReason
      : undefined;
  };
  const elapsedLine = () =>
    `- Worked for ${formatWorkflowElapsedTime(Math.max(0, now() - runStartedAt))}`;
  const logSpacedFailurePath = (label: string, value: string): true => {
    logger.error("");
    logger.error(`- ${label}:`);
    logger.error(`  ${value}`);
    return true;
  };
  const finishFailure = async (
    reason: string,
    completedIterations = iterations,
    exitCode = 1,
  ): Promise<RunnerResult> => {
    const finalReason = reason;
    logger.error(`FAILED: ${reason}`);
    let loggedSpacedFailurePath = false;
    if (workflowLogPath) {
      loggedSpacedFailurePath = logSpacedFailurePath(
        "Workflow log",
        workflowLogPath,
      );
    }
    if (latestFailureDebugPath) {
      loggedSpacedFailurePath = logSpacedFailurePath(
        "Failure details",
        latestFailureDebugPath,
      );
    }
    if (tokenUsageLogPath) {
      loggedSpacedFailurePath = logSpacedFailurePath(
        "Token usage ledger",
        tokenUsageLogPath,
      );
    }
    if (loggedSpacedFailurePath) {
      logger.error("");
    }
    logger.error(elapsedLine());
    return failure(finalReason, completedIterations, exitCode);
  };
  const finishSuccess = async (
    reason: string,
    completedIterations: number,
  ): Promise<RunnerResult> => {
    logger.log("SUCCESS");
    if (workflowLogPath) {
      logger.log(`- Workflow log: ${workflowLogPath}`);
    }
    if (tokenUsageLogPath) {
      logger.log(`- Token usage ledger: ${tokenUsageLogPath}`);
    }
    logger.log(elapsedLine());
    return success(reason, completedIterations);
  };
  const finishBlocked = async (
    reason: string,
    detail: string,
    planPath: string,
    completedIterations = iterations,
  ): Promise<RunnerResult> => {
    const finalReason = reason;
    const summary = blockedReasonSummary(detail);
    logger.error("BLOCKED");
    logger.error(`- Reason: ${summary.category}`);
    logger.error(`-> ${summary.detail}`);
    logger.error("-> Next: Run Codex CLI with this:");
    logger.error("`use unblock-plan.md`");
    logger.error("`evidence: ...`");
    logger.error(`\`${planPath}\``);
    logger.error("");
    if (workflowLogPath) {
      logger.error(`- Workflow log: ${workflowLogPath}`);
    }
    if (tokenUsageLogPath) {
      logger.error(`- Token usage ledger: ${tokenUsageLogPath}`);
    }
    logger.error(elapsedLine());
    return failure(finalReason, completedIterations);
  };
  const manualPlanPreflight = await preflightManualPlanExecutionMode({
    planName: planArgument,
    rootDir,
  });
  if (!manualPlanPreflight.ok) {
    return await finishFailure(manualPlanPreflight.reason);
  }
  const branchPreflight = await protectedBranchPreflight(
    rootDir,
    processRunner,
  );
  if (!branchPreflight.ok) {
    return await finishFailure(branchPreflight.reason);
  }
  const currentBranch = branchPreflight.branch;
  const initialParsedPlan = await parsePlan({
    planName: planArgument,
    rootDir,
  });
  if (!initialParsedPlan.ok) {
    return await finishFailure(initialParsedPlan.reason);
  }
  emitWorkflowThresholdWarnings(initialParsedPlan.warnings);
  let parsedPlan: ParsedPlan = initialParsedPlan;
  tokenUsageTotals = await readTokenUsageTotals(rootDir, parsedPlan.planName);
  const syncWorkflowSnapshot = async (
    plan: ParsedPlan,
  ): Promise<WorkflowContextSnapshotResult | Failure> => {
  const snapshotResult = await writeWorkflowContextSnapshot({
    rootDir,
    plan,
    latestTokenUsage: await readLatestTokenUsage(rootDir, plan.planName),
  });
    if (!snapshotResult.ok) {
      return snapshotResult;
    }
    return snapshotResult;
  };

  while (true) {
    const route = routeFor(parsedPlan.workflowState);
    if (!route.executable) {
      return await finishFailure(route.reason);
    }
    const prompt = await readPrompt(rootDir, route.promptPath);
    if (!prompt.ok) {
      return await finishFailure(prompt.reason);
    }
    const nextIteration = iterations + 1;
    const executionConfig = codexExecutionConfig(route.promptPath);
    const planTasks = parsePlanTasks(parsedPlan.content);
    const taskSavepointMode = planTasks.length > 1;
    const selectedTask = taskSavepointMode
      ? await nextIncompleteTask(rootDir, parsedPlan.planName, planTasks)
      : undefined;
    const taskSavepointAggregateSummary =
      taskSavepointMode &&
      !selectedTask &&
      route.promptPath === rel(".ai", "prompts", "commit-summary.md");
    const completedTaskCommits = taskSavepointMode
      ? await completedTaskCommitCount(rootDir, parsedPlan.planName, planTasks)
      : 0;
    const commitProgress: CommitProgress | undefined = taskSavepointMode
      ? {
          completed: completedTaskCommits,
          total: planTasks.length,
          description: selectedTask
            ? readableTaskProgressDescription(selectedTask)
            : "task commits complete",
        }
      : undefined;
    const taskCommitBoundaryTotal =
      selectedTask && route.promptPath === COMMIT_SUMMARY_PROMPT_PATH
        ? taskCommitBoundaryCount(parsedPlan.content, selectedTask.id)
        : undefined;
    const commitBoundaryProgress =
      selectedTask && taskCommitBoundaryTotal
        ? {
            taskPosition: completedTaskCommits + 1,
            taskTotal: planTasks.length,
            taskLabel: readableTaskLabel(selectedTask),
            boundaryTotal: taskCommitBoundaryTotal,
          }
        : undefined;
    const selectedTaskArtifactPath = selectedTask
      ? await currentTaskArtifactRelativePath(
          rootDir,
          parsedPlan.planName,
          selectedTask,
        )
      : undefined;
    const selectedTaskStage = selectedTaskArtifactPath
      ? await readTaskArtifactStage(rootDir, selectedTaskArtifactPath)
      : undefined;
    if (
      taskSavepointMode &&
      parsedPlan.workflowState === "completed" &&
      selectedTask &&
      selectedTaskArtifactPath
    ) {
      const noCommit = await hasArtifactOnlyNoCommitReview({
        rootDir,
        plan: parsedPlan,
      });
      if (!noCommit.ok) {
        return await finishFailure(noCommit.reason);
      }
      if (noCommit.noCommit) {
        const nextTask = await nextTaskAfter(
          rootDir,
          parsedPlan.planName,
          planTasks,
          selectedTask,
        );
        const artifact = await writeTaskArtifact({
          rootDir,
          planPath: parsedPlan.planPath,
          context: {
            task: selectedTask,
            stage: "committed",
            artifactPath: selectedTaskArtifactPath,
            commitSha: "no-commit",
          },
          changedFiles: [],
          summaryLines: [
            "Recovered task completion from an artifact-only review handoff.",
          ],
          validationSummary:
            "Artifact-only review was accepted before commit-summary recovery.",
          reviewResult: "Artifact-only review accepted without a local commit.",
          commitMessage: "N/A: declared artifact-only task savepoint.",
          nextTask,
        });
        if (!artifact.ok) {
          return await finishFailure(artifact.reason);
        }
        const reopened = await reopenPlanForNextTask(parsedPlan);
        if (!reopened.ok) {
          return await finishFailure(reopened.reason);
        }
        const nextParsed = await parsePlan({
          planName: planArgument,
          rootDir,
        });
        if (!nextParsed.ok) {
          return await finishFailure(nextParsed.reason);
        }
        parsedPlan = nextParsed;
        continue;
      }
    }
    if (
      taskSavepointMode &&
      route.promptPath === rel(".ai", "prompts", "commit-summary.md") &&
      selectedTask &&
      !currentTaskContext
    ) {
      const recoveryParent = await readTaskCommitRecoveryParent({
        rootDir,
        plan: parsedPlan,
      });
      if (!recoveryParent.ok) {
        return await finishFailure(recoveryParent.reason);
      }
      const recoveredCommit = await readHeadTaskCommit({
        rootDir,
        planName: parsedPlan.planName,
        planPath: parsedPlan.planPath,
        task: selectedTask,
        expectedParentSha: recoveryParent.headSha,
        processRunner,
      });
      if (!recoveredCommit.ok) {
        return await finishFailure(recoveredCommit.reason);
      }
      if (recoveredCommit.commit) {
        const parsedPaths = await parseCommitSummaryPathsForPlan(
          rootDir,
          parsedPlan,
          options.isIgnored,
        );
        if (!parsedPaths.ok) {
          return await finishFailure(
            `commit summary file scope invalid: ${parsedPaths.reason}`,
          );
        }
        const artifactPath = await nextTaskArtifactRelativePath(
          rootDir,
          parsedPlan.planName,
          selectedTask,
        );
        const artifact = await writeTaskArtifact({
          rootDir,
          planPath: parsedPlan.planPath,
          context: {
            task: selectedTask,
            stage: "committed",
            artifactPath,
            commitSha: recoveredCommit.commit.sha.slice(0, 9),
          },
          changedFiles: parsedPaths.paths,
          summaryLines: [
            "Recovered the task savepoint artifact from the existing local commit.",
          ],
          validationSummary: "Recovered from existing task commit metadata.",
          reviewResult: "Recovered after commit-summary artifact interruption.",
          commitMessage: extractCommitSummarySubject(
            recoveredCommit.commit.message,
            selectedTask.name,
          ),
          nextTask: await nextTaskAfter(
            rootDir,
            parsedPlan.planName,
            planTasks,
            selectedTask,
          ),
        });
        if (!artifact.ok) {
          return await finishFailure(artifact.reason);
        }
        continue;
      }
    }
    if (
      taskSavepointMode &&
      route.promptPath === rel(".ai", "prompts", "commit-summary.md") &&
      selectedTask &&
      completedTaskCommits > 0 &&
      !selectedTaskStage &&
      !currentTaskContext
    ) {
      const reopened = await reopenPlanForNextTask(parsedPlan);
      if (!reopened.ok) {
        return await finishFailure(reopened.reason);
      }
      const nextParsed = await parsePlan({
        planName: planArgument,
        rootDir,
      });
      if (!nextParsed.ok) {
        return await finishFailure(nextParsed.reason);
      }
      parsedPlan = nextParsed;
      continue;
    }
    if (!selectedTask) {
      currentTaskContext = undefined;
    }
    let deferredTaskProgress:
      | { stage: TaskStage; detail: string }
      | undefined;
    const emitTaskProgress = ({
      stage,
      detail,
    }: {
      stage: TaskStage;
      detail: string;
    }) => {
      if (!selectedTask) {
        return;
      }
      const taskProgressLine = formatTaskProgressLine({
        task: selectedTask,
        stage,
        detail,
        taskPosition: completedTaskCommits + 1,
        taskTotal: planTasks.length,
        completedTasks: completedTaskCommits,
        boundaryTotal: taskCommitBoundaryTotal,
      });
      logger.log(streamOutput ? `${taskProgressLine}\n` : taskProgressLine);
    };
    const setTaskStage = async ({
      stage,
      detail,
      commitSha,
      logProgress = true,
    }: {
      stage: TaskStage;
      detail: string;
      commitSha?: string;
      logProgress?: boolean;
    }): Promise<{ ok: true } | Failure> => {
      if (!selectedTask || !selectedTaskArtifactPath) {
        currentTaskContext = undefined;
        return { ok: true };
      }
      currentTaskContext = {
        task: selectedTask,
        stage,
        artifactPath: selectedTaskArtifactPath,
        commitSha,
      };
      const artifact = await writeTaskStageArtifact({
        rootDir,
        planPath: parsedPlan.planPath,
        context: currentTaskContext,
      });
      if (!artifact.ok) {
        return artifact;
      }
      const pointer = await writeCurrentTaskPointer({
        rootDir,
        planName: parsedPlan.planName,
        planPath: parsedPlan.planPath,
        context: currentTaskContext,
        timestamp: timestamp(),
      });
      if (!pointer.ok) {
        return pointer;
      }
      if (logProgress) {
        emitTaskProgress({ stage, detail });
      }
      return { ok: true };
    };
    const startingHeadSha = await workflowHeadSha(rootDir, processRunner);
    if (iterations >= MAX_WORKFLOW_ITERATIONS) {
      const reason = `maximum iterations ${MAX_WORKFLOW_ITERATIONS} reached`;
      const logTimestamp = timestamp();
      const failureMetadata = classifyFailureForLog(reason);
      const failureDebugResult = await appendFailureDebugLedger(
        rootDir,
        parsedPlan.planName,
        createWorkflowFailureDebugRecord({
          timestamp: logTimestamp,
          iteration: nextIteration,
          planPath: parsedPlan.planPath,
          workflowState: parsedPlan.workflowState,
          promptPath: route.promptPath,
          result: "not-launched",
          exitCode: undefined,
          stopReason: reason,
          failureMetadata,
          stdout: "",
          stderr: "",
        }),
      );
      if (!failureDebugResult.ok) {
        return await finishFailure(failureDebugResult.reason);
      }
      latestFailureDebugPath = failureDebugResult.pointer;
      const logResult = await appendLog(
        rootDir,
        parsedPlan.planName,
        logFields({
          timestamp: logTimestamp,
          iteration: nextIteration,
          planPath: parsedPlan.planPath,
          workflowState: parsedPlan.workflowState,
          promptPath: route.promptPath,
          model: executionConfig.model,
          reasoning: executionConfig.reasoning,
          contextUsage: unavailableContextUsage,
          result: "not-launched",
          exitCode: undefined,
          durationMs: 0,
          stopReason: reason,
          failureDebugPath: failureDebugResult.pointer,
          stdout: "",
          stderr: "",
          staging: undefined,
          taskContext: currentTaskContext,
          currentBranch,
          startingHeadSha,
          endingHeadSha: await workflowHeadSha(rootDir, processRunner),
          commitProgress,
        }),
      );
      if (!logResult.ok) {
        return await finishFailure(logResult.reason);
      }
      markWorkflowLogCreated(parsedPlan.planName);
      return await finishFailure(reason);
    }

    const attemptStartedAt = now();
    let staging: ReviewStagingProcess | undefined;
    let reviewCleanup: ReviewCleanupProcess | undefined;
    let reviewStagingPaths: string[] | undefined;
    let reviewScopeMetadata: ReviewScopeMetadata | undefined;
    let commitSummaryPaths: string[] | undefined;
    let fileOwnershipPreflight: FileOwnershipPreflight | undefined;
    let reviewAutoNarrowReason: string | undefined;
    let noCommitReviewCompletion = false;
    let progressLogged = false;
    const logWorkflowProgress = () => {
      if (progressLogged) {
        return;
      }
      iterations = nextIteration;
      logger.log(
        formatWorkflowProgressLine({
          iteration: iterations,
          maxIterations: MAX_WORKFLOW_ITERATIONS,
          workflowState: parsedPlan.workflowState,
          promptPath: route.promptPath,
          model: executionConfig.model,
          reasoning: executionConfig.reasoning,
          color: colorOutput,
        }),
      );
      if (commitProgress && !selectedTask) {
        logger.log(
          streamOutput
            ? `${formatCommitProgressLine(commitProgress)}\n`
            : formatCommitProgressLine(commitProgress),
        );
      }
      progressLogged = true;
      if (deferredTaskProgress) {
        emitTaskProgress(deferredTaskProgress);
        deferredTaskProgress = undefined;
      }
    };
    const cleanupReviewStagingPaths = async (
      paths: string[] | undefined,
    ): Promise<{ ok: true } | Failure> => {
      if (
        !isReviewPrompt(route.promptPath) ||
        !paths ||
        paths.length === 0 ||
        reviewCleanup
      ) {
        return { ok: true };
      }
      const cleanup = await runReviewUnstageForPaths(
        rootDir,
        paths,
        processRunner,
      );
      reviewCleanup = cleanup.cleanup;
      if (!cleanup.ok) {
        return { ok: false, reason: cleanup.reason };
      }
      return { ok: true };
    };
    const cleanupCommitSummaryPaths = async (
      paths: string[] | undefined,
    ): Promise<{ ok: true } | Failure> => {
      if (!paths || paths.length === 0 || reviewCleanup) {
        return { ok: true };
      }
      const cleanup = await runReviewUnstageForPaths(
        rootDir,
        paths,
        processRunner,
        {
          operationLabel: "commit-summary cleanup",
          promptPath: "git-commit-summary-unstage",
        },
      );
      reviewCleanup = cleanup.cleanup;
      if (!cleanup.ok) {
        return { ok: false, reason: cleanup.reason };
      }
      return { ok: true };
    };
    const prepareReviewScopeForPaths = async (
      paths: string[],
    ): Promise<{ ok: true } | Failure> => {
      let cleanup = await runScopeCleanupForPaths({
        codexRuntime,
        rootDir,
        planPath: parsedPlan.planPath,
        planContent: parsedPlan.content,
        paths,
        processRunner,
        mode: "review",
      });
      const skippedCleanupDiffBytes = cleanup.skippedLargeDiff
        ? cleanup.diffBytes
        : undefined;
      if (cleanup.skippedLargeDiff) {
        cleanup = await runScopeCleanupForPathBatches({
          codexRuntime,
          rootDir,
          planPath: parsedPlan.planPath,
          planContent: parsedPlan.content,
          paths,
          processRunner,
          mode: "review",
        });
      }
      const unresolvedCleanupDiffBytes = cleanup.skippedLargeDiff
        ? cleanup.diffBytes
        : skippedCleanupDiffBytes;
      if (unresolvedCleanupDiffBytes) {
        const decision = decideWorkflowAutoNarrow({
          currentPass: reviewNarrowPass,
          cleanupDiffBytes: unresolvedCleanupDiffBytes,
        });
        if (decision.shouldNarrow) {
          reviewNarrowPass = decision.nextPass;
        }
        reviewAutoNarrowReason = [reviewAutoNarrowReason, decision.reason]
          .filter(Boolean)
          .join("; ");
      }
      const scope = await buildReviewScopeMetadata({
        rootDir,
        paths,
        planContent: parsedPlan.content,
        processRunner,
        narrowPass: reviewNarrowPass,
        autoNarrowReason: reviewAutoNarrowReason,
      });
      if (!scope.ok) {
        return scope;
      }
      reviewNarrowPass = scope.scope.narrowPass;
      reviewScopeMetadata = scope.scope;
      return { ok: true };
    };
    if (
      route.promptPath === rel(".ai", "prompts", "execute-plan.md") &&
      selectedTask
    ) {
      const taskStage = await setTaskStage({
        stage: "implementing",
        detail: selectedTask.name,
        logProgress: false,
      });
      if (!taskStage.ok) {
        return await finishFailure(taskStage.reason);
      }
      deferredTaskProgress = {
        stage: "implementing",
        detail: selectedTask.name,
      };
    }
    if (
      route.promptPath === rel(".ai", "prompts", "commit-summary.md") &&
      selectedTask
    ) {
      const taskStage = await setTaskStage({
        stage: "commit-message",
        detail: "generating commit",
        logProgress: false,
      });
      if (!taskStage.ok) {
        return await finishFailure(taskStage.reason);
      }
      deferredTaskProgress = {
        stage: "commit-message",
        detail: "generating commit",
      };
    }
    if (
      route.promptPath === rel(".ai", "prompts", "execute-plan.md") ||
      isReviewPrompt(route.promptPath) ||
      route.promptPath === rel(".ai", "prompts", "commit-summary.md")
    ) {
      const preflight =
        parsedPlan.thinPlanContract === "thin-plan-v2"
          ? await readThinPlanV2FileOwnershipPreflight({
              rootDir,
              plan: parsedPlan,
              processRunner,
              isIgnored: options.isIgnored,
            })
          : await refreshAndCheckFileOwnershipArtifact({
              rootDir,
              plan: parsedPlan,
              processRunner,
              timestamp,
              isIgnored: options.isIgnored,
            });
      if ("ok" in preflight && !preflight.ok) {
        return await finishFailure(
          `workflow file ownership scope invalid: ${preflight.reason}`,
        );
      }
      fileOwnershipPreflight = preflight;
    }
    const workflowTokenGuardrail = await readWorkflowTokenGuardrail({
      rootDir,
      planName: parsedPlan.planName,
      promptPath: route.promptPath,
    });
    if (isReviewPrompt(route.promptPath)) {
      if (isReviewPrompt(route.promptPath)) {
        if (
          isArtifactOnlyNoCommitReview({
            plan: parsedPlan,
            artifact: fileOwnershipPreflight?.artifact,
          })
        ) {
          logWorkflowProgress();
          let continueExecution = false;
          if (taskSavepointMode && selectedTask && selectedTaskArtifactPath) {
            const nextTask = await nextTaskAfter(
              rootDir,
              parsedPlan.planName,
              planTasks,
              selectedTask,
            );
            const artifact = await writeTaskArtifact({
              rootDir,
              planPath: parsedPlan.planPath,
              context: {
                task: selectedTask,
                stage: "committed",
                artifactPath: selectedTaskArtifactPath,
                commitSha: "no-commit",
              },
              changedFiles:
                fileOwnershipPreflight?.artifact?.changedFiles ?? [],
              summaryLines: [
                "Artifact-only review accepted without a local commit.",
              ],
              validationSummary:
                "See plan validation history and artifact-only review evidence.",
              reviewResult: "Artifact-only review accepted without a local commit.",
              commitMessage: "N/A: declared artifact-only task savepoint.",
              nextTask,
            });
            if (!artifact.ok) {
              return await finishFailure(artifact.reason);
            }
            continueExecution =
              (await nextIncompleteTask(
                rootDir,
                parsedPlan.planName,
                planTasks,
              )) !== undefined;
          }
          const completed = await completeArtifactOnlyNoCommitReview({
            rootDir,
            plan: parsedPlan,
            timestamp,
            continueExecution,
          });
          if (!completed.ok) {
            return await finishFailure(completed.reason);
          }
          const updated = await parsePlan({ planName: planArgument, rootDir });
          if (!updated.ok) {
            return await finishFailure(updated.reason);
          }
          parsedPlan = updated;
          continue;
        }
        const parsedPaths =
          fileOwnershipPreflight?.hasOwnershipScope &&
          fileOwnershipPreflight.reviewStagingPaths
            ? fileOwnershipPreflight.reviewStagingPaths.length > 0
              ? {
                  ok: true as const,
                  paths: fileOwnershipPreflight.reviewStagingPaths,
                }
              : {
                  ok: false as const,
                  reason:
                    "plan has no changed ownership files to stage for review",
                }
            : await parseReviewStagingPaths({
                content: parsedPlan.content,
                rootDir,
                isIgnored:
                  options.isIgnored ??
                  ((relativePath) => defaultIsIgnored(rootDir, relativePath)),
              });
        if (!parsedPaths.ok) {
          const durationMs = Math.max(0, now() - attemptStartedAt);
          const logTimestamp = timestamp();
          const failureMetadata = classifyFailureForLog(parsedPaths.reason);
          const failureDebugResult = await appendFailureDebugLedger(
            rootDir,
            parsedPlan.planName,
            createWorkflowFailureDebugRecord({
              timestamp: logTimestamp,
              iteration: nextIteration,
              planPath: parsedPlan.planPath,
              workflowState: parsedPlan.workflowState,
              promptPath: route.promptPath,
              result: "not-launched",
              exitCode: undefined,
              stopReason: parsedPaths.reason,
              failureMetadata,
              stdout: "",
              stderr: "",
            }),
          );
          if (!failureDebugResult.ok) {
            return await finishFailure(failureDebugResult.reason);
          }
          latestFailureDebugPath = failureDebugResult.pointer;
          const logResult = await appendLog(
            rootDir,
            parsedPlan.planName,
            logFields({
              timestamp: logTimestamp,
              iteration: nextIteration,
              planPath: parsedPlan.planPath,
              workflowState: parsedPlan.workflowState,
              promptPath: route.promptPath,
              model: executionConfig.model,
              reasoning: executionConfig.reasoning,
              contextUsage: unavailableContextUsage,
              result: "not-launched",
              exitCode: undefined,
              durationMs,
              stopReason: parsedPaths.reason,
              failureDebugPath: failureDebugResult.pointer,
              stdout: "",
              stderr: "",
              staging: undefined,
              taskContext: currentTaskContext,
              currentBranch,
              startingHeadSha,
              endingHeadSha: await workflowHeadSha(rootDir, processRunner),
              commitProgress,
            }),
          );
          if (!logResult.ok) {
            return await finishFailure(logResult.reason);
          }
          markWorkflowLogCreated(parsedPlan.planName);
          return await finishFailure(parsedPaths.reason);
        }
        const preExistingStagedWork = await checkForPreReviewStagedWork(
          rootDir,
          processRunner,
          parsedPaths.paths,
        );
        if (!preExistingStagedWork.ok) {
          logWorkflowProgress();
          const durationMs = Math.max(0, now() - attemptStartedAt);
          const logTimestamp = timestamp();
          const failureMetadata = classifyFailureForLog(
            preExistingStagedWork.reason,
          );
          const failureDebugResult = await appendFailureDebugLedger(
            rootDir,
            parsedPlan.planName,
            createWorkflowFailureDebugRecord({
              timestamp: logTimestamp,
              iteration: nextIteration,
              planPath: parsedPlan.planPath,
              workflowState: parsedPlan.workflowState,
              promptPath: route.promptPath,
              result: "not-launched",
              exitCode: undefined,
              stopReason: preExistingStagedWork.reason,
              failureMetadata,
              stdout: "",
              stderr: "",
            }),
          );
          if (!failureDebugResult.ok) {
            return await finishFailure(failureDebugResult.reason);
          }
          latestFailureDebugPath = failureDebugResult.pointer;
          const logResult = await appendLog(
            rootDir,
            parsedPlan.planName,
            logFields({
              timestamp: logTimestamp,
              iteration: nextIteration,
              planPath: parsedPlan.planPath,
              workflowState: parsedPlan.workflowState,
              promptPath: route.promptPath,
              model: executionConfig.model,
              reasoning: executionConfig.reasoning,
              contextUsage: unavailableContextUsage,
              result: "not-launched",
              exitCode: undefined,
              durationMs,
              stopReason: preExistingStagedWork.reason,
              failureDebugPath: failureDebugResult.pointer,
              stdout: "",
              stderr: "",
              staging: undefined,
              taskContext: currentTaskContext,
              currentBranch,
              startingHeadSha,
              endingHeadSha: await workflowHeadSha(rootDir, processRunner),
              commitProgress,
            }),
          );
          if (!logResult.ok) {
            return await finishFailure(logResult.reason);
          }
          markWorkflowLogCreated(parsedPlan.planName);
          return await finishFailure(preExistingStagedWork.reason);
        }
        logWorkflowProgress();
        if (selectedTask) {
          const taskStage = await setTaskStage({
            stage: "reviewing",
            detail: `staged ${parsedPaths.paths.length} ${
              parsedPaths.paths.length === 1 ? "file" : "files"
            }`,
          });
          if (!taskStage.ok) {
            return await finishFailure(taskStage.reason);
          }
        }
        if (!selectedTask) {
          logger.log(
            `Staging ${parsedPaths.paths.length} plan-owned ${
              parsedPaths.paths.length === 1 ? "file" : "files"
            } for review...`,
          );
        }
        const staged = await runReviewStagingForPaths(
          rootDir,
          parsedPaths.paths,
          processRunner,
        );
        if (!staged.ok) {
          const cleanup = await cleanupReviewStagingPaths(
            staged.staging?.paths,
          );
          const stopReason = cleanup.ok
            ? staged.reason
            : `${staged.reason}; ${cleanup.reason}`;
          const durationMs = Math.max(0, now() - attemptStartedAt);
          const logTimestamp = timestamp();
          const failureMetadata = classifyFailureForLog(stopReason);
          const failureDebugResult = await appendFailureDebugLedger(
            rootDir,
            parsedPlan.planName,
            createWorkflowFailureDebugRecord({
              timestamp: logTimestamp,
              iteration: nextIteration,
              planPath: parsedPlan.planPath,
              workflowState: parsedPlan.workflowState,
              promptPath: route.promptPath,
              result: staged.staging ? "staging-failed" : "not-launched",
              exitCode: undefined,
              stopReason,
              failureMetadata,
              stdout: "",
              stderr: "",
              staging: staged.staging,
              cleanup: reviewCleanup,
              taskContext: currentTaskContext,
            }),
          );
          if (!failureDebugResult.ok) {
            return await finishFailure(failureDebugResult.reason);
          }
          latestFailureDebugPath = failureDebugResult.pointer;
          const logResult = await appendLog(
            rootDir,
            parsedPlan.planName,
            logFields({
              timestamp: logTimestamp,
              iteration: nextIteration,
              planPath: parsedPlan.planPath,
              workflowState: parsedPlan.workflowState,
              promptPath: route.promptPath,
              model: executionConfig.model,
              reasoning: executionConfig.reasoning,
              contextUsage: unavailableContextUsage,
              result: staged.staging ? "staging-failed" : "not-launched",
              exitCode: undefined,
              durationMs,
              stopReason,
              failureDebugPath: failureDebugResult.pointer,
              stdout: "",
              stderr: "",
              staging: staged.staging,
              cleanup: reviewCleanup,
              taskContext: currentTaskContext,
              currentBranch,
              startingHeadSha,
              endingHeadSha: await workflowHeadSha(rootDir, processRunner),
              commitProgress,
            }),
          );
          if (!logResult.ok) {
            return await finishFailure(logResult.reason);
          }
          markWorkflowLogCreated(parsedPlan.planName);
          return await finishFailure(stopReason);
        }
        const scope = await prepareReviewScopeForPaths(staged.paths);
        if (!scope.ok) {
          const cleanup = await cleanupReviewStagingPaths(staged.paths);
          const stopReason = cleanup.ok
            ? scope.reason
            : `${scope.reason}; ${cleanup.reason}`;
          return await finishFailure(stopReason);
        }
        staging = staged.staging;
        reviewStagingPaths = staged.paths;
      } else {
        if (
          !carriedReviewStagingPaths ||
          carriedReviewStagingPaths.length === 0
        ) {
          const parsedPaths =
            fileOwnershipPreflight?.hasOwnershipScope &&
            fileOwnershipPreflight.reviewStagingPaths
              ? fileOwnershipPreflight.reviewStagingPaths.length > 0
                ? {
                    ok: true as const,
                    paths: fileOwnershipPreflight.reviewStagingPaths,
                  }
                : {
                    ok: false as const,
                    reason:
                      "plan has no changed ownership files to stage for review",
                  }
              : await parseReviewStagingPaths({
                  content: parsedPlan.content,
                  rootDir,
                  isIgnored:
                    options.isIgnored ??
                    ((relativePath) => defaultIsIgnored(rootDir, relativePath)),
                });
          if (!parsedPaths.ok) {
            return await finishFailure(parsedPaths.reason);
          }
          logWorkflowProgress();
          if (selectedTask) {
            const taskStage = await setTaskStage({
              stage: "reviewing",
              detail: `staged ${parsedPaths.paths.length} ${
                parsedPaths.paths.length === 1 ? "file" : "files"
              }`,
            });
            if (!taskStage.ok) {
              return await finishFailure(taskStage.reason);
            }
          }
          if (!selectedTask) {
            logger.log(
              `Staging ${parsedPaths.paths.length} plan-owned ${
                parsedPaths.paths.length === 1 ? "file" : "files"
              } for quality review...`,
            );
          }
          const staged = await runReviewStagingForPaths(
            rootDir,
            parsedPaths.paths,
            processRunner,
          );
          if (!staged.ok) {
            const cleanup = await cleanupReviewStagingPaths(
              staged.staging?.paths,
            );
            const stopReason = cleanup.ok
              ? staged.reason
              : `${staged.reason}; ${cleanup.reason}`;
            return await finishFailure(stopReason);
          }
          const scope = await prepareReviewScopeForPaths(staged.paths);
          if (!scope.ok) {
            const cleanup = await cleanupReviewStagingPaths(staged.paths);
            const stopReason = cleanup.ok
              ? scope.reason
              : `${scope.reason}; ${cleanup.reason}`;
            return await finishFailure(stopReason);
          }
          reviewStagingPaths = staged.paths;
          staging = staged.staging;
        } else {
          logWorkflowProgress();
          reviewStagingPaths = carriedReviewStagingPaths;
          staging = carriedReviewStagingProcess;
          const scope = await prepareReviewScopeForPaths(reviewStagingPaths);
          if (!scope.ok) {
            return await finishFailure(scope.reason);
          }
        }
      }
    }
    if (route.promptPath === rel(".ai", "prompts", "commit-summary.md")) {
      const noCommit = await hasArtifactOnlyNoCommitReview({
        rootDir,
        plan: parsedPlan,
      });
      if (!noCommit.ok) {
        return await finishFailure(noCommit.reason);
      }
      noCommitReviewCompletion = noCommit.noCommit;
      if (!noCommitReviewCompletion) {
        const parsedPaths = await parseCommitSummaryPathsForPlan(
          rootDir,
          parsedPlan,
          options.isIgnored,
        );
        if (!parsedPaths.ok) {
          return await finishFailure(
            `commit summary file scope invalid: ${parsedPaths.reason}`,
          );
        }
        commitSummaryPaths = parsedPaths.paths;
        if (
          selectedTask &&
          parseTaskCommitBoundaries(parsedPlan.content, selectedTask.id).declared
        ) {
          const dirtyPaths = await readDirtyPlanOwnedPaths(
            rootDir,
            commitSummaryPaths,
            processRunner,
          );
          if (!dirtyPaths.ok) {
            return await finishFailure(dirtyPaths.reason);
          }
          const boundaries = validateTaskCommitBoundaries({
            planContent: parsedPlan.content,
            taskId: selectedTask.id,
            planOwnedDirtyPaths: dirtyPaths.paths,
          });
          if (!boundaries.ok) {
            return await finishFailure(boundaries.reason);
          }
        }
      }
    }
    if (route.terminal && noCommitReviewCompletion) {
      logWorkflowProgress();
      const snapshotResult = await syncWorkflowSnapshot(parsedPlan);
      if (!snapshotResult.ok) {
        return await finishFailure(snapshotResult.reason);
      }
      const logResult = await appendLog(
        rootDir,
        parsedPlan.planName,
        logFields({
          timestamp: timestamp(),
          iteration: iterations,
          planPath: parsedPlan.planPath,
          workflowState: parsedPlan.workflowState,
          promptPath: route.promptPath,
          model: executionConfig.model,
          reasoning: executionConfig.reasoning,
          contextUsage: unavailableContextUsage,
          result: "artifact-only-completed",
          exitCode: 0,
          durationMs: Math.max(0, now() - attemptStartedAt),
          stdout: "",
          stderr: "",
          taskContext: currentTaskContext,
          currentBranch,
          startingHeadSha,
          endingHeadSha: await workflowHeadSha(rootDir, processRunner),
          commitProgress,
        }),
      );
      if (!logResult.ok) {
        return await finishFailure(logResult.reason);
      }
      markWorkflowLogCreated(parsedPlan.planName);
      return await finishSuccess(
        "completed artifact-only no-commit workflow",
        iterations,
      );
    }

    logWorkflowProgress();
    const contextSnapshot = await syncWorkflowSnapshot(parsedPlan);
    if (!contextSnapshot.ok) {
      return await finishFailure(contextSnapshot.reason);
    }
    const generatedPrompt = generateWorkflowPrompt({
      promptPath: route.promptPath,
      planPath: parsedPlan.planPath,
      promptContent: prompt.content,
      planContent: parsedPlan.content,
      contextSnapshotPath: contextSnapshot.snapshotPath,
      reviewStagingPaths,
      reviewPrimaryPaths: reviewScopeMetadata?.reviewPrimaryPaths,
      reviewScopeMetadata,
      commitSummaryPaths,
      unblockNote,
      workflowTokenGuardrail,
      taskContext: currentTaskContext,
      taskSavepointAggregateSummary,
    });
    const executedIteration = await executeWorkflowIteration({
      rootDir,
      planContent: parsedPlan.content,
      promptPath: route.promptPath,
      generatedPrompt,
      codexRuntime,
      executionConfig,
      processRunner,
      abortSignal: options.abortSignal,
      outputStream,
      streamOutput,
      colorOutput,
      commitBoundaryProgress,
      now,
      startedAt: attemptStartedAt,
      logger,
    });
    const {
      result,
      durationMs,
      effectiveExecutionConfig,
      editedFiles,
    } = executedIteration;
    const contextUsage = result.launched
      ? parseContextUsage(result.stdout)
      : unavailableContextUsage;

    let stopReason: string | undefined;
    const interruptSignal =
      currentInterruptSignal() ??
      (result.launched &&
      (result.exitSignal === "SIGINT" || result.exitSignal === "SIGTERM")
        ? result.exitSignal
        : undefined);
    if (!result.launched) {
      stopReason = `could not launch ${codexRuntime.execLabel}: ${result.error}`;
    } else if (interruptSignal) {
      stopReason = `${codexRuntime.execLabel} interrupted by ${interruptSignal}`;
    } else if (result.exitCode !== 0) {
      stopReason = `${codexRuntime.execLabel} exited with code ${result.exitCode}`;
    } else {
      stopReason = codexOutputStopReason(
        result.stdout,
        result.stderr,
        codexRuntime.execLabel,
      );
    }

    const appendIterationLog = async (
      iterationStopReason?: string,
      endingPlan?: ParsedPlan,
    ): Promise<{ ok: true } | Failure> => {
      const logTimestamp = timestamp();
      const tokenUsage = parseCodexTokenUsage(result.stdout);
      const cumulativeTokenUsage = result.launched
        ? addTokenUsageToTotals(tokenUsageTotals, tokenUsage)
        : tokenUsageTotals;
      const thresholdWarnings = collectWorkflowThresholdWarnings({
        planByteSize: Buffer.byteLength(
          (endingPlan ?? parsedPlan).content,
          "utf8",
        ),
        latestTokenUsage: {
          stageInputTokens: tokenUsage.inputTokens,
          stageUncachedInputTokens: tokenUsage.uncachedInputTokens,
          stageOutputTokens: tokenUsage.outputTokens,
          stageReasoningOutputTokens: tokenUsage.reasoningOutputTokens,
          stageTotalTokens: tokenUsage.totalTokens,
        },
      });
      emitWorkflowThresholdWarnings(thresholdWarnings);
      const failureMetadata = iterationStopReason
        ? classifyFailureForLog(iterationStopReason)
        : undefined;
      let failureDebugPath: string | undefined;

      if (iterationStopReason && failureMetadata) {
        const failureDebugResult = await appendFailureDebugLedger(
          rootDir,
          parsedPlan.planName,
          createWorkflowFailureDebugRecord({
            timestamp: logTimestamp,
            iteration: iterations,
            planPath: parsedPlan.planPath,
            workflowState: parsedPlan.workflowState,
            promptPath: route.promptPath,
            result: result.launched ? "launched" : "launch-failed",
            exitCode: result.launched ? result.exitCode : undefined,
            stopReason: iterationStopReason,
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
        latestFailureDebugPath = failureDebugPath;
      }

      const logResult = await appendLog(
        rootDir,
        parsedPlan.planName,
        logFields({
          timestamp: logTimestamp,
          iteration: iterations,
          planPath: parsedPlan.planPath,
          workflowState: parsedPlan.workflowState,
          promptPath: route.promptPath,
          model: effectiveExecutionConfig.model,
          reasoning: effectiveExecutionConfig.reasoning,
          contextUsage,
          result: result.launched ? "launched" : "launch-failed",
          exitCode: result.launched ? result.exitCode : undefined,
          durationMs,
          stopReason: iterationStopReason,
          failureDebugPath,
          editedFiles,
          stdout: result.stdout,
          stderr: result.stderr,
          staging,
          cleanup: reviewCleanup,
          taskContext: currentTaskContext,
          currentBranch,
          startingHeadSha,
          endingHeadSha: await workflowHeadSha(rootDir, processRunner),
          commitProgress,
          reviewScope: reviewScopeMetadata,
          latestStageTokenUsage: tokenUsage,
          cumulativeTokenUsage,
        }),
      );
      if (logResult.ok) {
        markWorkflowLogCreated(parsedPlan.planName);
      }
      if (!logResult.ok || !result.launched) {
        return logResult;
      }

      tokenUsageTotals = cumulativeTokenUsage;
      const ledgerResult: TokenUsageLedgerResult = interruptSignal
        ? "interrupted"
        : iterationStopReason
          ? "failed"
          : "success";
      const ledgerResultValue = await appendTokenUsageLedger(
        rootDir,
        parsedPlan.planName,
        {
          timestamp: timestamp(),
          iteration: iterations,
          planPath: parsedPlan.planPath,
          startingWorkflowState: parsedPlan.workflowState,
          promptPath: route.promptPath,
          endingWorkflowState: endingPlan?.workflowState,
          model: effectiveExecutionConfig.model,
          reasoning: effectiveExecutionConfig.reasoning,
          result: ledgerResult,
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
          narrowPass: reviewScopeMetadata?.narrowPass,
          reviewAllPaths: reviewScopeMetadata?.reviewAllPaths,
          reviewPrimaryPaths: reviewScopeMetadata?.reviewPrimaryPaths,
          diffBytes: reviewScopeMetadata?.diffBytes,
          autoNarrowReason: reviewScopeMetadata?.autoNarrowReason,
          ...tokenUsageTotals,
        },
      );
      if (ledgerResultValue.ok) {
        markTokenUsageLogCreated(parsedPlan.planName);
      }
      return ledgerResultValue;
    };

    if (result.launched && result.exitCode === 0 && !interruptSignal) {
      const manifestRepair = await repairThinPlanV2ManifestStateFromWorkflow({
        rootDir,
        plan: parsedPlan,
      });
      if (!manifestRepair.ok) {
        const cleanup = await cleanupReviewStagingPaths(reviewStagingPaths);
        const reason = cleanup.ok
          ? manifestRepair.reason
          : `${manifestRepair.reason}; ${cleanup.reason}`;
        const logResult = await appendIterationLog(reason);
        if (!logResult.ok) {
          return await finishFailure(logResult.reason);
        }
        const snapshotResult = await syncWorkflowSnapshot(parsedPlan);
        if (!snapshotResult.ok) {
          return await finishFailure(snapshotResult.reason);
        }
        return await finishFailure(reason);
      }
    }

    const nonterminalRouteOutcome = (
      updated: ParsedPlan,
    ):
      | { kind: "blocked"; reason: string; detail: string; planPath: string }
      | undefined => {
      if (
        route.promptPath === rel(".ai", "prompts", "execute-plan.md") &&
        updated.workflowState === "blocked"
      ) {
        const detail = blockedPlanDetail(updated.content);
        const reason = `plan blocked after execute-plan: ${detail}`;
        return { kind: "blocked", reason, detail, planPath: updated.planPath };
      }

      if (
        route.promptPath === rel(".ai", "prompts", "unblock-plan.md") &&
        updated.workflowState === "blocked"
      ) {
        const detail = blockedPlanDetail(updated.content);
        const reason = `plan remains blocked after unblock-plan: ${detail}`;
        return { kind: "blocked", reason, detail, planPath: updated.planPath };
      }

      return undefined;
    };

    const finishNonterminalRouteOutcome = async (
      outcome: NonNullable<ReturnType<typeof nonterminalRouteOutcome>>,
    ): Promise<RunnerResult> => {
      return await finishBlocked(
        outcome.reason,
        outcome.detail,
        outcome.planPath,
      );
    };

    if (stopReason) {
      if (route.promptPath === EXECUTE_PLAN_PROMPT_PATH) {
        const recovered = await recoverThinPlanV2BlockedValidationHandoff({
          rootDir,
          plan: parsedPlan,
        });
        if (!recovered.ok) {
          return await finishFailure(recovered.reason);
        }
      }
      const updated = await parsePlan({ planName: planArgument, rootDir });
      if (updated.ok) {
        emitWorkflowThresholdWarnings(updated.warnings);
        const transition = transitionAllowed(
          route.promptPath,
          parsedPlan,
          updated,
        );
        if (transition.ok) {
          if (
            isReviewPrompt(route.promptPath) &&
            updated.workflowState === "active"
          ) {
            const cleanup = await cleanupReviewStagingPaths(reviewStagingPaths);
            if (!cleanup.ok) {
              const finalStopReason = `${stopReason}; ${cleanup.reason}`;
              const logResult = await appendIterationLog(finalStopReason);
              if (!logResult.ok) {
                return await finishFailure(logResult.reason);
              }
              const snapshotResult = await syncWorkflowSnapshot(updated);
              if (!snapshotResult.ok) {
                return await finishFailure(snapshotResult.reason);
              }
              return await finishFailure(finalStopReason);
            }
            carriedReviewStagingPaths = undefined;
            carriedReviewStagingProcess = undefined;
            const logResult = await appendIterationLog(undefined, updated);
            if (!logResult.ok) {
              return await finishFailure(logResult.reason);
            }
            const snapshotResult = await syncWorkflowSnapshot(updated);
            if (!snapshotResult.ok) {
              return await finishFailure(snapshotResult.reason);
            }
            parsedPlan = updated;
            continue;
          }
          const nonterminalOutcome = nonterminalRouteOutcome(updated);
          if (nonterminalOutcome) {
            const logResult = await appendIterationLog(undefined, updated);
            if (!logResult.ok) {
              return await finishFailure(logResult.reason);
            }
            const snapshotResult = await syncWorkflowSnapshot(updated);
            if (!snapshotResult.ok) {
              return await finishFailure(snapshotResult.reason);
            }
            return await finishNonterminalRouteOutcome(nonterminalOutcome);
          }
        }
      }
      const cleanup =
        route.promptPath === rel(".ai", "prompts", "commit-summary.md")
          ? await cleanupCommitSummaryPaths(commitSummaryPaths)
          : await cleanupReviewStagingPaths(reviewStagingPaths);
      const finalStopReason = cleanup.ok
        ? stopReason
        : `${stopReason}; ${cleanup.reason}`;
      const logResult = await appendIterationLog(finalStopReason);
      if (!logResult.ok) {
        return await finishFailure(logResult.reason);
      }
      const snapshotResult = await syncWorkflowSnapshot(parsedPlan);
      if (!snapshotResult.ok) {
        return await finishFailure(snapshotResult.reason);
      }
      return await finishFailure(
        finalStopReason,
        iterations,
        interruptSignal === "SIGINT"
          ? 130
          : interruptSignal === "SIGTERM"
            ? 143
            : 1,
      );
    }

    if (route.terminal) {
      const cleanCheck = await verifyCommitSummaryPathsClean(
        rootDir,
        commitSummaryPaths ?? [],
        processRunner,
      );
      if (!cleanCheck.ok) {
        const unstage = await cleanupCommitSummaryPaths(commitSummaryPaths);
        if (!unstage.ok) {
          return await finishFailure(`${cleanCheck.reason}; ${unstage.reason}`);
        }
        const logResult = await appendIterationLog(cleanCheck.reason);
        if (!logResult.ok) {
          return await finishFailure(logResult.reason);
        }
        const snapshotResult = await syncWorkflowSnapshot(parsedPlan);
        if (!snapshotResult.ok) {
          return await finishFailure(snapshotResult.reason);
        }
        return await finishFailure(cleanCheck.reason);
      }
      if (selectedTask && currentTaskContext) {
        const shaResult = await gitHeadShortSha(rootDir, processRunner);
        if (!shaResult.ok) {
          const logResult = await appendIterationLog(shaResult.reason);
          if (!logResult.ok) {
            return await finishFailure(logResult.reason);
          }
          const snapshotResult = await syncWorkflowSnapshot(parsedPlan);
          if (!snapshotResult.ok) {
            return await finishFailure(snapshotResult.reason);
          }
          return await finishFailure(shaResult.reason);
        }
        const taskStage = await setTaskStage({
          stage: "committed",
          detail: shaResult.sha,
          commitSha: shaResult.sha,
          logProgress: false,
        });
        if (!taskStage.ok) {
          return await finishFailure(taskStage.reason);
        }
      }
      const logResult = await appendIterationLog();
      if (!logResult.ok) {
        return await finishFailure(logResult.reason);
      }
      if (selectedTask && currentTaskContext) {
        const nextTask = await nextIncompleteTask(
          rootDir,
          parsedPlan.planName,
          planTasks.filter((task) => task.id !== selectedTask.id),
        );
        const artifact = await writeTaskArtifact({
          rootDir,
          planPath: parsedPlan.planPath,
          context: currentTaskContext,
          changedFiles: commitSummaryPaths ?? [],
          summaryLines: extractSummaryLines(result.stdout, selectedTask.name),
          validationSummary:
            "See plan validation history and commit-summary stage output.",
          reviewResult: "Review accepted task for commit-summary.",
          commitMessage: extractCommitSummarySubject(
            result.stdout,
            selectedTask.name,
          ),
          nextTask,
        });
        if (!artifact.ok) {
          return await finishFailure(artifact.reason);
        }
        const completedTaskArtifacts = await readCompletedTaskSavepoints({
          rootDir,
          planName: parsedPlan.planName,
          tasks: planTasks,
        });
        if (!completedTaskArtifacts.ok) {
          return await finishFailure(completedTaskArtifacts.reason);
        }
        const executionSummary = await writeExecutionSummary({
          rootDir,
          planName: parsedPlan.planName,
          planPath: parsedPlan.planPath,
          tasks: planTasks,
          completedTasks: completedTaskArtifacts.completedTasks,
          finalStatus: "in-progress",
        });
        if (!executionSummary.ok) {
          return await finishFailure(executionSummary.reason);
        }
        const bossSummary = await writeBossSummary({
          rootDir,
          planName: parsedPlan.planName,
          tasks: planTasks,
          completedTasks: completedTaskArtifacts.completedTasks,
          finalStatus: "in-progress",
        });
        if (!bossSummary.ok) {
          return await finishFailure(bossSummary.reason);
        }
        const nextTaskPosition = nextTask
          ? planTasks.findIndex((task) => task.id === nextTask.id) + 1
          : undefined;
        logger.log(
          streamOutput
            ? `${formatTaskCompletedProgressLine({
                taskPosition: completedTaskCommits + 1,
                taskTotal: planTasks.length,
                taskLabel: readableTaskLabel(selectedTask),
                commitTotal: taskCommitBoundaryTotal ?? 1,
                nextTaskPosition,
              })}\n`
            : formatTaskCompletedProgressLine({
                taskPosition: completedTaskCommits + 1,
                taskTotal: planTasks.length,
                taskLabel: readableTaskLabel(selectedTask),
                commitTotal: taskCommitBoundaryTotal ?? 1,
                nextTaskPosition,
              }),
        );
        const remainingTask = await nextIncompleteTask(
          rootDir,
          parsedPlan.planName,
          planTasks,
        );
        if (remainingTask) {
          const reopened = await reopenPlanForNextTask(parsedPlan);
          if (!reopened.ok) {
            return await finishFailure(reopened.reason);
          }
          const nextParsed = await parsePlan({
            planName: planArgument,
            rootDir,
          });
          if (!nextParsed.ok) {
            return await finishFailure(nextParsed.reason);
          }
          parsedPlan = nextParsed;
          continue;
        }
        parsedPlan = {
          ...parsedPlan,
          content: await readFile(parsedPlan.absolutePlanPath, "utf8"),
        };
        continue;
      }
      if (taskSavepointAggregateSummary) {
        const completedTaskArtifacts = await readCompletedTaskSavepoints({
          rootDir,
          planName: parsedPlan.planName,
          tasks: planTasks,
        });
        if (!completedTaskArtifacts.ok) {
          return await finishFailure(completedTaskArtifacts.reason);
        }
        const executionSummary = await writeExecutionSummary({
          rootDir,
          planName: parsedPlan.planName,
          planPath: parsedPlan.planPath,
          tasks: planTasks,
          completedTasks: completedTaskArtifacts.completedTasks,
          finalStatus: "completed",
        });
        if (!executionSummary.ok) {
          return await finishFailure(executionSummary.reason);
        }
        const bossSummary = await writeBossSummary({
          rootDir,
          planName: parsedPlan.planName,
          tasks: planTasks,
          completedTasks: completedTaskArtifacts.completedTasks,
          finalStatus: "completed",
        });
        if (!bossSummary.ok) {
          return await finishFailure(bossSummary.reason);
        }
      }
      const snapshotResult = await syncWorkflowSnapshot(parsedPlan);
      if (!snapshotResult.ok) {
        return await finishFailure(snapshotResult.reason);
      }
      const reason = "completed + commit-summary finished";
      return await finishSuccess(reason, iterations);
    }

    const previousContent = parsedPlan.content;
    const updated = await parsePlan({ planName: planArgument, rootDir });
    if (!updated.ok) {
      const cleanup = await cleanupReviewStagingPaths(reviewStagingPaths);
      const reason = cleanup.ok
        ? updated.reason
        : `${updated.reason}; ${cleanup.reason}`;
      const logResult = await appendIterationLog(reason);
      if (!logResult.ok) {
        return await finishFailure(logResult.reason);
      }
      const snapshotResult = await syncWorkflowSnapshot(parsedPlan);
      if (!snapshotResult.ok) {
        return await finishFailure(snapshotResult.reason);
      }
      return await finishFailure(reason);
    }
    emitWorkflowThresholdWarnings(updated.warnings);

    if (route.promptPath === EXECUTE_PLAN_PROMPT_PATH) {
      const recovered = await recoverThinPlanV2PartialExecuteReviewHandoff({
        rootDir,
        previous: parsedPlan,
        updated,
      });
      if (!recovered.ok) {
        const cleanup = await cleanupReviewStagingPaths(reviewStagingPaths);
        const reason = cleanup.ok
          ? recovered.reason
          : `${recovered.reason}; ${cleanup.reason}`;
        const logResult = await appendIterationLog(reason, updated);
        if (!logResult.ok) {
          return await finishFailure(logResult.reason);
        }
        const snapshotResult = await syncWorkflowSnapshot(updated);
        if (!snapshotResult.ok) {
          return await finishFailure(snapshotResult.reason);
        }
        return await finishFailure(reason);
      }
      if (recovered.recovered) {
        const recoveredPlan = await parsePlan({ planName: planArgument, rootDir });
        if (!recoveredPlan.ok) {
          const logResult = await appendIterationLog(recoveredPlan.reason);
          if (!logResult.ok) {
            return await finishFailure(logResult.reason);
          }
          const snapshotResult = await syncWorkflowSnapshot(parsedPlan);
          if (!snapshotResult.ok) {
            return await finishFailure(snapshotResult.reason);
          }
          return await finishFailure(recoveredPlan.reason);
        }
        const logResult = await appendIterationLog(
          "repaired partial execute-plan review handoff",
          recoveredPlan,
        );
        if (!logResult.ok) {
          return await finishFailure(logResult.reason);
        }
        const snapshotResult = await syncWorkflowSnapshot(recoveredPlan);
        if (!snapshotResult.ok) {
          return await finishFailure(snapshotResult.reason);
        }
        parsedPlan = recoveredPlan;
        continue;
      }
    }

    const nonterminalOutcome = nonterminalRouteOutcome(updated);
    if (nonterminalOutcome) {
      const logResult = await appendIterationLog(undefined, updated);
      if (!logResult.ok) {
        return await finishFailure(logResult.reason);
      }
      const snapshotResult = await syncWorkflowSnapshot(updated);
      if (!snapshotResult.ok) {
        return await finishFailure(snapshotResult.reason);
      }
      return await finishNonterminalRouteOutcome(nonterminalOutcome);
    }

    if (updated.content === previousContent) {
      if (route.promptPath === rel(".ai", "prompts", "execute-plan.md")) {
        const recovered = await recoverThinPlanV2ExecuteHandoff({
          rootDir,
          plan: parsedPlan,
          processRunner,
          stdout: result.stdout,
          timestamp,
        });
        if (!recovered.ok) {
          const logResult = await appendIterationLog(recovered.reason);
          if (!logResult.ok) {
            return await finishFailure(logResult.reason);
          }
          const snapshotResult = await syncWorkflowSnapshot(parsedPlan);
          if (!snapshotResult.ok) {
            return await finishFailure(snapshotResult.reason);
          }
          return await finishFailure(recovered.reason);
        }
        if (recovered.recovered) {
          const recoveredPlan = await parsePlan({
            planName: planArgument,
            rootDir,
          });
          if (!recoveredPlan.ok) {
            const logResult = await appendIterationLog(recoveredPlan.reason);
            if (!logResult.ok) {
              return await finishFailure(logResult.reason);
            }
            const snapshotResult = await syncWorkflowSnapshot(parsedPlan);
            if (!snapshotResult.ok) {
              return await finishFailure(snapshotResult.reason);
            }
            return await finishFailure(recoveredPlan.reason);
          }
          const transition = transitionAllowed(
            route.promptPath,
            parsedPlan,
            recoveredPlan,
          );
          if (!transition.ok) {
            const logResult = await appendIterationLog(
              transition.reason,
              recoveredPlan,
            );
            if (!logResult.ok) {
              return await finishFailure(logResult.reason);
            }
            const snapshotResult = await syncWorkflowSnapshot(recoveredPlan);
            if (!snapshotResult.ok) {
              return await finishFailure(snapshotResult.reason);
            }
            return await finishFailure(transition.reason);
          }
          const logResult = await appendIterationLog(undefined, recoveredPlan);
          if (!logResult.ok) {
            return await finishFailure(logResult.reason);
          }
          const snapshotResult = await syncWorkflowSnapshot(recoveredPlan);
          if (!snapshotResult.ok) {
            return await finishFailure(snapshotResult.reason);
          }
          parsedPlan = recoveredPlan;
          continue;
        }
      }
      const cleanup = await cleanupReviewStagingPaths(reviewStagingPaths);
      const reason = cleanup.ok
        ? "plan content unchanged after successful nonterminal workflow action"
        : `plan content unchanged after successful nonterminal workflow action; ${cleanup.reason}`;
      const logResult = await appendIterationLog(reason);
      if (!logResult.ok) {
        return await finishFailure(logResult.reason);
      }
      const snapshotResult = await syncWorkflowSnapshot(parsedPlan);
      if (!snapshotResult.ok) {
        return await finishFailure(snapshotResult.reason);
      }
      return await finishFailure(reason);
    }

    const transition = transitionAllowed(route.promptPath, parsedPlan, updated);
    if (!transition.ok) {
      const cleanup = await cleanupReviewStagingPaths(reviewStagingPaths);
      const reason = cleanup.ok
        ? transition.reason
        : `${transition.reason}; ${cleanup.reason}`;
      const logResult = await appendIterationLog(reason);
      if (!logResult.ok) {
        return await finishFailure(logResult.reason);
      }
      const snapshotResult = await syncWorkflowSnapshot(updated);
      if (!snapshotResult.ok) {
        return await finishFailure(snapshotResult.reason);
      }
      return await finishFailure(reason);
    }

    if (
      isReviewPrompt(route.promptPath) &&
      updated.workflowState === "active"
    ) {
      const cleanup = await cleanupReviewStagingPaths(reviewStagingPaths);
      if (!cleanup.ok) {
        const logResult = await appendIterationLog(cleanup.reason);
        if (!logResult.ok) {
          return await finishFailure(logResult.reason);
        }
        const snapshotResult = await syncWorkflowSnapshot(updated);
        if (!snapshotResult.ok) {
          return await finishFailure(snapshotResult.reason);
        }
        return await finishFailure(cleanup.reason);
      }
      carriedReviewStagingPaths = undefined;
      carriedReviewStagingProcess = undefined;
      const logResult = await appendIterationLog(undefined, updated);
      if (!logResult.ok) {
        return await finishFailure(logResult.reason);
      }
      const snapshotResult = await syncWorkflowSnapshot(updated);
      if (!snapshotResult.ok) {
        return await finishFailure(snapshotResult.reason);
      }
      parsedPlan = updated;
      continue;
    }

    const logResult = await appendIterationLog(undefined, updated);
    if (!logResult.ok) {
      return await finishFailure(logResult.reason);
    }
    const snapshotResult = await syncWorkflowSnapshot(updated);
    if (!snapshotResult.ok) {
      return await finishFailure(snapshotResult.reason);
    }

    parsedPlan = updated;
  }
};
