import assert from "node:assert/strict";
import test from "node:test";

import {
  codexCapacityFallbackConfig,
  codexExecutionConfig,
  WORKFLOW_RUNNER_CODEX_FALLBACK_MODEL,
} from "./codex.ts";

test("Codex routing selects the configured model and reasoning for every workflow stage", () => {
  assert.deepEqual(codexExecutionConfig(".ai/prompts/execute-plan.md"), {
    model: "gpt-5.5",
    reasoning: "high",
  });
  assert.deepEqual(codexExecutionConfig(".ai/prompts/review-changes.md"), {
    model: "gpt-5.6-terra",
    reasoning: "xhigh",
  });
  assert.deepEqual(codexExecutionConfig(".ai/prompts/commit-summary.md"), {
    model: "gpt-5.6-terra",
    reasoning: "medium",
  });
  assert.throws(
    () => codexExecutionConfig(".ai/prompts/unknown.md"),
    /codex config missing/,
  );
});

test("Codex capacity fallback changes only non-fallback models", () => {
  assert.deepEqual(
    codexCapacityFallbackConfig({ model: "gpt-5.6-terra", reasoning: "high" }),
    { model: WORKFLOW_RUNNER_CODEX_FALLBACK_MODEL, reasoning: "high" },
  );
  assert.equal(
    codexCapacityFallbackConfig({
      model: WORKFLOW_RUNNER_CODEX_FALLBACK_MODEL,
      reasoning: "high",
    }),
    undefined,
  );
});
