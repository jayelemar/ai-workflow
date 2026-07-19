import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

import {
  WORKFLOW_STAGE_CONTRACTS,
  workflowStageContractForState,
} from "./stage.ts";

const workflowStatePath = new URL(
  "../../../instructions/shared/workflow-state.md",
  import.meta.url,
);
const progressUpdatePath = new URL(
  "../../../prompts/progress-update.md",
  import.meta.url,
);

const orderedRoutes = (routes: Array<{ status: string; nextAction: string }>) =>
  routes.toSorted((left, right) =>
    `${left.status}+${left.nextAction}`.localeCompare(
      `${right.status}+${right.nextAction}`,
    ),
  );

test("stage contract defines every documented route and execution setting", () => {
  assert.deepEqual(
    WORKFLOW_STAGE_CONTRACTS.map(({ id, model, reasoning }) => ({
      id,
      model,
      reasoning,
    })),
    [
      { id: "sync-plan-artifacts", model: "gpt-5.6-luna", reasoning: "medium" },
      { id: "plan-validator", model: "gpt-5.6-terra", reasoning: "medium" },
      { id: "execute-plan", model: "gpt-5.5", reasoning: "high" },
      { id: "unblock-plan", model: "gpt-5.6-luna", reasoning: "medium" },
      { id: "review-changes", model: "gpt-5.6-terra", reasoning: "xhigh" },
      { id: "reopen-plan", model: "gpt-5.6-luna", reasoning: "medium" },
      { id: "commit-summary", model: "gpt-5.6-terra", reasoning: "medium" },
      { id: "scope-cleanup", model: "gpt-5.6-terra", reasoning: "high" },
    ],
  );
  assert.equal(
    workflowStageContractForState("review", "review-plan")?.id,
    "review-changes",
  );
  assert.equal(workflowStageContractForState("draft", "execute-plan"), undefined);
});

test("workflow-state route matrix matches executable stage routes", async () => {
  const workflowState = await readFile(workflowStatePath, "utf8");
  const matrix = workflowState.match(
    /### Runner Route Matrix\n\n[\s\S]*?(?=\n---\n)/,
  )?.[0];
  assert.ok(matrix, "workflow-state.md must contain Runner Route Matrix");

  const documentedRoutes = Array.from(
    matrix.matchAll(/^\| `([^`]+)` \| `([^`]+)` \|/gm),
    ([, status, nextAction]) => ({ status, nextAction }),
  );
  const executableRoutes = WORKFLOW_STAGE_CONTRACTS.flatMap(({ routes }) =>
    routes.map(([status, nextAction]) => ({ status, nextAction })),
  );

  assert.deepEqual(orderedRoutes(documentedRoutes), orderedRoutes(executableRoutes));
});

test("workflow documentation describes current task-savepoint completion", async () => {
  const [workflowState, progressUpdate] = await Promise.all([
    readFile(workflowStatePath, "utf8"),
    readFile(progressUpdatePath, "utf8"),
  ]);

  assert.match(
    workflowState,
    /task-savepoint plans[\s\S]*?reviewed task's local commit[\s\S]*?next incomplete task/i,
  );
  assert.match(
    workflowState,
    /aggregate commit-summary stage with no new commit/i,
  );
  assert.doesNotMatch(progressUpdate, /completed.*no required next action/i);
});
