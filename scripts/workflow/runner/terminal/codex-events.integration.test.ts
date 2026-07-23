import assert from "node:assert/strict";
import test from "node:test";

import {
  codexOutputContainsStop,
  codexOutputStopReason,
  isReviewNeedsFixStopReason,
  codexWorkEnvironment,
  createCodexLiveOutputFormatter,
  createWorkflowWaitNotice,
  formatCommitProgressLine,
  formatCodexJsonlEventForTerminal,
  formatWorkflowElapsedTime,
  formatWorkflowProgressLine,
  formatWorkflowWaitLine,
  supportsWorkflowAnsiColor,
  WORKFLOW_RUNNER_CODEX_PROFILE,
  WORKFLOW_WAIT_NOTICE_INTERVAL_MS,
} from "../../runner.ts";

const CODEX_COMMAND = WORKFLOW_RUNNER_CODEX_PROFILE;
const CODEX_EXEC_LABEL = `${CODEX_COMMAND} exec`;
const CODEX_HOME_SUFFIX = `/.${CODEX_COMMAND}`;
const OVERRIDE_CODEX_PROFILE = "codex-personal";
const OVERRIDE_CODEX_HOME_SUFFIX = `/.${OVERRIDE_CODEX_PROFILE}`;

const codexAgentMessageLine = (text: string) =>
  JSON.stringify({
    type: "item.completed",
    item: { id: "item_agent", type: "agent_message", text },
  });

const codexSubagentStateLine = (message: string) =>
  JSON.stringify({
    type: "item.completed",
    item: {
      id: "item_collab",
      type: "collab_tool_call",
      agents_states: [{ message }],
    },
  });

const codexCommandOutputLine = (text: string, command = "pnpm test") =>
  JSON.stringify({
    type: "item.completed",
    item: {
      id: "item_command",
      command,
      type: "command_execution",
      aggregated_output: text,
      exit_code: 0,
      status: "completed",
    },
  });

const tokenCountLine = (usedTokens: number, contextWindowTokens: number) =>
  JSON.stringify({
    type: "event_msg",
    payload: {
      type: "token_count",
      info: {
        last_token_usage: {
          total_tokens: usedTokens,
        },
        model_context_window: contextWindowTokens,
      },
    },
  });

const codexCommandStartedLine = (command = "pnpm test") =>
  JSON.stringify({
    type: "item.started",
    item: {
      id: "item_command",
      command,
      type: "command_execution",
      aggregated_output: "",
      exit_code: null,
      status: "in_progress",
    },
  });

const VITEST_FILE_COMMAND =
  "pnpm --filter @gondoor/web exec vitest run src/features/dashboard/docs/services/docs.test.ts src/features/dashboard/docs/components/docs-document-dialog.test.tsx";
const FILTERED_BACKEND_TEST_COMMAND =
  "pnpm --filter @gondoor/backend test -- test/onboarding/document-content-generator.service.spec.ts";
const FILTERED_BACKEND_BUILD_COMMAND = "pnpm --filter @gondoor/backend build";
const JEST_FILE_COMMAND =
  'pnpm --dir apps/backend exec jest --config jest.config.js --runTestsByPath test/onboarding/document-content-generator.service.spec.ts test/documents/document-content-generator.service.spec.ts --runInBand -t "candidate-specific live current|page excerpts verify direct competitors"';
const JEST_FAILED_COMMAND =
  "/bin/bash -lc 'pnpm --dir apps/backend exec jest --config jest.config.js --runTestsByPath test/onboarding/document-content-generator.service.spec.ts --runInBand -t \"widens unmapped suffixless\"'";
const APPLY_PATCH_VERIFICATION_FAILED_STDERR = [
  "2026-06-24T20:43:41.663424Z ERROR codex_core::tools::router: error=apply_patch verification failed: Failed to find expected lines in /home/jetermulo/projects/futr-wsl/Gondoor/apps/backend/src/documents/document-content-generator.service.ts:",
  "",
  "    return countries;",
  "  }",
  "",
  "  private isLikelyLocalOrRegionalGeographyLabel(label: string): boolean {",
  "    const normalized = this.normalizeGeographyLabel(label);",
].join("\n");
const GIT_STAGED_DIFF_COMMAND =
  "git diff --staged -- apps/backend/test/onboarding/document-content-generator.service.spec.ts apps/web/src/features/dashboard/docs/services/docs.test.ts apps/web/src/features/dashboard/docs/components/docs-document-dialog.test.tsx apps/backend/test/documents/document-content-generator.service.spec.ts";
const GIT_STAGED_NAME_STATUS_COMMAND =
  "git diff --staged --name-status -- apps/backend/src/documents/document-content-generator.service.ts apps/backend/src/documents/document-prompts.service.ts apps/backend/src/documents/document-generation.types.ts apps/backend/test/onboarding/document-content-generator.service.spec.ts apps/backend/test/documents/document-content-generator.service.spec.ts apps/web/src/features/dashboard/types/docs.ts apps/web/src/features/dashboard/docs/services/docs.ts apps/web/src/features/dashboard/docs/services/docs.test.ts apps/web/src/features/dashboard/docs/components/docs-document-dialog.tsx apps/web/src/features/dashboard/docs/components/docs-document-dialog.test.tsx";
const GIT_UNSTAGED_DIFF_COMMAND =
  "git diff -- apps/backend/test/onboarding/document-content-generator.service.spec.ts";
const GIT_UNSTAGED_DIFF_SED_COMMAND =
  "git diff -- apps/backend/src/documents/document-content-generator.service.ts | sed -n '1,220p'";
const GIT_SHOW_RG_COMMAND =
  'git show :apps/backend/src/documents/document-content-generator.service.ts | rg -n "broaderMarketResearch|registrationCountryContains|isLikelyLocal|buildMarketResearchCategoryTerms|generateMarketResearch|normalizeMarketResearchCompetitors|buildMarketResearchSupportMap|extractNameSupportWindows|extractFinancialSupportText|ensureSearchEvidenceGapSummary|competitor_rejected|likelyCompetitors|searchSkipped|search_skipped|fallback"';
const GIT_SHOW_SED_COMMAND =
  "git show :apps/backend/src/documents/document-content-generator.service.ts | nl -ba | sed -n '340,435p'";

test(`${CODEX_COMMAND} environment matches the local ${CODEX_COMMAND} function account context`, () => {
  assert.deepEqual(
    codexWorkEnvironment({ HOME: "/home/tester", PATH: "/usr/bin" }),
    {
      HOME: "/home/tester",
      PATH: "/home/tester/.nvm/versions/node/v20.20.2/bin:/usr/bin",
      CODEX_HOME: `/home/tester${CODEX_HOME_SUFFIX}`,
    },
  );
  assert.equal(
    codexWorkEnvironment({
      HOME: "/home/tester",
      PATH: "/home/tester/.nvm/versions/node/v20.20.2/bin:/usr/bin",
    }).PATH,
    "/home/tester/.nvm/versions/node/v20.20.2/bin:/usr/bin",
  );
  assert.deepEqual(
    codexWorkEnvironment(
      { HOME: "/home/tester", PATH: "/usr/bin" },
      OVERRIDE_CODEX_PROFILE,
    ),
    {
      HOME: "/home/tester",
      PATH: "/home/tester/.nvm/versions/node/v20.20.2/bin:/usr/bin",
      CODEX_HOME: `/home/tester${OVERRIDE_CODEX_HOME_SUFFIX}`,
    },
  );
});

test("codex JSON STOP detection ignores prompt and tool text but honors agent STOP directives", () => {
  const benignJsonOutput = [
    codexCommandOutputLine("If blocked, output `STOP`."),
    JSON.stringify({
      type: "item.completed",
      item: {
        id: "item_collab",
        type: "collab_tool_call",
        agents_states: [{ message: "STOP Check: no definite STOP required." }],
      },
    }),
    codexAgentMessageLine(
      "### Fix Summary\n\nPlan updated.\n\n### State Transition",
    ),
  ].join("\n");

  assert.equal(codexOutputContainsStop(benignJsonOutput, ""), false);
  assert.equal(
    codexOutputContainsStop(
      codexAgentMessageLine("STOP (`plan is blocked`)"),
      "",
    ),
    true,
  );
  assert.equal(codexOutputContainsStop("plain STOP output", ""), true);
  assert.equal(codexOutputContainsStop("", "STOP"), true);
});

test("codex JSON STOP reason extraction uses only agent_message STOP directives", () => {
  const stdout = [
    codexCommandOutputLine("STOP: command output should not count"),
    JSON.stringify({
      type: "item.completed",
      item: {
        id: "item_collab",
        type: "collab_tool_call",
        agents_states: [
          { message: "STOP: sub-agent diagnostic should not count" },
        ],
      },
    }),
    codexAgentMessageLine(
      "STOP: spec must be updated before plan can be fixed",
    ),
  ].join("\n");

  assert.equal(
    codexOutputStopReason(stdout, ""),
    `${CODEX_EXEC_LABEL} output contained STOP: spec must be updated before plan can be fixed`,
  );
});

