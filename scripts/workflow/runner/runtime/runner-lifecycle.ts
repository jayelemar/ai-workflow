import {
  parseRunnerCliArgs,
} from "../cli.ts";
import {
  readThinPlanFileOwnershipPreflight,
  refreshAndCheckFileOwnershipArtifact,
} from "../../ownership/file-ownership.ts";
import {
  parseContextUsage,
  unavailableContextUsage,
} from "../../telemetry/token-usage.ts";
export { analyzeTokenUsageLedger } from "../../telemetry/token-ledger.ts";
import {
  codexExecutionConfig,
  WORKFLOW_RUNNER_CODEX_PROFILE,
} from "../../config/codex.ts";
import { COMMIT_SUMMARY_PROMPT_PATH } from "../../contracts/stage.ts";
import { createWorkflowRunnerCodexRuntime, defaultProcessRunner, isValidCodexProfile } from "../process.ts";
import { classifyFailureForLog, codexOutputStopReason, createWorkflowFailureDebugRecord } from "../terminal/codex-events.ts";
import { formatCommitProgressLine, formatWorkflowElapsedTime, formatWorkflowProgressLine, supportsWorkflowAnsiColor } from "../terminal/formatters.ts";
import { parsePlanTasks, parseTaskCommitBoundaries, taskCommitBoundaryCount, validateTaskCommitBoundaries } from "../plan/parser.ts";
import { writeWorkflowContextSnapshot } from "../plan/context-snapshot.ts";
import { generateWorkflowPrompt, isReviewPrompt, readPrompt } from "../plan/prompt.ts";
import { parsePlan, preflightManualPlanExecutionMode, repairThinPlanManifestStateFromWorkflow } from "../plan/state.ts";
import { completedTaskCommitCount, currentTaskArtifactRelativePath, nextIncompleteTask, nextTaskAfter, readableTaskLabel, readableTaskProgressDescription, readTaskArtifactStage, writeTaskArtifact } from "../tasks/savepoints.ts";
import { hasCompletedTaskAggregateSummary } from "../tasks/summaries.ts";
import { parseCommitSummaryPathsForPlan, readDirtyPlanOwnedPaths } from "../review/commit.ts";
import { checkForPreReviewStagedWork, runReviewStagingForPaths, runReviewUnstageForPaths } from "../review/staging.ts";
import { routeFor } from "../transitions.ts";
import { workflowBranch, workflowHeadSha } from "./preflight.ts";
import { appendLog } from "./logging.ts";
import { createZeroTokenUsageTotals } from "./telemetry.ts";
import { appendFailureDebugLedger, readLatestTokenUsage, readTokenUsageTotals, readWorkflowTokenGuardrail, tokenUsageLedgerRelativePath } from "./records.ts";
import { blockedPlanDetail } from "./outcomes.ts";
import { executeWorkflowIteration } from "./iteration-execution.ts";
import { defaultConsole, failure, MAX_WORKFLOW_ITERATIONS, success, type RunWorkflowOptions, WORKFLOW_RUNNER_USAGE } from "./lifecycle.ts";
import { createWorkflowOutcomeReporter } from "./outcome-reporter.ts";
import { workflowIterationLogFields } from "./log-fields.ts";
import {
  completeArtifactOnlyNoCommitReview,
  hasArtifactOnlyNoCommitReview,
  isArtifactOnlyNoCommitReview,
} from "./artifact-only-review.ts";
import { prepareReviewScopeForPaths } from "./review-scope.ts";
import { prepareFreshReviewStaging } from "./review-staging-phase.ts";
import { handleTerminalStage } from "./terminal-stage.ts";
import { handleStoppedIteration } from "./stopped-iteration.ts";
import { handleSuccessfulNonterminalIteration } from "./successful-iteration.ts";
import { appendWorkflowIterationRecord } from "./iteration-recorder.ts";
import { createTaskProgress } from "./task-progress.ts";
import { recoverTaskSavepoint } from "./task-savepoint-recovery.ts";
import { resolveReviewStagingPaths } from "./review-staging-paths.ts";
import type { CommitProgress, Failure, FileOwnershipPreflight, ParsedPlan, ReviewCleanupProcess, ReviewScopeMetadata, ReviewStagingProcess, RunnerResult, TaskStage, WorkflowContextSnapshotResult, WorkflowTaskContext } from "../types.ts";

