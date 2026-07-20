import { formatTaskProgressLine } from "../tasks/savepoints.ts";
import {
  writeCurrentTaskPointer,
  writeTaskStageArtifact,
} from "../tasks/savepoints.ts";
import type {
  ConsoleLike,
  Failure,
  PlanTask,
  TaskStage,
  WorkflowTaskContext,
} from "../types.ts";

export const createTaskProgress = ({
  rootDir,
  planName,
  planPath,
  task,
  artifactPath,
  taskPosition,
  taskTotal,
  completedTasks,
  boundaryTotal,
  logger,
  streamOutput,
  timestamp,
}: {
  rootDir: string;
  planName: string;
  planPath: string;
  task?: PlanTask;
  artifactPath?: string;
  taskPosition: number;
  taskTotal: number;
  completedTasks: number;
  boundaryTotal?: number;
  logger: ConsoleLike;
  streamOutput: boolean;
  timestamp: () => string;
}) => {
  let context: WorkflowTaskContext | undefined;
  const emit = ({ stage, detail }: { stage: TaskStage; detail: string }) => {
    if (!task) {
      return;
    }
    const progress = formatTaskProgressLine({
      task,
      stage,
      detail,
      taskPosition,
      taskTotal,
      completedTasks,
      boundaryTotal,
    });
    logger.log(streamOutput ? `${progress}\n` : progress);
  };
  const setStage = async ({
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
    if (!task || !artifactPath) {
      context = undefined;
      return { ok: true };
    }
    context = { task, stage, artifactPath, commitSha };
    const artifact = await writeTaskStageArtifact({ rootDir, planPath, context });
    if (!artifact.ok) {
      return artifact;
    }
    const pointer = await writeCurrentTaskPointer({
      rootDir,
      planName,
      planPath,
      context,
      timestamp: timestamp(),
    });
    if (!pointer.ok) {
      return pointer;
    }
    if (logProgress) {
      emit({ stage, detail });
    }
    return { ok: true };
  };
  return { emit, setStage, context: () => context };
};
