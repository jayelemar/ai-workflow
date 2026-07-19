import assert from "node:assert/strict";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { mkdirSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
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

type Workspace = {
  root: string;
  cleanup: () => Promise<void>;
};

const setupWorkspace = async (): Promise<Workspace> => {
  const root = await mkdtemp(join(tmpdir(), "workflow-plan-state-"));
  mkdirSync(join(root, ".ai", "plans"), { recursive: true });
  return {
    root,
    cleanup: () => rm(root, { recursive: true, force: true }),
  };
};

const writePlan = async (root: string, planName: string, content: string) => {
  await writeFile(join(root, ".ai", "plans", `${planName}.md`), content);
};

const planArg = (planName: string) => `.ai/plans/${planName}.md`;

const thinPlanV1 = (
  status: string,
  nextAction: string,
  extra = "",
) => `# Plan: workflow-runner

## Workflow Content Rules

thin-plan-v1

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

const thinPlanV2Manifest = (
  status = "review",
  nextAction = "review-plan",
  extra = "",
) => `# Plan: artifact-state

## Workflow Content Rules

thin-plan-v2

## Status

${status}

## Next Action

${nextAction}

## Spec

.ai/scripts/workflow/runner.spec.md

## Artifacts

* Implementation map: .ai/artifacts/artifact-state/implementation-map.md
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

const writeThinPlanV2Artifacts = async (
  root: string,
  overrides: Partial<{
    status: string;
    nextAction: string;
    latest: Record<string, unknown>;
    history: unknown[];
    unresolvedBlockers: string[];
  }> = {},
) => {
  const artifactRoot = join(root, ".ai", "artifacts", "artifact-state");
  mkdirSync(join(artifactRoot, "state"), { recursive: true });
  mkdirSync(join(artifactRoot, "events"), { recursive: true });
  await writeFile(
    join(artifactRoot, "implementation-map.md"),
    "# Implementation Map\n\nN/A: workflow runner refactor.\n",
  );
  await writeFile(join(artifactRoot, "state", "context.md"), "# Context\n");
  await writeFile(
    join(artifactRoot, "state", "workflow.json"),
    `${JSON.stringify(
      {
        planPath: ".ai/plans/artifact-state.md",
        status: overrides.status ?? "review",
        nextAction: overrides.nextAction ?? "review-plan",
        latest: overrides.latest ?? {
          validation: {
            version: 1,
            result: "PASS",
            summary: "Focused plan checks passed.",
            evidence: ".ai/artifacts/artifact-state/events/validation-v1.md",
          },
          review: {
            version: 2,
            summary: "NEEDS FIX",
            decision: "active",
            evidence: ".ai/artifacts/artifact-state/events/review-v2.md",
            unresolvedFindings: ["Move state tests beside the plan module."],
          },
        },
        history: overrides.history ?? [
          ".ai/artifacts/artifact-state/events/validation-v1.md",
          ".ai/artifacts/artifact-state/events/review-v2.md",
        ],
        unresolvedBlockers: overrides.unresolvedBlockers ?? [
          "Move state tests beside the plan module.",
        ],
        updatedAt: "2026-07-19T00:00:00.000Z",
      },
      null,
      2,
    )}\n`,
  );
  await writeFile(
    join(artifactRoot, "state", "file-ownership.json"),
    `${JSON.stringify(
      {
        planPath: ".ai/plans/artifact-state.md",
        owns: [".ai/scripts/workflow/runner/plan/state.ts"],
        released: [],
        resolvedFiles: [".ai/scripts/workflow/runner/plan/state.ts"],
        changedFiles: [".ai/scripts/workflow/runner/plan/state.ts"],
        headSha: "abc123",
        updatedAt: "2026-07-19T00:00:00.000Z",
      },
      null,
      2,
    )}\n`,
  );
  await writeFile(
    join(artifactRoot, "state", "files.json"),
    `${JSON.stringify(
      {
        created: [],
        modified: [".ai/scripts/workflow/runner/plan/state.ts"],
        deleted: [],
        changedFiles: [".ai/scripts/workflow/runner/plan/state.ts"],
        released: [],
        headSha: "abc123",
      },
      null,
      2,
    )}\n`,
  );
};

test("plan parser extracts task, spec, and boundary contracts", () => {
  const plan = `${thinPlanV1(
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

test("plan state parses thin-plan-v2 sidecars and recovers failed review blockers", async () => {
  const workspace = await setupWorkspace();
  try {
    await writeThinPlanV2Artifacts(workspace.root, {
      status: "review",
      nextAction: "review-plan",
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
      thinPlanV2Manifest("review", "review-plan"),
    );

    const parsed = await parsePlan({
      planName: planArg("artifact-state"),
      rootDir: workspace.root,
    });

    assert.equal(parsed.ok, true);
    assert.equal(parsed.ok && parsed.status, "active");
    assert.equal(parsed.ok && parsed.nextAction, "execute-plan");

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
    assert.equal(workflow.status, "active");
    assert.equal(workflow.nextAction, "execute-plan");
    assert.deepEqual(workflow.unresolvedBlockers, [
      "Restore failed-review findings before another execute pass.",
    ]);
  } finally {
    await workspace.cleanup();
  }
});

test("context snapshot service writes current thin-plan state and token summary", async () => {
  const workspace = await setupWorkspace();
  try {
    await writeThinPlanV2Artifacts(workspace.root, {
      status: "active",
      nextAction: "execute-plan",
    });
    await writePlan(
      workspace.root,
      "artifact-state",
      thinPlanV2Manifest("active", "execute-plan"),
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
    assert.match(snapshot, /\* Status: active/);
    assert.match(snapshot, /\* Next Action: execute-plan/);
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
    planContent: thinPlanV1(
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
    planContent: thinPlanV1(
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
  assert.match(snapshot, /\* Status: blocked/);
  assert.match(snapshot, /plan dependency/);
});
