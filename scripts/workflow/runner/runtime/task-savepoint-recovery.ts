import { COMMIT_SUMMARY_PROMPT_PATH } from "../../contracts/stage.ts";
import { hasArtifactOnlyNoCommitReview } from "./artifact-only-review.ts";
import {
  extractCommitSummarySubject,
  readCompletedTaskSavepoints,
} from "../tasks/summaries.ts";
import { parseCommitSummaryPathsForPlan } from "../review/commit.ts";
import { parsePlan } from "../plan/state.ts";
import { reopenPlanForNextTask } from "./task-recovery.ts";
import {
  nextTaskAfter,
  nextTaskArtifactRelativePath,
  readHeadTaskCommit,
  readTaskCommitRecoveryParent,
  writeTaskArtifact,
  writeCurrentTaskPointer,
} from "../tasks/savepoints.ts";
import type {
  ParsedPlan,
  PlanTask,
  ProcessRunner,
  TaskStage,
  WorkflowTaskContext,
} from "../types.ts";

export const recoverTaskSavepoint = async ({
  rootDir,
  plan,
  planArgument,
  planTasks,
  taskSavepointMode,
  selectedTask,
  selectedTaskArtifactPath,
  selectedTaskStage,
  completedTaskCommits,
  promptPath,
  currentTaskContext,
  isIgnored,
  processRunner,
}: {
  rootDir: string;
  plan: ParsedPlan;
  planArgument: string | undefined;
  planTasks: PlanTask[];
  taskSavepointMode: boolean;
  selectedTask?: PlanTask;
  selectedTaskArtifactPath?: string;
  selectedTaskStage?: TaskStage;
  completedTaskCommits: number;
  promptPath: string;
  currentTaskContext?: WorkflowTaskContext;
  isIgnored?: (relativePath: string) => boolean;
  processRunner: ProcessRunner;
}): Promise<
  | { kind: "none" }
  | { kind: "continue"; plan: ParsedPlan }
  | { kind: "failure"; reason: string }
> => {
  if (
    taskSavepointMode &&
    plan.workflowState === "completed" &&
    selectedTask &&
    selectedTaskArtifactPath
  ) {
    const noCommit = await hasArtifactOnlyNoCommitReview({ rootDir, plan });
    if (!noCommit.ok) {
      return { kind: "failure", reason: noCommit.reason };
    }
    if (noCommit.noCommit) {
      const nextTask = await nextTaskAfter(
        rootDir,
        plan.planName,
        planTasks,
        selectedTask,
      );
      const artifact = await writeTaskArtifact({
        rootDir,
        planPath: plan.planPath,
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
        return { kind: "failure", reason: artifact.reason };
      }
      const pointer = await writeCurrentTaskPointer({
        rootDir,
        planName: plan.planName,
        planPath: plan.planPath,
        context: {
          task: selectedTask,
          stage: "committed",
          artifactPath: selectedTaskArtifactPath,
          commitSha: "no-commit",
        },
        timestamp: new Date().toISOString(),
      });
      if (!pointer.ok) {
        return { kind: "failure", reason: pointer.reason };
      }
      const reopened = await reopenPlanForNextTask(plan);
      if (!reopened.ok) {
        return { kind: "failure", reason: reopened.reason };
      }
      const nextPlan = await parsePlan({ planName: planArgument, rootDir });
      return nextPlan.ok
        ? { kind: "continue", plan: nextPlan }
        : { kind: "failure", reason: nextPlan.reason };
    }
  }

  if (
    taskSavepointMode &&
    promptPath === COMMIT_SUMMARY_PROMPT_PATH &&
    selectedTask &&
    !currentTaskContext
  ) {
    const recoveryParent = await readTaskCommitRecoveryParent({
      rootDir,
      plan,
    });
    if (!recoveryParent.ok) {
      return { kind: "failure", reason: recoveryParent.reason };
    }
    const completedTaskArtifacts = await readCompletedTaskSavepoints({
      rootDir,
      planName: plan.planName,
      tasks: planTasks,
    });
    if (!completedTaskArtifacts.ok) {
      return { kind: "failure", reason: completedTaskArtifacts.reason };
    }
    const recoveredCommit = await readHeadTaskCommit({
      rootDir,
      planName: plan.planName,
      planPath: plan.planPath,
      task: selectedTask,
      expectedParentSha: recoveryParent.headSha,
      recordedCommitShas: completedTaskArtifacts.completedTasks.map(
        ({ commitSha }) => commitSha,
      ),
      processRunner,
    });
    if (!recoveredCommit.ok) {
      return { kind: "failure", reason: recoveredCommit.reason };
    }
    if (recoveredCommit.commit) {
      const paths = await parseCommitSummaryPathsForPlan(rootDir, plan, isIgnored);
      if (!paths.ok) {
        return {
          kind: "failure",
          reason: `commit summary file scope invalid: ${paths.reason}`,
        };
      }
      const artifactPath = await nextTaskArtifactRelativePath(
        rootDir,
        plan.planName,
        selectedTask,
      );
      const nextTask = await nextTaskAfter(
        rootDir,
        plan.planName,
        planTasks,
        selectedTask,
      );
      const artifact = await writeTaskArtifact({
        rootDir,
        planPath: plan.planPath,
        context: {
          task: selectedTask,
          stage: "committed",
          artifactPath,
          commitSha: recoveredCommit.commit.sha.slice(0, 9),
        },
        changedFiles: paths.paths,
        summaryLines: [
          "Recovered the task savepoint artifact from the existing local commit.",
        ],
        validationSummary: "Recovered from existing task commit metadata.",
        reviewResult: "Recovered after commit-summary artifact interruption.",
        commitMessage: extractCommitSummarySubject(
          recoveredCommit.commit.message,
          selectedTask.name,
        ),
        nextTask,
      });
      if (!artifact.ok) {
        return { kind: "failure", reason: artifact.reason };
      }
      const pointer = await writeCurrentTaskPointer({
        rootDir,
        planName: plan.planName,
        planPath: plan.planPath,
        context: {
          task: selectedTask,
          stage: "committed",
          artifactPath,
          commitSha: recoveredCommit.commit.sha.slice(0, 9),
        },
        timestamp: new Date().toISOString(),
      });
      if (!pointer.ok) {
        return { kind: "failure", reason: pointer.reason };
      }
      if (!nextTask) {
        return { kind: "continue", plan };
      }
      const reopened = await reopenPlanForNextTask(plan);
      if (!reopened.ok) {
        return { kind: "failure", reason: reopened.reason };
      }
      const nextPlan = await parsePlan({ planName: planArgument, rootDir });
      return nextPlan.ok
        ? { kind: "continue", plan: nextPlan }
        : { kind: "failure", reason: nextPlan.reason };
    }
  }

  if (
    taskSavepointMode &&
    promptPath === COMMIT_SUMMARY_PROMPT_PATH &&
    selectedTask &&
    completedTaskCommits > 0 &&
    !selectedTaskStage &&
    !currentTaskContext
  ) {
    const reopened = await reopenPlanForNextTask(plan);
    if (!reopened.ok) {
      return { kind: "failure", reason: reopened.reason };
    }
    const nextPlan = await parsePlan({ planName: planArgument, rootDir });
    return nextPlan.ok
      ? { kind: "continue", plan: nextPlan }
      : { kind: "failure", reason: nextPlan.reason };
  }
  return { kind: "none" };
};
