import assert from "node:assert/strict";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";

import { createLifecycleState, NO_CODEX_COMPLETING_STAGES } from "../lifecycle/lifecycle.ts";
import { createLifecycleRevision, lifecycleRevisionDir, readLifecycleState } from "../lifecycle/lifecycle-store.ts";
import { lifecycleReportPath } from "../lifecycle/lifecycle-report.ts";
import { recordLifecycleAttempt, runPlanReviewLoop } from "../runner/runner-orchestrator.ts";

const tokenUsage = { inputTokens: 10, cachedInputTokens: 4, uncachedInputTokens: 6, outputTokens: 2, reasoningTokens: 1, totalTokens: 12 };

test("representative HIGH V7 workflow reaches Completion Summary with verified report", async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), "v7-pilot-"));
  try {
    const initial = createLifecycleState({ workflowId: "pilot-id", workflowName: "v7-pilot", runRevision: 1, risk: "HIGH", intakeStage: "feature-intake" });
    assert.ok(initial);
    await createLifecycleRevision(root, initial);
    let state = initial;
    let session = 0;
    const complete = async () => {
      const codexBacked = !NO_CODEX_COMPLETING_STAGES.includes(state.currentStage);
      return recordLifecycleAttempt({
        rootDir: root,
        state,
        outcome: codexBacked ? "succeeded" : "zero-token",
        codexBacked,
        sessionId: codexBacked ? `pilot-${++session}` : undefined,
        model: codexBacked ? "gpt-5.5" : undefined,
        reasoning: codexBacked ? "high" : undefined,
        tokenUsage: codexBacked ? tokenUsage : { inputTokens: 0, cachedInputTokens: 0, uncachedInputTokens: 0, outputTokens: 0, reasoningTokens: 0, totalTokens: 0 },
        evidence: "full prompt must not appear",
        taskId: ["task-implementation", "task-verification", "task-review", "task-commit"].includes(state.currentStage) ? "pilot-task" : undefined,
        taskAllowedFiles: state.currentStage === "task-implementation" ? [path.join(root, "pilot-task.md")] : undefined,
        workflowRoot: state.currentStage === "task-implementation" ? root : undefined,
      });
    };
    state = await complete(); // Feature Intake
    state = await complete(); // Specification Generation
    state = await complete(); // Plan Creation
    const review = await runPlanReviewLoop({ rootDir: root, state, specPath: ".ai/specs/v7-pilot.spec.md", planPath: ".ai/plans/v7-pilot.md", review: async () => ({ sessionId: `pilot-${++session}`, tokenUsage, verdict: "OKAY" }), repair: async () => ({ changedPaths: [] }) });
    state = review.state;
    state = await complete(); // Plan Setup
    state = await complete(); // Plan Validation
    state = await complete(); // Task Implementation
    state = await complete(); // Task Verification
    state = await complete(); // Task Review
    state = await complete(); // Task Commit
    state = await complete(); // Completion Summary
    assert.equal(state.runOutcome, "completed");
    const revisionDir = lifecycleRevisionDir(root, "v7-pilot", 1);
    assert.equal((await readLifecycleState(revisionDir))?.runOutcome, "completed");
    const report = await readFile(lifecycleReportPath(revisionDir), "utf8");
    assert.match(report, /Hash chain: VERIFIED/);
    assert.doesNotMatch(report, /full prompt must not appear/);
  } finally { await rm(root, { recursive: true, force: true }); }
});
