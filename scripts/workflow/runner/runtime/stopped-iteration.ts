import {
  rollbackStageDescriptor,
  type RunnerStageDescriptor,
} from "./stage-finalization.ts";
import type {
  Failure,
  ParsedPlan,
  RunnerResult,
  WorkflowContextSnapshotResult,
} from "../types.ts";

type BlockedOutcome = {
  kind: "blocked";
  reason: string;
  detail: string;
  planPath: string;
};

type StoppedIterationOutcome =
  | { kind: "continue"; plan: ParsedPlan; clearCarriedReviewStaging: boolean }
  | { kind: "finish"; result: RunnerResult };

export const handleStoppedIteration = async ({
  rootDir,
  plan,
  descriptor,
  stopReason,
  iterations,
  interruptSignal,
  appendIterationLog,
  syncWorkflowSnapshot,
  cleanupReviewStagingPaths,
  cleanupCommitSummaryPaths,
  finishFailure,
}: {
  rootDir: string;
  plan: ParsedPlan;
  descriptor?: RunnerStageDescriptor;
  stopReason: string;
  iterations: number;
  interruptSignal?: NodeJS.Signals;
  appendIterationLog: (stopReason?: string) => Promise<{ ok: true } | Failure>;
  syncWorkflowSnapshot: (
    plan: ParsedPlan,
  ) => Promise<WorkflowContextSnapshotResult | Failure>;
  cleanupReviewStagingPaths: () => Promise<{ ok: true } | Failure>;
  cleanupCommitSummaryPaths: () => Promise<{ ok: true } | Failure>;
  finishFailure: (
    reason: string,
    completedIterations?: number,
    exitCode?: number,
  ) => Promise<RunnerResult>;
}): Promise<StoppedIterationOutcome> => {
  const rollback = descriptor
    ? await rollbackStageDescriptor({ rootDir, plan })
    : { ok: true as const };
  const cleanup = descriptor?.stage === "review"
    ? await cleanupReviewStagingPaths()
    : await cleanupCommitSummaryPaths();
  const reasons = [stopReason, rollback.ok ? undefined : rollback.reason, cleanup.ok ? undefined : cleanup.reason]
    .filter((reason): reason is string => Boolean(reason));
  const finalStopReason = reasons.join("; ");
  const logResult = await appendIterationLog(finalStopReason);
  if (!logResult.ok) return { kind: "finish", result: await finishFailure(logResult.reason) };
  const snapshotResult = await syncWorkflowSnapshot(plan);
  if (!snapshotResult.ok) return { kind: "finish", result: await finishFailure(snapshotResult.reason) };
  return {
    kind: "finish",
    result: await finishFailure(
      finalStopReason,
      iterations,
      interruptSignal === "SIGINT" ? 130 : interruptSignal === "SIGTERM" ? 143 : 1,
    ),
  };
};