const rel = (...segments: string[]) => segments.join("/");

export const runWorkflowRunnerLifecycle = async (
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
  const reporter = createWorkflowOutcomeReporter({
    logger,
    now,
    startedAt: runStartedAt,
    workflowLogPath: () => workflowLogPath,
    tokenUsageLogPath: () => tokenUsageLogPath,
    failureDebugPath: () => latestFailureDebugPath,
  });
  const finishFailure = (
    reason: string,
    completedIterations = iterations,
    exitCode = 1,
  ) => reporter.finishFailure(reason, completedIterations, exitCode);
  const finishSuccess = (reason: string, completedIterations: number) =>
    reporter.finishSuccess(reason, completedIterations);
  const finishBlocked = (
    reason: string,
    detail: string,
    planPath: string,
    completedIterations = iterations,
  ) => reporter.finishBlocked(reason, detail, planPath, completedIterations);
  const manualPlanPreflight = await preflightManualPlanExecutionMode({
    planName: planArgument,
    rootDir,
  });
  if (!manualPlanPreflight.ok) {
    return await finishFailure(manualPlanPreflight.reason);
  }
  const currentBranch = await workflowBranch(rootDir, processRunner);
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
    const taskRecovery = await recoverTaskSavepoint({
      rootDir,
      plan: parsedPlan,
      planArgument,
      planTasks,
      taskSavepointMode,
      selectedTask,
      selectedTaskArtifactPath,
      selectedTaskStage,
      completedTaskCommits,
      promptPath: route.promptPath,
      currentTaskContext,
      isIgnored: options.isIgnored,
      processRunner,
    });
    if (taskRecovery.kind === "failure") {
      return await finishFailure(taskRecovery.reason);
    }
    if (taskRecovery.kind === "continue") {
      parsedPlan = taskRecovery.plan;
      continue;
    }
    if (taskSavepointAggregateSummary) {
      const aggregateSummary = await hasCompletedTaskAggregateSummary({
        rootDir,
        planName: parsedPlan.planName,
        taskCount: planTasks.length,
      });
      if (!aggregateSummary.ok) {
        return await finishFailure(aggregateSummary.reason);
      }
      if (aggregateSummary.completed) {
        iterations = nextIteration;
        logger.log(
          formatWorkflowProgressLine({
            iteration: iterations,
            maxIterations: MAX_WORKFLOW_ITERATIONS,
            workflowState: parsedPlan.workflowState,
            promptPath: route.promptPath,
            stageLabel: "FINAL SUMMARY",
            model: executionConfig.model,
            reasoning: executionConfig.reasoning,
            color: colorOutput,
          }),
        );
        logger.log(
          streamOutput
            ? `${formatCommitProgressLine(commitProgress!)}\n`
            : formatCommitProgressLine(commitProgress!),
        );
        const snapshotResult = await syncWorkflowSnapshot(parsedPlan);
        if (!snapshotResult.ok) {
          return await finishFailure(snapshotResult.reason);
        }
        markWorkflowLogCreated(parsedPlan.planName);
        markTokenUsageLogCreated(parsedPlan.planName);
        return await finishSuccess(
          "completed task savepoint aggregate summary already recorded",
          iterations,
        );
      }
    }
    if (!selectedTask) {
      currentTaskContext = undefined;
    }
    let deferredTaskProgress:
      | { stage: TaskStage; detail: string }
      | undefined;
    const taskProgress = createTaskProgress({
      rootDir,
      planName: parsedPlan.planName,
      planPath: parsedPlan.planPath,
      task: selectedTask,
      artifactPath: selectedTaskArtifactPath,
      taskPosition: completedTaskCommits + 1,
      taskTotal: planTasks.length,
      completedTasks: completedTaskCommits,
      boundaryTotal: taskCommitBoundaryTotal,
      logger,
      streamOutput,
      timestamp,
    });
    const emitTaskProgress = taskProgress.emit;
    const setTaskStage = async (input: {
      stage: TaskStage;
      detail: string;
      commitSha?: string;
      logProgress?: boolean;
    }): Promise<{ ok: true } | Failure> => {
      const stage = await taskProgress.setStage(input);
      currentTaskContext = taskProgress.context();
      return stage;
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
        workflowIterationLogFields({
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
          stageLabel: taskSavepointAggregateSummary
            ? "FINAL SUMMARY"
            : undefined,
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
        parsedPlan.thinPlanContract === "thin-plan"
          ? await readThinPlanFileOwnershipPreflight({
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
        const parsedPaths = await resolveReviewStagingPaths({
          rootDir,
          planContent: parsedPlan.content,
          ownershipPreflight: fileOwnershipPreflight,
          isIgnored: options.isIgnored,
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
            workflowIterationLogFields({
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
            workflowIterationLogFields({
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
            workflowIterationLogFields({
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
        const scope = await prepareReviewScopeForPaths({
          codexRuntime,
          rootDir,
          planPath: parsedPlan.planPath,
          planContent: parsedPlan.content,
          paths: staged.paths,
          processRunner,
          narrowPass: reviewNarrowPass,
          autoNarrowReason: reviewAutoNarrowReason,
        });
        if (!scope.ok) {
          const cleanup = await cleanupReviewStagingPaths(staged.paths);
          const stopReason = cleanup.ok
            ? scope.reason
            : `${scope.reason}; ${cleanup.reason}`;
          return await finishFailure(stopReason);
        }
        reviewNarrowPass = scope.scope.narrowPass;
        reviewAutoNarrowReason = scope.scope.autoNarrowReason;
        reviewScopeMetadata = scope.scope;
        staging = staged.staging;
        reviewStagingPaths = staged.paths;
      } else {
        if (
          !carriedReviewStagingPaths ||
          carriedReviewStagingPaths.length === 0
        ) {
          const parsedPaths = await resolveReviewStagingPaths({
            rootDir,
            planContent: parsedPlan.content,
            ownershipPreflight: fileOwnershipPreflight,
            isIgnored: options.isIgnored,
          });
          if (!parsedPaths.ok) {
            return await finishFailure(parsedPaths.reason);
          }
          const prepared = await prepareFreshReviewStaging({
            codexRuntime,
            rootDir,
            planPath: parsedPlan.planPath,
            planContent: parsedPlan.content,
            paths: parsedPaths.paths,
            processRunner,
            narrowPass: reviewNarrowPass,
            autoNarrowReason: reviewAutoNarrowReason,
            selectedTask,
            setTaskStage,
            logWorkflowProgress,
            logger,
            qualityReview: true,
          });
          if (!prepared.ok) {
            const cleanup = await cleanupReviewStagingPaths(prepared.paths);
            const stopReason = cleanup.ok
              ? prepared.reason
              : `${prepared.reason}; ${cleanup.reason}`;
            return await finishFailure(stopReason);
          }
          reviewNarrowPass = prepared.scope.narrowPass;
          reviewAutoNarrowReason = prepared.scope.autoNarrowReason;
          reviewScopeMetadata = prepared.scope;
          reviewStagingPaths = prepared.paths;
          staging = prepared.staging;
        } else {
          logWorkflowProgress();
          reviewStagingPaths = carriedReviewStagingPaths;
          staging = carriedReviewStagingProcess;
          const scope = await prepareReviewScopeForPaths({
            codexRuntime,
            rootDir,
            planPath: parsedPlan.planPath,
            planContent: parsedPlan.content,
            paths: reviewStagingPaths,
            processRunner,
            narrowPass: reviewNarrowPass,
            autoNarrowReason: reviewAutoNarrowReason,
          });
          if (!scope.ok) {
            return await finishFailure(scope.reason);
          }
          reviewNarrowPass = scope.scope.narrowPass;
          reviewAutoNarrowReason = scope.scope.autoNarrowReason;
          reviewScopeMetadata = scope.scope;
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
        workflowIterationLogFields({
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
      const record = await appendWorkflowIterationRecord({
        rootDir,
        plan: parsedPlan,
        endingPlan,
        promptPath: route.promptPath,
        iteration: iterations,
        timestamp,
        durationMs,
        result,
        executionConfig: effectiveExecutionConfig,
        contextUsage,
        editedFiles,
        stopReason: iterationStopReason,
        interruptSignal,
        staging,
        reviewCleanup,
        taskContext: currentTaskContext,
        currentBranch,
        startingHeadSha,
        processRunner,
        commitProgress,
        reviewScope: reviewScopeMetadata,
        tokenUsageTotals,
        emitWorkflowThresholdWarnings,
      });
      if (!record.ok) {
        return record;
      }
      tokenUsageTotals = record.tokenUsageTotals;
      if (record.failureDebugPath) {
        latestFailureDebugPath = record.failureDebugPath;
      }
      if (record.workflowLogCreated) {
        markWorkflowLogCreated(parsedPlan.planName);
      }
      if (record.tokenUsageLogCreated) {
        markTokenUsageLogCreated(parsedPlan.planName);
      }
      return { ok: true };
    };

    if (result.launched && result.exitCode === 0 && !interruptSignal) {
      const manifestRepair = await repairThinPlanManifestStateFromWorkflow({
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
      const stoppedOutcome = await handleStoppedIteration({
        rootDir,
        planArgument,
        plan: parsedPlan,
        promptPath: route.promptPath,
        stopReason,
        iterations,
        interruptSignal,
        appendIterationLog,
        syncWorkflowSnapshot,
        cleanupReviewStagingPaths: () =>
          cleanupReviewStagingPaths(reviewStagingPaths),
        cleanupCommitSummaryPaths: () =>
          cleanupCommitSummaryPaths(commitSummaryPaths),
        emitWorkflowThresholdWarnings,
        nonterminalRouteOutcome,
        finishNonterminalRouteOutcome,
        finishFailure,
      });
      if (stoppedOutcome.kind === "continue") {
        if (stoppedOutcome.clearCarriedReviewStaging) {
          carriedReviewStagingPaths = undefined;
          carriedReviewStagingProcess = undefined;
        }
        parsedPlan = stoppedOutcome.plan;
        continue;
      }
      return stoppedOutcome.result;
    }
    if (route.terminal) {
      const terminalOutcome = await handleTerminalStage({
        rootDir,
        planArgument,
        plan: parsedPlan,
        planTasks,
        selectedTask,
        commitSummaryPaths,
        taskSavepointAggregateSummary,
        completedTaskCommits,
        taskCommitBoundaryTotal,
        iterations,
        processRunner,
        stdout: result.stdout,
        logger,
        streamOutput,
        currentTaskContext: () => currentTaskContext,
        setTaskStage,
        appendIterationLog,
        syncWorkflowSnapshot,
        cleanupCommitSummaryPaths: () =>
          cleanupCommitSummaryPaths(commitSummaryPaths),
        finishFailure,
        finishSuccess,
      });
      if (terminalOutcome.kind === "continue") {
        parsedPlan = terminalOutcome.plan;
        continue;
      }
      return terminalOutcome.result;
    }
    const successfulOutcome = await handleSuccessfulNonterminalIteration({
      rootDir,
      planArgument,
      plan: parsedPlan,
      promptPath: route.promptPath,
      stdout: result.stdout,
      timestamp,
      processRunner,
      appendIterationLog,
      syncWorkflowSnapshot,
      cleanupReviewStagingPaths: () =>
        cleanupReviewStagingPaths(reviewStagingPaths),
      emitWorkflowThresholdWarnings,
      nonterminalRouteOutcome,
      finishNonterminalRouteOutcome,
      finishFailure,
    });
    if (successfulOutcome.kind === "continue") {
      if (successfulOutcome.clearCarriedReviewStaging) {
        carriedReviewStagingPaths = undefined;
        carriedReviewStagingProcess = undefined;
      }
      parsedPlan = successfulOutcome.plan;
      continue;
    }
    return successfulOutcome.result;
  }
};
