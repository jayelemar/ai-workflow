import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { join } from "node:path";
import test from "node:test";

import {
  generateScopeCleanupPrompt,
  generateWorkflowContextSnapshot,
  generateWorkflowPrompt,
} from "../../runner.ts";
import {
  collectWorkflowThresholdWarnings,
  decideWorkflowAutoNarrow,
  exceedsWorkflowTokenThresholds,
  WORKFLOW_REVIEW_FULL_DIFF_BYTE_LIMIT,
} from "../../telemetry/token-warnings.ts";
import { planWith, planWithFileScope } from "../__tests__/helpers/runner-plan.ts";

const readWorkflowPrompt = (name: string) =>
  readFile(join(process.cwd(), ".ai", "prompts", name), "utf8");

test("review prompt requires unresolved blockers for a failed thin-plan-v2 review", async () => {
  const prompt = await readWorkflowPrompt("review-changes.md");

  assert.match(prompt, /NEEDS FIX[\s\S]*unresolvedBlockers/i);
  assert.match(
    prompt,
    /do not write `\[\]` while the failed review is latest/i,
  );
});

test("unblock prompt preserves latest failed-review findings", async () => {
  const prompt = await readWorkflowPrompt("unblock-plan.md");

  assert.match(prompt, /latest review[\s\S]*unresolvedFindings/i);
  assert.match(prompt, /Never set `unresolvedBlockers` to `\[\]`/);
});

test("workflow prompts recover local E2E auth bootstrap before blocking", async () => {
  const [executePrompt, unblockPrompt] = await Promise.all([
    readWorkflowPrompt("execute-plan.md"),
    readWorkflowPrompt("unblock-plan.md"),
  ]);

  assert.match(executePrompt, /Local E2E Authentication and Harness Recovery/);
  assert.match(
    executePrompt,
    /existing local password, session, or storage-state helper/i,
  );
  assert.match(executePrompt, /do not add real credentials or tokens/i);
  assert.match(executePrompt, /keep the plan `active`/i);
  assert.match(unblockPrompt, /Local E2E Authentication and Harness Recovery/);
  assert.match(unblockPrompt, /authenticated browser session/i);
});

test("generates manual workflow prompts for every prompt action", () => {
  const cases = [
    [
      ".ai/prompts/sync-plan-artifacts.md",
      "Sync artifacts",
      "SYNC PLAN ARTIFACTS PROMPT",
    ],
    [".ai/prompts/plan-validator.md", "Validate", "PLAN VALIDATOR PROMPT"],
    [".ai/prompts/execute-plan.md", "Execute", "EXECUTE PLAN PROMPT"],
    [".ai/prompts/unblock-plan.md", "Unblock", "UNBLOCK PLAN PROMPT"],
    [".ai/prompts/review-changes.md", "Review", "REVIEW CHANGES PROMPT"],
    [".ai/prompts/reopen-plan.md", "Reopen", "REOPEN PLAN PROMPT"],
    [
      ".ai/prompts/commit-summary.md",
      "Commit summary",
      "COMMIT SUMMARY PROMPT",
    ],
  ] as const;

  for (const [promptPath, action, promptContent] of cases) {
    const prompt = generateWorkflowPrompt({
      promptPath,
      planPath: ".ai/plans/workflow-runner.md",
      promptContent,
    });

    assert.match(
      prompt,
      new RegExp(`^Use ${promptPath.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}`),
    );
    assert.match(
      prompt,
      /load: \.ai\/instructions\/shared\/reasoning-quality\.md/,
    );
    assert.match(prompt, /load: \.ai\/instructions\/shared\/debugging\.md/);
    assert.match(
      prompt,
      /Apply native shared reasoning and debugging guidance/,
    );
    assert.doesNotMatch(prompt, /load: \.ai\/prompts\/superpowers\.md/);
    assert.doesNotMatch(prompt, /Superpower skill root:/);
    assert.doesNotMatch(prompt, /use superpower skills: analyze/);
    assert.doesNotMatch(prompt, /using-superpowers\/SKILL\.md/);
    assert.doesNotMatch(prompt, /subagent-driven-development\/SKILL\.md/);
    assert.doesNotMatch(prompt, /use sub-agents/i);
    assert.match(prompt, /Active Context Packet:/);
    assert.match(
      prompt,
      new RegExp(`- ${promptPath.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}`),
    );
    assert.match(
      prompt,
      /- \.ai\/artifacts\/workflow-runner\/state\/context\.md/,
    );
    assert.match(prompt, /- \.ai\/instructions\/index\.md/);
    assert.match(prompt, /- \.ai\/instructions\/shared\/workflow-state\.md/);
    assert.match(
      prompt,
      new RegExp(`${action}:\\n\\.ai/plans/workflow-runner\\.md`),
    );
    if (promptPath === ".ai/prompts/unblock-plan.md") {
      assert.match(prompt, /Unblock evidence note:\n\(none provided\)/);
    }
    assert.match(prompt, /Workflow prompt controller:/);
    assert.match(
      prompt,
      new RegExp(
        `Follow ${promptPath.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")} exactly\\.`,
      ),
    );
    assert.match(
      prompt,
      /Do not restate or duplicate the full prompt text in this stage response\./,
    );
    assert.doesNotMatch(prompt, /Workflow prompt content:/);
    assert.doesNotMatch(prompt, /<workflow-prompt>/);
    assert.doesNotMatch(prompt, new RegExp(promptContent));
  }
});

