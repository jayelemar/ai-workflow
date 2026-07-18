import { createLifecycleState, NO_CODEX_COMPLETING_STAGES, routeForRisk, routePlanValidationDefect, routeTaskRemediation, type IntakeRisk, type LifecycleOutcome, type LifecycleStage } from "./lifecycle.ts";
import { createLifecycleRevision, lifecycleRevisionDir, nextLifecycleRevision, readCurrentLifecycleState, readLifecycleState, readTaskOwnershipManifest, writeLifecycleState, writeTaskOwnershipManifest } from "./lifecycle-store.ts";
import { regenerateLifecycleReport } from "./lifecycle-report.ts";
import { recordLifecycleAttempt } from "../runner/runner-orchestrator.ts";
import type { ExactSessionCheckpoint } from "../runner/session-checkpoint.ts";
import { acquireLifecycleLock, heartbeatLifecycleLock, releaseLifecycleLock, withWorkflowRevisionLock } from "./lifecycle-lock.ts";
import { readIntegrityInterruptionArtifacts, writeSourceAbandonmentArtifact } from "./lifecycle-recovery.ts";
import { readLifecycleLedger } from "./lifecycle-ledger.ts";
import { writeTaskRemediationArtifact, type TaskRemediationResult } from "./task-remediation.ts";

export const createV7Workflow = async ({
  rootDir,
  workflowName,
  workflowId,
  risk,
  intakeStage,
}: {
  rootDir: string;
  workflowName: string;
  workflowId: string;
  risk: IntakeRisk;
  intakeStage: "feature-intake" | "bug-intake-root-cause-analysis";
}) => {
  if (routeForRisk(risk) !== "runner-managed") return { created: false as const, route: routeForRisk(risk) };
  return withWorkflowRevisionLock(rootDir, workflowName, async () => {
    const runRevision = await nextLifecycleRevision(rootDir, workflowName);
    const state = createLifecycleState({ workflowId, workflowName, runRevision, risk, intakeStage });
    if (!state) throw new Error("HIGH risk must create a V7 lifecycle");
    const { revisionDir } = await createLifecycleRevision(rootDir, state);
    await regenerateLifecycleReport(revisionDir, state);
    return { created: true as const, route: state.route, state };
  });
};

export const reopenCompletedV7Workflow = async ({ rootDir, workflowName, sourceRevision }: { rootDir: string; workflowName: string; sourceRevision?: number }) => {
  return withWorkflowRevisionLock(rootDir, workflowName, async () => {
    const current = await readCurrentLifecycleState(rootDir, workflowName);
    const completed = sourceRevision ? await readLifecycleState(lifecycleRevisionDir(rootDir, workflowName, sourceRevision)) : current;
    if (!completed || !current || current.runRevision !== completed.runRevision || completed.runOutcome !== "completed") throw new Error(`only current completed V7 workflow can reopen: ${workflowName}`);
    const runRevision = await nextLifecycleRevision(rootDir, workflowName);
    const now = new Date().toISOString();
    const next = { ...completed, runRevision, currentStage: "plan-reopening" as const, runOutcome: "active" as const, resumeStage: undefined, linkedFromRevision: completed.runRevision, createdAt: now, updatedAt: now };
    const { revisionDir } = await createLifecycleRevision(rootDir, next);
    await regenerateLifecycleReport(revisionDir, next);
    return next;
  });
};

/**
 * Ledger corruption is never repaired in place. This preserves the interrupted
 * source revision and starts a linked Plan Reopening revision with immutable
 * abandonment evidence in the successor.
 */
