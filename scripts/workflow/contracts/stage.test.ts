import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

import {
  WORKFLOW_STAGE_CONTRACTS,
  workflowStageContractForState,
  type WorkflowState,
} from "./stage.ts";

const workflowStatePath = new URL("../../../instructions/shared/workflow-state.md", import.meta.url);

const states: WorkflowState[] = [
  "draft-artifact-sync", "draft-validation", "approved", "active",
  "blocked", "review", "reopening", "completed",
];

test("every canonical workflow state resolves one executable contract", () => {
  for (const workflowState of states) {
    const contract = workflowStageContractForState(workflowState);
    assert.ok(contract, `missing contract for ${workflowState}`);
    assert.ok(contract.promptPath);
    assert.ok(contract.model);
    assert.ok(contract.reasoning);
  }
  assert.equal(workflowStageContractForState("review")?.id, "review-changes");
  assert.equal(
    WORKFLOW_STAGE_CONTRACTS.filter((item) => "workflowState" in item).length,
    states.length,
  );
});

test("workflow-state matrix exactly matches executable contract", async () => {
  const content = (await readFile(workflowStatePath, "utf8")).split(
    "## Persistence Rules",
  )[0] ?? "";
  const documented = Array.from(
    content.matchAll(/^\| `([^`]+)`(?: \/ `([^`]+)`)? \| `([^`]+)` \|/gm),
    ([, firstState, secondState, action]) => [firstState, secondState]
      .filter((workflowState): workflowState is string => Boolean(workflowState))
      .map((workflowState) => ({ workflowState, action })),
  ).flat();
  const executable = states.map((workflowState) => ({
    workflowState,
    action: workflowStageContractForState(workflowState)?.id,
  }));
  assert.deepEqual(documented, executable);
});