test("execute workflow prompt requires a terminal stage summary", () => {
  const prompt = generateWorkflowPrompt({
    promptPath: ".ai/prompts/execute-plan.md",
    planPath: ".ai/plans/workflow-runner.md",
    promptContent: "EXECUTE PLAN PROMPT",
  });

  assert.match(
    prompt,
    /Before completing this execute stage, emit the controlling prompt's `## Output \(MANDATORY\)` response as the final agent message\./,
  );
  assert.match(
    prompt,
    /Include the `\*\*Plan\*\*`, `\*\*Summary\*\*`, `\*\*Key Details\*\*`, `\*\*Validation\*\*`, and `\*\*Next\*\*` sections with this stage's actual results\./,
  );
  assert.match(
    prompt,
    /Do not end the turn with only a tool-style change list, an empty response, or a bare completion acknowledgement\./,
  );
});

test("commit workflow prompt verifies and safely recovers post-commit formatter output", () => {
  const prompt = generateWorkflowPrompt({
    promptPath: ".ai/prompts/commit-summary.md",
    planPath: ".ai/plans/workflow-runner.md",
    promptContent: "COMMIT SUMMARY PROMPT",
    commitSummaryPaths: ["src/file.ts"],
  });

  assert.match(prompt, /git status --short -- src\/file\.ts/);
  assert.match(prompt, /mechanical formatter or linter output/i);
  assert.match(prompt, /git commit --amend --no-edit/);
  assert.match(prompt, /Do not amend product behavior that was edited after review/i);
});

test("review prompt requires compact terminal output", async () => {
  const prompt = await readFile(".ai/prompts/review-changes.md", "utf8");

  assert.match(prompt, /Keep output compact for terminal readability/);
  assert.match(
    prompt,
    /`\*\*Summary\*\*` starts with the stage result\/state line, then at most 2-3 short high-signal bullets/,
  );
  assert.match(
    prompt,
    /If Summary is `NEEDS FIX` or `HIGH RISK`, `\*\*Issues\*\*` must include at least one issue bullet/,
  );
  assert.match(
    prompt,
    /terminal issue bullets should focus on the problem details, not lead with file paths/i,
  );
  assert.match(
    prompt,
    /inline terminal refs only when needed to avoid ambiguity/i,
  );
  assert.match(prompt, /\*\*Plan\*\*/);
  assert.match(prompt, /\*\*Summary\*\*/);
  assert.match(prompt, /\*\*Issues\*\*/);
  assert.match(prompt, /\*\*Final Verdict\*\*/);
  assert.match(prompt, /\*\*Next\*\*/);
  assert.match(prompt, /Mark exactly one final-verdict checkbox/);
  assert.match(prompt, /- \[ \] Safe to merge/);
  assert.match(prompt, /- \[ \] Requires fixes/);
  assert.match(prompt, /- \[ \] Blocked/);
});

test("non-review prompts use the shared terminal output contract", async () => {
  const prompts = await Promise.all([
    readWorkflowPrompt("sync-plan-artifacts.md"),
    readWorkflowPrompt("plan-validator.md"),
    readWorkflowPrompt("execute-plan.md"),
    readWorkflowPrompt("reopen-plan.md"),
    readWorkflowPrompt("unblock-plan.md"),
    readWorkflowPrompt("commit-summary.md"),
  ]);

  for (const prompt of prompts) {
    assert.match(prompt, /\*\*Plan\*\*/);
    assert.match(prompt, /\*\*Summary\*\*/);
    assert.match(prompt, /\*\*Key Details\*\*/);
    assert.match(prompt, /\*\*Next\*\*/);
    assert.match(prompt, /Workflow State:/);
  }

  assert.match(prompts[2], /\*\*Validation\*\*/);
  assert.match(prompts[5], /single conventional-commit subject line/i);
  assert.match(
    prompts[5],
    /short user-facing summary list prefixed with `--`/i,
  );
  assert.match(prompts[5], /do not include a branch line/i);
});

test("native reasoning guidance describes analysis as shared instruction, not a missing skill", async () => {
  const prompt = await readFile(
    ".ai/instructions/shared/reasoning-quality.md",
    "utf8",
  );

  assert.match(
    prompt,
    /Validate assumptions against the spec, plan, codebase, and evidence/i,
  );
  assert.match(
    prompt,
    /Do not load `think`, `analyze`, or `edge-cases` as filesystem skills/i,
  );
  assert.doesNotMatch(prompt, /Use skill: think, analyze, edge-cases/);
});

test("unblock workflow prompt includes runner-provided evidence", () => {
  const prompt = generateWorkflowPrompt({
    promptPath: ".ai/prompts/unblock-plan.md",
    planPath: ".ai/plans/workflow-runner.md",
    promptContent: "UNBLOCK PLAN PROMPT",
    unblockNote:
      "Checked /en/dashboard at 1440px. Expected visible dashboard. Actual visible dashboard.",
  });

  assert.match(prompt, /Unblock evidence note:/);
  assert.match(prompt, /Checked \/en\/dashboard at 1440px/);
});

