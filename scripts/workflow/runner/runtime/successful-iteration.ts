import { EXECUTE_PLAN_PROMPT_PATH } from "../../contracts/stage.ts";
import { isReviewPrompt } from "../plan/prompt.ts";
import {
  parsePlan,
  recoverThinPlanPartialExecuteReviewHandoff,
} from "../plan/state.ts";
import { transitionAllowed } from "../transitions.ts";
import type {
  Failure,
  ParsedPlan,
  ProcessRunner,
  RunnerResult,
  WorkflowContextSnapshotResult,
} from "../types.ts";
import { recoverThinPlanExecuteHandoff } from "./execute-handoff-recovery.ts";

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
  stdout,
  timestamp,
  processRunner,
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
  stdout: string;
  timestamp: () => string;
  processRunner: ProcessRunner;
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
  const finish = async (
    result: RunnerResult,
  ): Promise<SuccessfulIterationOutcome> => ({ kind: "finish", result });
  const previousContent = plan.content;
  const updated = await parsePlan({ planName: planArgument, rootDir });
  if (!updated.ok) {
    const cleanup = await cleanupReviewStagingPaths();
    const reason = cleanup.ok
      ? updated.reason
      : `${updated.reason}; ${cleanup.reason}`;
    const logResult = await appendIterationLog(reason);
    if (!logResult.ok) {
      return await finish(await finishFailure(logResult.reason));
    }
    const snapshotResult = await syncWorkflowSnapshot(plan);
    if (!snapshotResult.ok) {
      return await finish(await finishFailure(snapshotResult.reason));
    }
    return await finish(await finishFailure(reason));
  }
  emitWorkflowThresholdWarnings(updated.warnings);
  if (promptPath === EXECUTE_PLAN_PROMPT_PATH) {
    const recovered = await recoverThinPlanPartialExecuteReviewHandoff({
      rootDir,
      previous: plan,
      updated,
    });
    if (!recovered.ok) {
      const cleanup = await cleanupReviewStagingPaths();
      const reason = cleanup.ok
        ? recovered.reason
        : `${recovered.reason}; ${cleanup.reason}`;
      const logResult = await appendIterationLog(reason, updated);
      if (!logResult.ok) {
        return await finish(await finishFailure(logResult.reason));
      }
      const snapshotResult = await syncWorkflowSnapshot(updated);
      if (!snapshotResult.ok) {
        return await finish(await finishFailure(snapshotResult.reason));
      }
      return await finish(await finishFailure(reason));
    }
    if (recovered.recovered) {
      const recoveredPlan = await parsePlan({ planName: planArgument, rootDir });
      if (!recoveredPlan.ok) {
        const logResult = await appendIterationLog(recoveredPlan.reason);
        if (!logResult.ok) {
          return await finish(await finishFailure(logResult.reason));
        }
        const snapshotResult = await syncWorkflowSnapshot(plan);
        if (!snapshotResult.ok) {
          return await finish(await finishFailure(snapshotResult.reason));
        }
        return await finish(await finishFailure(recoveredPlan.reason));
      }
      const logResult = await appendIterationLog(
        "repaired partial execute-plan review handoff",
        recoveredPlan,
      );
      if (!logResult.ok) {
        return await finish(await finishFailure(logResult.reason));
      }
      const snapshotResult = await syncWorkflowSnapshot(recoveredPlan);
      if (!snapshotResult.ok) {
        return await finish(await finishFailure(snapshotResult.reason));
      }
      return { kind: "continue", plan: recoveredPlan, clearCarriedReviewStaging: false };
    }
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
    return await finish(await finishNonterminalRouteOutcome(nonterminalOutcome));
  }
  if (updated.content === previousContent) {
    if (promptPath === EXECUTE_PLAN_PROMPT_PATH) {
      const recovered = await recoverThinPlanExecuteHandoff({
        rootDir,
        plan,
        processRunner,
        stdout,
        timestamp,
      });
      if (!recovered.ok) {
        const logResult = await appendIterationLog(recovered.reason);
        if (!logResult.ok) {
          return await finish(await finishFailure(logResult.reason));
        }
        const snapshotResult = await syncWorkflowSnapshot(plan);
        if (!snapshotResult.ok) {
          return await finish(await finishFailure(snapshotResult.reason));
        }
        return await finish(await finishFailure(recovered.reason));
      }
      if (recovered.recovered) {
        const recoveredPlan = await parsePlan({ planName: planArgument, rootDir });
        if (!recoveredPlan.ok) {
          const logResult = await appendIterationLog(recoveredPlan.reason);
          if (!logResult.ok) {
            return await finish(await finishFailure(logResult.reason));
          }
          const snapshotResult = await syncWorkflowSnapshot(plan);
          if (!snapshotResult.ok) {
            return await finish(await finishFailure(snapshotResult.reason));
          }
          return await finish(await finishFailure(recoveredPlan.reason));
        }
        const transition = transitionAllowed(promptPath, plan, recoveredPlan);
        if (!transition.ok) {
          const logResult = await appendIterationLog(
            transition.reason,
            recoveredPlan,
          );
          if (!logResult.ok) {
            return await finish(await finishFailure(logResult.reason));
          }
          const snapshotResult = await syncWorkflowSnapshot(recoveredPlan);
          if (!snapshotResult.ok) {
            return await finish(await finishFailure(snapshotResult.reason));
          }
          return await finish(await finishFailure(transition.reason));
        }
        const logResult = await appendIterationLog(undefined, recoveredPlan);
        if (!logResult.ok) {
          return await finish(await finishFailure(logResult.reason));
        }
        const snapshotResult = await syncWorkflowSnapshot(recoveredPlan);
        if (!snapshotResult.ok) {
          return await finish(await finishFailure(snapshotResult.reason));
        }
        return { kind: "continue", plan: recoveredPlan, clearCarriedReviewStaging: false };
      }
    }
    const cleanup = await cleanupReviewStagingPaths();
    const reason = cleanup.ok
      ? "plan content unchanged after successful nonterminal workflow action"
      : `plan content unchanged after successful nonterminal workflow action; ${cleanup.reason}`;
    const logResult = await appendIterationLog(reason);
    if (!logResult.ok) {
      return await finish(await finishFailure(logResult.reason));
    }
    const snapshotResult = await syncWorkflowSnapshot(plan);
    if (!snapshotResult.ok) {
      return await finish(await finishFailure(snapshotResult.reason));
    }
    return await finish(await finishFailure(reason));
  }
  const transition = transitionAllowed(promptPath, plan, updated);
  if (!transition.ok) {
    const cleanup = await cleanupReviewStagingPaths();
    const reason = cleanup.ok
      ? transition.reason
      : `${transition.reason}; ${cleanup.reason}`;
    const logResult = await appendIterationLog(reason);
    if (!logResult.ok) {
      return await finish(await finishFailure(logResult.reason));
    }
    const snapshotResult = await syncWorkflowSnapshot(updated);
    if (!snapshotResult.ok) {
      return await finish(await finishFailure(snapshotResult.reason));
    }
    return await finish(await finishFailure(reason));
  }
  if (isReviewPrompt(promptPath) && updated.workflowState === "active") {
    const cleanup = await cleanupReviewStagingPaths();
    if (!cleanup.ok) {
      const logResult = await appendIterationLog(cleanup.reason);
      if (!logResult.ok) {
        return await finish(await finishFailure(logResult.reason));
      }
      const snapshotResult = await syncWorkflowSnapshot(updated);
      if (!snapshotResult.ok) {
        return await finish(await finishFailure(snapshotResult.reason));
      }
      return await finish(await finishFailure(cleanup.reason));
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
  const logResult = await appendIterationLog(undefined, updated);
  if (!logResult.ok) {
    return await finish(await finishFailure(logResult.reason));
  }
  const snapshotResult = await syncWorkflowSnapshot(updated);
  if (!snapshotResult.ok) {
    return await finish(await finishFailure(snapshotResult.reason));
  }
  return { kind: "continue", plan: updated, clearCarriedReviewStaging: false };
};