test("codex JSON STOP reason extraction accepts inline-code STOP agent directives", () => {
  assert.equal(
    codexOutputContainsStop(codexAgentMessageLine("`STOP`"), ""),
    true,
  );
  assert.equal(
    codexOutputStopReason(
      codexAgentMessageLine(
        "`STOP`: spec must be updated before plan can be fixed",
      ),
      "",
    ),
    `${CODEX_EXEC_LABEL} output contained STOP: spec must be updated before plan can be fixed`,
  );
});

test("review NEEDS FIX STOP summaries are recognized as event-backed outcomes", () => {
  assert.equal(
    isReviewNeedsFixStopReason(
      `${CODEX_EXEC_LABEL} output contained STOP: NEEDS FIX.`,
    ),
    true,
  );
  assert.equal(
    isReviewNeedsFixStopReason(
      `${CODEX_EXEC_LABEL} output contained STOP: Review outcome is \`active / NEEDS FIX\`.`,
    ),
    true,
  );
  assert.equal(
    isReviewNeedsFixStopReason(
      `${CODEX_EXEC_LABEL} output contained STOP: plan must be in review state`,
    ),
    false,
  );
});

test("codex JSON STOP reason extraction accepts Unicode and mojibake dash directives", () => {
  assert.equal(
    codexOutputStopReason(
      codexAgentMessageLine("STOP — file outside plan scope"),
      "",
    ),
    `${CODEX_EXEC_LABEL} output contained STOP: file outside plan scope`,
  );
  assert.equal(
    codexOutputStopReason(
      codexAgentMessageLine("STOP ΓÇö file outside plan scope"),
      "",
    ),
    `${CODEX_EXEC_LABEL} output contained STOP: file outside plan scope`,
  );
});

test("codex JSON STOP reason extraction ignores STOP text in command output", () => {
  assert.equal(
    codexOutputStopReason(
      codexCommandOutputLine("STOP: command failed for another reason"),
      "",
    ),
    undefined,
  );
  assert.equal(
    codexOutputContainsStop(
      codexCommandOutputLine("STOP: command failed for another reason"),
      "",
    ),
    false,
  );
});

test("plain stdout and stderr STOP reason extraction includes a bounded excerpt", () => {
  assert.equal(
    codexOutputStopReason(
      "first line\nSTOP: plan needs a spec update\nlast line",
      "",
    ),
    `${CODEX_EXEC_LABEL} output contained STOP: plan needs a spec update`,
  );
  assert.equal(
    codexOutputStopReason("", "warning\nSTOP: external service is unavailable"),
    `${CODEX_EXEC_LABEL} output contained STOP: external service is unavailable`,
  );

  const longReason = codexOutputStopReason(`STOP: ${"x".repeat(500)}`, "");
  assert.equal(typeof longReason, "string");
  assert.equal((longReason ?? "").length < 320, true);
});

test("codex live output formatter converts JSONL events into readable terminal output", () => {
  assert.equal(
    formatCodexJsonlEventForTerminal(
      JSON.stringify({ type: "thread.started", thread_id: "thread_123" }),
    ),
    "[codex] thread started thread_123\n\n",
  );
  assert.equal(
    formatCodexJsonlEventForTerminal(
      codexCommandStartedLine("git status --short"),
      { color: false },
    ),
    "Ran git status --short\n\n",
  );
  assert.equal(
    formatCodexJsonlEventForTerminal(
      codexCommandOutputLine(" M src/file.ts\n"),
      { color: false },
    ),
    "",
  );
  assert.equal(
    formatCodexJsonlEventForTerminal(codexAgentMessageLine("Done")),
    "[agent]\nDone\n\n",
  );
  assert.equal(
    formatCodexJsonlEventForTerminal(tokenCountLine(50, 100)),
    "[context] 50/100 tokens (50.00%)\n\n",
  );
});

test("codex live output formatter condenses workflow completion summaries", () => {
  const workflowSummary = [
    "**Plan**",
    "`.ai/plans/market-research-competitor-discovery.md`",
    "",
    "**Summary**",
    "* REVIEW READY",
    "* Implemented Review v7 remediation for suffixless local/regional widening.",
    "* Preserved strict direct-competitor verification while widening matching-country local labels.",
    "* Manual browser validation remains deferred to review.",
    "",
    "**Key Details**",
    "* Added guarded handling for Seattle -> United States and Makati -> Philippines.",
    "* Prevented explicit country/region labels like UK, UAE, and Puerto Rico from widening to unrelated registration countries.",
    "* Fixed a regression where descriptor localities like `Iloilo City` could widen to a conflicting country.",
    "* Used read-only sub-agents for root-cause, spec, and code-quality review; final review approved.",
    "",
    "**Validation**",
    "* `pnpm --filter @gondoor/backend test -- test/onboarding/document-content-generator.service.spec.ts`: passed, 214 tests.",
    "* `pnpm --filter @gondoor/backend test -- test/documents/document-content-generator.service.spec.ts`: passed, 10 tests.",
    "* `pnpm --filter @gondoor/backend build`: passed, SWC compiled 987 files.",
    "* `pnpm --filter @gondoor/web exec vitest run src/features/dashboard/docs/services/docs.test.ts src/features/dashboard/docs/components/docs-document-dialog.test.tsx`: passed, 2 files / 30 tests.",
    "* Known limitation: live/manual checks for real generation logs, generated payload inspection, and opened dashboard dialog remain deferred to review.",
    "",
    "**Next**",
    "Workflow State: `review`",
  ].join("\n");

  assert.equal(
    formatCodexJsonlEventForTerminal(codexAgentMessageLine(workflowSummary), {
      color: false,
    }),
    [
      "[agent]",
      "**Plan**",
      "`.ai/plans/market-research-competitor-discovery.md`",
      "",
      "**Summary**",
      "* REVIEW READY",
      "* Implemented Review v7 remediation for suffixless local/regional widening.",
      "* Preserved strict direct-competitor verification while widening matching-country local labels.",
      "* Manual browser validation remains deferred to review.",
      "",
      "**Key Details**",
      "* Added guarded handling for Seattle -> United States and Makati -> Philippines.",
      "* Prevented explicit country/region labels like UK, UAE, and Puerto Rico from widening to unrelated registration countries.",
      "* Fixed a regression where descriptor localities like `Iloilo City` could widen to a conflicting country.",
      "",
      "**Validation**",
      "* Backend onboarding spec: passed, 214 tests.",
      "* Backend document spec: passed, 10 tests.",
      "* Backend build: passed, SWC compiled 987 files.",
      "* Web docs tests: passed, 2 files / 30 tests.",
      "* Deferred: live/manual checks for real generation logs, generated payload inspection, and opened dashboard dialog remain deferred to review.",
      "",
      "**Next**",
      "Workflow State: `review`",
      "",
      "",
    ].join("\n"),
  );
});

test("codex live output formatter condenses shared non-review summaries without validation", () => {
  const workflowSummary = [
    "**Plan**",
    "`.ai/plans/workflow-stage-output-contract-unification.md`",
    "",
    "**Summary**",
    "* PLAN UPDATED",
    "* Tightened the non-review stage output contract around shared terminal sections.",
    "* Kept thin-plan history and event artifacts unchanged.",
    "",
    "**Key Details**",
    "* Updated prompt output templates for validator, fix-review, reopen-plan, and unblock-plan.",
    "* Preserved review-changes as the only stage-specific terminal schema.",
    "",
    "**Next**",
    "Workflow State: `draft-validation`",
  ].join("\n");

  assert.equal(
    formatCodexJsonlEventForTerminal(codexAgentMessageLine(workflowSummary), {
      color: false,
    }),
    [
      "[agent]",
      "**Plan**",
      "`.ai/plans/workflow-stage-output-contract-unification.md`",
      "",
      "**Summary**",
      "* PLAN UPDATED",
      "* Tightened the non-review stage output contract around shared terminal sections.",
      "* Kept thin-plan history and event artifacts unchanged.",
      "",
      "**Key Details**",
      "* Updated prompt output templates for validator, fix-review, reopen-plan, and unblock-plan.",
      "* Preserved review-changes as the only stage-specific terminal schema.",
      "",
      "**Next**",
      "Workflow State: `draft-validation`",
      "",
      "",
    ].join("\n"),
  );
});