test("workflow prompt injects active context packet with current prompt, plan, spec, and cold paths", () => {
  const prompt = generateWorkflowPrompt({
    promptPath: ".ai/prompts/review-changes.md",
    planPath: ".ai/plans/workflow-runner.md",
    promptContent: "REVIEW CHANGES PROMPT",
    planContent: planWithFileScope(
      "review",
      "review-plan",
      { modified: ["apps/web/src/features/dashboard/home-page.tsx"] },
      "## Spec\n\n* .ai/specs/dashboard-home.spec.md\n",
    ),
    reviewStagingPaths: ["apps/web/src/features/dashboard/home-page.tsx"],
  });

  const activeContextPacket =
    prompt.match(
      /Active Context Packet:[\s\S]*?Use the Active Context Packet and index-selected instruction files only\./,
    )?.[0] ?? prompt;
  assert.match(prompt, /Active Context Packet:/);
  assert.match(prompt, /\.codex\/AGENTS\.md/);
  assert.match(prompt, /\.ai\/prompts\/review-changes\.md/);
  assert.match(prompt, /\.ai\/artifacts\/workflow-runner\/state\/context\.md/);
  assert.doesNotMatch(
    activeContextPacket,
    /\n- \.ai\/plans\/workflow-runner\.md/,
  );
  assert.match(prompt, /\.ai\/instructions\/index\.md/);
  assert.match(prompt, /\.ai\/instructions\/shared\/workflow-state\.md/);
  assert.match(prompt, /\.ai\/specs\/dashboard-home\.spec\.md/);
  assert.match(
    prompt,
    /Use workflow\.json only for current state, latest event pointers, and unresolved blockers/i,
  );
  assert.match(
    prompt,
    /Treat workflow\.json `history` as historical fallback only; do not inspect it during normal runs/i,
  );
  assert.match(
    prompt,
    /Open only the latest relevant event artifact referenced by the snapshot or workflow state when exact evidence is needed/i,
  );
  assert.match(prompt, /Do not broadly load `\.ai\/artifacts\/\*\*`/i);
  assert.match(
    prompt,
    /Use the Active Context Packet and index-selected instruction files only/i,
  );
  assert.match(prompt, /Plan-scoped diff boundary:/);
});

test("guarded workflow prompts add generic token guardrails after a prior token spike", () => {
  for (const promptPath of [
    ".ai/prompts/plan-validator.md",
    ".ai/prompts/execute-plan.md",
    ".ai/prompts/review-changes.md",
  ]) {
    const prompt = generateWorkflowPrompt({
      promptPath,
      planPath: ".ai/plans/workflow-runner.md",
      promptContent: "WORKFLOW PROMPT",
      workflowTokenGuardrail: {
        stageInputTokens: 1_100_000,
        stageUncachedInputTokens: 80_000,
      },
    });

    assert.match(prompt, /Workflow token guardrail:/);
    assert.match(prompt, /The previous stage exceeded token thresholds/i);
    assert.match(
      prompt,
      /\.ai\/artifacts\/workflow-runner\/state\/context\.md/,
    );
    assert.match(
      prompt,
      /Open exact plan sections or exact event artifacts only when needed/i,
    );
    assert.match(prompt, /Do not broadly load `\.ai\/artifacts\/\*\*`/i);
    assert.match(prompt, /Do not load full historical plan sections/i);
    assert.match(prompt, /required spec reads/i);
    assert.match(prompt, /path-scoped staged diff reads/i);
    assert.match(prompt, /latest validation evidence/i);
    assert.match(prompt, /workflow state reads/i);
    assert.match(prompt, /correctness-critical prompt inputs/i);
    assert.doesNotMatch(prompt, /Execute token guardrail:/);
  }
});

test("unguarded workflow prompts do not add generic token guardrails after a prior token spike", () => {
  const prompt = generateWorkflowPrompt({
    promptPath: ".ai/prompts/sync-plan-artifacts.md",
    planPath: ".ai/plans/workflow-runner.md",
    promptContent: "SYNC PLAN ARTIFACTS PROMPT",
    workflowTokenGuardrail: {
      stageInputTokens: 1_100_000,
      stageUncachedInputTokens: 80_000,
    },
  });

  assert.doesNotMatch(prompt, /Workflow token guardrail:/);
  assert.doesNotMatch(prompt, /Execute token guardrail:/);
});

test("workflow token thresholds use lowered strict warning boundaries", () => {
  assert.equal(
    exceedsWorkflowTokenThresholds({
      stageInputTokens: 299_999,
      stageUncachedInputTokens: 39_999,
    }),
    false,
  );
  assert.equal(
    exceedsWorkflowTokenThresholds({
      stageInputTokens: 300_000,
      stageUncachedInputTokens: 39_999,
    }),
    true,
  );
  assert.equal(
    exceedsWorkflowTokenThresholds({
      stageInputTokens: 299_999,
      stageUncachedInputTokens: 40_000,
    }),
    true,
  );
  assert.deepEqual(
    collectWorkflowThresholdWarnings({
      planByteSize: 1,
      latestTokenUsage: {
        stageInputTokens: 299_999,
        stageUncachedInputTokens: 39_999,
      },
    }),
    [],
  );
  assert.deepEqual(
    collectWorkflowThresholdWarnings({
      planByteSize: 1,
      latestTokenUsage: {
        stageInputTokens: 300_000,
        stageUncachedInputTokens: 39_999,
      },
    }),
    [
      "Stage token usage is high; the next guarded workflow stage will use snapshot-first guidance.",
    ],
  );
});

test("review prompt uses all-path summaries and narrowed primary full diff", () => {
  const prompt = generateWorkflowPrompt({
    promptPath: ".ai/prompts/review-changes.md",
    planPath: ".ai/plans/workflow-runner.md",
    promptContent: "REVIEW CHANGES PROMPT",
    reviewStagingPaths: ["src/a.ts", "src/b.ts", "src/c.ts"],
    reviewPrimaryPaths: ["src/b.ts"],
    reviewScopeMetadata: {
      narrowPass: 2,
      reviewAllPaths: ["src/a.ts", "src/b.ts", "src/c.ts"],
      reviewPrimaryPaths: ["src/b.ts"],
      diffBytes: 1234,
      autoNarrowReason: "review full diff 100000 bytes > 81920 bytes",
    },
  });

  assert.match(
    prompt,
    /git diff --staged --name-status -- src\/a\.ts src\/b\.ts src\/c\.ts/,
  );
  assert.match(
    prompt,
    /git diff --staged --stat -- src\/a\.ts src\/b\.ts src\/c\.ts/,
  );
  assert.match(prompt, /git diff --staged -- src\/b\.ts/);
  assert.doesNotMatch(
    prompt,
    /git diff --staged -- src\/a\.ts src\/b\.ts src\/c\.ts/,
  );
  assert.match(prompt, /Full diff byte limit: 81920/);
  assert.match(
    prompt,
    /Auto-narrow reason: review full diff 100000 bytes > 81920 bytes/,
  );
});

