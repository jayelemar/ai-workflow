import assert from "node:assert/strict";
import test from "node:test";

import { selectRelevantWorkflowEvent } from "./state-events.ts";

test("an active unblock event supersedes earlier blocked execution evidence", () => {
  const event = selectRelevantWorkflowEvent("", {
    documentFormat: "workflow-state@1",
    planPath: ".ai/plans/example.md",
    workflowState: "active",
    latest: {
      execution: {
        version: 4,
        outcome: "blocked",
        summary: "Database prerequisite required.",
        evidence: ".ai/artifacts/example/events/execution-v4.md",
      },
      unblock: {
        version: 1,
        outcome: "active",
        summary: "Database prerequisite completed.",
        evidence: ".ai/artifacts/example/events/unblock-v1.md",
      },
    },
    history: [
      ".ai/artifacts/example/events/execution-v4.md",
      ".ai/artifacts/example/events/unblock-v1.md",
    ],
    unresolvedBlockers: [],
    updatedAt: "2026-07-23T14:00:00.000Z",
  });

  assert.deepEqual(event, {
    kind: "unblock",
    label: "Unblock",
    stateField: "Outcome",
    stateValue: "active",
    summary: "Database prerequisite completed.",
    evidence: ".ai/artifacts/example/events/unblock-v1.md",
    reason: "latest resolved prerequisite for the next execute-plan run",
  });
});