test("codex live output formatter preserves approval Code Preview when color is disabled", () => {
  const workflowSummary = [
    "**Plan**",
    "`.ai/plans/approval-preview.md`",
    "",
    "**Summary**",
    "* APPROVAL REQUIRED",
    "* Review the proposed edit before apply.",
    "",
    "**Key Details**",
    "* File: `apps/web/src/components/banner.tsx`",
    "",
    "**Code Preview**",
    "```tsx",
    "const Message = ({ count }: { count: number }) => (",
    '  <Alert tone="success" count={count}>',
    "    Ready {/* approved */}",
    "  </Alert>",
    ");",
    "```",
    "",
    "**Next**",
    "Workflow State: `active`",
    "",
    "**Waiting for Approval**",
    "Reply `approve` to apply.",
  ].join("\n");

  assert.equal(
    formatCodexJsonlEventForTerminal(codexAgentMessageLine(workflowSummary), {
      color: false,
    }),
    [
      "[agent]",
      "**Plan**",
      "`.ai/plans/approval-preview.md`",
      "",
      "**Summary**",
      "* APPROVAL REQUIRED",
      "* Review the proposed edit before apply.",
      "",
      "**Key Details**",
      "* File: `apps/web/src/components/banner.tsx`",
      "",
      "**Code Preview**",
      "```tsx",
      "const Message = ({ count }: { count: number }) => (",
      '  <Alert tone="success" count={count}>',
      "    Ready {/* approved */}",
      "  </Alert>",
      ");",
      "```",
      "",
      "**Next**",
      "Workflow State: `active`",
      "",
      "**Waiting for Approval**",
      "Reply `approve` to apply.",
      "",
      "",
    ].join("\n"),
  );
});