test("review prompt treats generated artifacts as summary-only", () => {
  const prompt = generateWorkflowPrompt({
    promptPath: ".ai/prompts/review-changes.md",
    planPath: ".ai/plans/workflow-runner.md",
    promptContent: "REVIEW CHANGES PROMPT",
    reviewStagingPaths: ["src/service.ts", "packages/db/generated.ts"],
    reviewPrimaryPaths: ["src/service.ts"],
    reviewScopeMetadata: {
      narrowPass: 1,
      reviewAllPaths: ["src/service.ts", "packages/db/generated.ts"],
      reviewPrimaryPaths: ["src/service.ts"],
      summaryOnlyPaths: ["packages/db/generated.ts"],
      diffBytes: 1234,
    },
  });

  assert.match(prompt, /generated artifacts are summary-only/i);
  assert.match(prompt, /packages\/db\/generated\.ts/);
  assert.match(
    prompt,
    /Do not spend the primary full-diff budget on generated output/i,
  );
});

test("review prompt can reject missing primary full diff paths", () => {
  const prompt = generateWorkflowPrompt({
    promptPath: ".ai/prompts/review-changes.md",
    planPath: ".ai/plans/workflow-runner.md",
    promptContent: "REVIEW CHANGES PROMPT",
    reviewStagingPaths: ["src/a.ts", "src/b.ts"],
    reviewPrimaryPaths: [],
    reviewScopeMetadata: {
      narrowPass: 1,
      reviewAllPaths: ["src/a.ts", "src/b.ts"],
      reviewPrimaryPaths: [],
    },
  });

  assert.match(prompt, /No narrowed primary full-diff paths for this pass/);
  assert.doesNotMatch(prompt, /git diff --staged -- src\/a\.ts src\/b\.ts/);
});


test("workflow auto-narrow uses only reviewable diff size, not token telemetry", () => {
  const telemetryOnly = decideWorkflowAutoNarrow({ currentPass: 3 });
  assert.equal(telemetryOnly.shouldNarrow, false);
  assert.equal(telemetryOnly.shouldStop, false);
  assert.equal(telemetryOnly.nextPass, 3);

  const third = decideWorkflowAutoNarrow({
    currentPass: 3,
    diffBytes: WORKFLOW_REVIEW_FULL_DIFF_BYTE_LIMIT + 1,
  });
  assert.equal(third.shouldStop, true);
  assert.equal(third.shouldNarrow, false);
});


test("workflow prompt includes ai-workflow instructions for .ai-owned plan files", () => {
  const prompt = generateWorkflowPrompt({
    promptPath: ".ai/prompts/review-changes.md",
    planPath: ".ai/plans/workflow-runner.md",
    promptContent: "REVIEW CHANGES PROMPT",
    planContent: planWithFileScope(
      "review",
      "review-plan",
      {
        modified: [
          ".ai/prompts/create-plan.md",
          ".ai/scripts/workflow/runner.ts",
        ],
      },
      "## Spec\n\n* .ai/scripts/workflow/runner.spec.md\n",
    ),
    reviewStagingPaths: [
      ".ai/prompts/create-plan.md",
      ".ai/scripts/workflow/runner.ts",
    ],
  });

  const activeContextPacket =
    prompt.match(
      /Active Context Packet:[\s\S]*?Use the Active Context Packet and index-selected instruction files only\./,
    )?.[0] ?? prompt;

  assert.match(activeContextPacket, /\.ai\/instructions\/ai-workflow\.md/);
  assert.match(activeContextPacket, /\.ai\/scripts\/workflow\/runner\.spec\.md/);
});