export const abandonIntegrityInterruptedV7Workflow = async ({
  rootDir,
  workflowName,
  runRevision,
  reason,
}: {
  rootDir: string;
  workflowName: string;
  runRevision: number;
  reason: string;
}) => withWorkflowRevisionLock(rootDir, workflowName, async () => {
  if (!reason.trim()) throw new Error("V7 abandonment requires non-empty reason");
  const source = await readLifecycleState(lifecycleRevisionDir(rootDir, workflowName, runRevision));
  const current = await readCurrentLifecycleState(rootDir, workflowName);
  if (!source || !current || current.runRevision !== runRevision || source.runOutcome !== "interrupted") {
    throw new Error("V7 abandonment requires the current integrity-interrupted lifecycle");
  }
  const interruptions = await readIntegrityInterruptionArtifacts(lifecycleRevisionDir(rootDir, workflowName, runRevision));
  const sourceEvidence = interruptions.at(-1);
  if (!sourceEvidence || sourceEvidence.workflowId !== source.workflowId || sourceEvidence.runRevision !== source.runRevision) {
    throw new Error("V7 abandonment requires immutable integrity interruption evidence");
  }
  const nextRevision = await nextLifecycleRevision(rootDir, workflowName);
  const now = new Date().toISOString();
  const successor = {
    ...source,
    runRevision: nextRevision,
    currentStage: "plan-reopening" as const,
    runOutcome: "active" as const,
    resumeStage: undefined,
    linkedFromRevision: source.runRevision,
    createdAt: now,
    updatedAt: now,
  };
  const { revisionDir } = await createLifecycleRevision(rootDir, successor);
  const abandonment = await writeSourceAbandonmentArtifact({
    revisionDir,
    state: successor,
    sourceRunRevision: source.runRevision,
    sourceRecoveryHash: sourceEvidence.recoveryHash,
    reasonCode: reason,
  });
  await regenerateLifecycleReport(revisionDir, successor);
  return { state: successor, abandonment };
});

export const reopenIntakeForRouteChange = async ({
  rootDir,
  workflowName,
  risk,
  intakeStage,
  sourceRevision,
}: {
  rootDir: string;
  workflowName: string;
  risk: IntakeRisk;
  intakeStage: "feature-intake" | "bug-intake-root-cause-analysis";
  sourceRevision?: number;
}) => {
  return withWorkflowRevisionLock(rootDir, workflowName, async () => {
    const current = await readCurrentLifecycleState(rootDir, workflowName);
    const previous = sourceRevision ? await readLifecycleState(lifecycleRevisionDir(rootDir, workflowName, sourceRevision)) : current;
    if (!previous || !current || current.runRevision !== previous.runRevision) throw new Error(`no current V7 intake exists for ${workflowName}`);
    if (["completed", "superseded"].includes(previous.runOutcome)) throw new Error(`cannot reroute immutable V7 lifecycle revision: ${workflowName}#${previous.runRevision}`);
    const superseded = { ...previous, runOutcome: "superseded" as const, updatedAt: new Date().toISOString() };
    await writeLifecycleState(rootDir, superseded);
    await regenerateLifecycleReport(lifecycleRevisionDir(rootDir, workflowName, previous.runRevision), superseded);
    const route = routeForRisk(risk);
    if (route !== "runner-managed") return { created: false as const, route, superseded };
    const runRevision = await nextLifecycleRevision(rootDir, workflowName);
    const state = createLifecycleState({
      workflowId: previous.workflowId,
      workflowName,
      runRevision,
      intakeRevision: previous.intakeRevision + 1,
      risk,
      intakeStage,
      linkedFromRevision: previous.runRevision,
    });
    if (!state) throw new Error("HIGH route must create V7 intake revision");
    const { revisionDir } = await createLifecycleRevision(rootDir, state);
    await regenerateLifecycleReport(revisionDir, state);
    return { created: true as const, route, state, superseded };
  });
};