test("codex live output formatter colorizes approval Code Preview tsx fences", () => {
  const workflowSummary = [
    "**Plan**",
    "`.ai/plans/approval-preview.md`",
    "",
    "**Summary**",
    "* APPROVAL REQUIRED",
    "",
    "**Key Details**",
    "* File: `apps/web/src/components/banner.tsx`",
    "",
    "**Code Preview**",
    "```tsx",
    "const Message = ({ count }: { count: number }) => (",
    '  <Alert tone="success" count={count}>',
    "    Ready {/* approved */}",
    "  </Alert>",
    ");",
    "```",
    "",
    "**Next**",
    "Status: `active`",
    "Next Action: `execute-plan`",
    "",
    "**Waiting for Approval**",
    "Reply `approve` to apply.",
  ].join("\n");

  const formatted = formatCodexJsonlEventForTerminal(
    codexAgentMessageLine(workflowSummary),
    { color: true },
  );

  assert.match(formatted, /\u001b\[34mconst\u001b\[0m Message/);
  assert.match(formatted, /<\u001b\[36mAlert\u001b\[0m/);
  assert.match(formatted, /\u001b\[35mtone\u001b\[0m=/);
  assert.match(formatted, /\u001b\[32m"success"\u001b\[0m/);
  assert.match(formatted, /\u001b\[34mnumber\u001b\[0m/);
  assert.match(formatted, /\u001b\[90m\{\/\* approved \*\/\}\u001b\[0m/);
});

test("codex live output formatter renders subagent approval Code Preview state messages", () => {
  const workflowSummary = [
    "**Plan**",
    "`.ai/plans/approval-preview.md`",
    "",
    "**Summary**",
    "* APPROVAL REQUIRED",
    "",
    "**Key Details**",
    "* File: `apps/web/src/components/banner.tsx`",
    "",
    "**Code Preview**",
    "```tsx",
    "const count = 1;",
    "```",
    "",
    "**Next**",
    "Status: `active`",
    "Next Action: `execute-plan`",
    "",
    "**Waiting for Approval**",
    "Reply `approve` to apply.",
  ].join("\n");

  const formatted = formatCodexJsonlEventForTerminal(
    codexSubagentStateLine(workflowSummary),
    { color: true },
  );

  assert.match(formatted, /\u001b\[38;5;214m\[agent\]\u001b\[0m/);
  assert.match(formatted, /\*\*Code Preview\*\*/);
  assert.match(
    formatted,
    /\u001b\[34mconst\u001b\[0m count = \u001b\[33m1\u001b\[0m;/,
  );
});

test("codex live output formatter keeps normal workflow shared summary compact when code fences are present", () => {
  const workflowSummary = [
    "**Plan**",
    "`.ai/plans/workflow-runner.md`",
    "",
    "**Summary**",
    "* PLAN UPDATED",
    "",
    "**Key Details**",
    "* Updated formatter behavior.",
    "",
    "**Diagnostics**",
    "```ts",
    "const unrelated = shouldNotRender();",
    "```",
    "",
    "**Next**",
    "Status: `draft`",
    "Next Action: `plan-validator`",
  ].join("\n");

  const formatted = formatCodexJsonlEventForTerminal(
    codexAgentMessageLine(workflowSummary),
    { color: false },
  );

  assert.match(
    formatted,
    /\*\*Key Details\*\*\n\* Updated formatter behavior\./,
  );
  assert.doesNotMatch(formatted, /shouldNotRender/);
  assert.doesNotMatch(formatted, /```ts/);
});

test("codex live output formatter hides completed commit-summary next action in the Next block", () => {
  const workflowSummary = [
    "**Plan**",
    "`.ai/plans/workflow-runner.md`",
    "",
    "**Summary**",
    "* COMPLETED",
    "* Finished the plan.",
    "",
    "**Key Details**",
    "* Detail retained.",
    "",
    "**Next**",
    "Workflow State: `completed`",
  ].join("\n");

  assert.equal(
    formatCodexJsonlEventForTerminal(codexAgentMessageLine(workflowSummary), {
      color: false,
    }),
    [
      "[agent]",
      "**Plan**",
      "`.ai/plans/workflow-runner.md`",
      "",
      "**Summary**",
      "* COMPLETED",
      "* Finished the plan.",
      "",
      "**Key Details**",
      "* Detail retained.",
      "",
      "**Next**",
      "Workflow State: `completed`",
      "",
      "",
    ].join("\n"),
  );
});

test("codex live output formatter keeps next action for non-completed summaries", () => {
  const workflowSummary = [
    "**Plan**",
    "`.ai/plans/workflow-runner.md`",
    "",
    "**Summary**",
    "* REVIEW READY",
    "",
    "**Next**",
    "Status: `review`",
    "Next Action: `review-plan`",
  ].join("\n");

  assert.equal(
    formatCodexJsonlEventForTerminal(codexAgentMessageLine(workflowSummary), {
      color: false,
    }),
    [
      "[agent]",
      "**Plan**",
      "`.ai/plans/workflow-runner.md`",
      "",
      "**Summary**",
      "* REVIEW READY",
      "",
      "**Next**",
      "Status: `review`",
      "Next Action: `review-plan`",
      "",
      "",
    ].join("\n"),
  );
});

test("codex live output formatter normalizes multiline next fields", () => {
  const workflowSummary = [
    "**Plan**",
    "[.ai/plans/market-research-initial-competitor-search-observability.md](/home/jetermulo/projects/futr-wsl/Gondoor/.ai/plans/market-research-initial-competitor-search-observability.md)",
    "",
    "**Summary**",
    "* PLAN UPDATED",
    "* stage result: `PLAN UPDATED`; state set to `draft + plan-validator`",
    "* narrowed regeneration validation scope back to the existing code/spec contract",
    "",
    "**Key Details**",
    "* issue addressed: removed invented `attempt` / `maxAttempts` requirements",
    "* affected sections: `## Next Action`, `### Preparation`, `### Implementation`, `### Validation`",
    "* changes made: rewrote the search-service implementation task",
    "",
    "**Next**",
    "Workflow State:",
    "draft-validation",
  ].join("\n");

  assert.equal(
    formatCodexJsonlEventForTerminal(codexAgentMessageLine(workflowSummary), {
      color: false,
    }),
    [
      "[agent]",
      "**Plan**",
      "[.ai/plans/market-research-initial-competitor-search-observability.md](/home/jetermulo/projects/futr-wsl/Gondoor/.ai/plans/market-research-initial-competitor-search-observability.md)",
      "",
      "**Summary**",
      "* PLAN UPDATED",
      "* stage result: `PLAN UPDATED`; state set to `draft + plan-validator`",
      "* narrowed regeneration validation scope back to the existing code/spec contract",
      "",
      "**Key Details**",
      "* issue addressed: removed invented `attempt` / `maxAttempts` requirements",
      "* affected sections: `## Next Action`, `### Preparation`, `### Implementation`, `### Validation`",
      "* changes made: rewrote the search-service implementation task",
      "",
      "**Next**",
      "Workflow State: `draft-validation`",
      "",
      "",
    ].join("\n"),
  );
});

test("codex live output formatter condenses review summaries", () => {
  const reviewSummary = [
    "**Plan**",
    "[.ai/plans/market-research-competitor-discovery.md](/home/jetermulo/projects/futr-wsl/Gondoor/.ai/plans/market-research-competitor-discovery.md:630)",
    "",
    "**Summary**",
    "* NEEDS FIX",
    "* Direct competitor fallback still leaks unverified competitors into preview output.",
    "* Dashboard dialog can show misleading competitors when search evidence is unavailable.",
    "* Manual validation remains pending.",
    "",
    "**Issues**",
    "* Critical: unknown suffixless geographies can widen to any registration country. [document-content-generator.service.ts](/home/jetermulo/projects/futr-wsl/Gondoor/apps/backend/src/documents/document-content-generator.service.ts:449)",
    "* Critical: descriptor-bearing non-Philippine local or regional labels can still fail to widen. [document-content-generator.service.ts](/home/jetermulo/projects/futr-wsl/Gondoor/apps/backend/src/documents/document-content-generator.service.ts:444)",
    "* Warning: Manual validation remains pending for real generation logs, generated payload separation, and dashboard dialog inspection.",
    "* Suggestion: Consolidate duplicate rejection checks around the existing rejection paths. [document-content-generator.service.ts](/home/jetermulo/projects/futr-wsl/Gondoor/apps/backend/src/documents/document-content-generator.service.ts:2657) [document-content-generator.service.ts](/home/jetermulo/projects/futr-wsl/Gondoor/apps/backend/src/documents/document-content-generator.service.ts:2740)",
    "",
    "**Final Verdict**",
    "- [ ] safe to merge",
    "- [x] requires fixes",
    "- [x] block merge",
    "",
    "**Next**",
    "Workflow State: `active`",
  ].join("\n");

  assert.equal(
    formatCodexJsonlEventForTerminal(codexAgentMessageLine(reviewSummary), {
      color: false,
    }),
    [
      "[agent]",
      "**Plan**",
      "`.ai/plans/market-research-competitor-discovery.md`",
      "",
      "**Summary**",
      "* NEEDS FIX",
      "* Direct competitor fallback still leaks unverified competitors into preview output.",
      "* Dashboard dialog can show misleading competitors when search evidence is unavailable.",
      "  +1 more",
      "",
      "**Issues**",
      "* Critical: unknown suffixless geographies can widen to any registration country.",
      "* Critical: descriptor-bearing non-Philippine local or regional labels can still fail to widen.",
      "* Warning: Manual validation remains pending for real generation logs, generated payload separation, and dashboard dialog inspection.",
      "* Suggestion: Consolidate duplicate rejection checks.",
      "",
      "**Final Verdict**",
      "- [ ] safe to merge",
      "- [x] requires fixes",
      "- [x] block merge",
      "",
      "**Next**",
      "Workflow State: `active`",
      "",
      "",
    ].join("\n"),
  );
});

test("codex live output formatter keeps bounded review summary details", () => {
  const reviewSummary = [
    "**Plan**",
    "`.ai/plans/market-research-competitor-discovery.md`",
    "",
    "**Summary**",
    "* NEEDS FIX",
    "* Direct competitor fallback still leaks unverified competitors into preview output.",
    "* Dashboard dialog can show misleading competitors when search evidence is unavailable.",
    "* Manual validation remains pending.",
    "",
    "**Issues**",
    "* Critical: fallback competitors are still shown without verification. [document-content-generator.service.ts](/home/jetermulo/projects/futr-wsl/Gondoor/apps/backend/src/documents/document-content-generator.service.ts:449)",
    "",
    "**Final Verdict**",
    "- [ ] safe to merge",
    "- [x] requires fixes",
    "- [x] block merge",
  ].join("\n");

  assert.equal(
    formatCodexJsonlEventForTerminal(codexAgentMessageLine(reviewSummary), {
      color: false,
    }),
    [
      "[agent]",
      "**Plan**",
      "`.ai/plans/market-research-competitor-discovery.md`",
      "",
      "**Summary**",
      "* NEEDS FIX",
      "* Direct competitor fallback still leaks unverified competitors into preview output.",
      "* Dashboard dialog can show misleading competitors when search evidence is unavailable.",
      "  +1 more",
      "",
      "**Issues**",
      "* Critical: fallback competitors are still shown without verification.",
      "",
      "**Final Verdict**",
      "- [ ] safe to merge",
      "- [x] requires fixes",
      "- [x] block merge",
      "",
      "",
    ].join("\n"),
  );
});

test("codex live output formatter includes review issues written as asterisk bullets", () => {
  const reviewSummary = [
    "**Plan**",
    "`.ai/plans/market-research-competitor-discovery.md`",
    "",
    "**Summary**",
    "* NEEDS FIX",
    "",
    "**Issues**",
    "* Critical: add a guarded matching-country widening path so ordinary United States and Canada local labels cannot emit only local competitor queries. `apps/backend/src/documents/document-content-generator.service.ts:452`",
    "* Critical: restrict likely-competitor relevance to category, product, competitor, or alternative evidence. `apps/backend/src/documents/document-content-generator.service.ts:2468`",
    "",
    "**Final Verdict**",
    "- [ ] safe to merge",
    "- [x] requires fixes",
    "- [x] block merge",
  ].join("\n");

  assert.equal(
    formatCodexJsonlEventForTerminal(codexAgentMessageLine(reviewSummary), {
      color: false,
    }),
    [
      "[agent]",
      "**Plan**",
      "`.ai/plans/market-research-competitor-discovery.md`",
      "",
      "**Summary**",
      "* NEEDS FIX",
      "",
      "**Issues**",
      "* Critical: add a guarded matching-country widening path so ordinary United States and Canada local labels cannot emit only local competitor queries. `apps/backend/src/documents/document-content-generator.service.ts:452`.",
      "* Critical: restrict likely-competitor relevance to category, product, competitor, or alternative evidence. `apps/backend/src/documents/document-content-generator.service.ts:2468`.",
      "",
      "**Final Verdict**",
      "- [ ] safe to merge",
      "- [x] requires fixes",
      "- [x] block merge",
      "",
      "",
    ].join("\n"),
  );
});

test("codex live output formatter preserves commit-summary subject and user bullets", () => {
  const workflowSummary = [
    "**Plan**",
    "`.ai/plans/workflow-stage-output-contract-unification.md`",
    "",
    "**Summary**",
    "* COMMIT CREATED",
    "* Local commit is ready for manual deployment validation.",
    "",
    "**Key Details**",
    "fix(workflow): unify stage output contract",
    "-- Unified non-review stage output sections across prompts.",
    "-- Updated workflow-runner parsing and snapshot compaction.",
    "-- Added contract coverage for prompts and terminal rendering.",
    "* Branch: fix/competitive-gap-analysis",
    "",
    "**Next**",
    "Workflow State: `completed`",
  ].join("\n");

  assert.equal(
    formatCodexJsonlEventForTerminal(codexAgentMessageLine(workflowSummary), {
      color: false,
    }),
    [
      "[agent]",
      "**Plan**",
      "`.ai/plans/workflow-stage-output-contract-unification.md`",
      "",
      "**Summary**",
      "* COMMIT CREATED",
      "* Local commit is ready for manual deployment validation.",
      "",
      "**Key Details**",
      "fix(workflow): unify stage output contract",
      "-- Unified non-review stage output sections across prompts.",
      "-- Updated workflow-runner parsing and snapshot compaction.",
      "-- Added contract coverage for prompts and terminal rendering.",
      "",
      "**Next**",
      "Workflow State: `completed`",
      "",
      "",
    ].join("\n"),
  );
});

test("codex live output formatter colorizes hybrid labels when color is enabled", () => {
  assert.equal(
    formatCodexJsonlEventForTerminal(
      codexCommandStartedLine("git status --short"),
      { color: true },
    ),
    "\u001b[34mRan\u001b[0m git status --short\n\n",
  );
  assert.equal(
    formatCodexJsonlEventForTerminal(
      codexCommandStartedLine("cat .ai/prompts/review-changes.md"),
      { color: true },
    ),
    "",
  );
  assert.equal(
    formatCodexJsonlEventForTerminal(codexCommandOutputLine("", "pnpm test"), {
      color: true,
    }),
    "",
  );
  assert.equal(
    formatCodexJsonlEventForTerminal(
      codexCommandOutputLine("content\n", "cat .ai/prompts/review-changes.md"),
      {
        color: true,
      },
    ),
    ["\u001b[34mRead\u001b[0m .ai/prompts/review-changes.md", "", ""].join(
      "\n",
    ),
  );
  assert.equal(
    formatCodexJsonlEventForTerminal(
      JSON.stringify({
        type: "item.completed",
        item: {
          id: "item_command",
          command: "pnpm test",
          type: "command_execution",
          aggregated_output: "failed",
          exit_code: 7,
          status: "failed",
        },
      }),
      { color: true },
    ),
    "\u001b[31m[failed]\u001b[0m pnpm test (exit 7)\n  output: 6 bytes, 1 lines omitted\n  command output omitted from workflow log\n\n",
  );
  assert.equal(
    formatCodexJsonlEventForTerminal(codexAgentMessageLine("Done"), {
      color: true,
    }),
    "\u001b[38;5;214m[agent]\u001b[0m\nDone\n\n",
  );
  assert.equal(
    formatCodexJsonlEventForTerminal(JSON.stringify({ type: "turn.started" }), {
      color: true,
    }),
    "\u001b[35m[codex]\u001b[0m turn started\n\n",
  );
  assert.equal(
    formatCodexJsonlEventForTerminal(tokenCountLine(50, 100), { color: true }),
    "\u001b[30;43m[context]\u001b[0m 50/100 tokens (50.00%)\n\n",
  );
});

test("codex live output formatter groups successful shell command summaries by action", () => {
  assert.equal(
    formatCodexJsonlEventForTerminal(
      codexCommandOutputLine(
        "line one\nline two\n",
        String.raw`/bin/bash -lc "sed -n '1,260p' .ai/prompts/execute-plan.md"`,
      ),
      { color: false },
    ),
    ["Read .ai/prompts/execute-plan.md", "", ""].join("\n"),
  );

  assert.equal(
    formatCodexJsonlEventForTerminal(
      codexCommandOutputLine(
        "match\n",
        String.raw`/bin/bash -lc "rg -n 'workflow-runner' .ai/scripts/workflow/runner.ts .ai/scripts/workflow/runner.spec.md"`,
      ),
      { color: false },
    ),
    [
      "Search workflow-runner",
      "- runner.ts",
      "- runner.spec.md",
      "",
      "",
    ].join("\n"),
  );

  assert.equal(
    formatCodexJsonlEventForTerminal(
      codexCommandOutputLine(
        "match\n",
        String.raw`/bin/bash -lc "rg -n 'extractNameSupportWindows|textSupportsBusinessModelFrame|textSupportsTargetGeography|normalizeMarketResearchCompetitors|isCurrentSearchSourceId|evidenceClass' apps/backend/src/documents/document-content-generator.service.ts"`,
      ),
      { color: false },
    ),
    [
      "Search in document-content-generator.service.ts",
      "- extractNameSupportWindows",
      "- textSupportsBusinessModelFrame",
      "- textSupportsTargetGeography",
      "  +3 more",
      "",
      "",
    ].join("\n"),
  );

  assert.equal(
    formatCodexJsonlEventForTerminal(
      codexCommandOutputLine(
        "match\n",
        String.raw`/bin/bash -lc "rg -n 'registrationGeography|countryCode|industry' apps/backend/test/documents apps/backend/test/documents/document-content-generator.service.spec.ts"`,
      ),
      { color: false },
    ),
    [
      "Search in documents",
      "- document-content-generator.service.spec.ts",
      "- registrationGeography",
      "- countryCode",
      "  +1 more",
      "",
      "",
    ].join("\n"),
  );

  assert.equal(
    formatCodexJsonlEventForTerminal(
      codexCommandOutputLine(
        "match\n",
        String.raw`/bin/bash -lc "rg -n 'country-list|i18n-iso-countries|world-countries|countries|city|locality|geography|geographies' package.json package.json pnpm-lock.yaml apps/backend/src apps/backend/test"`,
      ),
      { color: false },
    ),
    [
      "Search in",
      "- package.json",
      "- pnpm-lock.yaml",
      "- src",
      "  + 1 more",
      "",
      "terms:",
      "- country-list",
      "- i18n-iso-countries",
      "- world-countries",
      "  +5 more",
      "",
      "",
    ].join("\n"),
  );

  assert.equal(
    formatCodexJsonlEventForTerminal(
      codexCommandOutputLine(
        "match\n",
        String.raw`/bin/bash -lc "rg -n 'likelyCompetitors|directCompetitors|competitors|fallback|verified' apps/web/src/features/dashboard/docs/services/docs.test.ts apps/web/src/features/dashboard/docs/components/docs-document-dialog.test.tsx apps/backend/test/onboarding/document-content-generator.service.spec.ts"`,
      ),
      { color: false },
    ),
    [
      "Search in",
      "- docs.test.ts",
      "- docs-document-dialog.test.tsx",
      "- document-content-generator.service.spec.ts",
      "",
      "terms:",
      "- likelyCompetitors",
      "- directCompetitors",
      "- competitors",
      "  +2 more",
      "",
      "",
    ].join("\n"),
  );

  assert.equal(
    formatCodexJsonlEventForTerminal(
      codexCommandOutputLine(
        "match\n",
        String.raw`/bin/bash -lc "rg -n 'function translateOrFallback|noVerifiedDirectCompetitors|competitors:' apps/web/src/features/dashboard/docs/components/docs-document-dialog.tsx apps/web/src/features/dashboard/docs/components/docs-document-dialog.test.tsx"`,
      ),
      { color: false },
    ),
    [
      "Search in",
      "- docs-document-dialog.tsx",
      "- docs-document-dialog.test.tsx",
      "",
      "terms:",
      "- function translateOrFallback",
      "- noVerifiedDirectCompetitors",
      "- competitors:",
      "",
      "",
    ].join("\n"),
  );

  assert.equal(
    formatCodexJsonlEventForTerminal(
      codexCommandOutputLine(
        "match\n",
        String.raw`/bin/bash -lc "rg -n 'legal|Inc|owned by|acquired by|same-company|relationship|Mindbody, Inc|FitSuite' apps/backend/test/documents/document-content-generator.service.spec.ts apps/backend/test/onboarding/document-content-generator.service.spec.ts"`,
      ),
      { color: false },
    ),
    [
      "Search in",
      "- document-content-generator.service.spec.ts",
      "",
      "terms:",
      "- legal",
      "- Inc",
      "- owned by",
      "  +5 more",
      "",
      "",
    ].join("\n"),
  );

  assert.equal(
    formatCodexJsonlEventForTerminal(
      codexCommandOutputLine(
        "match\n",
        String.raw`/bin/bash -lc "rg -n 'registrationCountryContainsLocality|currentMarketResearchCompetitorSourceIds|likelyCompetitors|competitor.*benchmark|benchmarks|sourceIds|MarketResearch' apps/backend/src/documents/document-content-generator.service.ts apps/backend/test/documents/document-content-generator.service.spec.ts apps/backend/test/onboarding/document-content-generator.service.spec.ts apps/web/src/features/dashboard/docs/components/docs-document-dialog.tsx apps/web/src/features/dashboard/docs/components/docs-document-dialog.test.tsx"`,
      ),
      { color: false },
    ),
    [
      "Search in",
      "- document-content-generator.service.ts",
      "- document-content-generator.service.spec.ts",
      "- docs-document-dialog.tsx",
      "  + 1 more",
      "",
      "terms:",
      "- registrationCountryContainsLocality",
      "- currentMarketResearchCompetitorSourceIds",
      "- likelyCompetitors",
      "  +4 more",
      "",
      "",
    ].join("\n"),
  );

  assert.equal(
    formatCodexJsonlEventForTerminal(
      codexCommandOutputLine(
        ".ai/scripts/workflow/runner.spec.md\n",
        String.raw`/bin/bash -lc "find .ai/scripts -type f -name '*.spec.md' 2>/dev/null | sort"`,
      ),
      { color: false },
    ),
    ["Explore .ai/scripts", "", ""].join("\n"),
  );

  assert.equal(
    formatCodexJsonlEventForTerminal(
      codexCommandOutputLine(
        "",
        String.raw`/bin/bash -lc "git diff -- apps/web/e2e/fixtures/preauth-dashboard.fixture.ts"`,
      ),
      { color: false },
    ),
    "",
  );
});

test("codex live output formatter omits successful command output bodies regardless of length", () => {
  const output = Array.from(
    { length: 8 },
    (_, index) => `line ${index + 1}`,
  ).join("\n");

  assert.equal(
    formatCodexJsonlEventForTerminal(
      codexCommandOutputLine(output, "pnpm test"),
      { color: false },
    ),
    "",
  );
});

test("codex live output formatter omits long successful command output bodies", () => {
  const longLine = "x".repeat(650);
  const rendered = formatCodexJsonlEventForTerminal(
    codexCommandOutputLine(longLine, "pnpm test"),
    {
      color: false,
    },
  );

  assert.equal(rendered, "");
  assert.equal(rendered.includes("x"), false);
});

test("codex live output formatter renders recognized vitest file runs as structured started output", () => {
  assert.equal(
    formatCodexJsonlEventForTerminal(
      codexCommandStartedLine(VITEST_FILE_COMMAND),
      { color: false },
    ),
    [
      "Ran pnpm --filter @gondoor/web exec vitest run",
      "- src/features/dashboard/docs/services/docs.test.ts",
      "- src/features/dashboard/docs/components/docs-document-dialog.test.tsx",
      "",
      "",
    ].join("\n"),
  );

  assert.equal(
    formatCodexJsonlEventForTerminal(
      codexCommandStartedLine(VITEST_FILE_COMMAND),
      { color: true },
    ),
    [
      "\u001b[34mRan\u001b[0m pnpm --filter @gondoor/web exec vitest run",
      "- src/features/dashboard/docs/services/docs.test.ts",
      "- src/features/dashboard/docs/components/docs-document-dialog.test.tsx",
      "",
      "",
    ].join("\n"),
  );

  assert.equal(
    formatCodexJsonlEventForTerminal(
      codexCommandStartedLine(FILTERED_BACKEND_TEST_COMMAND),
      { color: false },
    ),
    [
      "Ran pnpm --filter @gondoor/backend test",
      "- test/onboarding/document-content-generator.service.spec.ts",
      "",
      "",
    ].join("\n"),
  );

  assert.equal(
    formatCodexJsonlEventForTerminal(
      codexCommandStartedLine(FILTERED_BACKEND_BUILD_COMMAND),
      { color: false },
    ),
    ["Ran pnpm --filter @gondoor/backend build", "", ""].join("\n"),
  );

  assert.equal(
    formatCodexJsonlEventForTerminal(
      codexCommandStartedLine(
        "wc -l .codex/AGENTS.md .ai/prompts/review-changes.md .ai/artifacts/market-research-competitor-discovery/state/context.md .ai/instructions/index.md .ai/instructions/shared/workflow-state.md .ai/specs/market-research-competitor-discovery.spec.md .ai/instructions/architecture.md .ai/instructions/web.md .ai/instructions/backend.md .ai/instructions/shared/testing.md .ai/plans/market-research-competitor-discovery.md",
      ),
      { color: false },
    ),
    ["Ran line count for 11 files", "", ""].join("\n"),
  );

  assert.equal(
    formatCodexJsonlEventForTerminal(
      codexCommandStartedLine(JEST_FILE_COMMAND),
      { color: false },
    ),
    [
      "Ran tests",
      "- test/onboarding/document-content-generator.service.spec.ts",
      "- test/documents/document-content-generator.service.spec.ts",
      "",
      "",
    ].join("\n"),
  );

  assert.equal(
    formatCodexJsonlEventForTerminal(
      codexCommandStartedLine(GIT_STAGED_NAME_STATUS_COMMAND),
      { color: false },
    ),
    [
      "Ran staged diff summary",
      "- apps/backend/src/documents/document-content-generator.service.ts",
      "- apps/backend/src/documents/document-prompts.service.ts",
      "- apps/backend/src/documents/document-generation.types.ts",
      "  +7 more",
      "",
      "",
    ].join("\n"),
  );

  assert.equal(
    formatCodexJsonlEventForTerminal(
      codexCommandStartedLine(GIT_STAGED_DIFF_COMMAND),
      { color: false },
    ),
    [
      "Ran staged diff",
      "- apps/backend/test/onboarding/document-content-generator.service.spec.ts",
      "- apps/web/src/features/dashboard/docs/services/docs.test.ts",
      "- apps/web/src/features/dashboard/docs/components/docs-document-dialog.test.tsx",
      "  +1 more",
      "",
      "",
    ].join("\n"),
  );

  assert.equal(
    formatCodexJsonlEventForTerminal(
      codexCommandStartedLine(GIT_UNSTAGED_DIFF_COMMAND),
      { color: false },
    ),
    [
      "Ran git diff",
      "- apps/backend/test/onboarding/document-content-generator.service.spec.ts",
      "",
      "",
    ].join("\n"),
  );

  assert.equal(
    formatCodexJsonlEventForTerminal(
      codexCommandStartedLine(GIT_UNSTAGED_DIFF_SED_COMMAND),
      { color: false },
    ),
    [
      "Ran git diff",
      "- apps/backend/src/documents/document-content-generator.service.ts",
      "",
      "",
    ].join("\n"),
  );

  assert.equal(
    formatCodexJsonlEventForTerminal(
      codexCommandOutputLine(
        "match\n",
        String.raw`/bin/bash -lc "rg -n ''\''^## Status|'\''^## Next Action|Review v7 remediation completed|'\''^### Validation v18|'\''^## Review History|'\''^### Review v8|'\''^## Blockers' .ai/plans/market-research-competitor-discovery.md"`,
      ),
      { color: false },
    ),
    [
      "Search in market-research-competitor-discovery.md",
      "- ## Status",
      "- ## Next Action",
      "- Review v7 remediation completed",
      "  +4 more",
      "",
      "",
    ].join("\n"),
  );

  assert.equal(
    formatCodexJsonlEventForTerminal(
      codexCommandOutputLine(
        "match\n",
        String.raw`/bin/bash -lc "rg -n 'likelyCompetitors|countryCode|ordinary explicit local|directCompetitors|registrationGeography|geography aliases|current search evidence|model-only guesses|website/audit-only|static fallback|search skipped|competitor rejected|source ids|document wording|dashboard rendering' apps/backend/test/documents/document-content-generator.service.spec.ts apps/web/src/features/dashboard/docs/services/docs.test.ts apps/web/src/features/dashboard/docs/components/docs-document-dialog.test.tsx apps/web/src/features/dashboard/types/docs.ts apps/web/src/features/dashboard/docs/components/docs-document-dialog.tsx"`,
      ),
      { color: false },
    ),
    [
      "Search in",
      "- document-content-generator.service.spec.ts",
      "- docs.test.ts",
      "- docs-document-dialog.test.tsx",
      "  + 2 more",
      "",
      "terms:",
      "- likelyCompetitors",
      "- countryCode",
      "- ordinary explicit local",
      "  +12 more",
      "",
      "",
    ].join("\n"),
  );
});

test("codex live output formatter summarizes git show search and line-range pipelines", () => {
  assert.equal(
    formatCodexJsonlEventForTerminal(
      codexCommandStartedLine(GIT_SHOW_RG_COMMAND),
      { color: false },
    ),
    [
      "Ran git show search",
      "- apps/backend/src/documents/document-content-generator.service.ts",
      "terms:",
      "- broaderMarketResearch",
      "- registrationCountryContains",
      "- isLikelyLocal",
      "  +12 more",
      "",
      "",
    ].join("\n"),
  );

  assert.equal(
    formatCodexJsonlEventForTerminal(
      codexCommandStartedLine(GIT_SHOW_SED_COMMAND),
      { color: false },
    ),
    [
      "Ran git show",
      "- apps/backend/src/documents/document-content-generator.service.ts:340-435",
      "",
      "",
    ].join("\n"),
  );
});

test("codex live output formatter shows only output metadata for failed command output", () => {
  const output = Array.from(
    { length: 12 },
    (_, index) => `line ${index + 1}`,
  ).join("\n");

  assert.equal(
    formatCodexJsonlEventForTerminal(
      JSON.stringify({
        type: "item.completed",
        item: {
          id: "item_command",
          command: "pnpm test",
          type: "command_execution",
          aggregated_output: output,
          exit_code: 1,
          status: "failed",
        },
      }),
    ),
    [
      "[failed] pnpm test (exit 1)",
      `  output: ${Buffer.byteLength(output, "utf8")} bytes, 12 lines omitted`,
      "  command output omitted from workflow log",
      "",
      "",
    ].join("\n"),
  );
});

test("codex live output formatter summarizes failed inline tsx commands without raw script bodies", () => {
  const inlineScript =
    "import { DocumentContentGeneratorService } from './src/documents/document-content-generator.service'; const secret = 'raw inline script body'; console.log(secret);";
  const command = `/bin/bash -lc "pnpm --filter @gondoor/backend exec tsx -e \\"${inlineScript}\\""`;
  const output = "AssertionError: expected benchmark to be suppressed\n";

  const formatted = formatCodexJsonlEventForTerminal(
    JSON.stringify({
      type: "item.completed",
      item: {
        id: "item_command",
        command,
        type: "command_execution",
        aggregated_output: output,
        exit_code: 1,
        status: "failed",
      },
    }),
  );

  assert.equal(
    formatted,
    [
      "[failed] backend inline tsx check (exit 1)",
      "  command: pnpm --filter @gondoor/backend exec tsx -e <inline script>",
      "",
      "",
    ].join("\n"),
  );
  assert.doesNotMatch(formatted, /DocumentContentGeneratorService/);
  assert.doesNotMatch(formatted, /raw inline script body/);
  assert.doesNotMatch(formatted, /AssertionError/);
  assert.doesNotMatch(formatted, /command output omitted from workflow log/);
});

test("codex live output formatter keeps failed Jest test output metadata-only", () => {
  const output = [
    "FAIL test/onboarding/document-content-generator.service.spec.ts (10.998 s)",
    "  ● DocumentContentGeneratorService › widens unmapped suffixless Austin Market Research competitor queries to matching registration country",
    "",
    "    expect(received).toBeGreaterThan(expected)",
    "",
    "    Expected: > 0",
    "    Received:   -1",
    "",
    "Test Suites: 1 failed, 1 total",
  ].join("\n");

  assert.equal(
    formatCodexJsonlEventForTerminal(
      JSON.stringify({
        type: "item.completed",
        item: {
          id: "item_command",
          command: JEST_FAILED_COMMAND,
          type: "command_execution",
          aggregated_output: output,
          exit_code: 1,
          status: "failed",
        },
      }),
    ),
    [
      "[failed] jest test (exit 1)",
      `  output: ${Buffer.byteLength(output, "utf8")} bytes, 9 lines omitted`,
      "  command output omitted from workflow log",
      "",
      "",
    ].join("\n"),
  );
});

test("codex live output formatter treats unknown command exits as failed but keeps the label readable", () => {
  assert.equal(
    formatCodexJsonlEventForTerminal(
      JSON.stringify({
        type: "item.completed",
        item: {
          id: "item_command",
          command: "pnpm test",
          type: "command_execution",
          aggregated_output: "no exit",
          exit_code: null,
          status: "completed",
        },
      }),
    ),
    "[failed] pnpm test (exit unknown)\n  output: 7 bytes, 1 lines omitted\n  command output omitted from workflow log\n\n",
  );
});

test("workflow progress formatter adds readable stage labels with optional color", () => {
  assert.equal(
    formatWorkflowProgressLine({
      iteration: 1,
      maxIterations: 100,
      workflowState: "active",
      promptPath: ".ai/prompts/execute-plan.md",
      model: "gpt-5.5",
      reasoning: "high",
      color: false,
    }),
    "\n\n[1/100] STAGE EXECUTE\nworkflowState: active\nmodel: gpt-5.5 | reasoning: high\n",
  );

  assert.equal(
    formatWorkflowProgressLine({
      iteration: 2,
      maxIterations: 100,
      workflowState: "review",
      promptPath: ".ai/prompts/review-changes.md",
      model: "gpt-5.5",
      reasoning: "xhigh",
      color: true,
    }),
    "\n\n\u001b[37;45m[2/100] STAGE REVIEW\u001b[0m\nworkflowState: review\nmodel: gpt-5.5 | reasoning: xhigh\n",
  );
});

test("commit progress formatter reports milestone counters without changing stage output", () => {
  assert.equal(
    formatCommitProgressLine({
      completed: 0,
      total: 5,
      description: "backend upload limits",
    }),
    "[0/5] backend upload limits",
  );
  assert.equal(
    formatCommitProgressLine({
      completed: 1,
      total: 5,
      description: "a".repeat(210),
    }),
    `[1/5] ${"a".repeat(197)}...`,
  );
});

test("workflow wait formatter emits a light yellow append-only silence notice", () => {
  assert.equal(WORKFLOW_WAIT_NOTICE_INTERVAL_MS, 120_000);
  assert.equal(
    formatWorkflowWaitLine({
      promptPath: ".ai/prompts/review-changes.md",
      elapsedMs: 120_000,
      color: false,
    }),
    "[wait] review-changes.md running 2m",
  );

  assert.equal(
    formatWorkflowWaitLine({
      promptPath: ".ai/prompts/review-changes.md",
      elapsedMs: 120_000,
      color: true,
    }),
    "\u001b[38;2;255;244;143m[wait] review-changes.md running 2m\u001b[0m",
  );
});

test("workflow wait notice elapsed time resets after streamed activity", async () => {
  let nowMs = 0;
  const chunks: string[] = [];
  let resolveFirstNotice: () => void = () => {};
  const firstNotice = new Promise<void>((resolve) => {
    resolveFirstNotice = resolve;
  });
  const outputStream = {
    stdout: (chunk: string) => {
      chunks.push(chunk);
      notice.stop();
      resolveFirstNotice();
    },
    stderr: () => {},
  };
  const notice = createWorkflowWaitNotice({
    outputStream,
    enabled: true,
    promptPath: ".ai/prompts/execute-plan.md",
    now: () => nowMs,
    startedAt: 0,
    color: false,
    intervalMs: 1,
  });

  notice.start();
  nowMs = 300_000;
  notice.markActivity();
  nowMs = 420_000;
  await firstNotice;

  assert.deepEqual(chunks, ["[wait] execute-plan.md running 2m\n\n"]);
});

test("workflow elapsed time formatter uses compact human-readable units", () => {
  assert.equal(formatWorkflowElapsedTime(12_345), "12s");
  assert.equal(formatWorkflowElapsedTime(1_315_000), "21m 55s");
  assert.equal(formatWorkflowElapsedTime(3_845_000), "1h 04m 05s");
});

test("workflow ANSI color detection respects terminal and environment controls", () => {
  assert.equal(supportsWorkflowAnsiColor({}, { isTTY: true }), true);
  assert.equal(supportsWorkflowAnsiColor({}, { isTTY: false }), false);
  assert.equal(
    supportsWorkflowAnsiColor({ FORCE_COLOR: "1" }, { isTTY: false }),
    true,
  );
  assert.equal(
    supportsWorkflowAnsiColor({ FORCE_COLOR: "0" }, { isTTY: true }),
    false,
  );
  assert.equal(
    supportsWorkflowAnsiColor({ NO_COLOR: "" }, { isTTY: true }),
    false,
  );
});

test("codex live output formatter buffers partial JSONL chunks and passes through non-JSON stdout", () => {
  let stdout = "";
  let stderr = "";
  const formatter = createCodexLiveOutputFormatter({
    stdout: (chunk) => {
      stdout += chunk;
    },
    stderr: (chunk) => {
      stderr += chunk;
    },
  });
  const event = codexAgentMessageLine("Chunked");

  formatter.stdout(event.slice(0, 12));
  formatter.stdout(`${event.slice(12)}\nplain output\n`);
  formatter.stderr("stderr output\n");
  formatter.stderr("Reading additional input from stdin...\n");
  formatter.flush();

  assert.equal(stdout, "[agent]\nChunked\n\nplain output\n");
  assert.equal(
    stderr,
    "stderr output\nReading additional input from stdin...\n\n",
  );
});

test("codex live output formatter reports every atomized commit boundary", () => {
  let stdout = "";
  const formatter = createCodexLiveOutputFormatter(
    {
      stdout: (chunk) => {
        stdout += chunk;
      },
      stderr: () => {},
    },
    {
      commitBoundaryProgress: {
        taskPosition: 3,
        taskTotal: 5,
        taskLabel: "Workspace shell and active enforcement",
        boundaryTotal: 2,
      },
    },
  );

  formatter.stdout(`${codexCommandStartedLine("git commit -F message")}\n`);
  formatter.stdout(`${codexCommandOutputLine("", "git commit -F message")}\n`);
  formatter.stdout(`${codexCommandStartedLine("git commit -F message")}\n`);
  formatter.stdout(`${codexCommandOutputLine("", "git commit -F message")}\n`);
  formatter.flush();

  assert.match(
    stdout,
    /\[COMMITTING\] Task 3 of 5 — Workspace shell and active enforcement\nProgress: 2 tasks committed · Creating commit 1 of 2/,
  );
  assert.match(
    stdout,
    /\[COMMITTING\] Task 3 of 5 — Workspace shell and active enforcement\nProgress: 2 tasks committed · Created commit 1 of 2/,
  );
  assert.match(
    stdout,
    /\[COMMITTING\] Task 3 of 5 — Workspace shell and active enforcement\nProgress: 2 tasks committed · Created commit 2 of 2/,
  );
});

test("codex live output formatter inserts a blank line before formatted event blocks after raw output", () => {
  let combined = "";
  const formatter = createCodexLiveOutputFormatter({
    stdout: (chunk) => {
      combined += chunk;
    },
    stderr: (chunk) => {
      combined += chunk;
    },
  });

  formatter.stderr("Reading additional input from stdin...\n");
  formatter.stdout(
    `${JSON.stringify({ type: "thread.started", thread_id: "thread_123" })}\n`,
  );
  formatter.stdout(`${JSON.stringify({ type: "turn.started" })}\n`);
  formatter.flush();

  assert.equal(
    combined,
    [
      "Reading additional input from stdin...",
      "",
      "[codex] thread started thread_123",
      "",
      "[codex] turn started",
      "",
      "",
    ].join("\n"),
  );
});

test("codex live output formatter summarizes apply_patch verification failures on stderr", () => {
  let stdout = "";
  let stderr = "";
  const formatter = createCodexLiveOutputFormatter({
    stdout: (chunk) => {
      stdout += chunk;
    },
    stderr: (chunk) => {
      stderr += chunk;
    },
  });

  formatter.stderr(`${APPLY_PATCH_VERIFICATION_FAILED_STDERR}\n`);

  assert.equal(stdout, "");
  assert.equal(
    stderr,
    [
      "[failed] apply_patch (verification failed)",
      "- apps/backend/src/documents/document-content-generator.service.ts",
      "",
      "Patch context not found:",
      "return countries;",
      "",
      "Re-read the target section and apply a fresh patch.",
      "",
      "command output omitted from workflow log",
      "",
      "",
    ].join("\n"),
  );
});

test("codex live output formatter separates adjacent JSONL event blocks", () => {
  let stdout = "";
  const formatter = createCodexLiveOutputFormatter({
    stdout: (chunk) => {
      stdout += chunk;
    },
    stderr: () => {},
  });

  formatter.stdout(
    `${codexCommandOutputLine("", "git diff --check")}\n${codexCommandStartedLine("git status --short")}\n`,
  );
  formatter.flush();

  assert.equal(stdout, "Ran git status --short\n\n");
});

test("codex live output formatter suppresses successful plan section read commands", () => {
  const planPath = ".ai/plans/market-research-competitor-discovery.md";
  const headingSearchCommand = String.raw`rg -n '^## (Status|Next Action|Ownership Scope|Files \(MANDATORY\)|File Ownership Releases|Validation Evidence|Review History|Blockers)' ${planPath}`;
  const sectionReadCommand = String.raw`awk '/^## File Ownership Releases$/{flag=1; print; next} flag && /^## /{exit} flag{print}' ${planPath}`;

  assert.equal(
    formatCodexJsonlEventForTerminal(
      codexCommandStartedLine(headingSearchCommand),
      { color: false },
    ),
    "",
  );
  assert.equal(
    formatCodexJsonlEventForTerminal(
      codexCommandOutputLine("12:## Status\n", headingSearchCommand),
      {
        color: false,
      },
    ),
    "",
  );
  assert.equal(
    formatCodexJsonlEventForTerminal(
      codexCommandStartedLine(sectionReadCommand),
      { color: false },
    ),
    "",
  );
  assert.equal(
    formatCodexJsonlEventForTerminal(
      codexCommandOutputLine(
        "## File Ownership Releases\n\n(empty)\n",
        sectionReadCommand,
      ),
      {
        color: false,
      },
    ),
    "",
  );
  assert.equal(
    formatCodexJsonlEventForTerminal(
      JSON.stringify({
        type: "item.completed",
        item: {
          id: "item_command",
          command: sectionReadCommand,
          type: "command_execution",
          aggregated_output: "missing section\n",
          exit_code: 1,
          status: "completed",
        },
      }),
      { color: false },
    ),
    [
      "[failed] plan section read (exit 1)",
      "  output: 15 bytes, 1 lines omitted",
      "  command output omitted from workflow log",
      "",
      "",
    ].join("\n"),
  );
});

test("codex live output formatter keeps every explored summary in streamed output", () => {
  let stdout = "";
  const formatter = createCodexLiveOutputFormatter({
    stdout: (chunk) => {
      stdout += chunk;
    },
    stderr: () => {},
  });

  formatter.stdout(
    [
      codexCommandOutputLine("content\n", "cat .ai/prompts/review-changes.md"),
      codexCommandOutputLine(
        "match\n",
        String.raw`/bin/bash -lc "rg -n 'workflow-runner' .ai/scripts/workflow/runner.ts .ai/scripts/workflow/runner.spec.md"`,
      ),
    ].join("\n") + "\n",
  );
  formatter.flush();

  assert.equal(
    stdout,
    [
      "Read .ai/prompts/review-changes.md",
      "",
      "Search workflow-runner",
      "- runner.ts",
      "- runner.spec.md",
      "",
      "",
    ].join("\n"),
  );
});

test("codex live output formatter groups consecutive read summaries", () => {
  let stdout = "";
  const formatter = createCodexLiveOutputFormatter({
    stdout: (chunk) => {
      stdout += chunk;
    },
    stderr: () => {},
  });

  formatter.stdout(
    [
      codexCommandOutputLine("content\n", "cat .codex/AGENTS.md"),
      codexCommandOutputLine("content\n", "cat .ai/instructions/index.md"),
      codexAgentMessageLine("Loaded"),
    ].join("\n") + "\n",
  );
  formatter.flush();

  assert.equal(
    stdout,
    [
      "Read .codex/AGENTS.md",
      "Read .ai/instructions/index.md",
      "",
      "[agent]",
      "Loaded",
      "",
      "",
    ].join("\n"),
  );
});

test("codex live output formatter groups chained read commands", () => {
  assert.equal(
    formatCodexJsonlEventForTerminal(
      codexCommandOutputLine(
        "content\n",
        String.raw`/bin/bash -lc "cat /home/jetermulo/.agents/skills/using-superpowers/SKILL.md && sed -n '1,160p' /home/jetermulo/.agents/skills/dispatching-parallel-agents/SKILL.md && sed -n '1,160p' /home/jetermulo/.agents/skills/requesting-code-review/SKILL.md"`,
      ),
      { color: false },
    ),
    [
      "Read /home/jetermulo/.agents/skills/using-superpowers/SKILL.md",
      "Read /home/jetermulo/.agents/skills/dispatching-parallel-agents/SKILL.md",
      "Read /home/jetermulo/.agents/skills/requesting-code-review/SKILL.md",
      "",
      "",
    ].join("\n"),
  );
});

test("codex live output formatter suppresses consecutive duplicate command summaries", () => {
  let stdout = "";
  const formatter = createCodexLiveOutputFormatter({
    stdout: (chunk) => {
      stdout += chunk;
    },
    stderr: () => {},
  });

  formatter.stdout(
    [
      codexCommandStartedLine(GIT_STAGED_NAME_STATUS_COMMAND),
      codexCommandStartedLine(GIT_STAGED_NAME_STATUS_COMMAND),
      codexCommandOutputLine(
        "match\n",
        String.raw`/bin/bash -lc "rg -n ''\''^(## Ownership Scope|## File Ownership Releases|## Review History|## Deployment Validation|## Status|## Next Action|### Review v)' .ai/plans/market-research-competitor-discovery.md"`,
      ),
    ].join("\n") + "\n",
  );
  formatter.flush();

  assert.equal(
    stdout,
    [
      "Ran staged diff summary",
      "- apps/backend/src/documents/document-content-generator.service.ts",
      "- apps/backend/src/documents/document-prompts.service.ts",
      "- apps/backend/src/documents/document-generation.types.ts",
      "  +7 more",
      "",
      "Search in market-research-competitor-discovery.md",
      "- ## Ownership Scope",
      "- ## File Ownership Releases",
      "- ## Review History",
      "  +4 more",
      "",
      "",
    ].join("\n"),
  );
});

test("codex live output formatter suppresses explored start events", () => {
  assert.equal(
    formatCodexJsonlEventForTerminal(
      codexCommandStartedLine("cat .ai/prompts/execute-plan.md"),
      { color: false },
    ),
    "",
  );
  assert.equal(
    formatCodexJsonlEventForTerminal(
      codexCommandStartedLine(
        String.raw`/bin/bash -lc "rg -n 'workflow-runner' .ai/scripts/workflow/runner.ts"`,
      ),
      { color: false },
    ),
    "",
  );
});

test("codex live output formatter suppresses consecutive duplicate explored summaries", () => {
  let stdout = "";
  const formatter = createCodexLiveOutputFormatter({
    stdout: (chunk) => {
      stdout += chunk;
    },
    stderr: () => {},
  });

  const duplicateRead = codexCommandOutputLine(
    "content\n",
    "cat apps/backend/src/documents/document-content-generator.service.ts",
  );

  formatter.stdout(`${duplicateRead}\n${duplicateRead}\n${duplicateRead}\n`);
  formatter.flush();

  assert.equal(
    stdout,
    [
      "Read apps/backend/src/documents/document-content-generator.service.ts",
      "",
      "",
    ].join("\n"),
  );
});

test("codex live output formatter removes raw cursor control sequences from live output", () => {
  let stdout = "";
  const formatter = createCodexLiveOutputFormatter({
    stdout: (chunk) => {
      stdout += chunk;
    },
    stderr: () => {},
  });

  formatter.stdout(
    `\u001b[B\n${codexCommandOutputLine("", "git diff --check")}\n`,
  );
  formatter.stdout(
    `\u001b[B${codexCommandStartedLine("git status --short")}\n`,
  );
  formatter.flush();

  assert.equal(stdout, "Ran git status --short\n\n");
});

test("codex live output formatter passes color option through streamed JSONL chunks", () => {
  let stdout = "";
  const formatter = createCodexLiveOutputFormatter(
    {
      stdout: (chunk) => {
        stdout += chunk;
      },
      stderr: () => {},
    },
    { color: true },
  );

  formatter.stdout(`${codexCommandStartedLine("git status --short")}\n`);
  formatter.flush();

  assert.equal(stdout, "\u001b[34mRan\u001b[0m git status --short\n\n");
});
