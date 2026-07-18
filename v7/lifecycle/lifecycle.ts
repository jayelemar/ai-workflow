export const LIFECYCLE_STAGES = [
  ["Feature Intake", "feature-intake"],
  ["Bug Intake & Root Cause Analysis", "bug-intake-root-cause-analysis"],
  ["Specification Generation", "specification-generation"],
  ["Plan Creation", "plan-creation"],
  ["Plan Review", "plan-review"],
  ["Pre-Run Artifact Repair", "pre-run-artifact-repair"],
  ["Decision Needed", "decision-needed"],
  ["Plan Setup", "plan-setup"],
  ["Plan Validation", "plan-validation"],
  ["Task Implementation", "task-implementation"],
  ["Task Verification", "task-verification"],
  ["Task Review", "task-review"],
  ["Task Commit", "task-commit"],
  ["Blocker Resolution", "blocker-resolution"],
  ["Plan Reopening", "plan-reopening"],
  ["Completion Summary", "completion-summary"],
] as const;

export type LifecycleStage = (typeof LIFECYCLE_STAGES)[number][1];
export type LifecycleDisplayStage = (typeof LIFECYCLE_STAGES)[number][0];
export type IntakeRoute = "direct" | "manual" | "runner-managed";
export type IntakeRisk = "LOW" | "MEDIUM" | "HIGH";
export type LifecycleOutcome =
  | "succeeded"
  | "blocked"
  | "failed"
  | "skipped"
  | "zero-token"
  | "usage-unavailable"
  | "interrupted";
export type LifecycleRunOutcome = "active" | "blocked" | "interrupted" | "completed" | "superseded";

export type LifecycleState = {
  version: 7;
  workflowId: string;
  workflowName: string;
  runRevision: number;
  intakeRevision: number;
  route: IntakeRoute;
  intakeStage: "feature-intake" | "bug-intake-root-cause-analysis";
  currentStage: LifecycleStage;
  runOutcome: LifecycleRunOutcome;
  resumeStage?: LifecycleStage;
  linkedFromRevision?: number;
  createdAt: string;
  updatedAt: string;
};

export type LifecycleAttemptResult = {
  state: LifecycleState;
  advanced: boolean;
};

export type LifecycleTransitionOptions = {
  /** A completed attempt whose stage remains current, such as Plan Review findings. */
  advance?: boolean;
};

export const NO_CODEX_COMPLETING_STAGES: readonly LifecycleStage[] = [
  "pre-run-artifact-repair",
  "decision-needed",
  "plan-setup",
  "blocker-resolution",
  "task-commit",
  "completion-summary",
] as const;

const stageSet = new Set<string>(LIFECYCLE_STAGES.map(([, id]) => id));
const displayByStage = new Map(LIFECYCLE_STAGES.map(([display, id]) => [id, display]));
const workflowNamePattern = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;

const successfulNextStage: Partial<Record<LifecycleStage, LifecycleStage>> = {
  "feature-intake": "specification-generation",
  "bug-intake-root-cause-analysis": "specification-generation",
  "specification-generation": "plan-creation",
  "plan-creation": "plan-review",
  "plan-review": "plan-setup",
  "pre-run-artifact-repair": "plan-review",
  "plan-setup": "plan-validation",
  "plan-validation": "task-implementation",
  "task-implementation": "task-verification",
  "task-verification": "task-review",
  "task-review": "task-commit",
  "task-commit": "completion-summary",
  "blocker-resolution": "task-implementation",
  "plan-reopening": "plan-review",
};

export const routeForRisk = (risk: IntakeRisk): IntakeRoute =>
  risk === "HIGH" ? "runner-managed" : risk === "MEDIUM" ? "manual" : "direct";

export const isLifecycleStage = (value: string): value is LifecycleStage => stageSet.has(value);

export const assertNormalizedWorkflowName = (workflowName: string): string => {
  if (!workflowNamePattern.test(workflowName)) throw new Error(`V7 workflow name must be normalized kebab-case: ${workflowName}`);
  return workflowName;
};

export const lifecycleDisplayName = (stage: LifecycleStage): LifecycleDisplayStage => {
  const display = displayByStage.get(stage);
  if (!display) throw new Error(`unknown V7 lifecycle stage: ${stage}`);
  return display;
};