export const checkpointV7Lifecycle = async ({
  rootDir,
  workflowName,
  runRevision,
  outcome,
  session,
  noCodexReason,
  evidence,
  taskId,
  taskAllowedFiles,
  workflowRoot,
  validationDefect = false,
  remediationRequired = false,
  remediationResult,
}: {
  rootDir: string;
  workflowName: string;
  runRevision: number;
  outcome: LifecycleOutcome;
  session?: ExactSessionCheckpoint;
  noCodexReason?: string;
  evidence?: string;
  taskId?: string;
  taskAllowedFiles?: string[];
  workflowRoot?: string;
  validationDefect?: boolean;
  remediationRequired?: boolean;
  remediationResult?: TaskRemediationResult;
}) => {
  const state = await readLifecycleState(lifecycleRevisionDir(rootDir, workflowName, runRevision));
  if (!state) throw new Error(`no matching V7 lifecycle record for ${workflowName}#${runRevision}`);
  const codexBacked = !NO_CODEX_COMPLETING_STAGES.includes(state.currentStage);
  const revisionDir = lifecycleRevisionDir(rootDir, workflowName, runRevision);
  let taskOwnershipHash: string | undefined;
  let remediationHash: string | undefined;
  let ownership;
  if (["task-implementation", "task-verification", "task-review", "task-commit"].includes(state.currentStage) && !taskId?.trim()) {
    throw new Error(`V7 ${state.currentStage} checkpoint requires task ID`);
  }
  if (taskId) {
    try {
      ownership = await readTaskOwnershipManifest(revisionDir, taskId);
      if (ownership.workflowId !== state.workflowId || ownership.runRevision !== state.runRevision) throw new Error("V7 task ownership manifest belongs to another lifecycle revision");
      taskOwnershipHash = ownership.ownershipHash;
    } catch (error: unknown) {
      if (state.currentStage !== "task-implementation" || !workflowRoot || !taskAllowedFiles?.length || (error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
      ownership = await writeTaskOwnershipManifest({ revisionDir, workflowId: state.workflowId, runRevision: state.runRevision, taskId, allowedFiles: taskAllowedFiles, workflowRoot });
      taskOwnershipHash = ownership.ownershipHash;
    }
  }
  if (!codexBacked && session) throw new Error(`no-Codex V7 stage cannot accept a Codex session: ${state.currentStage}`);
  if (remediationRequired) {
    if (!taskId || !ownership || !remediationResult || !["task-implementation", "task-verification", "task-review"].includes(state.currentStage)) {
      throw new Error("V7 task remediation requires task result and immutable task ownership");
    }
    const records = await readLifecycleLedger(revisionDir);
    const attempt = records.filter((record) => record.recordKind === "stage-attempt" && record.stage === state.currentStage).length + 1;
    remediationHash = (await writeTaskRemediationArtifact({ revisionDir, state, ownership, attempt, result: remediationResult })).remediationHash;
  }
  const next = await recordLifecycleAttempt({
    rootDir,
    state,
    outcome: noCodexReason && !codexBacked && outcome === "succeeded" ? "zero-token" : outcome,
    codexBacked,
    sessionId: session?.sessionId,
    model: session?.model,
    tokenUsage: session?.tokenUsage,
    taskId,
    taskOwnershipHash,
    remediationHash,
    evidence: noCodexReason ?? evidence,
    advance: validationDefect || remediationRequired ? false : undefined,
  });
  if (validationDefect) {
    const routed = routePlanValidationDefect(next);
    await writeLifecycleState(rootDir, routed);
    await regenerateLifecycleReport(revisionDir, routed);
    return routed;
  }
  if (remediationRequired) {
    const routed = routeTaskRemediation(next);
    await writeLifecycleState(rootDir, routed);
    await regenerateLifecycleReport(revisionDir, routed);
    return routed;
  }
  return next;
};

export const requireV7PlanSetupLifecycle = async (rootDir: string, workflowName: string) => {
  const state = await readCurrentLifecycleState(rootDir, workflowName);
  if (!state) throw new Error(`V7 runner rejected plan before Plan Setup: no matching lifecycle record for ${workflowName}`);
  if (state.currentStage !== "plan-setup" || state.runOutcome !== "active") {
    throw new Error(`V7 runner rejected ${workflowName}: lifecycle is ${state.currentStage}/${state.runOutcome}, not Plan Setup`);
  }
  return state;
};

export const runV7LifecycleWithLock = async <T>(
  rootDir: string,
  workflowName: string,
  run: (state: Awaited<ReturnType<typeof requireV7PlanSetupLifecycle>>) => Promise<T>,
  heartbeatIntervalMs = 30_000,
): Promise<T> => {
  const state = await requireV7PlanSetupLifecycle(rootDir, workflowName);
  const revisionDir = lifecycleRevisionDir(rootDir, state.workflowName, state.runRevision);
  const lock = await acquireLifecycleLock(revisionDir, { workflowId: state.workflowId, runRevision: state.runRevision });
  let heartbeatInFlight = Promise.resolve();
  const heartbeat = setInterval(() => {
    heartbeatInFlight = heartbeatInFlight
      .catch(() => undefined)
      .then(() => heartbeatLifecycleLock(revisionDir, lock.ownerId));
  }, heartbeatIntervalMs);
  try { return await run(state); } finally {
    clearInterval(heartbeat);
    await heartbeatInFlight.catch(() => undefined);
    await releaseLifecycleLock(revisionDir, lock.ownerId);
  }
};

export const parseLifecycleOutcome = (value: string): LifecycleOutcome => {
  const outcomes: LifecycleOutcome[] = ["succeeded", "blocked", "failed", "skipped", "zero-token", "usage-unavailable", "interrupted"];
  if (!outcomes.includes(value as LifecycleOutcome)) throw new Error(`invalid V7 lifecycle outcome: ${value}`);
  return value as LifecycleOutcome;
};
export const parseLifecycleStage = (value: string): LifecycleStage => value as LifecycleStage;
