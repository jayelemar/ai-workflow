import { isReviewPrompt } from "../plan/prompt.ts";
import { parsePlan } from "../plan/state.ts";
import {
  completeStageFinalization,
  finalizeStageDescriptor,
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

type SuccessfulIterationOutcome =
  | { kind: "continue"; plan: ParsedPlan; clearCarriedReviewStaging: boolean }
  | { kind: "finish"; result: RunnerResult };

export const handleSuccessfulNonterminalIteration = async ({
  rootDir,
  planArgument,
  plan,
  promptPath,
  descriptor,
  appendIterationLog,
  syncWorkflowSnapshot,
  cleanupReviewStagingPaths,
  emitWorkflowThresholdWarnings,
  nonterminalRouteOutcome,
  finishNonterminalRouteOutcome,
  finishFailure,
}: {
  rootDir: string;
  planArgument: string;
  plan: ParsedPlan;
  promptPath: string;
  descriptor: RunnerStageDescriptor;
  appendIterationLog: (
    stopReason?: string,
    endingPlan?: ParsedPlan,
  ) => Promise<{ ok: true } | Failure>;
  syncWorkflowSnapshot: (
    plan: ParsedPlan,
  ) => Promise<WorkflowContextSnapshotResult | Failure>;
  cleanupReviewStagingPaths: () => Promise<{ ok: true } | Failure>;
  emitWorkflowThresholdWarnings: (warnings: string[]) => void;
  nonterminalRouteOutcome: (plan: ParsedPlan) => BlockedOutcome | undefined;
  finishNonterminalRouteOutcome: (
    outcome: BlockedOutcome,
  ) => Promise<RunnerResult>;
  finishFailure: (reason: string) => Promise<RunnerResult>;
}): Promise<SuccessfulIterationOutcome> => {
  const finish = async (result: RunnerResult): Promise<SuccessfulIterationOutcome> => ({
    kind: "finish",
    result,
  });
  const finalized = await finalizeStageDescriptor({ rootDir, plan, descriptor });
  if (!finalized.ok) {
    const cleanup = await cleanupReviewStagingPaths();
    const reason = cleanup.ok ? finalized.reason : `${finalized.reason}; ${cleanup.reason}`;
    const logResult = await appendIterationLog(reason);
    if (!logResult.ok) return await finish(await finishFailure(logResult.reason));
    const snapshotResult = await syncWorkflowSnapshot(plan);
    if (!snapshotResult.ok) return await finish(await finishFailure(snapshotResult.reason));
    return await finish(await finishFailure(reason));
  }
  const updated = await parsePlan({ planName: planArgument, rootDir });
  if (!updated.ok) {
    const logResult = await appendIterationLog(updated.reason);
    if (!logResult.ok) return await finish(await finishFailure(logResult.reason));
    return await finish(await finishFailure(updated.reason));
  }
  emitWorkflowThresholdWarnings(updated.warnings);
  const snapshotResult = await syncWorkflowSnapshot(updated);
  if (!snapshotResult.ok) return await finish(await finishFailure(snapshotResult.reason));
  const completed = await completeStageFinalization({ rootDir, planName: updated.planName });
  if (!completed.ok) return await finish(await finishFailure(completed.reason));
  const nonterminalOutcome = nonterminalRouteOutcome(updated);
  if (nonterminalOutcome) {
    const logResult = await appendIterationLog(undefined, updated);
    if (!logResult.ok) return await finish(await finishFailure(logResult.reason));
    return await finish(await finishNonterminalRouteOutcome(nonterminalOutcome));
  }
  if (isReviewPrompt(promptPath) && updated.workflowState === "active") {
    const cleanup = await cleanupReviewStagingPaths();
    if (!cleanup.ok) {
      const logResult = await appendIterationLog(cleanup.reason, updated);
      if (!logResult.ok) return await finish(await finishFailure(logResult.reason));
      return await finish(await finishFailure(cleanup.reason));
    }
    const logResult = await appendIterationLog(undefined, updated);
    if (!logResult.ok) return await finish(await finishFailure(logResult.reason));
    return { kind: "continue", plan: updated, clearCarriedReviewStaging: true };
  }
  const logResult = await appendIterationLog(undefined, updated);
  if (!logResult.ok) return await finish(await finishFailure(logResult.reason));
  return { kind: "continue", plan: updated, clearCarriedReviewStaging: false };
};
