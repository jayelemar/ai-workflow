import assert from "node:assert/strict";
import { readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";
import test from "node:test";

import { migration } from "./migrate-workflow-artifacts.ts";
import { setupWorkflowWorkspace } from "./runner/__tests__/helpers/workspace.ts";
import {
  thinPlanManifest,
  writeWorkflowRunnerPlan,
} from "./runner/__tests__/helpers/runner-plan.ts";

const planPath = ".ai/plans/artifact-state.md";
const eventPath = ".ai/artifacts/artifact-state/events/review-v1.md";

const setupLegacyReview = async () => {
  const workspace = await setupWorkflowWorkspace({ prefix: "workflow-migration-" });
  await writeWorkflowRunnerPlan(
    workspace.root,
    "artifact-state",
    thinPlanManifest("active", "execute-plan"),
  );
  const manifestPath = join(workspace.root, planPath);
  await writeFile(
    manifestPath,
    `${await readFile(manifestPath, "utf8")}\n## Review History\n\n* Decision: active\n* Evidence: ${eventPath}\n`,
    "utf8",
  );
  await writeFile(
    join(workspace.root, eventPath),
    `# Review v1

## Outcome

active

## Summary

Review requires a follow-up repair.

## Evidence

* pnpm test failed with the reproduction.

## Remediation

* Move review history into the review event.
`,
    "utf8",
  );
  const workflowPath = join(
    workspace.root,
    ".ai/artifacts/artifact-state/state/workflow.json",
  );
  await writeFile(
    workflowPath,
    `${JSON.stringify({
      documentFormat: "workflow-state@1",
      planPath,
      workflowState: "active",
      latest: {
        review: {
          version: 1,
          decision: "active",
          summary: "NEEDS FIX",
          evidence: eventPath,
        },
      },
      history: [eventPath],
      unresolvedBlockers: ["Move review history into the review event."],
      updatedAt: "2026-07-22T00:00:00.000Z",
    }, null, 2)}\n`,
    "utf8",
  );
  return { workspace, manifestPath, workflowPath };
};

test("explicit migration moves only fully provable inline review history", async () => {
  const { workspace, manifestPath, workflowPath } = await setupLegacyReview();
  try {
    await migration({ rootDir: workspace.root, cli: { planPath, apply: true } });

    const manifest = await readFile(manifestPath, "utf8");
    const workflow = JSON.parse(await readFile(workflowPath, "utf8"));
    assert.doesNotMatch(manifest, /## Review History/);
    assert.deepEqual(workflow.latest.review, {
      version: 1,
      outcome: "active",
      summary: "Review requires a follow-up repair.",
      evidence: eventPath,
      unresolvedFindings: ["Move review history into the review event."],
    });
  } finally {
    await workspace.cleanup();
  }
});

test("incomplete migration proof leaves the malformed artifacts unchanged", async () => {
  const { workspace, manifestPath, workflowPath } = await setupLegacyReview();
  try {
    const event = await readFile(join(workspace.root, eventPath), "utf8");
    await writeFile(
      join(workspace.root, eventPath),
      event.replace("\nactive\n", "\ncompleted\n"),
      "utf8",
    );
    const manifestBefore = await readFile(manifestPath, "utf8");
    const workflowBefore = await readFile(workflowPath, "utf8");

    await assert.rejects(
      migration({ rootDir: workspace.root, cli: { planPath, apply: true } }),
      /event outcome does not match/i,
    );
    assert.equal(await readFile(manifestPath, "utf8"), manifestBefore);
    assert.equal(await readFile(workflowPath, "utf8"), workflowBefore);
  } finally {
    await workspace.cleanup();
  }
});