export const createLifecycleState = ({
  workflowId,
  workflowName,
  runRevision,
  intakeRevision = 1,
  risk,
  intakeStage,
  linkedFromRevision,
  now = new Date().toISOString(),
}: {
  workflowId: string;
  workflowName: string;
  runRevision: number;
  intakeRevision?: number;
  risk: IntakeRisk;
  intakeStage: "feature-intake" | "bug-intake-root-cause-analysis";
  linkedFromRevision?: number;
  now?: string;
}): LifecycleState | null => {
  if (routeForRisk(risk) !== "runner-managed") return null;
  assertNormalizedWorkflowName(workflowName);
  if (!workflowId || !workflowName || !Number.isInteger(runRevision) || runRevision < 1) {
    throw new Error("V7 lifecycle requires workflow identity and positive run revision");
  }
  return {
    version: 7,
    workflowId,
    workflowName,
    runRevision,
    intakeRevision,
    route: "runner-managed",
    intakeStage,
    currentStage: intakeStage,
    runOutcome: "active",
    linkedFromRevision,
    createdAt: now,
    updatedAt: now,
  };
};

export const transitionLifecycle = (
  state: LifecycleState,
  outcome: LifecycleOutcome,
  now = new Date().toISOString(),
  options: LifecycleTransitionOptions = {},
): LifecycleAttemptResult => {
  if (state.runOutcome !== "active" && outcome !== "succeeded") {
    return { state: { ...state, updatedAt: now }, advanced: false };
  }
  if (outcome === "blocked" || outcome === "usage-unavailable") {
    return {
      state: { ...state, currentStage: "blocker-resolution", resumeStage: state.currentStage, runOutcome: "blocked", updatedAt: now },
      advanced: false,
    };
  }
  if (outcome === "interrupted") {
    return { state: { ...state, runOutcome: "interrupted", updatedAt: now }, advanced: false };
  }
  if (outcome === "failed" || outcome === "skipped") return { state: { ...state, updatedAt: now }, advanced: false };
  if (options.advance === false) return { state: { ...state, updatedAt: now }, advanced: false };
  if (outcome === "zero-token" && !NO_CODEX_COMPLETING_STAGES.includes(state.currentStage)) {
    return { state: { ...state, updatedAt: now }, advanced: false };
  }
  if (state.currentStage === "completion-summary") {
    return { state: { ...state, runOutcome: "completed", updatedAt: now }, advanced: true };
  }
  if (state.currentStage === "blocker-resolution") {
    const resumeStage = state.resumeStage;
    if (!resumeStage) throw new Error("blocker resolution has no recorded blocked stage");
    return { state: { ...state, currentStage: resumeStage, resumeStage: undefined, runOutcome: "active", updatedAt: now }, advanced: true };
  }
  const next = successfulNextStage[state.currentStage];
  if (!next) throw new Error(`no automatic V7 transition from ${state.currentStage}`);
  return { state: { ...state, currentStage: next, updatedAt: now }, advanced: true };
};

export const routePlanValidationDefect = (state: LifecycleState, now = new Date().toISOString()): LifecycleState => {
  if (state.currentStage !== "plan-validation") throw new Error("plan validation defect must originate at plan-validation");
  return { ...state, currentStage: "plan-reopening", updatedAt: now };
};

export const routeTaskRemediation = (state: LifecycleState, now = new Date().toISOString()): LifecycleState => {
  if (!["task-implementation", "task-verification", "task-review"].includes(state.currentStage)) {
    throw new Error("task remediation must originate from a task stage");
  }
  return { ...state, currentStage: "task-implementation", updatedAt: now };
};

export const routeDecisionNeeded = (state: LifecycleState, now = new Date().toISOString()): LifecycleState => {
  if (!["plan-review", "pre-run-artifact-repair"].includes(state.currentStage)) throw new Error("Decision Needed must originate at Plan Review or Pre-Run Artifact Repair");
  return { ...state, currentStage: "decision-needed", runOutcome: "active", updatedAt: now };
};

export const routePreRunArtifactRepair = (state: LifecycleState, now = new Date().toISOString()): LifecycleState => {
  if (state.currentStage !== "plan-review") throw new Error("Pre-Run Artifact Repair must originate at plan-review");
  return { ...state, currentStage: "pre-run-artifact-repair", updatedAt: now };
};

export const resumeAfterDecision = (state: LifecycleState, now = new Date().toISOString()): LifecycleState => {
  if (state.currentStage !== "decision-needed") throw new Error("only Decision Needed can begin a fresh review");
  return { ...state, currentStage: "plan-review", runOutcome: "active", updatedAt: now };
};
