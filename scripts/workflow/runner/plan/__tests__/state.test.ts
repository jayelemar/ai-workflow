import assert from "node:assert/strict";
import { readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";
import test from "node:test";

import { parsePlan, synthesizeThinPlanContent } from "../state.ts";
import { parseThinPlanWorkflowState } from "../thin-plan-sidecars.ts";
import { setupWorkflowWorkspace } from "../../__tests__/helpers/workspace.ts";
import {
  thinPlanManifest,
  writeWorkflowRunnerPlan,
} from "../../__tests__/helpers/runner-plan.ts";

const planArgument = ".ai/plans/artifact-state.md";

const setupThinPlan = async () => {
  const workspace = await setupWorkflowWorkspace({ prefix: "workflow-plan-state-" });
  await writeWorkflowRunnerPlan(
    workspace.root,
    "artifact-state",
    thinPlanManifest("review", "review-plan"),
  );
  return workspace;
};

test("plan parsing rejects inline review history without rewriting the manifest", async () => {
  const workspace = await setupThinPlan();
  try {
    const planPath = join(workspace.root, planArgument);
    const original = await readFile(planPath, "utf8");
    const malformed = `${original}\n## Review History\n\n* This must be an event artifact.\n`;
    await writeFile(planPath, malformed, "utf8");

    const parsed = await parsePlan({ rootDir: workspace.root, planName: planArgument });

    assert.equal(parsed.ok, false);
    assert.match(parsed.ok ? "" : parsed.reason, /forbidden inline section/i);
    assert.equal(await readFile(planPath, "utf8"), malformed);
  } finally {
    await workspace.cleanup();
  }
});

test("thin-plan sidecars reject legacy latest records without an automatic repair", async () => {
  const workspace = await setupThinPlan();
  try {
    const workflowPath = join(
      workspace.root,
      ".ai/artifacts/artifact-state/state/workflow.json",
    );
    const legacy = {
      documentFormat: "workflow-state@1",
      planPath: planArgument,
      workflowState: "review",
      latest: {
        review: {
          version: 1,
          decision: "active",
          summary: "NEEDS FIX",
          evidence: ".ai/artifacts/artifact-state/events/review-v1.md",
        },
      },
      history: [".ai/artifacts/artifact-state/events/review-v1.md"],
      unresolvedBlockers: ["Repair the test fixture."],
      updatedAt: "2026-07-22T00:00:00.000Z",
    };
    const raw = `${JSON.stringify(legacy, null, 2)}\n`;
    await writeFile(workflowPath, raw, "utf8");

    const parsed = await parsePlan({ rootDir: workspace.root, planName: planArgument });

    assert.equal(parsed.ok, false);
    assert.match(parsed.ok ? "" : parsed.reason, /canonical version, outcome, summary, and evidence/i);
    assert.equal(await readFile(workflowPath, "utf8"), raw);
  } finally {
    await workspace.cleanup();
  }
});

test("canonical failed-review state exposes generated remediation context", async () => {
  const canonical = {
    documentFormat: "workflow-state@1",
    planPath: planArgument,
    workflowState: "active",
    latest: {
      review: {
        version: 1,
        outcome: "active",
        summary: "Fix required before completion.",
        evidence: ".ai/artifacts/artifact-state/events/review-v1.md",
        unresolvedFindings: ["Move review history into its event artifact."],
      },
    },
    history: [".ai/artifacts/artifact-state/events/review-v1.md"],
    unresolvedBlockers: ["Move review history into its event artifact."],
    updatedAt: "2026-07-22T00:00:00.000Z",
  };

  const parsed = parseThinPlanWorkflowState(
    canonical,
    planArgument,
    ".ai/artifacts/artifact-state/state/workflow.json",
  );

  assert.equal("ok" in parsed, false);
  if ("ok" in parsed) return;
  assert.equal(parsed.latest?.review?.outcome, "active");
  assert.deepEqual(parsed.unresolvedBlockers, [
    "Move review history into its event artifact.",
  ]);
});

test("synthesized content omits remediation from a review superseded by execution", () => {
  const content = synthesizeThinPlanContent({
    manifestContent: thinPlanManifest("active", "execute-plan"),
    workflow: {
      documentFormat: "workflow-state@1",
      planPath: planArgument,
      workflowState: "active",
      latest: {
        review: {
          version: 1,
          outcome: "active",
          summary: "Fixture fixes required.",
          evidence: ".ai/artifacts/artifact-state/events/review-v1.md",
          unresolvedFindings: ["Update `apps/web/src/smoke/critical.smoke.test.ts`."],
        },
        execution: {
          version: 2,
          outcome: "review-ready",
          summary: "Fixture fixes completed.",
          evidence: ".ai/artifacts/artifact-state/events/execution-v2.md",
        },
      },
      history: [
        ".ai/artifacts/artifact-state/events/review-v1.md",
        ".ai/artifacts/artifact-state/events/execution-v2.md",
      ],
      unresolvedBlockers: [],
      updatedAt: "2026-07-23T00:00:00.000Z",
    },
    files: {
      documentFormat: "files-state@1",
      created: [],
      modified: [],
      deleted: [],
      changedFiles: [],
      released: [],
      headSha: "abc123",
    },
    fileOwnership: {
      documentFormat: "file-ownership@1",
      planPath: planArgument,
      owns: [],
      released: [],
      resolvedFiles: [],
      changedFiles: [],
      headSha: "abc123",
      updatedAt: "2026-07-23T00:00:00.000Z",
    },
    implementationMap: "N/A: test fixture.",
  });

  assert.match(content, /Fixture fixes required\./);
  assert.doesNotMatch(content, /\* Remediation:/);
  assert.doesNotMatch(content, /critical\.smoke\.test\.ts/);
});
