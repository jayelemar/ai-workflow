import {
  EXECUTE_PLAN_PROMPT_PATH,
} from "../../contracts/stage.ts";
import { isReviewPrompt } from "../plan/prompt.ts";
import { parsePlan, recoverThinPlanBlockedValidationHandoff } from "../plan/state.ts";
import { transitionAllowed } from "../transitions.ts";
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
  planArgument,
  plan,
  promptPath,
  stopReason,
  iterations,
  interruptSignal,
  appendIterationLog,
  syncWorkflowSnapshot,
  cleanupReviewStagingPaths,
  cleanupCommitSummaryPaths,
  emitWorkflowThresholdWarnings,
  nonterminalRouteOutcome,
  finishNonterminalRouteOutcome,
  finishFailure,
}: {
  rootDir: string;
  planArgument: string;
  plan: ParsedPlan;
  promptPath: string;
  stopReason: string;
  iterations: number;
  interruptSignal?: NodeJS.Signals;
  appendIterationLog: (
    stopReason?: string,
    endingPlan?: ParsedPlan,
  ) => Promise<{ ok: true } | Failure>;
  syncWorkflowSnapshot: (
    plan: ParsedPlan,
  ) => Promise<WorkflowContextSnapshotResult | Failure>;
  cleanupReviewStagingPaths: () => Promise<{ ok: true } | Failure>;
  cleanupCommitSummaryPaths: () => Promise<{ ok: true } | Failure>;
  emitWorkflowThresholdWarnings: (warnings: string[]) => void;
  nonterminalRouteOutcome: (plan: ParsedPlan) => BlockedOutcome | undefined;
  finishNonterminalRouteOutcome: (
    outcome: BlockedOutcome,
  ) => Promise<RunnerResult>;
  finishFailure: (
    reason: string,
    completedIterations?: number,
    exitCode?: number,
  ) => Promise<RunnerResult>;
}): Promise<StoppedIterationOutcome> => {
  const finish = async (result: RunnerResult): Promise<StoppedIterationOutcome> => ({
    kind: "finish",
    result,
  });
  if (promptPath === EXECUTE_PLAN_PROMPT_PATH) {
    const recovered = await recoverThinPlanBlockedValidationHandoff({
      rootDir,
      plan,
    });
    if (!recovered.ok) {
      return await finish(await finishFailure(recovered.reason));
    }
  }
  const updated = await parsePlan({ planName: planArgument, rootDir });
  if (updated.ok) {
    emitWorkflowThresholdWarnings(updated.warnings);
    const transition = transitionAllowed(promptPath, plan, updated);
    if (transition.ok) {
      if (isReviewPrompt(promptPath) && updated.workflowState === "active") {
        const cleanup = await cleanupReviewStagingPaths();
        if (!cleanup.ok) {
          const finalStopReason = `${stopReason}; ${cleanup.reason}`;
          const logResult = await appendIterationLog(finalStopReason);
          if (!logResult.ok) {
            return await finish(await finishFailure(logResult.reason));
          }
          const snapshotResult = await syncWorkflowSnapshot(updated);
          if (!snapshotResult.ok) {
            return await finish(await finishFailure(snapshotResult.reason));
          }
          return await finish(await finishFailure(finalStopReason));
        }
        const logResult = await appendIterationLog(undefined, updated);
        if (!logResult.ok) {
          return await finish(await finishFailure(logResult.reason));
        }
        const snapshotResult = await syncWorkflowSnapshot(updated);
        if (!snapshotResult.ok) {
          return await finish(await finishFailure(snapshotResult.reason));
        }
        return { kind: "continue", plan: updated, clearCarriedReviewStaging: true };
      }
      const nonterminalOutcome = nonterminalRouteOutcome(updated);
      if (nonterminalOutcome) {
        const logResult = await appendIterationLog(undefined, updated);
        if (!logResult.ok) {
          return await finish(await finishFailure(logResult.reason));
        }
        const snapshotResult = await syncWorkflowSnapshot(updated);
        if (!snapshotResult.ok) {
          return await finish(await finishFailure(snapshotResult.reason));
        }
        return await finish(
          await finishNonterminalRouteOutcome(nonterminalOutcome),
        );
      }
    }
  }
  const cleanup =
    promptPath === ".ai/prompts/commit-summary.md"
      ? await cleanupCommitSummaryPaths()
      : await cleanupReviewStagingPaths();
  const finalStopReason = cleanup.ok
    ? stopReason
    : `${stopReason}; ${cleanup.reason}`;
  const logResult = await appendIterationLog(finalStopReason);
  if (!logResult.ok) {
    return await finish(await finishFailure(logResult.reason));
  }
  const snapshotResult = await syncWorkflowSnapshot(plan);
  if (!snapshotResult.ok) {
    return await finish(await finishFailure(snapshotResult.reason));
  }
  return await finish(
    await finishFailure(
      finalStopReason,
      iterations,
      interruptSignal === "SIGINT" ? 130 : interruptSignal === "SIGTERM" ? 143 : 1,
    ),
  );
};
