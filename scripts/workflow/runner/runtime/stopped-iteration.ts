import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";

import {
  finalizeStageDescriptor,
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

export const isTaskBoundaryPrerequisiteStop = (stopReason: string): boolean =>
  /output contained STOP:/i.test(stopReason) &&
  /\b(?:cannot|unable|not)\b[\s\S]{0,180}\b(?:review-ready|review ready)\b/i.test(stopReason) &&
  /\b(?:declared|current)\b[\s\S]{0,80}\b(?:file(?:s)? (?:boundary|scope)|task files?)\b/i.test(stopReason) &&
  /\b(?:requires?|needs?|remaining)\b[\s\S]{0,240}\b(?:downstream|migration|database(?:-owned)?|generated (?:contract|types?)|contract update|outside)\b/i.test(stopReason);

export const isMissingReservedStageEventStop = (stopReason: string): boolean =>
  /completed without writing its reserved stage event/i.test(stopReason);

const canPersistBlockedHandoff = (descriptor: RunnerStageDescriptor): boolean =>
  descriptor.stage === "validation" ||
  descriptor.stage === "execution" ||
  descriptor.stage === "unblock";

const stageTitle = (stage: RunnerStageDescriptor["stage"]): string =>
  `${stage.slice(0, 1).toUpperCase()}${stage.slice(1)}`;

const stageRouteLabel = (stage: RunnerStageDescriptor["stage"]): string =>
  stage === "execution" ? "execute-plan" : stage === "unblock" ? "unblock-plan" : stage;

const conciseReason = (reason: string): string =>
  reason.replace(/\s+/g, " ").trim().slice(0, 500);

const writeBlockedHandoffEvent = async ({
  rootDir,
  descriptor,
  stopReason,
  taskBoundaryPrerequisite,
}: {
  rootDir: string;
  descriptor: RunnerStageDescriptor;
  stopReason: string;
  taskBoundaryPrerequisite: boolean;
}): Promise<{ ok: true } | Failure> => {
  try {
    const eventPath = path.join(rootDir, descriptor.eventPath);
    const summary = taskBoundaryPrerequisite
      ? "The current task requires an undeclared prerequisite outside its declared Files boundary."
      : `The ${descriptor.stage} stage ended without writing its reserved event, so the runner preserved a resumable blocked handoff.`;
    const remediation = taskBoundaryPrerequisite
      ? "Complete the required prerequisite in a separate plan or savepoint that owns its files, then rerun this plan."
      : "Repair the stage-agent environment or event write failure, then rerun this plan with the existing unblock evidence.";
    await mkdir(path.dirname(eventPath), { recursive: true });
    await writeFile(
      eventPath,
      `# ${stageTitle(descriptor.stage)} v${descriptor.version}\n\n## Outcome\n\nblocked\n\n## Summary\n\n${summary}\n\n## Evidence\n\n* ${conciseReason(stopReason)}\n\n## Remediation\n\n* ${remediation}\n`,
      "utf8",
    );
    return { ok: true };
  } catch (error) {
    return {
      ok: false,
      reason: `runner cannot write blocked stage handoff: ${String(error)}`,
    };
  }
};

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
  reparsePlan,
  finishBlocked,
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
  reparsePlan: () => Promise<ParsedPlan | Failure>;
  finishBlocked: (
    reason: string,
    detail: string,
    planPath: string,
    completedIterations: number,
  ) => Promise<RunnerResult>;
  finishFailure: (
    reason: string,
    completedIterations?: number,
    exitCode?: number,
  ) => Promise<RunnerResult>;
}): Promise<StoppedIterationOutcome> => {
  const taskBoundaryPrerequisite = Boolean(
    descriptor?.stage === "execution" &&
      isTaskBoundaryPrerequisiteStop(stopReason),
  );
  const missingReservedEvent = isMissingReservedStageEventStop(stopReason);
  if (
    descriptor &&
    canPersistBlockedHandoff(descriptor) &&
    (taskBoundaryPrerequisite || missingReservedEvent)
  ) {
    const event = await writeBlockedHandoffEvent({
      rootDir,
      descriptor,
      stopReason,
      taskBoundaryPrerequisite,
    });
    if (event.ok) {
      const finalized = await finalizeStageDescriptor({
        rootDir,
        plan,
        descriptor,
      });
      if (finalized.ok) {
        const blockedPlan = await reparsePlan();
        if (!blockedPlan.ok) {
          return {
            kind: "finish",
            result: await finishFailure(blockedPlan.reason),
          };
        }
        const detail = taskBoundaryPrerequisite
          ? "Current task needs a separate prerequisite outside its declared Files boundary"
          : `The ${descriptor.stage} stage ended without writing its reserved event`;
        const logResult = await appendIterationLog(undefined, blockedPlan);
        if (!logResult.ok) {
          return {
            kind: "finish",
            result: await finishFailure(logResult.reason),
          };
        }
        const snapshotResult = await syncWorkflowSnapshot(blockedPlan);
        if (!snapshotResult.ok) {
          return {
            kind: "finish",
            result: await finishFailure(snapshotResult.reason),
          };
        }
        return {
          kind: "finish",
          result: await finishBlocked(
            `plan blocked after ${stageRouteLabel(descriptor.stage)}: ${detail}`,
            detail,
            blockedPlan.planPath,
            iterations,
          ),
        };
      }
      stopReason = `${stopReason}; automatic task-boundary handoff failed: ${finalized.reason}`;
    } else {
      stopReason = `${stopReason}; automatic task-boundary handoff failed: ${event.reason}`;
    }
  }
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
