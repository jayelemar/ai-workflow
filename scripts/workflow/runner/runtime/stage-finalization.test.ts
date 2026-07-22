import assert from "node:assert/strict";
import { readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";
import test from "node:test";

import { parsePlan } from "../plan/state.ts";
import {
  completeStageFinalization,
  finalizeStageDescriptor,
  reserveStageDescriptor,
} from "./stage-finalization.ts";
import {
  createThinPlanArtifactWriter,
  setupWorkflowWorkspace,
} from "../__tests__/helpers/workspace.ts";
import {
  thinPlanManifest,
  writeWorkflowRunnerPlan,
} from "../__tests__/helpers/runner-plan.ts";

const writeArtifacts = createThinPlanArtifactWriter("stage-finalization");

test("runner finalizes only a reserved event and writes canonical state", async () => {
  const workspace = await setupWorkflowWorkspace({ prefix: "stage-finalization-" });
  try {
    await writeArtifacts(workspace.root, {
      status: "active",
      nextAction: "execute-plan",
      latest: {
        validation: {
          version: 1,
          outcome: "approved",
          summary: "Fixture validation approved.",
          evidence: ".ai/artifacts/artifact-state/events/validation-v1.md",
        },
      },
    });
    await writeWorkflowRunnerPlan(
      workspace.root,
      "artifact-state",
      thinPlanManifest("active", "execute-plan"),
    );
    const plan = await parsePlan({
      rootDir: workspace.root,
      planName: ".ai/plans/artifact-state.md",
    });
    assert.ok(plan.ok, plan.ok ? undefined : plan.reason);
    if (!plan.ok) return;
    const descriptor = await reserveStageDescriptor({ rootDir: workspace.root, plan });
    assert.equal("ok" in descriptor, false);
    if ("ok" in descriptor) return;
    await writeFile(
      join(workspace.root, descriptor.eventPath),
      `# Execution v${descriptor.version}\n\n## Outcome\n\nreview-ready\n\n## Summary\n\nImplementation and focused validation are complete.\n\n## Evidence\n\n* pnpm test passed.\n`,
      "utf8",
    );
    const finalized = await finalizeStageDescriptor({
      rootDir: workspace.root,
      plan,
      descriptor,
    });
    assert.deepEqual(finalized, { ok: true, targetState: "review" });
    const workflow = JSON.parse(await readFile(
      join(workspace.root, ".ai/artifacts/artifact-state/state/workflow.json"),
      "utf8",
    ));
    assert.deepEqual(workflow.latest.execution, {
      version: descriptor.version,
      outcome: "review-ready",
      summary: "Implementation and focused validation are complete.",
      evidence: descriptor.eventPath,
    });
    assert.equal(workflow.history.at(-1), descriptor.eventPath);
    const manifest = await readFile(join(workspace.root, ".ai/plans/artifact-state.md"), "utf8");
    assert.match(manifest, /## Workflow State\n\nreview/);
    const completed = await completeStageFinalization({
      rootDir: workspace.root,
      planName: plan.planName,
    });
    assert.equal(completed.ok, true);
  } finally {
    await workspace.cleanup();
  }
});

test("runner restores routing documents when a stage edits them directly", async () => {
  const workspace = await setupWorkflowWorkspace({ prefix: "stage-routing-" });
  try {
    await writeArtifacts(workspace.root, {
      status: "active",
      nextAction: "execute-plan",
      latest: {
        validation: {
          version: 1,
          outcome: "approved",
          summary: "Fixture validation approved.",
          evidence: ".ai/artifacts/artifact-state/events/validation-v1.md",
        },
      },
    });
    await writeWorkflowRunnerPlan(
      workspace.root,
      "artifact-state",
      thinPlanManifest("active", "execute-plan"),
    );
    const plan = await parsePlan({
      rootDir: workspace.root,
      planName: ".ai/plans/artifact-state.md",
    });
    assert.ok(plan.ok, plan.ok ? undefined : plan.reason);
    if (!plan.ok) return;
    const descriptor = await reserveStageDescriptor({ rootDir: workspace.root, plan });
    assert.equal("ok" in descriptor, false);
    if ("ok" in descriptor) return;
    await writeFile(
      join(workspace.root, descriptor.eventPath),
      `# Execution v${descriptor.version}\n\n## Outcome\n\nreview-ready\n\n## Summary\n\nDone.\n\n## Evidence\n\n* Test passed.\n`,
      "utf8",
    );
    await writeFile(
      plan.absolutePlanPath,
      (await readFile(plan.absolutePlanPath, "utf8")).replace("\nactive\n", "\nreview\n"),
      "utf8",
    );
    const finalized = await finalizeStageDescriptor({ rootDir: workspace.root, plan, descriptor });
    assert.equal(finalized.ok, false);
    assert.match(finalized.ok ? "" : finalized.reason, /changed runner-owned workflow routing documents/);
    const manifest = await readFile(plan.absolutePlanPath, "utf8");
    assert.match(manifest, /## Workflow State\n\nactive/);
  } finally {
    await workspace.cleanup();
  }
});

test("runner rejects any manifest mutation, not only workflow-state changes", async () => {
  const workspace = await setupWorkflowWorkspace({ prefix: "stage-manifest-" });
  try {
    await writeArtifacts(workspace.root, {
      status: "active",
      nextAction: "execute-plan",
      latest: {
        validation: {
          version: 1,
          outcome: "approved",
          summary: "Fixture validation approved.",
          evidence: ".ai/artifacts/artifact-state/events/validation-v1.md",
        },
      },
    });
    await writeWorkflowRunnerPlan(
      workspace.root,
      "artifact-state",
      thinPlanManifest("active", "execute-plan"),
    );
    const plan = await parsePlan({
      rootDir: workspace.root,
      planName: ".ai/plans/artifact-state.md",
    });
    assert.ok(plan.ok, plan.ok ? undefined : plan.reason);
    if (!plan.ok) return;
    const original = await readFile(plan.absolutePlanPath, "utf8");
    const descriptor = await reserveStageDescriptor({ rootDir: workspace.root, plan });
    assert.equal("ok" in descriptor, false);
    if ("ok" in descriptor) return;
    await writeFile(
      join(workspace.root, descriptor.eventPath),
      `# Execution v${descriptor.version}

## Outcome

review-ready

## Summary

Done.

## Evidence

* Test passed.
`,
      "utf8",
    );
    await writeFile(
      plan.absolutePlanPath,
      `${original}\n## Unauthorized Manifest Note\n\nThis change must be rejected.\n`,
      "utf8",
    );

    const finalized = await finalizeStageDescriptor({ rootDir: workspace.root, plan, descriptor });

    assert.equal(finalized.ok, false);
    assert.equal(await readFile(plan.absolutePlanPath, "utf8"), original);
  } finally {
    await workspace.cleanup();
  }
});

test("runner restores file inventory and ownership when a stage mutates them", async () => {
  const workspace = await setupWorkflowWorkspace({ prefix: "stage-sidecars-" });
  try {
    await writeArtifacts(workspace.root, {
      status: "active",
      nextAction: "execute-plan",
      latest: {
        validation: {
          version: 1,
          outcome: "approved",
          summary: "Fixture validation approved.",
          evidence: ".ai/artifacts/artifact-state/events/validation-v1.md",
        },
      },
    });
    await writeWorkflowRunnerPlan(
      workspace.root,
      "artifact-state",
      thinPlanManifest("active", "execute-plan"),
    );
    const plan = await parsePlan({
      rootDir: workspace.root,
      planName: ".ai/plans/artifact-state.md",
    });
    assert.ok(plan.ok, plan.ok ? undefined : plan.reason);
    if (!plan.ok) return;
    const inventoryPath = join(workspace.root, ".ai/artifacts/artifact-state/state/files.json");
    const ownershipPath = join(workspace.root, ".ai/artifacts/artifact-state/state/file-ownership.json");
    const originalInventory = await readFile(inventoryPath, "utf8");
    const originalOwnership = await readFile(ownershipPath, "utf8");
    const descriptor = await reserveStageDescriptor({ rootDir: workspace.root, plan });
    assert.equal("ok" in descriptor, false);
    if ("ok" in descriptor) return;
    await writeFile(
      join(workspace.root, descriptor.eventPath),
      `# Execution v${descriptor.version}

## Outcome

review-ready

## Summary

Done.

## Evidence

* Test passed.
`,
      "utf8",
    );
    await writeFile(inventoryPath, "{}\n", "utf8");
    await writeFile(ownershipPath, "{}\n", "utf8");

    const finalized = await finalizeStageDescriptor({ rootDir: workspace.root, plan, descriptor });

    assert.equal(finalized.ok, false);
    assert.equal(await readFile(inventoryPath, "utf8"), originalInventory);
    assert.equal(await readFile(ownershipPath, "utf8"), originalOwnership);
  } finally {
    await workspace.cleanup();
  }
});