test("workflow context snapshot keeps current state and latest unresolved history only", () => {
  const snapshot = generateWorkflowContextSnapshot({
    planName: "workflow-runner",
    planPath: ".ai/plans/workflow-runner.md",
    planContent: `# Plan: workflow-runner

## Workflow State

active

## Spec

.ai/scripts/workflow/runner.spec.md

## Files (MANDATORY)

### Created files

* None

### Modified files

* .ai/scripts/workflow/runner.ts
* .ai/prompts/execute-plan.md

### Deleted files

* None

## Current Implementation Status

Completed so far:

* Snapshot generation is implemented.
* Prompt loading now prefers the compact context.

Remaining:

* Verify threshold warnings in logs and snapshots.

## Execution Log

### Execution v1

* Summary: old execution history that should be dropped
* Result: completed
* Evidence: .ai/artifacts/workflow-runner/events/execution-v1.md

### Execution v2

* Summary: latest execution summary to keep
* Result: completed
* Evidence: .ai/artifacts/workflow-runner/events/execution-v2.md

## Validation History

### Validation v1

* Summary: old validation history that should be dropped
* Result: NEEDS FIX
* Evidence: .ai/artifacts/workflow-runner/events/validation-v1.md

### Validation v2

* Summary: latest validation summary to keep
* Result: PASS
* Evidence: .ai/artifacts/workflow-runner/events/validation-v2.md

## Review History

### Review v1

* Summary: NEEDS FIX
* Decision: active
* Evidence: .ai/artifacts/workflow-runner/events/review-v1.md

### Review v2

* Summary: NEEDS FIX
* Decision: active
* Evidence: .ai/artifacts/workflow-runner/events/review-v2.md

## Blockers

### Blocker 1

* Status: resolved
* Description: old resolved blocker

### Blocker 2

* Status: unresolved
* Description: active blocker to keep
* Required Action: compact the plan history
* Next Step: rerun execute-plan
`,
    workflowState: {
      planPath: ".ai/plans/workflow-runner.md",
      workflowState: "active",
      latest: {
        execution: {
          version: 2,
          result: "completed",
          summary: "latest execution summary to keep",
          evidence: ".ai/artifacts/workflow-runner/events/execution-v2.md",
        },
        validation: {
          version: 2,
          result: "PASS",
          summary: "latest validation summary to keep",
          evidence: ".ai/artifacts/workflow-runner/events/validation-v2.md",
        },
        review: {
          version: 2,
          summary: "NEEDS FIX",
          decision: "active",
          evidence: ".ai/artifacts/workflow-runner/events/review-v2.md",
          unresolvedFindings: ["compact the plan history before the next run"],
        },
      },
      history: [
        ".ai/artifacts/workflow-runner/events/execution-v2.md",
        ".ai/artifacts/workflow-runner/events/validation-v2.md",
        ".ai/artifacts/workflow-runner/events/review-v2.md",
      ],
      unresolvedBlockers: ["compact the plan history"],
      updatedAt: "2026-07-09T00:00:00.000Z",
    },
    latestTokenUsage: {
      iteration: 7,
      promptPath: ".ai/prompts/review-changes.md",
      model: "gpt-5.6-terra",
      reasoning: "high",
      stageInputTokens: 1234,
      stageUncachedInputTokens: 934,
      stageOutputTokens: 120,
      stageTotalTokens: 1354,
      totalTokens: 54321,
    },
  });

  assert.match(snapshot, /# Workflow Context Snapshot: workflow-runner/);
  assert.match(snapshot, /## Current State/);
  assert.match(snapshot, /\* Workflow State: active/);
  assert.match(snapshot, /\.ai\/scripts\/workflow\/runner\.spec\.md/);
  assert.match(snapshot, /## Summary/);
  assert.match(snapshot, /## Key Details/);
  assert.match(snapshot, /## Validation/);
  assert.match(snapshot, /## Review/);
  assert.match(snapshot, /## Latest Relevant Event/);
  assert.match(snapshot, /\* Kind: Review/);
  assert.match(
    snapshot,
    /\* Why: latest review remediation for the next execute-plan run/,
  );
  assert.match(snapshot, /Snapshot generation is implemented/);
  assert.match(snapshot, /latest execution summary to keep/);
  assert.match(snapshot, /PASS/);
  assert.match(
    snapshot,
    /\.ai\/artifacts\/workflow-runner\/events\/review-v2\.md/,
  );
  assert.match(snapshot, /## Latest Review Remediation Context/);
  assert.match(snapshot, /\* Source Review: Review v2/);
  assert.match(snapshot, /\* Summary: NEEDS FIX/);
  assert.match(snapshot, /\* Decision: active/);
  assert.match(
    snapshot,
    /\* Evidence: \.ai\/artifacts\/workflow-runner\/events\/review-v2\.md/,
  );
  assert.match(snapshot, /active blocker to keep/);
  assert.match(snapshot, /Stage Input Tokens: 1234/);
  assert.match(snapshot, /Stage Uncached Input Tokens: 934/);
  assert.match(snapshot, /Stage Output Tokens: 120/);
  assert.doesNotMatch(snapshot, /old execution history that should be dropped/);
  assert.doesNotMatch(
    snapshot,
    /old validation history that should be dropped/,
  );
  assert.doesNotMatch(snapshot, /old review history that should be dropped/);
  assert.doesNotMatch(
    snapshot,
    /Resolved: historical fix should not be repeated/,
  );
  assert.doesNotMatch(snapshot, /## Threshold Warnings/);
});

test("workflow context snapshot emits no remediation context when not resuming execute after review", () => {
  const snapshot = generateWorkflowContextSnapshot({
    planName: "workflow-runner",
    planPath: ".ai/plans/workflow-runner.md",
    planContent: `# Plan: workflow-runner

## Workflow State

review

## Review History

### Review v3

* Summary: NEEDS FIX
* Issues:
  * latest unresolved review finding that should not be treated as execute hot-path context yet
* Decision: active
`,
  });

  assert.match(snapshot, /## Latest Review Remediation Context\s*\n\(none\)/);
  assert.match(snapshot, /## Review/);
  assert.match(
    snapshot,
    /latest unresolved review finding that should not be treated as execute hot-path context yet/,
  );
});

test("workflow context snapshot renders empty blockers as none", () => {
  const snapshot = generateWorkflowContextSnapshot({
    planName: "workflow-runner",
    planPath: ".ai/plans/workflow-runner.md",
    planContent: `# Plan: workflow-runner

## Workflow State

active

## Blockers

(empty)
`,
  });

  assert.match(snapshot, /## Active Blockers\s*\n\(none\)/);
  assert.doesNotMatch(snapshot, /\* ## Blockers/);
});

test("workflow prompts tell agents to use the snapshot first and avoid full historical plan loads", async () => {
  const promptPaths = [
    ".ai/prompts/plan-validator.md",
    ".ai/prompts/execute-plan.md",
    ".ai/prompts/review-changes.md",
    ".ai/prompts/unblock-plan.md",
    ".ai/prompts/reopen-plan.md",
    ".ai/prompts/commit-summary.md",
  ];

  for (const promptPath of promptPaths) {
    const prompt = await readFile(promptPath, "utf8");
    assert.match(prompt, /context snapshot/i);
    assert.match(prompt, /primary current-state source/i);
    assert.match(
      prompt,
      /do not load full historical sections unless the snapshot is insufficient/i,
      promptPath,
    );
  }
});

test("normal runner prompts avoid workflow history reads by default", async () => {
  const promptPaths = [
    ".ai/prompts/execute-plan.md",
    ".ai/prompts/review-changes.md",
    ".ai/prompts/commit-summary.md",
    ".ai/prompts/unblock-plan.md",
    ".ai/prompts/reopen-plan.md",
  ];

  for (const promptPath of promptPaths) {
    const prompt = await readFile(promptPath, "utf8");
    assert.match(
      prompt,
      /Do not inspect workflow `history` during normal/i,
      promptPath,
    );
  }
});

test("baseline snapshot-first guidance preserves review and blocker correctness inputs", async () => {
  const reviewChangesPrompt = await readFile(
    ".ai/prompts/review-changes.md",
    "utf8",
  );
  const unblockPrompt = await readFile(".ai/prompts/unblock-plan.md", "utf8");
  const reopenPrompt = await readFile(".ai/prompts/reopen-plan.md", "utf8");

  assert.match(reviewChangesPrompt, /path-scoped staged diff/i);
  assert.match(reviewChangesPrompt, /correctness-critical review inputs/i);

  assert.match(unblockPrompt, /unresolved blockers/i);
  assert.match(unblockPrompt, /workflow state/i);
  assert.match(unblockPrompt, /event evidence/i);

  assert.match(reopenPrompt, /reopen findings/i);
  assert.match(reopenPrompt, /workflow state/i);
  assert.match(reopenPrompt, /event evidence/i);
});

test("workflow docs describe baseline snapshot-first guidance and retain token usage measurement", async () => {
  const readme = await readFile(".ai/README.md", "utf8");
  const optimizationRecord = await readFile(
    ".ai/docs/token-usage-optimization.md",
    "utf8",
  );

  assert.match(readme, /baseline snapshot-first/i);
  assert.match(readme, /threshold crossings add stronger/i);
  assert.match(readme, /token-usage\.jsonl/);
  assert.match(readme, /measurement data/i);

  assert.match(optimizationRecord, /Baseline Snapshot-First/i);
  assert.match(optimizationRecord, /token-usage\.jsonl/);
  assert.match(optimizationRecord, /measurement data/i);
  assert.match(optimizationRecord, /Priority 2.*implemented/is);
});

test("scope cleanup prompt references the snapshot and paths instead of inlining full plan or spec content", () => {
  const prompt = generateScopeCleanupPrompt({
    promptContent: "SCOPE CLEANUP PROMPT",
    planPath: ".ai/plans/workflow-runner.md",
    contextSnapshotPath: ".ai/artifacts/workflow-runner/state/context.md",
    specPaths: [".ai/scripts/workflow/runner.spec.md"],
    paths: ["src/file.ts"],
    diff: [
      "diff --git a/src/file.ts b/src/file.ts",
      "index 1111111..2222222 100644",
      "--- a/src/file.ts",
      "+++ b/src/file.ts",
      "@@ -1 +1,2 @@",
      ' const keep = "yes";',
      '+const remove = "no";',
    ].join("\n"),
    mode: "review",
  });

  assert.match(prompt, /Plan path: \.ai\/plans\/workflow-runner\.md/);
  assert.match(
    prompt,
    /Snapshot path: \.ai\/artifacts\/workflow-runner\/state\/context\.md/,
  );
  assert.match(prompt, /Spec paths:/);
  assert.match(prompt, /\.ai\/scripts\/workflow\/runner\.spec\.md/);
  assert.match(prompt, /Path-scoped staged diff:/);
  assert.match(prompt, /const remove = "no"/);
  assert.doesNotMatch(prompt, /Plan content:/);
  assert.doesNotMatch(prompt, /Spec content:/);
});

test("workflow prompt injects repo-relative spec paths outside .ai/specs", () => {
  const prompt = generateWorkflowPrompt({
    promptPath: ".ai/prompts/execute-plan.md",
    planPath: ".ai/plans/workflow-runner.md",
    promptContent: "EXECUTE PLAN PROMPT",
    planContent: planWithFileScope(
      "active",
      "execute-plan",
      { modified: [".ai/scripts/workflow/runner.ts"] },
      "## Spec\n\n* .ai/scripts/workflow/runner.spec.md\n",
    ),
  });

  const activeContextPacket =
    prompt.match(
      /Active Context Packet:[\s\S]*?Use the Active Context Packet and index-selected instruction files only\./,
    )?.[0] ?? prompt;

  assert.match(activeContextPacket, /\.ai\/scripts\/workflow\/runner\.spec\.md/);
});

test("workflow prompt uses native guidance without Superpowers skill roots", () => {
  const prompt = generateWorkflowPrompt({
    promptPath: ".ai/prompts/execute-plan.md",
    planPath: ".ai/plans/workflow-runner.md",
    promptContent: "EXECUTE PLAN PROMPT",
    planContent: planWith("active", "execute-plan"),
  });

  assert.match(
    prompt,
    /load: \.ai\/instructions\/shared\/reasoning-quality\.md/,
  );
  assert.match(prompt, /load: \.ai\/instructions\/shared\/debugging\.md/);
  assert.doesNotMatch(prompt, /Superpower skill root:/);
  assert.doesNotMatch(prompt, /\/home\/jetermulo\/\.agents\/skills/);
  assert.doesNotMatch(prompt, /using-superpowers\/SKILL\.md/);
  assert.doesNotMatch(prompt, /executing-plans\/SKILL\.md/);
  assert.doesNotMatch(prompt, /subagent-driven-development\/SKILL\.md/);
  assert.doesNotMatch(prompt, /\/home\/jetermulo\/\.codex-shared\/skills/);
});

test("review workflow prompt defaults to harness-only review without subagents", () => {
  const prompt = generateWorkflowPrompt({
    promptPath: ".ai/prompts/review-changes.md",
    planPath: ".ai/plans/workflow-runner.md",
    promptContent: "REVIEW PROMPT",
    planContent: planWith("review", "review-plan"),
  });

  assert.match(prompt, /Harness review policy:/);
  assert.match(
    prompt,
    /Use the harness review prompt as the only review system/,
  );
  assert.doesNotMatch(prompt, /use sub-agents/i);
  assert.doesNotMatch(prompt, /subagent-driven-development\/SKILL\.md/);
  assert.doesNotMatch(prompt, /full-history fork/i);
  assert.doesNotMatch(prompt, /Superpowers/i);
});

test("non-review workflow prompts do not inject default subagent guidance", () => {
  const prompt = generateWorkflowPrompt({
    promptPath: ".ai/prompts/execute-plan.md",
    planPath: ".ai/plans/workflow-runner.md",
    promptContent: "EXECUTE PLAN PROMPT",
    planContent: planWith("active", "execute-plan"),
  });

  assert.doesNotMatch(prompt, /use sub-agents/i);
  assert.doesNotMatch(prompt, /subagent-driven-development\/SKILL\.md/);
  assert.doesNotMatch(prompt, /full-history fork/i);
  assert.doesNotMatch(
    prompt,
    /omit `agent_type`, `model`, and `reasoning_effort`/,
  );
  assert.doesNotMatch(prompt, /spawn without a full-history fork/);
});

test("workflow prompt selects area instructions from plan-owned paths", () => {
  const prompt = generateWorkflowPrompt({
    promptPath: ".ai/prompts/execute-plan.md",
    planPath: ".ai/plans/workflow-runner.md",
    promptContent: "EXECUTE PLAN PROMPT",
    planContent: planWithFileScope("active", "execute-plan", {
      modified: [
        "src/app/api/gondoor/route.ts",
        "src/services/account-service.ts",
        "supabase/migrations/20260718_add_policy.sql",
        "e2e/auth.spec.ts",
      ],
    }),
  });

  assert.match(prompt, /\.ai\/instructions\/shared\/security\.md/);
  assert.match(prompt, /\.ai\/instructions\/data-services\.md/);
  assert.match(prompt, /\.ai\/instructions\/supabase\.md/);
  assert.match(prompt, /\.ai\/instructions\/shared\/testing\.md/);
  assert.match(prompt, /\.ai\/instructions\/architecture\.md/);
});

test("review workflow prompt includes plan-scoped staged diff commands for plan-owned paths", () => {
  const prompt = generateWorkflowPrompt({
    promptPath: ".ai/prompts/review-changes.md",
    planPath: ".ai/plans/workflow-runner.md",
    promptContent: "REVIEW CHANGES PROMPT",
    reviewStagingPaths: [
      ".ai/scripts/workflow/runner.ts",
      ".ai/scripts/workflow/runner/__tests__/integration/runner.test.ts",
    ],
    reviewPrimaryPaths: [
      ".ai/scripts/workflow/runner.ts",
      ".ai/scripts/workflow/runner/__tests__/integration/runner.test.ts",
    ],
  });

  assert.match(prompt, /Plan-scoped diff boundary:/);
  assert.match(
    prompt,
    /git diff --staged --name-status -- \.ai\/scripts\/workflow\/runner\.ts \.ai\/scripts\/workflow\/runner\/__tests__\/integration\/runner\.test\.ts/,
  );
  assert.match(
    prompt,
    /git diff --staged --stat -- \.ai\/scripts\/workflow\/runner\.ts \.ai\/scripts\/workflow\/runner\/__tests__\/integration\/runner\.test\.ts/,
  );
  assert.match(
    prompt,
    /git diff --staged -- \.ai\/scripts\/workflow\/runner\.ts \.ai\/scripts\/workflow\/runner\/__tests__\/integration\/runner\.test\.ts/,
  );
  assert.doesNotMatch(
    prompt,
    /No narrowed primary full-diff paths for this pass/,
  );
  assert.match(prompt, /Ignore staged files outside this path list/);
});

test("commit-summary workflow prompt includes plan-scoped staging commands for plan-owned paths", () => {
  const prompt = generateWorkflowPrompt({
    promptPath: ".ai/prompts/commit-summary.md",
    planPath: ".ai/plans/workflow-runner.md",
    promptContent: "COMMIT SUMMARY PROMPT",
    commitSummaryPaths: ["apps/web/src/simple.ts", "docs/plan notes.md"],
  });

  assert.match(prompt, /Plan-scoped commit boundary:/);
  assert.match(
    prompt,
    /Use only these non-ignored plan-owned implementation paths:/,
  );
  assert.match(
    prompt,
    /git status --short -- apps\/web\/src\/simple\.ts 'docs\/plan notes\.md'/,
  );
  assert.match(
    prompt,
    /git diff --name-status -- apps\/web\/src\/simple\.ts 'docs\/plan notes\.md'/,
  );
  assert.match(
    prompt,
    /git add --all -- apps\/web\/src\/simple\.ts 'docs\/plan notes\.md'/,
  );
  assert.match(prompt, /pnpm lint-staged/);
  assert.match(
    prompt,
    /git diff --staged --name-status -- apps\/web\/src\/simple\.ts 'docs\/plan notes\.md'/,
  );
  assert.match(prompt, /git diff --staged --name-status\n/);
  assert.match(
    prompt,
    /SKIP_LINT_STAGED=1 git commit --cleanup=verbatim -F - <<'EOF'/,
  );
  assert.match(prompt, /<generated subject>/);
  assert.match(prompt, /<generated body>/);
  assert.doesNotMatch(
    prompt,
    /SKIP_LINT_STAGED=1 git commit --cleanup=verbatim -F - <<'EOF' -- apps\/web\/src\/simple\.ts 'docs\/plan notes\.md'/,
  );
  assert.match(prompt, /wait or poll that same command until it exits/);
  assert.match(prompt, /Do not use `HUSKY=0` or `--no-verify`/);
  assert.match(prompt, /non plan-scoped staged changes detected/);
  assert.match(prompt, /Do not stage \.ai files/);
  assert.doesNotMatch(prompt, /use sub-agents/);
});

test("workflow prompt includes task savepoint current task and aggregate-only commit summary modes", () => {
  const taskPrompt = generateWorkflowPrompt({
    promptPath: ".ai/prompts/execute-plan.md",
    planPath: ".ai/plans/workflow-runner.md",
    promptContent: "EXECUTE PLAN PROMPT",
    taskContext: {
      task: {
        id: "01-backend-endpoints",
        words: "backend-endpoints",
        name: "Add backend endpoints",
        artifactWords: "backend-endpoints",
      },
      stage: "implementing",
      artifactPath:
        ".ai/artifacts/workflow-runner/tasks/01-backend-endpoints-v1.md",
    },
  });

  assert.match(taskPrompt, /Task savepoint current task:/);
  assert.match(taskPrompt, /Task ID: 01-backend-endpoints/);
  assert.match(taskPrompt, /Task Stage: implementing/);
  assert.match(taskPrompt, /Do not start another `\[task:\.\.\.\]` item/);
  assert.match(taskPrompt, /smallest compatibility path needed/i);
  assert.match(
    taskPrompt,
    /missing backend RPC, migration, generated database type, or database regression test/i,
  );
  assert.match(taskPrompt, /current task's access\/security invariant/i);
  assert.match(
    taskPrompt,
    /add the exact file to the current plan's ownership\/inventory artifacts and continue/i,
  );
  assert.match(
    taskPrompt,
    /Do not output `STOP` solely because that minimal compatibility fix touches a file named in a later `\[task:\.\.\.\]` item/,
  );
  assert.match(
    taskPrompt,
    /Do not output `STOP` solely because the required minimal backend contract repair touches a migration, generated database contract file, or database test outside the original current-task file list/,
  );

  const commitPrompt = generateWorkflowPrompt({
    promptPath: ".ai/prompts/commit-summary.md",
    planPath: ".ai/plans/workflow-runner.md",
    promptContent: "COMMIT SUMMARY PROMPT",
    commitSummaryPaths: ["src/file.ts"],
    taskContext: {
      task: {
        id: "01-backend-endpoints",
        words: "backend-endpoints",
        name: "Add backend endpoints",
        artifactWords: "backend-endpoints",
      },
      stage: "committed",
      artifactPath:
        ".ai/artifacts/workflow-runner/tasks/01-backend-endpoints-v1.md",
    },
  });

  assert.match(
    commitPrompt,
    /SKIP_LINT_STAGED=1 git commit --cleanup=verbatim -F - <<'EOF'/,
  );
  assert.match(commitPrompt, /execution-summary\.md/);
  assert.doesNotMatch(
    commitPrompt,
    /Update \.ai\/artifacts\/<plan-name>\/execution-summary\.md/,
  );

  const aggregatePrompt = generateWorkflowPrompt({
    promptPath: ".ai/prompts/commit-summary.md",
    planPath: ".ai/plans/workflow-runner.md",
    promptContent: "COMMIT SUMMARY PROMPT",
    commitSummaryPaths: ["src/file.ts"],
    taskSavepointAggregateSummary: true,
  });

  assert.match(aggregatePrompt, /Task savepoint aggregate summary:/);
  assert.match(aggregatePrompt, /Do not create a git commit/);
  assert.doesNotMatch(
    aggregatePrompt,
    /SKIP_LINT_STAGED=1 git commit --cleanup=verbatim -F - <<'EOF'/,
  );
});

test("review workflow prompt shell-quotes path-scoped diff commands", () => {
  const prompt = generateWorkflowPrompt({
    promptPath: ".ai/prompts/review-changes.md",
    planPath: ".ai/plans/workflow-runner.md",
    promptContent: "REVIEW CHANGES PROMPT",
    reviewStagingPaths: ["src/simple.ts", "docs/plan notes.md", "src/it's.ts"],
  });

  assert.match(
    prompt,
    /git diff --staged --name-status -- src\/simple\.ts 'docs\/plan notes\.md' 'src\/it'\\''s\.ts'/,
  );
  assert.match(
    prompt,
    /git diff --staged --stat -- src\/simple\.ts 'docs\/plan notes\.md' 'src\/it'\\''s\.ts'/,
  );
  assert.doesNotMatch(
    prompt,
    /git diff --staged -- src\/simple\.ts 'docs\/plan notes\.md' 'src\/it'\\''s\.ts'/,
  );
});

test("non-review workflow prompts do not include review diff boundary instructions", () => {
  const prompt = generateWorkflowPrompt({
    promptPath: ".ai/prompts/execute-plan.md",
    planPath: ".ai/plans/workflow-runner.md",
    promptContent: "EXECUTE PLAN PROMPT",
    reviewStagingPaths: [".ai/scripts/workflow/runner.ts"],
  });

  assert.doesNotMatch(prompt, /Plan-scoped diff boundary:/);
  assert.doesNotMatch(prompt, /git diff --staged --/);
  assert.doesNotMatch(prompt, /Ignore staged files outside this path list/);
});
