import { runReviewStagingForPaths } from "../review/staging.ts";
import type {
  Failure,
  PlanTask,
  ProcessRunner,
  ReviewScopeMetadata,
  ReviewStagingProcess,
  TaskStage,
  WorkflowRunnerCodexRuntime,
} from "../types.ts";
import { prepareReviewScopeForPaths } from "./review-scope.ts";

type PreparedReviewStaging =
  | {
      ok: true;
      paths: string[];
      staging: ReviewStagingProcess;
      scope: ReviewScopeMetadata;
    }
  | {
      ok: false;
      reason: string;
      kind: "staging" | "scope";
      paths: string[];
      staging?: ReviewStagingProcess;
    };

export const prepareFreshReviewStaging = async ({
  codexRuntime,
  rootDir,
  planPath,
  planContent,
  paths,
  processRunner,
  narrowPass,
  autoNarrowReason,
  selectedTask,
  setTaskStage,
  logWorkflowProgress,
  logger,
  qualityReview,
}: {
  codexRuntime: WorkflowRunnerCodexRuntime;
  rootDir: string;
  planPath: string;
  planContent: string;
  paths: string[];
  processRunner: ProcessRunner;
  narrowPass: number;
  autoNarrowReason?: string;
  selectedTask?: PlanTask;
  setTaskStage: (input: {
    stage: TaskStage;
    detail: string;
  }) => Promise<{ ok: true } | Failure>;
  logWorkflowProgress: () => void;
  logger: { log: (message: string) => void };
  qualityReview: boolean;
}): Promise<PreparedReviewStaging> => {
  logWorkflowProgress();
  if (selectedTask) {
    const taskStage = await setTaskStage({
      stage: "reviewing",
      detail: `staged ${paths.length} ${paths.length === 1 ? "file" : "files"}`,
    });
    if (!taskStage.ok) {
      return {
        ok: false,
        reason: taskStage.reason,
        kind: "scope",
        paths,
      };
    }
  } else {
    logger.log(
      `Staging ${paths.length} plan-owned ${
        paths.length === 1 ? "file" : "files"
      } for ${qualityReview ? "quality review" : "review"}...`,
    );
  }
  const staged = await runReviewStagingForPaths(rootDir, paths, processRunner);
  if (!staged.ok) {
    return {
      ok: false,
      reason: staged.reason,
      kind: "staging",
      paths,
      staging: staged.staging,
    };
  }
  const scope = await prepareReviewScopeForPaths({
    codexRuntime,
    rootDir,
    planPath,
    planContent,
    paths: staged.paths,
    processRunner,
    narrowPass,
    autoNarrowReason,
  });
  if (!scope.ok) {
    return {
      ok: false,
      reason: scope.reason,
      kind: "scope",
      paths: staged.paths,
      staging: staged.staging,
    };
  }
  return {
    ok: true,
    paths: staged.paths,
    staging: staged.staging,
    scope: scope.scope,
  };
};
