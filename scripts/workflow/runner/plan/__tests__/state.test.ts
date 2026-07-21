import assert from "node:assert/strict";
import { readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";
import test from "node:test";

import {
  extractSpecPaths,
  parsePlanTasks,
  validateTaskCommitBoundaries,
} from "../parser.ts";
import {
  generateWorkflowContextSnapshot,
  writeWorkflowContextSnapshot,
} from "../context-snapshot.ts";
import {
  generateScopeCleanupPrompt,
  generateWorkflowPrompt,
} from "../prompt.ts";
import { parsePlan } from "../state.ts";
import {
  createThinPlanArtifactWriter,
  setupWorkflowWorkspace,
  writeWorkflowPlan,
} from "../../__tests__/helpers/workspace.ts";
import {
  planWith,
  thinPlanManifest,
  writeWorkflowRunnerPlan,
} from "../../__tests__/helpers/runner-plan.ts";
import { writeWorkflowEventArtifact } from "../../__tests__/helpers/workflow-events.ts";

const setupWorkspace = () =>
  setupWorkflowWorkspace({ prefix: "workflow-plan-state-" });

const writePlan = writeWorkflowRunnerPlan;

const writePlanStateThinPlanArtifacts =
  createThinPlanArtifactWriter("plan-state");
const writeThinPlanArtifacts = createThinPlanArtifactWriter("runner");

const planArg = (planName: string) => `.ai/plans/${planName}.md`;

const thinPlan = (
  status: string,
  nextAction: string,
  extra = "",
) => `# Plan: workflow-runner

## Workflow Content Rules

thin-plan

## Status

${status}

## Next Action

${nextAction}

## Files (MANDATORY)

### Created files

* None

### Modified files

* .ai/scripts/workflow/runner.ts

### Deleted files

* None

${extra}
`;


const deploymentValidationSection = (
  planName: string,
  status = "pending",
) => `## Deployment Validation

### Deployment Validation v1

* Summary: deployment validation pending
* Status: ${status}
* Evidence: .ai/artifacts/${planName}/events/deployment-validation-v1.md
`;

const thinPlanStateManifest = (
  workflowState = "review",
  extra = "",
) => `# Plan: artifact-state

## Document Format

plan-manifest@1

## Workflow Content Rules

thin-plan

## Execution Mode

runner-managed

## Workflow State

${workflowState}

## Spec

.ai/specs/artifact-state.spec.md

## Artifacts

* Implementation map: .ai/artifacts/artifact-state/implementation-map.md
* User journey: .ai/artifacts/artifact-state/user-journey.md
* Manual handoff: N/A: runner-managed test fixture
* Workflow state: .ai/artifacts/artifact-state/state/workflow.json
* File ownership: .ai/artifacts/artifact-state/state/file-ownership.json
* Files: .ai/artifacts/artifact-state/state/files.json
* Context: .ai/artifacts/artifact-state/state/context.md
* Events: .ai/artifacts/artifact-state/events/

## Phases

### Implementation

* Objective: Move plan services.
* Tasks:
  1. [task:01-plan-state] Extract plan state
* Expected outcome: Plan services are isolated.

${extra}
`;

test("plan parser extracts task, spec, and boundary contracts", () => {
  const plan = `${thinPlan(
    "active",
    "execute-plan",
    `## Spec

* .ai/scripts/workflow/runner.spec.md
* docs/companion.spec.md

## Phases

### Implementation

* Tasks:
  1. [task:03-extract-plan-state] Extract plan-state and prompt services

## Commit Boundaries

### [task:03-extract-plan-state]

1. Parser files: \`.ai/scripts/workflow/runner/plan/parser.ts\`
2. Prompt files: \`.ai/scripts/workflow/runner/plan/prompt.ts\`
`,
  )}`;

  assert.deepEqual(extractSpecPaths(plan), [
    ".ai/scripts/workflow/runner.spec.md",
    "docs/companion.spec.md",
  ]);
  assert.deepEqual(parsePlanTasks(plan), [
    {
      id: "03-extract-plan-state",
      words: "extract-plan-state",
      name: "Extract plan-state and prompt services",
      artifactWords: "extract-plan-state",
    },
  ]);
  assert.deepEqual(
    validateTaskCommitBoundaries({
      planContent: plan,
      taskId: "03-extract-plan-state",
      planOwnedDirtyPaths: [
        ".ai/scripts/workflow/runner/plan/parser.ts",
        ".ai/scripts/workflow/runner/plan/prompt.ts",
      ],
    }),
    { ok: true },
  );
});

test("plan state rejects legacy routing fields", async () => {
  const workspace = await setupWorkspace();
  try {
    await writeWorkflowPlan(
      workspace.root,
      "legacy-routing",
      `# Plan

## Workflow Content Rules

thin-plan

## Status

active

## Next Action

execute-plan
`,
    );
    const parsed = await parsePlan({
      planName: planArg("legacy-routing"),
      rootDir: workspace.root,
    });
    assert.equal(parsed.ok, false);
    assert.match(parsed.ok ? "" : parsed.reason, /only ## Workflow State/);
  } finally {
    await workspace.cleanup();
  }
});

test("thin-plan sidecar rejects secondary routing fields", async () => {
  const workspace = await setupWorkspace();
  try {
    await writePlanStateThinPlanArtifacts(workspace.root, {
      workflowState: "active",
    });
    await writePlan(
      workspace.root,
      "artifact-state",
      thinPlanStateManifest("active"),
    );
    const workflowPath = join(
      workspace.root,
      ".ai",
      "artifacts",
      "artifact-state",
      "state",
      "workflow.json",
    );
    const workflow = JSON.parse(await readFile(workflowPath, "utf8"));
    workflow.status = "active";
    await writeFile(workflowPath, `${JSON.stringify(workflow, null, 2)}\n`);

    const parsed = await parsePlan({
      planName: planArg("artifact-state"),
      rootDir: workspace.root,
    });
    assert.equal(parsed.ok, false);
    assert.match(parsed.ok ? "" : parsed.reason, /only workflowState/);
  } finally {
    await workspace.cleanup();
  }
});

test("plan state parses thin-plan sidecars and recovers failed review blockers", async () => {
  const workspace = await setupWorkspace();
  try {
    await writePlanStateThinPlanArtifacts(workspace.root, {
      workflowState: "review",
      latest: {
        review: {
          version: 3,
          summary: "NEEDS FIX",
          decision: "active",
          evidence: ".ai/artifacts/artifact-state/events/review-v3.md",
        },
      },
      history: [".ai/artifacts/artifact-state/events/review-v3.md"],
      unresolvedBlockers: [],
    });
    await writeFile(
      join(
        workspace.root,
        ".ai",
        "artifacts",
        "artifact-state",
        "events",
        "review-v3.md",
      ),
      `# Review v3

## Summary

NEEDS FIX

## Issues

* Restore failed-review findings before another execute pass.
`,
    );
    await writePlan(
      workspace.root,
      "artifact-state",
      thinPlanStateManifest("review"),
    );

    const parsed = await parsePlan({
      planName: planArg("artifact-state"),
      rootDir: workspace.root,
    });

    assert.equal(parsed.ok, true);
    assert.equal(parsed.ok && parsed.workflowState, "active");

    const workflow = JSON.parse(
      await readFile(
        join(
          workspace.root,
          ".ai",
          "artifacts",
          "artifact-state",
          "state",
          "workflow.json",
        ),
        "utf8",
      ),
    ) as Record<string, unknown>;
    assert.equal(workflow.workflowState, "active");
    assert.equal(workflow.status, undefined);
    assert.equal(workflow.nextAction, undefined);
    assert.deepEqual(workflow.unresolvedBlockers, [
      "Restore failed-review findings before another execute pass.",
    ]);
  } finally {
    await workspace.cleanup();
  }
});

test("plan state routes a passed review with an active decision to commit-summary", async () => {
  const workspace = await setupWorkspace();
  try {
    await writePlanStateThinPlanArtifacts(workspace.root, {
      workflowState: "active",
      latest: {
        review: {
          version: 3,
          summary: "SAFE",
          decision: "active",
          evidence: ".ai/artifacts/artifact-state/events/review-v3.md",
        },
      },
      history: [".ai/artifacts/artifact-state/events/review-v3.md"],
      unresolvedBlockers: [],
    });
    await writePlan(
      workspace.root,
      "artifact-state",
      thinPlanStateManifest("active"),
    );

    const parsed = await parsePlan({
      planName: planArg("artifact-state"),
      rootDir: workspace.root,
    });

    assert.equal(parsed.ok, true);
    assert.equal(parsed.ok && parsed.workflowState, "completed");

    const workflow = JSON.parse(
      await readFile(
        join(
          workspace.root,
          ".ai",
          "artifacts",
          "artifact-state",
          "state",
          "workflow.json",
        ),
        "utf8",
      ),
    ) as Record<string, unknown>;
    assert.equal(workflow.workflowState, "completed");
    assert.equal(
      (workflow.latest as { review: { decision: string } }).review.decision,
      "completed",
    );
    assert.match(
      await readFile(join(workspace.root, ".ai", "plans", "artifact-state.md"), "utf8"),
      /## Workflow State\s*\n\s*completed/,
    );
  } finally {
    await workspace.cleanup();
  }
});

test("plan state recovers a safe review despite stale execution history ordering", async () => {
  const workspace = await setupWorkspace();
  try {
    await writePlanStateThinPlanArtifacts(workspace.root, {
      workflowState: "active",
      latest: {
        execution: {
          version: 12,
          summary: "Implemented the current task and moved it to review.",
          evidence: ".ai/artifacts/artifact-state/events/execution-v12.md",
        },
        review: {
          version: 12,
          summary: "SAFE",
          decision: "active",
          evidence: ".ai/artifacts/artifact-state/events/review-v12.md",
          unresolvedFindings: [],
        },
      },
      history: [
        ".ai/artifacts/artifact-state/events/review-v12.md",
        ".ai/artifacts/artifact-state/events/execution-v12.md",
      ],
      unresolvedBlockers: [],
    });
    await writePlan(
      workspace.root,
      "artifact-state",
      thinPlanStateManifest("active"),
    );

    const parsed = await parsePlan({
      planName: planArg("artifact-state"),
      rootDir: workspace.root,
    });

    assert.equal(parsed.ok, true);
    assert.equal(parsed.ok && parsed.workflowState, "completed");
  } finally {
    await workspace.cleanup();
  }
});

test("context snapshot service writes current thin-plan state and token summary", async () => {
  const workspace = await setupWorkspace();
  try {
    await writePlanStateThinPlanArtifacts(workspace.root, {
      workflowState: "active",
    });
    await writePlan(
      workspace.root,
      "artifact-state",
      thinPlanStateManifest("active"),
    );
    const parsed = await parsePlan({
      planName: planArg("artifact-state"),
      rootDir: workspace.root,
    });
    assert.equal(parsed.ok, true);

    const result = await writeWorkflowContextSnapshot({
      rootDir: workspace.root,
      plan: parsed.ok ? parsed : (undefined as never),
      latestTokenUsage: {
        iteration: 4,
        promptPath: ".ai/prompts/execute-plan.md",
        stageInputTokens: 123,
        stageCachedInputTokens: 23,
        stageUncachedInputTokens: 100,
        stageOutputTokens: 20,
        stageReasoningOutputTokens: 5,
        stageTotalTokens: 143,
        totalTokens: 1000,
      },
    });

    assert.equal(result.ok, true);
    const snapshot = await readFile(
      join(workspace.root, ".ai", "artifacts", "artifact-state", "state", "context.md"),
      "utf8",
    );
    assert.match(snapshot, /\* Workflow State: active/);
    assert.match(snapshot, /Move state tests beside the plan module/);
    assert.match(snapshot, /Stage Input Tokens: 123/);
  } finally {
    await workspace.cleanup();
  }
});

test("prompt services build active-context and scope-cleanup prompts", () => {
  const workflowPrompt = generateWorkflowPrompt({
    promptPath: ".ai/prompts/execute-plan.md",
    planPath: ".ai/plans/workflow-runner.md",
    promptContent: "EXECUTE PLAN PROMPT",
    planContent: thinPlan(
      "active",
      "execute-plan",
      "## Spec\n\n* .ai/scripts/workflow/runner.spec.md\n",
    ),
    taskContext: {
      task: {
        id: "03-extract-plan-state",
        words: "extract-plan-state",
        name: "Extract plan-state and prompt services",
        artifactWords: "extract-plan-state",
      },
      stage: "implementing",
      artifactPath:
        ".ai/artifacts/workflow-runner/tasks/03-extract-plan-state-v1.md",
    },
  });

  assert.match(workflowPrompt, /Active Context Packet:/);
  assert.match(workflowPrompt, /\.ai\/scripts\/workflow\/runner\.spec\.md/);
  assert.match(workflowPrompt, /Task ID: 03-extract-plan-state/);
  assert.match(workflowPrompt, /End-of-stage output requirement:/);

  const cleanupPrompt = generateScopeCleanupPrompt({
    promptContent: "SCOPE CLEANUP PROMPT",
    planPath: ".ai/plans/workflow-runner.md",
    contextSnapshotPath: ".ai/artifacts/workflow-runner/state/context.md",
    specPaths: [".ai/scripts/workflow/runner.spec.md"],
    paths: [".ai/scripts/workflow/runner/plan/prompt.ts"],
    diff: "diff --git a/file b/file",
    mode: "review",
  });

  assert.match(cleanupPrompt, /Use \.ai\/prompts\/scope-cleanup\.md/);
  assert.match(cleanupPrompt, /Snapshot path:/);
  assert.match(cleanupPrompt, /Path-scoped staged diff:/);
  assert.doesNotMatch(cleanupPrompt, /Plan content:/);
});

test("context snapshot rendering stays available as a pure formatter", () => {
  const snapshot = generateWorkflowContextSnapshot({
    planName: "workflow-runner",
    planPath: ".ai/plans/workflow-runner.md",
    planContent: thinPlan(
      "blocked",
      "unblock-plan",
      `## Blockers

### Blocker 1

* Description: plan dependency
* Required Action: release owned file
`,
    ),
  });

  assert.match(snapshot, /# Workflow Context Snapshot: workflow-runner/);
  assert.match(snapshot, /\* Workflow State: \(missing\)/);
  assert.match(snapshot, /plan dependency/);
});

test("parsePlanTasks extracts stable task IDs, words, and readable names", () => {
  const tasks = parsePlanTasks(`## Phases

### Implementation

* Objective: Complete task-savepoint work.
* Tasks:
  1. [task:01-backend-endpoints] Add backend endpoints
  2. [task:02-web-surface] Add web surface
`);

  assert.deepEqual(tasks, [
    { id: "01-backend-endpoints", words: "backend-endpoints", name: "Add backend endpoints", artifactWords: "backend-endpoints" },
    { id: "02-web-surface", words: "web-surface", name: "Add web surface", artifactWords: "web-surface" },
  ]);
});

test("parsePlan requires the repo-relative .ai/plans markdown path", async () => {
  const workspace = await setupWorkspace();
  try {
    await writePlan(
      workspace.root,
      "workflow-runner",
      planWith("active", "execute-plan"),
    );
    const parsed = await parsePlan({
      planName: planArg("workflow-runner"),
      rootDir: workspace.root,
    });
    assert.equal(parsed.ok, true);
    assert.equal(parsed.ok && parsed.planPath, ".ai/plans/workflow-runner.md");
    assert.equal(parsed.ok && parsed.planName, "workflow-runner");
  } finally {
    await workspace.cleanup();
  }
});

test("parsePlan accepts markdown code-wrapped workflow metadata values", async () => {
  const workspace = await setupWorkspace();
  try {
    await writePlan(
      workspace.root,
      "workflow-runner",
      planWith("`draft`", "`plan-validator`").replace(
        "thin-plan",
        "`thin-plan`",
      ),
    );
    const parsed = await parsePlan({
      planName: planArg("workflow-runner"),
      rootDir: workspace.root,
    });

    assert.equal(parsed.ok, true);
    assert.equal(parsed.ok && parsed.workflowState, "draft-validation");
  } finally {
    await workspace.cleanup();
  }
});

test("parsePlan requires thin-plan before a workflow plan is runnable", async () => {
  const workspace = await setupWorkspace();
  try {
    await writePlan(
      workspace.root,
      "legacy-plan",
      `# Plan

## Status

active

## Next Action

execute-plan
`,
    );

    const parsed = await parsePlan({
      planName: planArg("legacy-plan"),
      rootDir: workspace.root,
    });

    assert.equal(parsed.ok, false);
    assert.match(parsed.ok ? "" : parsed.reason, /thin-plan/);
  } finally {
    await workspace.cleanup();
  }
});

test("parsePlan accepts thin-plan manifest and reads current state from workflow.json", async () => {
  const workspace = await setupWorkspace();
  try {
    await writeThinPlanArtifacts(workspace.root, {
      status: "review",
      nextAction: "review-plan",
    });
    await writePlan(
      workspace.root,
      "artifact-state",
      thinPlanManifest("review", "review-plan"),
    );

    const parsed = await parsePlan({
      planName: planArg("artifact-state"),
      rootDir: workspace.root,
    });

    assert.equal(parsed.ok, true);
    assert.equal(parsed.ok && parsed.workflowState, "review");
    assert.match(parsed.ok ? parsed.content : "", /## Files \(MANDATORY\)/);
    assert.match(parsed.ok ? parsed.content : "", /## Review History/);
    assert.match(parsed.ok ? parsed.content : "", /src\/artifact-state\.ts/);
  } finally {
    await workspace.cleanup();
  }
});

test("parsePlan accepts thin-plan sidecars without duplicated workflow state", async () => {
  const workspace = await setupWorkspace();
  try {
    await writeThinPlanArtifacts(workspace.root, {
      status: "completed",
      nextAction: "commit-summary",
    });

    const ownershipPath = join(
      workspace.root,
      ".ai",
      "artifacts",
      "artifact-state",
      "state",
      "file-ownership.json",
    );
    const ownership = JSON.parse(await readFile(ownershipPath, "utf8"));
    delete ownership.status;
    delete ownership.nextAction;
    await writeFile(ownershipPath, `${JSON.stringify(ownership, null, 2)}\n`);

    const filesPath = join(
      workspace.root,
      ".ai",
      "artifacts",
      "artifact-state",
      "state",
      "files.json",
    );
    const files = JSON.parse(await readFile(filesPath, "utf8"));
    delete files.workflow;
    await writeFile(filesPath, `${JSON.stringify(files, null, 2)}\n`);

    await writePlan(
      workspace.root,
      "artifact-state",
      thinPlanManifest("completed", "commit-summary"),
    );

    const parsed = await parsePlan({
      planName: planArg("artifact-state"),
      rootDir: workspace.root,
    });

    assert.equal(parsed.ok, true);
    assert.equal(parsed.ok && parsed.workflowState, "completed");
  } finally {
    await workspace.cleanup();
  }
});

test("parsePlan rejects thin-plan manifest and workflow sidecar state mismatch", async () => {
  const workspace = await setupWorkspace();
  try {
    await writeThinPlanArtifacts(workspace.root, {
      status: "draft",
      nextAction: "sync-plan-artifacts",
    });
    await writePlan(
      workspace.root,
      "artifact-state",
      thinPlanManifest("draft", "plan-validator"),
    );

    const parsed = await parsePlan({
      planName: planArg("artifact-state"),
      rootDir: workspace.root,
    });

    assert.equal(parsed.ok, false);
    assert.match(
      parsed.ok ? "" : parsed.reason,
      /thin-plan workflow state mismatch/,
    );
    assert.match(parsed.ok ? "" : parsed.reason, /workflow\.json/);
  } finally {
    await workspace.cleanup();
  }
});

test("parsePlan rejects thin-plan sync state when workflow sidecar is mismatched", async () => {
  const workspace = await setupWorkspace();
  try {
    await writeThinPlanArtifacts(workspace.root, {
      status: "draft",
      nextAction: "plan-validator",
    });
    await writePlan(
      workspace.root,
      "artifact-state",
      thinPlanManifest("draft", "sync-plan-artifacts"),
    );

    const parsed = await parsePlan({
      planName: planArg("artifact-state"),
      rootDir: workspace.root,
    });

    assert.equal(parsed.ok, false);
    assert.match(
      parsed.ok ? "" : parsed.reason,
      /thin-plan workflow state mismatch/,
    );
    assert.match(
      parsed.ok ? "" : parsed.reason,
      /draft-artifact-sync/,
    );
  } finally {
    await workspace.cleanup();
  }
});

test("parsePlan repairs a failed thin-plan review missing blockers and resumes execution", async () => {
  const workspace = await setupWorkspace();
  try {
    await writeThinPlanArtifacts(workspace.root, {
      status: "review",
      nextAction: "review-plan",
      activeBlockers: [],
      latest: {
        review: {
          version: 3,
          summary: "NEEDS FIX",
          decision: "active",
          evidence: ".ai/artifacts/artifact-state/events/review-v3.md",
        },
      },
      history: [".ai/artifacts/artifact-state/events/review-v3.md"],
    });
    await writeFile(
      join(
        workspace.root,
        ".ai",
        "artifacts",
        "artifact-state",
        "events",
        "review-v3.md",
      ),
      `# Review v3

## Summary

NEEDS FIX

## Issues

* Add spoofed-user regression coverage before resuming setup.
`,
      "utf8",
    );
    await writePlan(
      workspace.root,
      "artifact-state",
      thinPlanManifest("review", "review-plan"),
    );

    const parsed = await parsePlan({
      planName: planArg("artifact-state"),
      rootDir: workspace.root,
    });

    assert.equal(parsed.ok, true);
    assert.equal(parsed.ok && parsed.workflowState, "active");

    const workflow = JSON.parse(
      await readFile(
        join(
          workspace.root,
          ".ai",
          "artifacts",
          "artifact-state",
          "state",
          "workflow.json",
        ),
        "utf8",
      ),
    ) as Record<string, unknown>;
    assert.equal(workflow.workflowState, "active");
    assert.deepEqual(workflow.unresolvedBlockers, [
      "Add spoofed-user regression coverage before resuming setup.",
    ]);
    assert.deepEqual(
      (workflow.latest as Record<string, Record<string, unknown>>).review
        .unresolvedFindings,
      ["Add spoofed-user regression coverage before resuming setup."],
    );
    const manifest = await readFile(
      join(workspace.root, ".ai", "plans", "artifact-state.md"),
      "utf8",
    );
    assert.match(manifest, /## Workflow State\s+active/);
  } finally {
    await workspace.cleanup();
  }
});

test("parsePlan restores review findings after an unblock clears only a runtime blocker", async () => {
  const workspace = await setupWorkspace();
  try {
    await writeThinPlanArtifacts(workspace.root, {
      status: "active",
      nextAction: "execute-plan",
      activeBlockers: [],
      latest: {
        execution: {
          version: 4,
          result: "completed",
          evidence: ".ai/artifacts/artifact-state/events/execution-v4.md",
        },
        validation: {
          version: 4,
          result: "passed",
          evidence: ".ai/artifacts/artifact-state/events/validation-v4.md",
        },
        review: {
          version: 5,
          summary: "NEEDS FIX — workspace mutation is not atomic.",
          decision: "active",
          evidence: ".ai/artifacts/artifact-state/events/review-v5.md",
        },
        unblock: {
          version: 1,
          result: "resolved",
          evidence: ".ai/artifacts/artifact-state/events/unblock-v1.md",
        },
      },
      history: [
        ".ai/artifacts/artifact-state/events/execution-v4.md",
        ".ai/artifacts/artifact-state/events/validation-v4.md",
        ".ai/artifacts/artifact-state/events/review-v5.md",
        ".ai/artifacts/artifact-state/events/unblock-v1.md",
      ],
    });
    await writeFile(
      join(
        workspace.root,
        ".ai",
        "artifacts",
        "artifact-state",
        "events",
        "review-v5.md",
      ),
      `# Review v5

## Summary

NEEDS FIX

## Evidence

* The runtime blocker is separate from the mutation defect.

## Issues

* Make the workspace mutation and entitlement check atomic.
`,
      "utf8",
    );
    await writePlan(
      workspace.root,
      "artifact-state",
      thinPlanManifest("active", "execute-plan"),
    );

    const parsed = await parsePlan({
      planName: planArg("artifact-state"),
      rootDir: workspace.root,
    });

    assert.equal(parsed.ok, true);
    const workflow = JSON.parse(
      await readFile(
        join(
          workspace.root,
          ".ai",
          "artifacts",
          "artifact-state",
          "state",
          "workflow.json",
        ),
        "utf8",
      ),
    ) as Record<string, unknown>;
    assert.deepEqual(workflow.unresolvedBlockers, [
      "Make the workspace mutation and entitlement check atomic.",
    ]);
    assert.deepEqual(
      (workflow.latest as Record<string, Record<string, unknown>>).review
        .unresolvedFindings,
      ["Make the workspace mutation and entitlement check atomic."],
    );
  } finally {
    await workspace.cleanup();
  }
});

test("parsePlan accepts thin-plan remediated failed review with empty blockers", async () => {
  const workspace = await setupWorkspace();
  try {
    await writeThinPlanArtifacts(workspace.root, {
      status: "review",
      nextAction: "review-plan",
      activeBlockers: [],
      latest: {
        review: {
          version: 2,
          path: ".ai/artifacts/artifact-state/events/review-v2.md",
          summary: "NEEDS FIX",
          decision: "active",
        },
        execution: {
          version: 3,
          path: ".ai/artifacts/artifact-state/events/execution-v3.md",
          summary: "Review blockers remediated.",
          state: "review-ready",
        },
        validation: {
          version: 3,
          path: ".ai/artifacts/artifact-state/events/validation-v3.md",
          summary: "Review-remediation regressions passed.",
          result: "passed",
        },
      },
      history: [
        ".ai/artifacts/artifact-state/events/review-v2.md",
        ".ai/artifacts/artifact-state/events/execution-v3.md",
        ".ai/artifacts/artifact-state/events/validation-v3.md",
      ],
    });
    await writePlan(
      workspace.root,
      "artifact-state",
      thinPlanManifest("review", "review-plan"),
    );

    const parsed = await parsePlan({
      planName: planArg("artifact-state"),
      rootDir: workspace.root,
    });

    assert.equal(parsed.ok, true);
  } finally {
    await workspace.cleanup();
  }
});

test("parsePlan normalizes object-style review history before checking remediation progress", async () => {
  const workspace = await setupWorkspace();
  try {
    await writeThinPlanArtifacts(workspace.root, {
      status: "review",
      nextAction: "review-plan",
      activeBlockers: [],
      latest: {
        review: {
          version: 6,
          summary: "NEEDS FIX — renewal isolation is incomplete.",
          decision: "active",
          evidence: ".ai/artifacts/artifact-state/events/review-v6.md",
        },
        execution: {
          version: 8,
          summary: "Remediated renewal isolation.",
          result: "completed",
          evidence: ".ai/artifacts/artifact-state/events/execution-v8.md",
        },
        validation: {
          version: 8,
          summary: "Renewal-isolation regression passed.",
          result: "passed",
          evidence: ".ai/artifacts/artifact-state/events/validation-v8.md",
        },
      },
      rawHistory: [
        {
          kind: "review",
          version: 6,
          evidence: ".ai/artifacts/artifact-state/events/review-v6.md",
        },
        ".ai/artifacts/artifact-state/events/execution-v8.md",
        ".ai/artifacts/artifact-state/events/validation-v8.md",
      ],
    });
    await writePlan(
      workspace.root,
      "artifact-state",
      thinPlanManifest("review", "review-plan"),
    );

    const parsed = await parsePlan({
      planName: planArg("artifact-state"),
      rootDir: workspace.root,
    });

    assert.equal(parsed.ok, true);
  } finally {
    await workspace.cleanup();
  }
});

test("parsePlan rejects thin-plan when required artifacts are missing", async () => {
  const workspace = await setupWorkspace();
  try {
    await writePlan(workspace.root, "artifact-state", thinPlanManifest());

    const parsed = await parsePlan({
      planName: planArg("artifact-state"),
      rootDir: workspace.root,
    });

    assert.equal(parsed.ok, false);
    assert.match(
      parsed.ok ? "" : parsed.reason,
      /thin-plan artifact does not exist.*implementation-map\.md/,
    );
  } finally {
    await workspace.cleanup();
  }
});

test("parsePlan rejects thin-plan forbidden inline workflow sections", async () => {
  const workspace = await setupWorkspace();
  try {
    await writeThinPlanArtifacts(workspace.root);
    await writePlan(
      workspace.root,
      "artifact-state",
      thinPlanManifest(
        "draft",
        "plan-validator",
        `## Implementation Map

### User Action: Inline mapping

* UI route/component: apps/web/src/app/page.tsx
`,
      ),
    );

    const parsed = await parsePlan({
      planName: planArg("artifact-state"),
      rootDir: workspace.root,
    });

    assert.equal(parsed.ok, false);
    assert.match(
      parsed.ok ? "" : parsed.reason,
      /thin-plan contains forbidden inline section Implementation Map/,
    );
  } finally {
    await workspace.cleanup();
  }
});

test("workflow context snapshot reads validation, review, and blockers from thin-plan workflow state", async () => {
  const workspace = await setupWorkspace();
  try {
    await writeThinPlanArtifacts(workspace.root, {
      status: "blocked",
      nextAction: "unblock-plan",
      latestValidationResult: "FAIL",
      latestReviewSummary: "HIGH RISK",
      activeBlockers: [
        "Plan dependency | .ai/plans/owner.md still owns src/artifact-state.ts",
      ],
    });
    await writePlan(
      workspace.root,
      "artifact-state",
      thinPlanManifest("blocked", "unblock-plan"),
    );
    const parsed = await parsePlan({
      planName: planArg("artifact-state"),
      rootDir: workspace.root,
    });
    assert.equal(parsed.ok, true);

    const snapshot = generateWorkflowContextSnapshot({
      planName: "artifact-state",
      planPath: ".ai/plans/artifact-state.md",
      planContent: parsed.ok ? parsed.content : "",
    });

    assert.match(snapshot, /\* Workflow State: blocked/);
    assert.match(snapshot, /\* Result: FAIL/);
    assert.match(snapshot, /\* Summary: HIGH RISK/);
    assert.match(snapshot, /Fix the artifact state reader/);
    assert.match(
      snapshot,
      /Plan dependency \| \.ai\/plans\/owner\.md still owns src\/artifact-state\.ts/,
    );
  } finally {
    await workspace.cleanup();
  }
});

test("parsePlan accepts empty thin-plan workflow history stubs", async () => {
  const workspace = await setupWorkspace();
  try {
    await writePlan(
      workspace.root,
      "workflow-runner",
      `${planWith("draft", "plan-validator")}## Execution Log

(empty)

## Validation History

(empty)

## Review History

(empty)

## Reopen History

(empty)

## Blockers

(empty)
`,
    );

    const parsed = await parsePlan({
      planName: planArg("workflow-runner"),
      rootDir: workspace.root,
    });

    assert.equal(parsed.ok, true);
  } finally {
    await workspace.cleanup();
  }
});

test("parsePlan accepts empty thin-plan workflow history stubs with section separators", async () => {
  const workspace = await setupWorkspace();
  try {
    await writePlan(
      workspace.root,
      "workflow-runner",
      `${planWith("draft", "plan-validator")}## Execution Log

(empty)

---

## Validation History

(empty)

Rules:

* Every validation iteration MUST append a new entry
* MUST NOT overwrite previous validation entries
* Validation versions MUST be sequential

---

## Review History

(empty)

Rules:

* Every review iteration MUST append a new entry
* MUST NOT overwrite previous reviews
* Review versions MUST be sequential

---

## Reopen History

(empty)

Rules:

* Every reopen iteration MUST append a new entry
* MUST NOT overwrite previous reopen entries
* Reopen versions MUST be sequential

---

## Blockers

(empty)
`,
    );

    const parsed = await parsePlan({
      planName: planArg("workflow-runner"),
      rootDir: workspace.root,
    });

    assert.equal(parsed.ok, true);
  } finally {
    await workspace.cleanup();
  }
});

test("parsePlan accepts bounded thin-plan entries with matching artifact evidence", async () => {
  const workspace = await setupWorkspace();
  try {
    await writeWorkflowEventArtifact({
      root: workspace.root,
      planName: "workflow-runner",
      kind: "execution",
      version: 1,
      summary: "Implementation finished.",
      evidence:
        "rtk pnpm exec tsx --test-name-pattern thin-plan .ai/scripts/workflow/runner/__tests__/integration/runner.test.ts",
    });
    await writePlan(
      workspace.root,
      "workflow-runner",
      planWith(
        "active",
        "execute-plan",
        `## Execution Log

### Execution v1

* Summary: Implementation finished.
* Result: completed
* Evidence: .ai/artifacts/workflow-runner/events/execution-v1.md
`,
      ),
    );

    const parsed = await parsePlan({
      planName: planArg("workflow-runner"),
      rootDir: workspace.root,
    });

    assert.equal(parsed.ok, true);
  } finally {
    await workspace.cleanup();
  }
});

test("parsePlan accepts thin-plan workflow entries with only summary, state, and evidence", async () => {
  const workspace = await setupWorkspace();
  try {
    await writeWorkflowEventArtifact({
      root: workspace.root,
      planName: "thin-stubs",
      kind: "validation",
      version: 1,
    });
    await writeWorkflowEventArtifact({
      root: workspace.root,
      planName: "thin-stubs",
      kind: "review",
      version: 1,
    });
    await writePlan(
      workspace.root,
      "thin-stubs",
      planWith(
        "completed",
        "commit-summary",
        `## Validation History

### Validation v1

* Summary: Required tests passed.
* Result: APPROVED
* Evidence: .ai/artifacts/thin-stubs/events/validation-v1.md

## Review History

### Review v1

* Summary: Safe for local commit summary.
* Decision: completed
* Evidence: .ai/artifacts/thin-stubs/events/review-v1.md
`,
      ),
    );

    const parsed = await parsePlan({
      planName: planArg("thin-stubs"),
      rootDir: workspace.root,
    });

    assert.equal(parsed.ok, true);
  } finally {
    await workspace.cleanup();
  }
});

test("parsePlan ignores historical Deployment Validation sections for thin-plan validation", async () => {
  const workspace = await setupWorkspace();
  try {
    await writePlan(
      workspace.root,
      "historical-deployment-validation",
      planWith(
        "completed",
        "commit-summary",
        deploymentValidationSection("historical-deployment-validation"),
      ),
    );

    const parsed = await parsePlan({
      planName: planArg("historical-deployment-validation"),
      rootDir: workspace.root,
    });

    assert.equal(parsed.ok, true);
  } finally {
    await workspace.cleanup();
  }
});

test("parsePlan rejects unsupported fields in thin-plan workflow entries", async () => {
  const workspace = await setupWorkspace();
  try {
    await writeWorkflowEventArtifact({
      root: workspace.root,
      planName: "unsupported-thin-field",
      kind: "review",
      version: 1,
    });
    await writePlan(
      workspace.root,
      "unsupported-thin-field",
      planWith(
        "review",
        "review-plan",
        `## Review History

### Review v1

* Summary: NEEDS FIX
* Issues:
  * Move detailed issue notes to the review artifact.
* Evidence: .ai/artifacts/unsupported-thin-field/events/review-v1.md
* Decision: active
`,
      ),
    );

    const parsed = await parsePlan({
      planName: planArg("unsupported-thin-field"),
      rootDir: workspace.root,
    });

    assert.equal(parsed.ok, false);
    assert.match(parsed.ok ? "" : parsed.reason, /unsupported field.*Issues/);
  } finally {
    await workspace.cleanup();
  }
});

test("parsePlan rejects oversized thin-plan workflow entries and aggregate history", async () => {
  const workspace = await setupWorkspace();
  try {
    await writeWorkflowEventArtifact({
      root: workspace.root,
      planName: "oversized-thin-entry",
      kind: "execution",
      version: 1,
    });
    await writePlan(
      workspace.root,
      "oversized-thin-entry",
      planWith(
        "active",
        "execute-plan",
        `## Execution Log

### Execution v1

* Summary: ${"x".repeat(500)}
* Result: completed
* Evidence: .ai/artifacts/oversized-thin-entry/events/execution-v1.md
`,
      ),
    );
    const oversizedEntry = await parsePlan({
      planName: planArg("oversized-thin-entry"),
      rootDir: workspace.root,
    });
    assert.equal(oversizedEntry.ok, false);
    assert.match(
      oversizedEntry.ok ? "" : oversizedEntry.reason,
      /entry exceeds 512 bytes/,
    );

    for (let version = 1; version <= 18; version += 1) {
      await writeWorkflowEventArtifact({
        root: workspace.root,
        planName: "oversized-thin-history",
        kind: "validation",
        version,
      });
    }
    const aggregateEntries = Array.from({ length: 18 }, (_, index) => {
      const version = index + 1;
      return `### Validation v${version}

* Summary: ${"x".repeat(120)}
* Result: APPROVED
* Evidence: .ai/artifacts/oversized-thin-history/events/validation-v${version}.md`;
    }).join("\n\n");
    await writePlan(
      workspace.root,
      "oversized-thin-history",
      planWith(
        "active",
        "execute-plan",
        `## Validation History

${aggregateEntries}
`,
      ),
    );
    const oversizedHistory = await parsePlan({
      planName: planArg("oversized-thin-history"),
      rootDir: workspace.root,
    });
    assert.equal(oversizedHistory.ok, true);
    assert.match(
      oversizedHistory.ok ? oversizedHistory.warnings.join("\n") : "",
      /workflow history is .* > 4 KB/,
    );
  } finally {
    await workspace.cleanup();
  }
});


test("parsePlan rejects forbidden narrative sections in thin-plan files", async () => {
  const workspace = await setupWorkspace();
  try {
    await writeWorkflowEventArtifact({
      root: workspace.root,
      planName: "narrative-section",
      kind: "review",
      version: 1,
    });
    await writePlan(
      workspace.root,
      "narrative-section",
      planWith(
        "review",
        "review-plan",
        `## Review History

### Review v1

* Summary: NEEDS FIX
* Decision: active
* Evidence: .ai/artifacts/narrative-section/events/review-v1.md

## Review Required Fixes

* Resolved: This detailed fix note belongs in the review artifact.
`,
      ),
    );

    const parsed = await parsePlan({
      planName: planArg("narrative-section"),
      rootDir: workspace.root,
    });

    assert.equal(parsed.ok, false);
    assert.match(
      parsed.ok ? "" : parsed.reason,
      /forbidden narrative section.*Review Required Fixes/,
    );
  } finally {
    await workspace.cleanup();
  }
});

test("parsePlan rejects missing, mismatched, and oversized thin-plan artifacts", async () => {
  const workspace = await setupWorkspace();
  try {
    await writePlan(
      workspace.root,
      "missing-artifact",
      planWith(
        "active",
        "execute-plan",
        `## Validation History

### Validation v2

* Summary: Tests passed.
* Result: PASS
* Evidence: .ai/artifacts/missing-artifact/events/validation-v2.md
`,
      ),
    );
    const missingArtifact = await parsePlan({
      planName: planArg("missing-artifact"),
      rootDir: workspace.root,
    });
    assert.equal(missingArtifact.ok, false);
    assert.match(
      missingArtifact.ok ? "" : missingArtifact.reason,
      /event artifact does not exist/,
    );

    await writeWorkflowEventArtifact({
      root: workspace.root,
      planName: "path-mismatch",
      kind: "review",
      version: 1,
    });
    await writePlan(
      workspace.root,
      "path-mismatch",
      planWith(
        "review",
        "review-plan",
        `## Review History

### Review v1

* Summary: Review finished.
* Decision: active
* Evidence: .ai/artifacts/path-mismatch/events/review-v2.md
`,
      ),
    );
    const mismatched = await parsePlan({
      planName: planArg("path-mismatch"),
      rootDir: workspace.root,
    });
    assert.equal(mismatched.ok, false);
    assert.match(
      mismatched.ok ? "" : mismatched.reason,
      /must be \.ai\/artifacts\/path-mismatch\/events\/review-v1\.md/,
    );

    await writeWorkflowEventArtifact({
      root: workspace.root,
      planName: "oversized-summary",
      kind: "execution",
      version: 1,
      summary: "x".repeat(1025),
    });
    await writePlan(
      workspace.root,
      "oversized-summary",
      planWith(
        "active",
        "execute-plan",
        `## Execution Log

### Execution v1

* Summary: Implementation finished.
* Result: completed
* Evidence: .ai/artifacts/oversized-summary/events/execution-v1.md
`,
      ),
    );
    const oversized = await parsePlan({
      planName: planArg("oversized-summary"),
      rootDir: workspace.root,
    });
    assert.equal(oversized.ok, false);
    assert.match(
      oversized.ok ? "" : oversized.reason,
      /artifact summary exceeds 1 KB/,
    );

    await writeWorkflowEventArtifact({
      root: workspace.root,
      planName: "oversized-entry",
      kind: "execution",
      version: 1,
    });
    await writePlan(
      workspace.root,
      "oversized-entry",
      planWith(
        "active",
        "execute-plan",
        `## Execution Log

### Execution v1

* Summary: ${"x".repeat(2048)}
* Result: completed
* Evidence: .ai/artifacts/oversized-entry/events/execution-v1.md
`,
      ),
    );
    const oversizedEntry = await parsePlan({
      planName: planArg("oversized-entry"),
      rootDir: workspace.root,
    });
    assert.equal(oversizedEntry.ok, false);
    assert.match(
      oversizedEntry.ok ? "" : oversizedEntry.reason,
      /entry exceeds 512 bytes/,
    );

    await writeWorkflowEventArtifact({
      root: workspace.root,
      planName: "oversized-artifact",
      kind: "validation",
      version: 1,
      evidence: "x".repeat(21 * 1024),
    });
    await writePlan(
      workspace.root,
      "oversized-artifact",
      planWith(
        "active",
        "execute-plan",
        `## Validation History

### Validation v1

* Summary: Tests passed.
* Result: PASS
* Evidence: .ai/artifacts/oversized-artifact/events/validation-v1.md
`,
      ),
    );
    const oversizedArtifact = await parsePlan({
      planName: planArg("oversized-artifact"),
      rootDir: workspace.root,
    });
    assert.equal(oversizedArtifact.ok, false);
    assert.match(
      oversizedArtifact.ok ? "" : oversizedArtifact.reason,
      /artifact exceeds 20 KB/,
    );

    await writeWorkflowEventArtifact({
      root: workspace.root,
      planName: "too-many-issues",
      kind: "review",
      version: 1,
    });
    await writePlan(
      workspace.root,
      "too-many-issues",
      planWith(
        "review",
        "review-plan",
        `## Review History

### Review v1

* Summary: NEEDS FIX
* Issues:
  * issue 1
  * issue 2
  * issue 3
  * issue 4
  * issue 5
  * issue 6
* Evidence: .ai/artifacts/too-many-issues/events/review-v1.md
* Decision: active
`,
      ),
    );
    const tooManyIssues = await parsePlan({
      planName: planArg("too-many-issues"),
      rootDir: workspace.root,
    });
    assert.equal(tooManyIssues.ok, false);
    assert.match(
      tooManyIssues.ok ? "" : tooManyIssues.reason,
      /unsupported field.*Issues/,
    );
  } finally {
    await workspace.cleanup();
  }
});

test("parsePlan rejects deployment-validation as an unsupported workflow status", async () => {
  const workspace = await setupWorkspace();
  try {
    await writePlan(
      workspace.root,
      "workflow-runner",
      planWith("deployment-validation", "unblock-plan"),
    );
    const parsed = await parsePlan({
      planName: planArg("workflow-runner"),
      rootDir: workspace.root,
    });

    assert.equal(parsed.ok, false);
    assert.match(
      parsed.ok ? "" : parsed.reason,
      /unknown workflowState value: deployment-validation/,
    );
  } finally {
    await workspace.cleanup();
  }
});
