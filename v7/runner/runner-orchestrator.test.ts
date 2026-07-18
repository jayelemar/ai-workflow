import assert from "node:assert/strict";
import { mkdtemp, mkdir, readdir, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";

import { createLifecycleState } from "../lifecycle/lifecycle.ts";
import { createLifecycleRevision } from "../lifecycle/lifecycle-store.ts";
import { resolveV7Decision, resumeV7Decision, runPlanReviewLoop } from "./runner-orchestrator.ts";

const tokens = { inputTokens: 1, cachedInputTokens: 0, uncachedInputTokens: 1, outputTokens: 1, reasoningTokens: 0, totalTokens: 2 };
const finding = (findingCode: string, severity: "LOW" | "MEDIUM" | "HIGH", deterministic = true) => ({ findingCode, severity, material: true, deterministic, message: "review finding", options: [{ id: "accept", summary: "Apply repair." }], recommendationId: "accept" });
test("Plan Review OKAY advances directly to Plan Setup with fresh session", async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), "v7-review-"));
  try {
    const state = createLifecycleState({ workflowId: "id", workflowName: "flow", runRevision: 1, risk: "HIGH", intakeStage: "feature-intake" });
    assert.ok(state);
    state.currentStage = "plan-review";
    await createLifecycleRevision(root, state);
    const result = await runPlanReviewLoop({ rootDir: root, state, specPath: ".ai/specs/flow.spec.md", planPath: ".ai/plans/flow.md", review: async () => ({ sessionId: "review-1", tokenUsage: tokens, verdict: "OKAY" }), repair: async () => ({ changedPaths: [] }) });
    assert.equal(result.result, "approved");
    assert.equal(result.state.currentStage, "plan-setup");
  } finally { await rm(root, { recursive: true, force: true }); }
});

test("Plan Review HIGH finding requires Decision Needed", async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), "v7-review-"));
  try {
    const state = createLifecycleState({ workflowId: "id", workflowName: "flow", runRevision: 1, risk: "HIGH", intakeStage: "feature-intake" });
    assert.ok(state);
    state.currentStage = "plan-review";
    await createLifecycleRevision(root, state);
    const result = await runPlanReviewLoop({ rootDir: root, state, specPath: ".ai/specs/flow.spec.md", planPath: ".ai/plans/flow.md", review: async () => ({ sessionId: "review-1", tokenUsage: tokens, verdict: "FINDINGS", findings: [finding("security", "HIGH")] }), repair: async () => ({ changedPaths: [] }) });
    assert.equal(result.result, "decision-needed");
    assert.equal(result.state.currentStage, "decision-needed");
  } finally { await rm(root, { recursive: true, force: true }); }
});

test("deterministic repair must modify allowed file before fresh review", async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), "v7-review-"));
  try {
    await mkdir(path.join(root, ".ai", "specs"), { recursive: true });
    await mkdir(path.join(root, ".ai", "plans"), { recursive: true });
    await writeFile(path.join(root, ".ai", "specs", "flow.spec.md"), "before\n");
    await writeFile(path.join(root, ".ai", "plans", "flow.md"), "plan\n");
    const state = createLifecycleState({ workflowId: "id", workflowName: "flow", runRevision: 1, risk: "HIGH", intakeStage: "feature-intake" });
    assert.ok(state);
    state.currentStage = "plan-review";
    await createLifecycleRevision(root, state);
    let reviews = 0;
    const result = await runPlanReviewLoop({
      rootDir: root,
      state,
      specPath: ".ai/specs/flow.spec.md",
      planPath: ".ai/plans/flow.md",
      review: async () => ++reviews === 1 ? { sessionId: "review-1", tokenUsage: tokens, verdict: "FINDINGS", findings: [finding("wording", "LOW")] } : { sessionId: "review-2", tokenUsage: tokens, verdict: "OKAY" },
      repair: async () => { await writeFile(path.join(root, ".ai", "specs", "flow.spec.md"), "after\n"); return { changedPaths: [".ai/specs/flow.spec.md"] }; },
    });
    assert.equal(result.result, "approved");
    assert.equal(reviews, 2);
  } finally { await rm(root, { recursive: true, force: true }); }
});

test("no-progress repair routes to immutable Decision Needed evidence", async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), "v7-review-no-progress-"));
  try {
    const state = createLifecycleState({ workflowId: "id", workflowName: "flow", runRevision: 1, risk: "HIGH", intakeStage: "feature-intake" });
    assert.ok(state);
    state.currentStage = "plan-review";
    const { revisionDir } = await createLifecycleRevision(root, state);
    const result = await runPlanReviewLoop({
      rootDir: root,
      state,
      specPath: ".ai/specs/flow.spec.md",
      planPath: ".ai/plans/flow.md",
      review: async () => ({ sessionId: "review-1", tokenUsage: tokens, verdict: "FINDINGS", findings: [finding("wording", "LOW")] }),
      repair: async () => ({ changedPaths: [] }),
    });
    assert.equal(result.result, "decision-needed");
    const decisions = await readdir(path.join(revisionDir, "decisions"));
    assert.equal(decisions.length, 1);
    assert.match(decisions[0], /^decision-needed-1\.json$/);
  } finally { await rm(root, { recursive: true, force: true }); }
});

test("Decision Needed resolution is immutable, one-shot, and resumes fresh Plan Review", async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), "v7-review-resolution-"));
  try {
    const state = createLifecycleState({ workflowId: "id", workflowName: "flow", runRevision: 1, risk: "HIGH", intakeStage: "feature-intake" });
    assert.ok(state);
    state.currentStage = "plan-review";
    const { revisionDir } = await createLifecycleRevision(root, state);
    const routed = await runPlanReviewLoop({ rootDir: root, state, specPath: ".ai/specs/flow.spec.md", planPath: ".ai/plans/flow.md", review: async () => ({ sessionId: "review-1", tokenUsage: tokens, verdict: "FINDINGS", findings: [finding("security", "HIGH")] }), repair: async () => ({ changedPaths: [] }) });
    const decision = path.join(revisionDir, "decisions", "decision-needed-1.json");
    await resolveV7Decision({ rootDir: root, state: routed.state, decisionPath: decision, resolutionId: "3d1941a3-7193-4bdc-9ae5-3e48c7d548fb", selectedOptionId: "accept" });
    const resumed = await resumeV7Decision({ rootDir: root, state: routed.state, resolutionId: "3d1941a3-7193-4bdc-9ae5-3e48c7d548fb" });
    assert.equal(resumed.currentStage, "plan-review");
    await assert.rejects(() => resumeV7Decision({ rootDir: root, state: routed.state, resolutionId: "3d1941a3-7193-4bdc-9ae5-3e48c7d548fb" }), /already consumed/);
  } finally { await rm(root, { recursive: true, force: true }); }
});
