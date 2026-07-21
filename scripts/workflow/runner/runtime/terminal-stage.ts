import { readFile } from "node:fs/promises";

import {
  nextIncompleteTask,
  readableTaskLabel,
  writeTaskArtifact,
  writeCurrentTaskPointer,
} from "../tasks/savepoints.ts";
import {
  extractCommitSummarySubject,
  extractSummaryLines,
  readCompletedTaskSavepoints,
  writeBossSummary,
  writeExecutionSummary,
} from "../tasks/summaries.ts";
import { verifyCommitSummaryPathsClean } from "../review/commit.ts";
import { parsePlan } from "../plan/state.ts";
import { formatTaskCompletedProgressLine } from "../terminal/formatters.ts";
import type {
  Failure,
  ParsedPlan,
  PlanTask,
  ProcessRunner,
  RunnerResult,
  TaskStage,
  WorkflowContextSnapshotResult,
  WorkflowTaskContext,
} from "../types.ts";
import { gitHeadShortSha, reopenPlanForNextTask } from "./task-recovery.ts";

type TerminalStageOutcome =
  | { kind: "continue"; plan: ParsedPlan }
  | { kind: "finish"; result: RunnerResult };

export const handleTerminalStage = async ({
  rootDir,
  planArgument,
  plan,
  planTasks,
  selectedTask,
  commitSummaryPaths,
  taskSavepointAggregateSummary,
  completedTaskCommits,
  taskCommitBoundaryTotal,
  iterations,
  processRunner,
  stdout,
  logger,
  streamOutput,
  currentTaskContext,
  setTaskStage,
  appendIterationLog,
  syncWorkflowSnapshot,
  cleanupCommitSummaryPaths,
  finishFailure,
  finishSuccess,
}: {
  rootDir: string;
  planArgument: string;
  plan: ParsedPlan;
  planTasks: PlanTask[];
  selectedTask?: PlanTask;
  commitSummaryPaths?: string[];
  taskSavepointAggregateSummary: boolean;
  completedTaskCommits: number;
  taskCommitBoundaryTotal?: number;
  iterations: number;
  processRunner: ProcessRunner;
  stdout: string;
  logger: { log: (message: string) => void };
  streamOutput: boolean;
  currentTaskContext: () => WorkflowTaskContext | undefined;
  setTaskStage: (input: {
    stage: TaskStage;
    detail: string;
    commitSha?: string;
    logProgress?: boolean;
  }) => Promise<{ ok: true } | Failure>;
  appendIterationLog: (
    stopReason?: string,
  ) => Promise<{ ok: true } | Failure>;
  syncWorkflowSnapshot: (
    plan: ParsedPlan,
  ) => Promise<WorkflowContextSnapshotResult | Failure>;
  cleanupCommitSummaryPaths: () => Promise<{ ok: true } | Failure>;
  finishFailure: (reason: string) => Promise<RunnerResult>;
  finishSuccess: (reason: string, iterations: number) => Promise<RunnerResult>;
}): Promise<TerminalStageOutcome> => {
  const finish = async (result: RunnerResult): Promise<TerminalStageOutcome> => ({
    kind: "finish",
    result,
  });
  const cleanCheck = await verifyCommitSummaryPathsClean(
    rootDir,
    commitSummaryPaths ?? [],
    processRunner,
  );
  if (!cleanCheck.ok) {
    const unstage = await cleanupCommitSummaryPaths();
    if (!unstage.ok) {
      return await finish(
        await finishFailure(`${cleanCheck.reason}; ${unstage.reason}`),
      );
    }
    const logResult = await appendIterationLog(cleanCheck.reason);
    if (!logResult.ok) {
      return await finish(await finishFailure(logResult.reason));
    }
    const snapshotResult = await syncWorkflowSnapshot(plan);
    if (!snapshotResult.ok) {
      return await finish(await finishFailure(snapshotResult.reason));
    }
    return await finish(await finishFailure(cleanCheck.reason));
  }
  if (selectedTask && currentTaskContext()) {
    const shaResult = await gitHeadShortSha(rootDir, processRunner);
    if (!shaResult.ok) {
      const logResult = await appendIterationLog();
      if (!logResult.ok) {
        return await finish(await finishFailure(logResult.reason));
      }
      const snapshotResult = await syncWorkflowSnapshot(plan);
      if (!snapshotResult.ok) {
        return await finish(await finishFailure(snapshotResult.reason));
      }
      return await finish(await finishFailure(shaResult.reason));
    }
    const taskStage = await setTaskStage({
      stage: "committed",
      detail: shaResult.sha,
      commitSha: shaResult.sha,
      logProgress: false,
    });
    if (!taskStage.ok) {
      return await finish(await finishFailure(taskStage.reason));
    }
  }
  const logResult = await appendIterationLog();
  if (!logResult.ok) {
    return await finish(await finishFailure(logResult.reason));
  }
  const taskContext = currentTaskContext();
  if (selectedTask && taskContext) {
    const nextTask = await nextIncompleteTask(
      rootDir,
      plan.planName,
      planTasks.filter((task) => task.id !== selectedTask.id),
    );
    const artifact = await writeTaskArtifact({
      rootDir,
      planPath: plan.planPath,
      context: taskContext,
      changedFiles: commitSummaryPaths ?? [],
      summaryLines: extractSummaryLines(stdout, selectedTask.name),
      validationSummary: "See plan validation history and commit-summary stage output.",
      reviewResult: "Review accepted task for commit-summary.",
      commitMessage: extractCommitSummarySubject(stdout, selectedTask.name),
      nextTask,
    });
    if (!artifact.ok) {
      return await finish(await finishFailure(artifact.reason));
    }
    const completedTaskArtifacts = await readCompletedTaskSavepoints({
      rootDir,
      planName: plan.planName,
      tasks: planTasks,
    });
    if (!completedTaskArtifacts.ok) {
      return await finish(await finishFailure(completedTaskArtifacts.reason));
    }
    const executionSummary = await writeExecutionSummary({
      rootDir,
      planName: plan.planName,
      planPath: plan.planPath,
      tasks: planTasks,
      completedTasks: completedTaskArtifacts.completedTasks,
      finalStatus: "in-progress",
    });
    if (!executionSummary.ok) {
      return await finish(await finishFailure(executionSummary.reason));
    }
    const bossSummary = await writeBossSummary({
      rootDir,
      planName: plan.planName,
      tasks: planTasks,
      completedTasks: completedTaskArtifacts.completedTasks,
      finalStatus: "in-progress",
    });
    if (!bossSummary.ok) {
      return await finish(await finishFailure(bossSummary.reason));
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
      plan.planName,
      planTasks,
    );
    if (remainingTask) {
      const reopened = await reopenPlanForNextTask(plan);
      if (!reopened.ok) {
        return await finish(await finishFailure(reopened.reason));
      }
      const nextParsed = await parsePlan({ planName: planArgument, rootDir });
      if (!nextParsed.ok) {
        return await finish(await finishFailure(nextParsed.reason));
      }
      return { kind: "continue", plan: nextParsed };
    }
    return {
      kind: "continue",
      plan: {
        ...plan,
        content: await readFile(plan.absolutePlanPath, "utf8"),
      },
    };
  }
  if (taskSavepointAggregateSummary) {
    const completedTaskArtifacts = await readCompletedTaskSavepoints({
      rootDir,
      planName: plan.planName,
      tasks: planTasks,
    });
    if (!completedTaskArtifacts.ok) {
      return await finish(await finishFailure(completedTaskArtifacts.reason));
    }
    const executionSummary = await writeExecutionSummary({
      rootDir,
      planName: plan.planName,
      planPath: plan.planPath,
      tasks: planTasks,
      completedTasks: completedTaskArtifacts.completedTasks,
      finalStatus: "completed",
    });
    if (!executionSummary.ok) {
      return await finish(await finishFailure(executionSummary.reason));
    }
    const bossSummary = await writeBossSummary({
      rootDir,
      planName: plan.planName,
      tasks: planTasks,
      completedTasks: completedTaskArtifacts.completedTasks,
      finalStatus: "completed",
    });
    if (!bossSummary.ok) {
      return await finish(await finishFailure(bossSummary.reason));
    }
    const finalTask = planTasks.at(-1);
    const finalSavepoint = completedTaskArtifacts.completedTasks.find(
      ({ task }) => task.id === finalTask?.id,
    );
    if (!finalTask || !finalSavepoint) {
      return await finish(
        await finishFailure("final task savepoint is missing after aggregate summary"),
      );
    }
    const pointer = await writeCurrentTaskPointer({
      rootDir,
      planName: plan.planName,
      planPath: plan.planPath,
      context: {
        task: finalTask,
        stage: "committed",
        artifactPath: finalSavepoint.artifactPath,
        commitSha: finalSavepoint.commitSha,
      },
      timestamp: new Date().toISOString(),
    });
    if (!pointer.ok) {
      return await finish(await finishFailure(pointer.reason));
    }
  }
  const snapshotResult = await syncWorkflowSnapshot(plan);
  if (!snapshotResult.ok) {
    return await finish(await finishFailure(snapshotResult.reason));
  }
  return await finish(
    await finishSuccess("completed + commit-summary finished", iterations),
  );
};
