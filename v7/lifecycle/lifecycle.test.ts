import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";

import { assertNormalizedWorkflowName, LIFECYCLE_STAGES, NO_CODEX_COMPLETING_STAGES, createLifecycleState, routeDecisionNeeded, routeForRisk, routePlanValidationDefect, routeTaskRemediation, transitionLifecycle } from "./lifecycle.ts";
import { createLifecycleRevision } from "./lifecycle-store.ts";
import { checkpointV7Lifecycle } from "./workflow-lifecycle.ts";

test("V7 lifecycle uses canonical stages and excludes LOW/MEDIUM", () => {
  assert.equal(LIFECYCLE_STAGES.length, 16);
  assert.equal(routeForRisk("LOW"), "direct");
  assert.equal(routeForRisk("MEDIUM"), "manual");
  const state = createLifecycleState({ workflowId: "f-1", workflowName: "feature", runRevision: 1, risk: "HIGH", intakeStage: "feature-intake", now: "2026-01-01T00:00:00Z" });
  assert.ok(state);
  assert.equal(transitionLifecycle(state, "succeeded").state.currentStage, "specification-generation");
});

test("V7 rejects non-normalized workflow names", () => {
  assert.throws(() => assertNormalizedWorkflowName("../escape"), /normalized kebab-case/);
  assert.throws(() => createLifecycleState({ workflowId: "id", workflowName: "Has Space", runRevision: 1, risk: "HIGH", intakeStage: "feature-intake" }), /normalized kebab-case/);
});

test("V7 lifecycle blocks, resumes, reopens, remediates, and completes", () => {
  const initial = createLifecycleState({ workflowId: "f-1", workflowName: "feature", runRevision: 1, risk: "HIGH", intakeStage: "feature-intake" });
  assert.ok(initial);
  const blocked = transitionLifecycle(initial, "usage-unavailable").state;
  assert.equal(blocked.currentStage, "blocker-resolution");
  assert.equal(transitionLifecycle(blocked, "succeeded").state.currentStage, "feature-intake");
  const validation = { ...initial, currentStage: "plan-validation" as const };
  assert.equal(routePlanValidationDefect(validation).currentStage, "plan-reopening");
  const review = { ...initial, currentStage: "task-review" as const };
  assert.equal(routeTaskRemediation(review).currentStage, "task-implementation");
  const completion = { ...initial, currentStage: "completion-summary" as const };
  assert.equal(transitionLifecycle(completion, "zero-token").state.runOutcome, "completed");
});

test("V7 only advances zero-token through declared no-Codex stages", () => {
  const initial = createLifecycleState({ workflowId: "f-1", workflowName: "feature", runRevision: 1, risk: "HIGH", intakeStage: "feature-intake" });
  assert.ok(initial);
  assert.equal(transitionLifecycle(initial, "zero-token").state.currentStage, "feature-intake");
  const setup = { ...initial, currentStage: "plan-setup" as const };
  assert.equal(transitionLifecycle(setup, "zero-token").state.currentStage, "plan-validation");
  assert.deepEqual(NO_CODEX_COMPLETING_STAGES, ["pre-run-artifact-repair", "decision-needed", "plan-setup", "blocker-resolution", "task-commit", "completion-summary"]);
});

test("V7 review findings complete the review attempt without auto-advancing", () => {
  const initial = createLifecycleState({ workflowId: "f-1", workflowName: "feature", runRevision: 1, risk: "HIGH", intakeStage: "feature-intake" });
  assert.ok(initial);
  const review = { ...initial, currentStage: "plan-review" as const };
  assert.equal(transitionLifecycle(review, "succeeded", undefined, { advance: false }).state.currentStage, "plan-review");
  const decision = routeDecisionNeeded(review);
  assert.equal(decision.currentStage, "decision-needed");
  assert.equal(decision.runOutcome, "active");
});

test("Plan Validation defect routes through Plan Reopening after its recorded attempt", async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), "v7-validation-"));
  try {
    const state = createLifecycleState({ workflowId: "id", workflowName: "flow", runRevision: 1, risk: "HIGH", intakeStage: "feature-intake" });
    assert.ok(state);
    state.currentStage = "plan-validation";
    await createLifecycleRevision(root, state);
    const tokenUsage = { inputTokens: 2, cachedInputTokens: 0, uncachedInputTokens: 2, outputTokens: 1, reasoningTokens: 0, totalTokens: 3 };
    const next = await checkpointV7Lifecycle({ rootDir: root, workflowName: "flow", runRevision: 1, outcome: "succeeded", session: { sessionId: "validation-session", model: "gpt", tokenUsage }, validationDefect: true });
    assert.equal(next.currentStage, "plan-reopening");
  } finally { await rm(root, { recursive: true, force: true }); }
});
