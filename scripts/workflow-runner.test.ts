import assert from "node:assert/strict";
import { once } from "node:events";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { existsSync, mkdirSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { tmpdir } from "node:os";
import { Writable } from "node:stream";
import test from "node:test";

import {
  codexExecutionConfig,
  codexOutputContainsStop,
  codexOutputStopReason,
  codexWorkEnvironment,
  createCodexLiveOutputFormatter,
  generateScopeCleanupPrompt,
  generateWorkflowContextSnapshot,
  createWorkflowWaitNotice,
  formatCodexJsonlEventForTerminal,
  formatWorkflowElapsedTime,
  formatWorkflowProgressLine,
  formatWorkflowWaitLine,
  generateWorkflowPrompt,
  analyzeTokenUsageLedger,
  processStdioForInput,
  parseCodexTokenUsage,
  parsePlan,
  parseContextUsage,
  parseReviewStagingPaths,
  runWorkflowRunner,
  supportsWorkflowAnsiColor,
  WORKFLOW_WAIT_NOTICE_INTERVAL_MS,
  WORKFLOW_RUNNER_CODEX_PROFILE,
  workflowContextSnapshotRelativePath,
  workflowFileLockPath,
  writeProcessInput,
  type ProcessRunner,
} from "./workflow-runner.ts";

type Workspace = {
  root: string;
  cleanup: () => Promise<void>;
};

const PROMPTS = {
  "plan-validator.md": "PLAN VALIDATOR PROMPT",
  "fix-plan.md": "FIX PLAN PROMPT",
  "execute-plan.md": "EXECUTE PLAN PROMPT",
  "unblock-plan.md": "UNBLOCK PLAN PROMPT",
  "review-changes.md": "REVIEW CHANGES PROMPT",
  "scope-cleanup.md": "SCOPE CLEANUP PROMPT",
  "fix-review.md": "FIX REVIEW PROMPT",
  "reopen-plan.md": "REOPEN PLAN PROMPT",
  "commit-summary.md": "COMMIT SUMMARY PROMPT",
};

const CODEX_COMMAND = WORKFLOW_RUNNER_CODEX_PROFILE;
const CODEX_EXEC_LABEL = `${CODEX_COMMAND} exec`;
const CODEX_HOME_SUFFIX = `/.${CODEX_COMMAND}`;

const planWith = (status: string, nextAction: string, extra = "") => `# Plan

${thinPlanContractSection()}

## Status

${status}

## Next Action

${nextAction}

## Files (MANDATORY)

### Created files

* .ai/scripts/workflow-runner.test.ts

### Modified files

* .ai/scripts/workflow-runner.ts

### Deleted files

* None

${extra}
`;

const planWithFileScope = (
  status: string,
  nextAction: string,
  files: {
    created?: string[];
    modified?: string[];
    deleted?: string[];
  },
  extra = "",
) => `# Plan

${thinPlanContractSection()}

## Status

${status}

## Next Action

${nextAction}

## Files (MANDATORY)

### Created files

${(files.created?.length ? files.created : ["None"]).map((file) => `* ${file}`).join("\n")}

### Modified files

${(files.modified?.length ? files.modified : ["None"]).map((file) => `* ${file}`).join("\n")}

### Deleted files

${(files.deleted?.length ? files.deleted : ["None"]).map((file) => `* ${file}`).join("\n")}

${extra}
`;

const ownershipReleaseSection = (file: string, releasedTo = ".ai/plans/dependent-plan.md") => `## File Ownership Releases

### Release v1

* File: ${file}
* Released By: .ai/plans/current-plan.md
* Released To: ${releasedTo}
* Evidence: current-plan file-specific validation passed
* Status: transferred
`;

const deploymentValidationSection = (planName: string, status = "pending") => `## Deployment Validation

### Deployment Validation v1

* Summary: deployment validation pending
* Status: ${status}
* Evidence: .ai/artifacts/${planName}/events/deployment-validation-v1.md
`;

const setupWorkspace = async (): Promise<Workspace> => {
  const root = await mkdtemp(join(tmpdir(), "workflow-runner-"));
  mkdirSync(join(root, ".ai", "plans"), { recursive: true });
  mkdirSync(join(root, ".ai", "prompts"), { recursive: true });
  for (const [name, content] of Object.entries(PROMPTS)) {
    writeFileSync(join(root, ".ai", "prompts", name), content);
  }
  return {
    root,
    cleanup: () => rm(root, { recursive: true, force: true }),
  };
};

const writePlan = async (root: string, planName: string, content: string) => {
  await writeFile(join(root, ".ai", "plans", `${planName}.md`), content);
};

const writeWorkflowEventArtifactSync = ({
  root,
  planName,
  kind,
  version,
  summary = "Artifact summary.",
  evidence = "Artifact evidence.",
}: {
  root: string;
  planName: string;
  kind: string;
  version: number;
  summary?: string;
  evidence?: string;
}) => {
  const artifactPath = join(root, ".ai", "artifacts", planName, "events", `${kind}-v${version}.md`);
  mkdirSync(dirname(artifactPath), { recursive: true });
  writeFileSync(
    artifactPath,
    `# ${kind} v${version}

## Summary

${summary}

## Evidence

${evidence}
`,
    "utf8",
  );
};

const writeWorkflowEventArtifact = async (options: Parameters<typeof writeWorkflowEventArtifactSync>[0]) => {
  writeWorkflowEventArtifactSync(options);
};

const writeWorkflowFileLock = async (
  root: string,
  relativePath: string,
  metadata: Record<string, unknown> | string,
) => {
  const lockPath = workflowFileLockPath(root, relativePath);
  mkdirSync(dirname(lockPath), { recursive: true });
  await writeFile(lockPath, typeof metadata === "string" ? metadata : JSON.stringify(metadata), "utf8");
  return lockPath;
};

const planArg = (planName: string) => `.ai/plans/${planName}.md`;

const thinPlanContractSection = () => `## Workflow Content Rules

thin-plan-v1
`;

const readTokenUsageLedger = async (root: string, planName: string) => {
  const content = await readFile(
    join(root, ".ai", "artifacts", planName, "logs", "token-usage.jsonl"),
    "utf8",
  );
  return content
    .trim()
    .split("\n")
    .filter(Boolean)
    .map((line) => JSON.parse(line) as Record<string, unknown>);
};

const readFailureDebugLedger = async (root: string, planName: string) => {
  const content = await readFile(
    join(root, ".ai", "artifacts", planName, "logs", "failure.jsonl"),
    "utf8",
  );
  return content
    .trim()
    .split("\n")
    .filter(Boolean)
    .map((line) => JSON.parse(line) as Record<string, unknown>);
};

const assertFailureMetadata = (
  log: string,
  expected: {
    kind: string;
    reason: RegExp;
    nextSuggestedAction: RegExp;
  },
) => {
  assert.match(log, new RegExp(`failureKind: ${expected.kind}`));
  assert.match(log, expected.reason);
  assert.match(log, expected.nextSuggestedAction);
};

const collectConsole = () => {
  const lines: string[] = [];
  return {
    lines,
    console: {
      log: (message: string) => lines.push(message),
      error: (message: string) => lines.push(message),
    },
  };
};

const runnerReturning =
  (
    result: Awaited<ReturnType<ProcessRunner>>,
    onRun?: (call: Parameters<ProcessRunner>[0]) => Promise<void> | void,
  ): ProcessRunner =>
  async (call) => {
    await onRun?.(call);
    if (call.command === "git" && call.args[0] === "status" && call.args[1] === "--short") {
      return { launched: true, stdout: "", stderr: "", exitCode: 0 };
    }
    return result;
  };

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

const turnCompletedUsageLine = (inputTokens: number) =>
  JSON.stringify({
    type: "turn.completed",
    usage: {
      input_tokens: inputTokens,
      cached_input_tokens: Math.floor(inputTokens / 2),
      output_tokens: 1234,
      reasoning_output_tokens: 456,
    },
  });

const turnCompletedUsageDetailLine = ({
  inputTokens,
  cachedInputTokens,
  outputTokens,
  reasoningOutputTokens,
}: {
  inputTokens: number;
  cachedInputTokens: number;
  outputTokens: number;
  reasoningOutputTokens: number;
}) =>
  JSON.stringify({
    type: "turn.completed",
    usage: {
      input_tokens: inputTokens,
      cached_input_tokens: cachedInputTokens,
      output_tokens: outputTokens,
      reasoning_output_tokens: reasoningOutputTokens,
    },
  });

const codexAgentMessageLine = (text: string) =>
  JSON.stringify({
    type: "item.completed",
    item: {
      id: "item_agent",
      type: "agent_message",
      text,
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
  '/bin/bash -lc \'pnpm --dir apps/backend exec jest --config jest.config.js --runTestsByPath test/onboarding/document-content-generator.service.spec.ts --runInBand -t "widens unmapped suffixless"\'';
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
const GIT_UNSTAGED_DIFF_COMMAND = "git diff -- apps/backend/test/onboarding/document-content-generator.service.spec.ts";
const GIT_UNSTAGED_DIFF_SED_COMMAND =
  "git diff -- apps/backend/src/documents/document-content-generator.service.ts | sed -n '1,220p'";
const GIT_SHOW_RG_COMMAND =
  'git show :apps/backend/src/documents/document-content-generator.service.ts | rg -n "broaderMarketResearch|registrationCountryContains|isLikelyLocal|buildMarketResearchCategoryTerms|generateMarketResearch|normalizeMarketResearchCompetitors|buildMarketResearchSupportMap|extractNameSupportWindows|extractFinancialSupportText|ensureSearchEvidenceGapSummary|competitor_rejected|likelyCompetitors|searchSkipped|search_skipped|fallback"';
const GIT_SHOW_SED_COMMAND =
  "git show :apps/backend/src/documents/document-content-generator.service.ts | nl -ba | sed -n '340,435p'";

const readWorkflowPrompt = (name: string) => readFile(join(process.cwd(), ".ai", "prompts", name), "utf8");
const readInstruction = (name: string) =>
  readFile(join(process.cwd(), ".ai", "instructions", name), "utf8");
const readPlanTemplate = () => readFile(join(process.cwd(), ".ai", "templates", "plan.template.md"), "utf8");

test("plan-validator prompt classifies spec-origin findings as minor repairs or major decisions", async () => {
  const prompt = await readWorkflowPrompt("plan-validator.md");

  assert.match(prompt, /`MINOR SPEC REPAIR` applies ONLY to:/);
  assert.match(prompt, /typos, formatting, heading\/list consistency/);
  assert.match(prompt, /making behavior explicit when it is already unambiguously defined elsewhere in the same spec/);
  assert.match(prompt, /`MAJOR SPEC DECISION REQUIRED` applies to:/);
  assert.match(prompt, /new behavior/);
  assert.match(prompt, /changed business logic/);
  assert.match(prompt, /missing product choice/);
  assert.match(prompt, /unclear data shape\/API contract/);
  assert.match(prompt, /unclear edge-case behavior/);
  assert.match(prompt, /anything that requires user authority/);
});

test("plan-validator prompt requires major spec decisions to STOP without routing to fix-plan", async () => {
  const prompt = await readWorkflowPrompt("plan-validator.md");

  assert.match(
    prompt,
    /`MAJOR SPEC DECISION REQUIRED` MUST output `STOP`, state the required user decision, and must not transition to `fix-plan`/,
  );
  assert.match(prompt, /IF any `MAJOR SPEC DECISION REQUIRED` issues exist:[\s\S]*output `STOP`/);
  assert.match(prompt, /plan MUST NOT transition to `fix-plan`/);
});

test("plan-validator prompt excludes spec issue routes from generic critical routing", async () => {
  const prompt = await readWorkflowPrompt("plan-validator.md");

  assert.match(
    prompt,
    /IF any CRITICAL issues exist and NO `MAJOR SPEC DECISION REQUIRED` issues exist and NO `MINOR SPEC REPAIR` issues exist:/,
  );
});

test("fix-plan prompt allows spec edits only for latest minor spec repair validation findings", async () => {
  const prompt = await readWorkflowPrompt("fix-plan.md");

  assert.match(prompt, /spec-origin issues from the latest validation entry marked exactly `MINOR SPEC REPAIR`/);
  assert.match(prompt, /modify the spec unless the latest validation finding is marked exactly `MINOR SPEC REPAIR`/);
  assert.match(prompt, /Spec edits are allowed ONLY when the latest validation history entry points to an evidence artifact/);
  assert.match(prompt, /edit only the named spec file and named spec section\(s\) from the latest validation artifact/);
  assert.match(prompt, /return to `draft \+ plan-validator`/);
});

test("fix-plan prompt forbids unclassified or unresolved major spec-origin edits", async () => {
  const prompt = await readWorkflowPrompt("fix-plan.md");

  assert.match(prompt, /major or unclassified spec issue requires user decision before plan can be fixed/);
  assert.match(
    prompt,
    /If the latest validation finding is marked `MAJOR SPEC DECISION REQUIRED`, STOP only when the issue still requires user authority after this codebase reclassification check\./,
  );
  assert.match(prompt, /If a spec-origin validation finding is unclassified:[\s\S]*STOP/);
  assert.match(prompt, /If a `MINOR SPEC REPAIR` finding lacks exact allowed spec sections:[\s\S]*STOP/);
  assert.match(prompt, /If a `MINOR SPEC REPAIR` would require behavior not already decided in the existing spec:[\s\S]*STOP/);
});

test("plan-validator prompt reuses existing codebase contracts before escalating spec decisions", async () => {
  const prompt = await readWorkflowPrompt("plan-validator.md");

  assert.match(prompt, /## Codebase Contract Resolution \(MANDATORY\)/);
  assert.match(prompt, /Existing codebase contracts SHOULD be preferred over escalating to user decisions/);
  assert.match(
    prompt,
    /Do NOT call a data shape\/API contract "unclear" if the existing spec-scoped codebase already defines a compatible contract the plan can reuse/,
  );
  assert.match(
    prompt,
    /Do NOT call a sibling-contract reuse choice a spec gap when the spec adds a new section to an existing document\/API and the reused contract already represents the same kind of item in that surface/,
  );
  assert.match(
    prompt,
    /Supporting files directly required to implement behavior in a spec-named owner file may appear in the plan when they do not expand behavior beyond the spec/,
  );
  assert.match(
    prompt,
    /`MAJOR SPEC DECISION REQUIRED` does NOT apply when:[\s\S]*the codebase already provides an equivalent sibling item contract that can be reused for the new spec-required section/,
  );
  assert.match(
    prompt,
    /`MAJOR SPEC DECISION REQUIRED` does NOT apply when:[\s\S]*a supporting type\/contract file must be updated only to carry the already-decided spec behavior through an in-scope owner file/,
  );
});

test("fix-plan prompt allows codebase-backed reclassification without spec edits", async () => {
  const prompt = await readWorkflowPrompt("fix-plan.md");

  assert.match(prompt, /## Codebase Reclassification Check \(MANDATORY\)/);
  assert.match(prompt, /removing behavior the plan invented beyond the spec/);
  assert.match(prompt, /narrowing file scope or validation scope back to the spec/);
  assert.match(prompt, /reusing an existing codebase contract\/type\/rendering path that already exists in spec-scoped files/);
  assert.match(prompt, /replacing an invented data shape\/API contract with an existing compatible contract already present in the codebase/);
  assert.match(prompt, /adding spec-required coverage that the plan omitted/);
  assert.match(prompt, /reusing an existing sibling contract for a new spec-required section of an existing document\/API surface/);
  assert.match(
    prompt,
    /including a supporting type\/contract file only because an in-scope owner file needs that already-decided shape carried through existing code/,
  );
  assert.match(prompt, /This reclassification does NOT allow spec edits unless the finding is explicitly `MINOR SPEC REPAIR`\./);
  assert.match(
    prompt,
    /when applicable, replace invented plan behavior with the existing compatible codebase contract instead of asking for a new spec decision/,
  );
});

test("execute-plan prompt turns cross-plan file conflicts into resumable plan dependency blockers", async () => {
  const prompt = await readWorkflowPrompt("execute-plan.md");

  assert.match(prompt, /plan dependency/);
  assert.match(prompt, /owner plan path/);
  assert.match(prompt, /owned by another active plan/);
  assert.match(prompt, /Status\s*=\s*blocked/);
  assert.match(prompt, /Next Action\s*=\s*unblock-plan/);
  assert.match(prompt, /Do NOT keep executing both plans in parallel/);
});

test("execute-plan prompt defers unavailable external final validation to review", async () => {
  const prompt = await readWorkflowPrompt("execute-plan.md");

  assert.match(prompt, /external final validation deferral/i);
  assert.match(prompt, /browser\/manual\/deployed\/external validation/i);
  assert.match(prompt, /Status\s*=\s*review/);
  assert.match(prompt, /Next Action\s*=\s*review-plan/);
  assert.match(prompt, /review owns the completion decision/i);
  assert.match(prompt, /must not transition directly to `commit-summary`/i);
});

test("execute-plan prompt defers validation failures that only come from out-of-scope files", async () => {
  const prompt = await readWorkflowPrompt("execute-plan.md");

  assert.match(prompt, /validation command fails only on files outside the current plan scope/i);
  assert.match(prompt, /do not block the active plan solely for that reason/i);
  assert.match(prompt, /record the validation as deferred or out-of-scope/i);
});

test("execute-plan prompt loads testing instructions before validation", async () => {
  const prompt = await readWorkflowPrompt("execute-plan.md");

  assert.match(prompt, /\.ai\/instructions\/shared\/testing\.md/);
  assert.match(prompt, /before running, skipping, or classifying validation/i);
});

test("superpowers prompt does not require compact agent progress updates", async () => {
  const prompt = await readWorkflowPrompt("superpowers.md");

  assert.doesNotMatch(prompt, /Free-form `\[agent\]` progress updates should be one sentence by default/);
  assert.doesNotMatch(prompt, /Lead with `Area: finding\/result`/);
  assert.doesNotMatch(prompt, /Avoid narrative lead-ins/);
  assert.doesNotMatch(prompt, /Use bullets only for multiple actionable findings, capped at 3/);
});

test("create-plan prompt defines Files as the planning-time ownership boundary", async () => {
  const prompt = await readWorkflowPrompt("create-plan.md");

  assert.match(prompt, /planning-time expected ownership boundary/i);
  assert.match(prompt, /expected created, modified, and deleted file paths/i);
  assert.match(prompt, /reconciled after implementation by `execute-plan`/i);
});

test("execute-plan prompt reconciles Files after implementation before review", async () => {
  const prompt = await readWorkflowPrompt("execute-plan.md");

  assert.match(prompt, /reconcile `## Files \(MANDATORY\)` after implementation/i);
  assert.match(prompt, /actual created, modified, and deleted plan-owned paths/i);
  assert.match(prompt, /before moving to `Status = review`/i);
});

test("review-changes prompt routes file-list mismatches back to execution", async () => {
  const prompt = await readWorkflowPrompt("review-changes.md");

  assert.match(prompt, /If staged implementation paths do not match `## Files \(MANDATORY\)`/);
  assert.match(prompt, /file-list mismatch/i);
  assert.match(prompt, /Status = active/);
  assert.match(prompt, /Next Action = execute-plan/);
});

test("commit-summary prompt does not repair Files metadata", async () => {
  const prompt = await readWorkflowPrompt("commit-summary.md");

  assert.match(prompt, /relies on the existing `## Files \(MANDATORY\)` list/i);
  assert.match(prompt, /must not repair `## Files \(MANDATORY\)`/i);
  assert.match(prompt, /route the plan back through review or execution/i);
});

test("execute-plan prompt requires concise execution log and validation update wording", async () => {
  const prompt = await readWorkflowPrompt("execute-plan.md");

  assert.match(prompt, /Execution Log entries may contain only `Summary`, `Result`, and `Evidence`/);
  assert.match(prompt, /Keep inline execution entries under 512 bytes/);
  assert.match(prompt, /Do not record reasoning narration, wait-state updates, or artifact body text in the plan/);
  assert.match(prompt, /Plan updates should state what changed, what was validated, and remaining action/);
});

test("review-changes prompt requires concise actionable Review History entries", async () => {
  const prompt = await readWorkflowPrompt("review-changes.md");

  assert.match(prompt, /Review History entries may contain only `Summary`, `Decision`, and `Evidence`/);
  assert.match(prompt, /Put all issue bullets, file references, remediation notes, missing validations, and unresolved risks in the review artifact/);
  assert.match(prompt, /self-contained/i);
  assert.match(prompt, /must not rely on surrounding prose, earlier review versions, or shorthand like `same as above`/i);
  assert.match(prompt, /Do not use Review History for terminal-output summaries/);
});

test("plan template uses artifact-first thin-plan workflow stubs", async () => {
  const template = await readPlanTemplate();

  assert.match(template, /Keep workflow history entries under 512 bytes/);
  assert.match(template, /Keep aggregate workflow history under 4 KB/);
  assert.match(template, /may contain only `Summary`, exactly one of `Result`, `Decision`, or `Status`, and `Evidence`/);
  assert.doesNotMatch(template, /\* Issues:/);
  assert.doesNotMatch(template, /\* Critical Issues:/);
  assert.doesNotMatch(template, /\* Warnings:/);
  assert.doesNotMatch(template, /\* Required Fixes:/);
});

test("plan template keeps workflow history sections as empty stubs", async () => {
  const template = await readPlanTemplate();

  const validationSection = template.match(/## Validation History([\s\S]*?)## Review History/);
  const reviewSection = template.match(/## Review History([\s\S]*?)## Reopen History/);
  const reopenSection = template.match(/## Reopen History([\s\S]*?)## Blockers/);

  assert.ok(validationSection, "expected Validation History section");
  assert.ok(reviewSection, "expected Review History section");
  assert.ok(reopenSection, "expected Reopen History section");

  for (const [sectionName, section] of [
    ["Validation History", validationSection[1]],
    ["Review History", reviewSection[1]],
    ["Reopen History", reopenSection[1]],
  ] as const) {
    assert.match(section, /\(empty\)/, `${sectionName} should keep the empty stub`);
    assert.doesNotMatch(section, /^---$/m, `${sectionName} must not include section separators`);
    assert.doesNotMatch(section, /\bRules:\b/, `${sectionName} must not include inline rules`);
    assert.doesNotMatch(
      section,
      /###\s+(Validation|Review|Reopen)\s+v\d+/,
      `${sectionName} must not include inline entry examples`,
    );
  }
});

test("execute-plan prompt uses snapshot remediation context before full review history", async () => {
  const prompt = await readWorkflowPrompt("execute-plan.md");

  assert.match(prompt, /Latest Review Remediation Context/i);
  assert.match(prompt, /default fix list/i);
  assert.match(prompt, /Do not load `## Review History` by default/i);
});

test("fix-review prompt requires concise corrective plan updates", async () => {
  const prompt = await readWorkflowPrompt("fix-review.md");

  assert.match(prompt, /Corrective plan updates must be limited to issue, affected section, and action taken/);
  assert.match(prompt, /Do not add reasoning narration to review-fix plan updates/);
});

test("review-changes prompt loads testing instructions before validation", async () => {
  const prompt = await readWorkflowPrompt("review-changes.md");

  assert.match(prompt, /\.ai\/instructions\/shared\/testing\.md/);
  assert.match(prompt, /before running, skipping, or classifying validation/i);
});

test("testing instructions require command-level escalation for local E2E in Codex sandbox", async () => {
  const instructions = await readInstruction("shared/testing.md");

  assert.match(instructions, /Codex sandbox/i);
  assert.match(instructions, /Node\/Playwright local network/i);
  assert.match(instructions, /command-level escalation/i);
  assert.match(instructions, /Do not use `yolo`/i);
});

test("unblock-plan prompt can resume plan dependency blockers after owner completion evidence", async () => {
  const prompt = await readWorkflowPrompt("unblock-plan.md");

  assert.match(prompt, /plan dependency/);
  assert.match(prompt, /owner plan/);
  assert.match(prompt, /completed \+ commit-summary/);
  assert.match(prompt, /released the shared file ownership/);
  assert.match(prompt, /blocked -> active/);
});

test("unblock-plan prompt recognizes deployment-validation owner commits as stable dependency evidence", async () => {
  const prompt = await readWorkflowPrompt("unblock-plan.md");

  assert.match(prompt, /deployment-validation \+ unblock-plan/);
  assert.match(prompt, /deployment-validation artifact/);
  assert.match(prompt, /stable/);
  assert.match(prompt, /plan dependency/);
});

test("review-changes prompt treats required out-of-scope owner-plan fixes as dependency blockers", async () => {
  const prompt = await readWorkflowPrompt("review-changes.md");

  assert.match(prompt, /plan dependency/);
  assert.match(prompt, /required fix needs a file outside the current plan path list/);
  assert.match(prompt, /owned by another active plan/);
  assert.match(prompt, /Status = active/);
  assert.match(prompt, /Next Action = execute-plan/);
});

test("review-changes prompt routes deferred external validation to completed commit-summary", async () => {
  const prompt = await readWorkflowPrompt("review-changes.md");

  assert.match(prompt, /final validation requires deployed, manual, or external code/);
  assert.match(prompt, /deferred validation note/i);
  assert.match(prompt, /## Status[\s\S]*completed/);
  assert.match(prompt, /## Next Action[\s\S]*commit-summary/);
  assert.doesNotMatch(prompt, /SAFE - DEPLOYMENT VALIDATION REQUIRED/);
});

test("review-changes prompt requires actionable issue output for failed reviews", async () => {
  const prompt = await readWorkflowPrompt("review-changes.md");

  assert.match(prompt, /If Summary is `NEEDS FIX` or `HIGH RISK`, `\*\*Issues\*\*` must include at least one issue bullet/);
  assert.match(prompt, /concrete conflict, defect, missing validation, or required fix/);
  assert.match(prompt, /terminal output shows what needs to be fixed without opening the artifact file/);
});

test("review-changes prompt expects runner pre-review cleanup for clearly unrelated hunks", async () => {
  const prompt = await readWorkflowPrompt("review-changes.md");

  assert.match(prompt, /runner may auto-unstage clearly unrelated staged hunks before review/i);
  assert.match(prompt, /review the remaining path-scoped staged diff only/i);
  assert.match(prompt, /if unrelated changes remain after runner cleanup/i);
});

test("commit-summary prompt creates one local deployment-validation commit and forbids auto-push", async () => {
  const prompt = await readWorkflowPrompt("commit-summary.md");

  assert.match(prompt, /deployment-validation/);
  assert.match(prompt, /exactly one local git commit/);
  assert.match(prompt, /MUST NOT push/);
  assert.match(prompt, /## Deployment Validation/);
  assert.match(prompt, /artifact must include the commit SHA, branch, commit timestamp, push status, deployment status/);
  assert.match(prompt, /Deployment Validation entries may contain only `Summary`, `Status`, and `Evidence`/);
  assert.doesNotMatch(prompt, /\* Commit:/);
  assert.doesNotMatch(prompt, /\* Push Status:/);
  assert.doesNotMatch(prompt, /\* Deployment Status:/);
});

test("commit-summary prompt creates one local completed commit and forbids auto-push", async () => {
  const prompt = await readWorkflowPrompt("commit-summary.md");

  assert.match(prompt, /completed \+ commit-summary[\s\S]*create exactly one local git commit/);
  assert.match(prompt, /git commit -m "<generated message>" -- <plan-owned paths>/);
  assert.match(prompt, /MUST NOT push/);
});

test("commit-summary prompt avoids a second commit after deployment validation passes", async () => {
  const prompt = await readWorkflowPrompt("commit-summary.md");

  assert.match(prompt, /Status: passed/);
  assert.match(prompt, /do not create a second commit/);
  assert.match(prompt, /recorded commit/);
});

test("commit-summary prompt unstages clearly unrelated staged hunks after path-scoped git add", async () => {
  const prompt = await readWorkflowPrompt("commit-summary.md");

  assert.match(prompt, /after the path-scoped git add/i);
  assert.match(prompt, /unstage any staged hunk that is not clearly related to the current plan or spec/i);
  assert.match(prompt, /do not stop for clearly unrelated hunks/i);
});

test("unblock-plan prompt updates deployment-validation state from deployment evidence", async () => {
  const prompt = await readWorkflowPrompt("unblock-plan.md");

  assert.match(prompt, /deployment-validation/);
  assert.match(prompt, /Push Status/);
  assert.match(prompt, /Deployment Status/);
  assert.match(prompt, /final validation evidence/);
  assert.match(prompt, /completed \+ commit-summary/);
  assert.match(prompt, /reopening \+ reopen-plan/);
});

test("unblock-plan prompt stops deployment validation when no new evidence is available", async () => {
  const prompt = await readWorkflowPrompt("unblock-plan.md");

  assert.match(prompt, /If no concrete new deployment-validation evidence is available/);
  assert.match(prompt, /output `STOP`/);
  assert.match(prompt, /deployment-validation evidence is required/);
  assert.match(prompt, /MUST NOT return success without changing the plan/);
});

test("reopen-plan prompt accepts canonical reopening state", async () => {
  const prompt = await readWorkflowPrompt("reopen-plan.md");

  assert.match(prompt, /Already Reopened Fast Path/);
  assert.match(prompt, /Status == active/);
  assert.match(prompt, /Next Action == execute-plan/);
  assert.match(prompt, /do not output `STOP`/);
  assert.match(prompt, /Expected:\s*\n\s*reopening/);
  assert.match(prompt, /IF Status != reopening:/);
  assert.match(prompt, /After the plan is updated for the reopened work:/);
  assert.match(prompt, /## Status\s*\n\s*\nactive/);
  assert.match(prompt, /## Next Action\s*\n\s*\nexecute-plan/);
  assert.doesNotMatch(prompt, /plan must be completed before reopening/);
});

test("workflow prompts define transferred file ownership releases", async () => {
  const executePrompt = await readWorkflowPrompt("execute-plan.md");
  const unblockPrompt = await readWorkflowPrompt("unblock-plan.md");
  const reviewPrompt = await readWorkflowPrompt("review-changes.md");

  for (const prompt of [executePrompt, unblockPrompt, reviewPrompt]) {
    assert.match(prompt, /File Ownership Releases/);
    assert.match(prompt, /Released To/);
    assert.match(prompt, /Status: transferred/);
  }
  assert.match(executePrompt, /must not edit, stage, review, or commit the released file again/);
  assert.match(unblockPrompt, /add the released file to its own `## Files \(MANDATORY\)`/);
  assert.match(reviewPrompt, /reject the review for the releasing plan/);
});

test("parses context usage from the final valid codex token_count event", () => {
  const usage = parseContextUsage(
    [
      "not json",
      tokenCountLine(100, 1000),
      JSON.stringify({ type: "event_msg", payload: { type: "token_count", info: {} } }),
      tokenCountLine(129200, 258400),
      turnCompletedUsageLine(999999),
    ].join("\n"),
  );

  assert.deepEqual(usage, {
    contextWindowTokens: 258400,
    contextWindowUsedTokens: 129200,
    contextWindowUsedPercent: "50.00",
  });
});

test("parses detailed codex turn completed token usage", () => {
  assert.deepEqual(
    parseCodexTokenUsage(
      [
        "not json",
        tokenCountLine(333, 999),
        turnCompletedUsageDetailLine({
          inputTokens: 1200,
          cachedInputTokens: 450,
          outputTokens: 80,
          reasoningOutputTokens: 25,
        }),
      ].join("\n"),
    ),
    {
      usageAvailable: true,
      inputTokens: 1200,
      cachedInputTokens: 450,
      uncachedInputTokens: 750,
      outputTokens: 80,
      reasoningOutputTokens: 25,
      totalTokens: 1280,
      contextWindowTokens: 999,
      contextWindowUsedTokens: 333,
      contextWindowUsedPercent: "33.33",
    },
  );
});

test("token usage parsing keeps context-window usage when detailed usage is unavailable", () => {
  assert.deepEqual(parseCodexTokenUsage(["plain", tokenCountLine(200, 1000)].join("\n")), {
    usageAvailable: false,
    inputTokens: null,
    cachedInputTokens: null,
    uncachedInputTokens: null,
    outputTokens: null,
    reasoningOutputTokens: null,
    totalTokens: null,
    contextWindowTokens: 1000,
    contextWindowUsedTokens: 200,
    contextWindowUsedPercent: "20.00",
  });
});

test("parses current codex turn.completed usage when token_count events are absent", () => {
  assert.deepEqual(parseContextUsage(["not json", turnCompletedUsageLine(6070935)].join("\n")), {
    contextWindowTokens: "unavailable",
    contextWindowUsedTokens: 6070935,
    contextWindowUsedPercent: "unavailable",
  });
});

test("context usage parsing returns unavailable when codex usage data is missing", () => {
  assert.deepEqual(parseContextUsage("plain stdout\n{}"), {
    contextWindowTokens: "unavailable",
    contextWindowUsedTokens: "unavailable",
    contextWindowUsedPercent: "unavailable",
  });
});

test("process stdin helpers ignore empty input and pipe non-empty input", () => {
  assert.deepEqual(processStdioForInput(""), ["ignore", "pipe", "pipe"]);
  assert.deepEqual(processStdioForInput("prompt"), ["pipe", "pipe", "pipe"]);
});

test("process stdin helper attaches an error handler before writing input", async () => {
  const writable = new Writable({
    write(_chunk, _encoding, callback) {
      callback(new Error("write EPIPE"));
    },
  });
  const error = once(writable, "error");

  writeProcessInput(writable, "prompt");

  assert.equal(writable.listenerCount("error") >= 2, true);
  const [caught] = await error;
  assert.match(String(caught), /write EPIPE/);
});

test(`${CODEX_COMMAND} environment matches the local ${CODEX_COMMAND} function account context`, () => {
  assert.deepEqual(codexWorkEnvironment({ HOME: "/home/tester", PATH: "/usr/bin" }), {
    HOME: "/home/tester",
    PATH: "/home/tester/.nvm/versions/node/v20.20.2/bin:/usr/bin",
    CODEX_HOME: `/home/tester${CODEX_HOME_SUFFIX}`,
  });
  assert.equal(
    codexWorkEnvironment({
      HOME: "/home/tester",
      PATH: "/home/tester/.nvm/versions/node/v20.20.2/bin:/usr/bin",
    }).PATH,
    "/home/tester/.nvm/versions/node/v20.20.2/bin:/usr/bin",
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
    codexAgentMessageLine("### Fix Summary\n\nPlan updated.\n\n### State Transition"),
  ].join("\n");

  assert.equal(codexOutputContainsStop(benignJsonOutput, ""), false);
  assert.equal(codexOutputContainsStop(codexAgentMessageLine("STOP (`plan is blocked`)"), ""), true);
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
        agents_states: [{ message: "STOP: sub-agent diagnostic should not count" }],
      },
    }),
    codexAgentMessageLine("STOP: spec must be updated before plan can be fixed"),
  ].join("\n");

    assert.equal(
      codexOutputStopReason(stdout, ""),
    `${CODEX_EXEC_LABEL} output contained STOP: spec must be updated before plan can be fixed`,
  );
});

test("codex JSON STOP reason extraction accepts inline-code STOP agent directives", () => {
  assert.equal(codexOutputContainsStop(codexAgentMessageLine("`STOP`"), ""), true);
  assert.equal(
    codexOutputStopReason(codexAgentMessageLine("`STOP`: spec must be updated before plan can be fixed"), ""),
    `${CODEX_EXEC_LABEL} output contained STOP: spec must be updated before plan can be fixed`,
  );
});

test("codex JSON STOP reason extraction ignores STOP text in command output", () => {
  assert.equal(codexOutputStopReason(codexCommandOutputLine("STOP: command failed for another reason"), ""), undefined);
  assert.equal(codexOutputContainsStop(codexCommandOutputLine("STOP: command failed for another reason"), ""), false);
});

test("plain stdout and stderr STOP reason extraction includes a bounded excerpt", () => {
  assert.equal(
    codexOutputStopReason("first line\nSTOP: plan needs a spec update\nlast line", ""),
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
    formatCodexJsonlEventForTerminal(codexCommandStartedLine("git status --short"), { color: false }),
    "Ran git status --short\n\n",
  );
  assert.equal(formatCodexJsonlEventForTerminal(codexCommandOutputLine(" M src/file.ts\n"), { color: false }), "");
  assert.equal(formatCodexJsonlEventForTerminal(codexAgentMessageLine("Done")), "[agent]\nDone\n\n");
  assert.equal(formatCodexJsonlEventForTerminal(tokenCountLine(50, 100)), "[context] 50/100 tokens (50.00%)\n\n");
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
    "Status: `review`",
    "Next Action: `review-plan`",
  ].join("\n");

  assert.equal(
    formatCodexJsonlEventForTerminal(codexAgentMessageLine(workflowSummary), { color: false }),
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
      "Status: `review`",
      "Next Action: `review-plan`",
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
    "* Updated prompt output templates for validator, fix-plan, fix-review, reopen-plan, and unblock-plan.",
    "* Preserved review-changes as the only stage-specific terminal schema.",
    "",
    "**Next**",
    "Status: `draft`",
    "Next Action: `plan-validator`",
  ].join("\n");

  assert.equal(
    formatCodexJsonlEventForTerminal(codexAgentMessageLine(workflowSummary), { color: false }),
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
      "* Updated prompt output templates for validator, fix-plan, fix-review, reopen-plan, and unblock-plan.",
      "* Preserved review-changes as the only stage-specific terminal schema.",
      "",
      "**Next**",
      "Status: `draft`",
      "Next Action: `plan-validator`",
      "",
      "",
    ].join("\n"),
  );
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
    "Status: `completed`",
    "Next Action: `commit-summary`",
  ].join("\n");

  assert.equal(
    formatCodexJsonlEventForTerminal(codexAgentMessageLine(workflowSummary), { color: false }),
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
      "Status: `completed`",
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
    formatCodexJsonlEventForTerminal(codexAgentMessageLine(workflowSummary), { color: false }),
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
    "Status:",
    "draft",
    "",
    "Next Action:",
    "plan-validator",
  ].join("\n");

  assert.equal(
    formatCodexJsonlEventForTerminal(codexAgentMessageLine(workflowSummary), { color: false }),
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
      "Status: `draft`",
      "Next Action: `plan-validator`",
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
    "Status: `active`",
    "Next Action: `execute-plan`",
  ].join("\n");

  assert.equal(
    formatCodexJsonlEventForTerminal(codexAgentMessageLine(reviewSummary), { color: false }),
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
      "Status: `active`",
      "Next Action: `execute-plan`",
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
    formatCodexJsonlEventForTerminal(codexAgentMessageLine(reviewSummary), { color: false }),
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
    formatCodexJsonlEventForTerminal(codexAgentMessageLine(reviewSummary), { color: false }),
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
    "Status: `completed`",
    "Next Action: `commit-summary`",
  ].join("\n");

  assert.equal(
    formatCodexJsonlEventForTerminal(codexAgentMessageLine(workflowSummary), { color: false }),
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
      "Status: `completed`",
      "",
      "",
    ].join("\n"),
  );
});

test("codex live output formatter colorizes hybrid labels when color is enabled", () => {
  assert.equal(
    formatCodexJsonlEventForTerminal(codexCommandStartedLine("git status --short"), { color: true }),
    "\u001b[34mRan\u001b[0m git status --short\n\n",
  );
  assert.equal(
    formatCodexJsonlEventForTerminal(codexCommandStartedLine("cat .ai/prompts/review-changes.md"), { color: true }),
    "",
  );
  assert.equal(
    formatCodexJsonlEventForTerminal(codexCommandOutputLine("", "pnpm test"), { color: true }),
    "",
  );
  assert.equal(
    formatCodexJsonlEventForTerminal(codexCommandOutputLine("content\n", "cat .ai/prompts/review-changes.md"), {
      color: true,
    }),
    [
      "\u001b[34mRead\u001b[0m .ai/prompts/review-changes.md",
      "",
      "",
    ].join("\n"),
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
    "\u001b[31m[failed]\u001b[0m pnpm test (exit 7)\n  failed\n  command output omitted from workflow log\n\n",
  );
  assert.equal(
    formatCodexJsonlEventForTerminal(codexAgentMessageLine("Done"), { color: true }),
    "\u001b[38;5;214m[agent]\u001b[0m\nDone\n\n",
  );
  assert.equal(
    formatCodexJsonlEventForTerminal(JSON.stringify({ type: "turn.started" }), { color: true }),
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
    [
      "Read .ai/prompts/execute-plan.md",
      "",
      "",
    ].join("\n"),
  );

  assert.equal(
    formatCodexJsonlEventForTerminal(
      codexCommandOutputLine(
        "match\n",
        String.raw`/bin/bash -lc "rg -n 'workflow-runner' .ai/scripts/workflow-runner.ts .ai/scripts/workflow-runner.spec.md"`,
      ),
      { color: false },
    ),
    [
      "Search workflow-runner",
      "- workflow-runner.ts",
      "- workflow-runner.spec.md",
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
        ".ai/scripts/workflow-runner.spec.md\n",
        String.raw`/bin/bash -lc "find .ai/scripts -type f -name '*.spec.md' 2>/dev/null | sort"`,
      ),
      { color: false },
    ),
    [
      "Explore .ai/scripts",
      "",
      "",
    ].join("\n"),
  );

  assert.equal(
    formatCodexJsonlEventForTerminal(
      codexCommandOutputLine("", String.raw`/bin/bash -lc "git diff -- apps/web/e2e/fixtures/preauth-dashboard.fixture.ts"`),
      { color: false },
    ),
    "",
  );
});

test("codex live output formatter omits successful command output bodies regardless of length", () => {
  const output = Array.from({ length: 8 }, (_, index) => `line ${index + 1}`).join("\n");

  assert.equal(
    formatCodexJsonlEventForTerminal(codexCommandOutputLine(output, "pnpm test"), { color: false }),
    "",
  );
});

test("codex live output formatter omits long successful command output bodies", () => {
  const longLine = "x".repeat(650);
  const rendered = formatCodexJsonlEventForTerminal(codexCommandOutputLine(longLine, "pnpm test"), {
    color: false,
  });

  assert.equal(rendered, "");
  assert.equal(rendered.includes("x"), false);
});

test("codex live output formatter renders recognized vitest file runs as structured started output", () => {
  assert.equal(
    formatCodexJsonlEventForTerminal(codexCommandStartedLine(VITEST_FILE_COMMAND), { color: false }),
    [
      "Ran pnpm --filter @gondoor/web exec vitest run",
      "- src/features/dashboard/docs/services/docs.test.ts",
      "- src/features/dashboard/docs/components/docs-document-dialog.test.tsx",
      "",
      "",
    ].join("\n"),
  );

  assert.equal(
    formatCodexJsonlEventForTerminal(codexCommandStartedLine(VITEST_FILE_COMMAND), { color: true }),
    [
      "\u001b[34mRan\u001b[0m pnpm --filter @gondoor/web exec vitest run",
      "- src/features/dashboard/docs/services/docs.test.ts",
      "- src/features/dashboard/docs/components/docs-document-dialog.test.tsx",
      "",
      "",
    ].join("\n"),
  );

  assert.equal(
    formatCodexJsonlEventForTerminal(codexCommandStartedLine(FILTERED_BACKEND_TEST_COMMAND), { color: false }),
    [
      "Ran pnpm --filter @gondoor/backend test",
      "- test/onboarding/document-content-generator.service.spec.ts",
      "",
      "",
    ].join("\n"),
  );

  assert.equal(
    formatCodexJsonlEventForTerminal(codexCommandStartedLine(FILTERED_BACKEND_BUILD_COMMAND), { color: false }),
    [
      "Ran pnpm --filter @gondoor/backend build",
      "",
      "",
    ].join("\n"),
  );

  assert.equal(
    formatCodexJsonlEventForTerminal(
      codexCommandStartedLine(
        "wc -l .codex/AGENTS.md .ai/prompts/review-changes.md .ai/artifacts/market-research-competitor-discovery/state/context.md .ai/instructions/index.md .ai/instructions/shared/workflow-state.md .ai/specs/market-research-competitor-discovery.spec.md .ai/instructions/architecture.md .ai/instructions/web.md .ai/instructions/backend.md .ai/instructions/shared/testing.md .ai/plans/market-research-competitor-discovery.md",
      ),
      { color: false },
    ),
    [
      "Ran line count for 11 files",
      "",
      "",
    ].join("\n"),
  );

  assert.equal(
    formatCodexJsonlEventForTerminal(codexCommandStartedLine(JEST_FILE_COMMAND), { color: false }),
    [
      "Ran tests",
      "- test/onboarding/document-content-generator.service.spec.ts",
      "- test/documents/document-content-generator.service.spec.ts",
      "",
      "",
    ].join("\n"),
  );

  assert.equal(
    formatCodexJsonlEventForTerminal(codexCommandStartedLine(GIT_STAGED_NAME_STATUS_COMMAND), { color: false }),
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
    formatCodexJsonlEventForTerminal(codexCommandStartedLine(GIT_STAGED_DIFF_COMMAND), { color: false }),
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
    formatCodexJsonlEventForTerminal(codexCommandStartedLine(GIT_UNSTAGED_DIFF_COMMAND), { color: false }),
    [
      "Ran git diff",
      "- apps/backend/test/onboarding/document-content-generator.service.spec.ts",
      "",
      "",
    ].join("\n"),
  );

  assert.equal(
    formatCodexJsonlEventForTerminal(codexCommandStartedLine(GIT_UNSTAGED_DIFF_SED_COMMAND), { color: false }),
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
    formatCodexJsonlEventForTerminal(codexCommandStartedLine(GIT_SHOW_RG_COMMAND), { color: false }),
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
    formatCodexJsonlEventForTerminal(codexCommandStartedLine(GIT_SHOW_SED_COMMAND), { color: false }),
    [
      "Ran git show",
      "- apps/backend/src/documents/document-content-generator.service.ts:340-435",
      "",
      "",
    ].join("\n"),
  );
});

test("codex live output formatter shows a bounded excerpt for failed command output", () => {
  const output = Array.from({ length: 12 }, (_, index) => `line ${index + 1}`).join("\n");

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
      "  line 1",
      "  line 2",
      "  line 3",
      "  line 4",
      "  ... output truncated in terminal; command output omitted from workflow log",
      "",
      "",
    ].join("\n"),
  );
});

test("codex live output formatter summarizes failed Jest test output", () => {
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
      "- test/onboarding/document-content-generator.service.spec.ts",
      "- widens unmapped suffixless",
      "",
      "expect(received).toBeGreaterThan(expected)",
      "Expected: > 0",
      "Received:   -1",
      "",
      "command output omitted from workflow log",
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
    "[failed] pnpm test (exit unknown)\n  no exit\n  command output omitted from workflow log\n\n",
  );
});

test("workflow progress formatter adds readable stage labels with optional color", () => {
  assert.equal(
    formatWorkflowProgressLine({
      iteration: 1,
      maxIterations: 100,
      status: "active",
      nextAction: "execute-plan",
      promptPath: ".ai/prompts/execute-plan.md",
      model: "gpt-5.5",
      reasoning: "high",
      color: false,
    }),
    "[1/100] STAGE EXECUTE\nactive -> execute-plan\nmodel: gpt-5.5 | reasoning: high",
  );

  assert.equal(
    formatWorkflowProgressLine({
      iteration: 2,
      maxIterations: 100,
      status: "review",
      nextAction: "review-plan",
      promptPath: ".ai/prompts/review-changes.md",
      model: "gpt-5.5",
      reasoning: "xhigh",
      color: true,
    }),
    "\u001b[37;45m[2/100] STAGE REVIEW\u001b[0m\nreview -> review-plan\nmodel: gpt-5.5 | reasoning: xhigh",
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
  assert.equal(supportsWorkflowAnsiColor({ FORCE_COLOR: "1" }, { isTTY: false }), true);
  assert.equal(supportsWorkflowAnsiColor({ FORCE_COLOR: "0" }, { isTTY: true }), false);
  assert.equal(supportsWorkflowAnsiColor({ NO_COLOR: "" }, { isTTY: true }), false);
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
  formatter.flush();

  assert.equal(stdout, "[agent]\nChunked\n\nplain output\n");
  assert.equal(stderr, "stderr output\n");
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
  const headingSearchCommand = String.raw`rg -n '^## (Status|Next Action|Files \(MANDATORY\)|Hunk Ownership|File Ownership Releases|Validation Evidence|Review History|Blockers)' ${planPath}`;
  const sectionReadCommand = String.raw`awk '/^## File Ownership Releases$/{flag=1; print; next} flag && /^## /{exit} flag{print}' ${planPath}`;

  assert.equal(formatCodexJsonlEventForTerminal(codexCommandStartedLine(headingSearchCommand), { color: false }), "");
  assert.equal(
    formatCodexJsonlEventForTerminal(codexCommandOutputLine("12:## Status\n", headingSearchCommand), {
      color: false,
    }),
    "",
  );
  assert.equal(formatCodexJsonlEventForTerminal(codexCommandStartedLine(sectionReadCommand), { color: false }), "");
  assert.equal(
    formatCodexJsonlEventForTerminal(codexCommandOutputLine("## File Ownership Releases\n\n(empty)\n", sectionReadCommand), {
      color: false,
    }),
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
      "  missing section",
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
        String.raw`/bin/bash -lc "rg -n 'workflow-runner' .ai/scripts/workflow-runner.ts .ai/scripts/workflow-runner.spec.md"`,
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
      "- workflow-runner.ts",
      "- workflow-runner.spec.md",
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
        String.raw`/bin/bash -lc "rg -n ''\''^(## Hunk Ownership|## File Ownership Releases|## Review History|## Deployment Validation|## Status|## Next Action|### Review v)' .ai/plans/market-research-competitor-discovery.md"`,
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
      "- ## Hunk Ownership",
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
    formatCodexJsonlEventForTerminal(codexCommandStartedLine("cat .ai/prompts/execute-plan.md"), { color: false }),
    "",
  );
  assert.equal(
    formatCodexJsonlEventForTerminal(
      codexCommandStartedLine(String.raw`/bin/bash -lc "rg -n 'workflow-runner' .ai/scripts/workflow-runner.ts"`),
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

  formatter.stdout(`\u001b[B\n${codexCommandOutputLine("", "git diff --check")}\n`);
  formatter.stdout(`\u001b[B${codexCommandStartedLine("git status --short")}\n`);
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

test("generates manual workflow prompts for every prompt action", () => {
  const cases = [
    [".ai/prompts/plan-validator.md", "Validate", "PLAN VALIDATOR PROMPT"],
    [".ai/prompts/fix-plan.md", "Fix", "FIX PLAN PROMPT"],
    [".ai/prompts/execute-plan.md", "Execute", "EXECUTE PLAN PROMPT"],
    [".ai/prompts/unblock-plan.md", "Unblock", "UNBLOCK PLAN PROMPT"],
    [".ai/prompts/review-changes.md", "Review", "REVIEW CHANGES PROMPT"],
    [".ai/prompts/fix-review.md", "Fix review", "FIX REVIEW PROMPT"],
    [".ai/prompts/reopen-plan.md", "Reopen", "REOPEN PLAN PROMPT"],
    [".ai/prompts/commit-summary.md", "Commit summary", "COMMIT SUMMARY PROMPT"],
  ] as const;

  for (const [promptPath, action, promptContent] of cases) {
    const prompt = generateWorkflowPrompt({
      promptPath,
      planPath: ".ai/plans/workflow-runner.md",
      promptContent,
    });

    assert.match(prompt, new RegExp(`^Use ${promptPath.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}`));
    assert.match(prompt, /load: \.ai\/prompts\/superpowers\.md/);
    assert.match(prompt, /Apply the superpowers advisory guidance for analysis and edge-case checks/);
    assert.doesNotMatch(prompt, /use superpower skills: analyze/);
    assert.match(prompt, /Active Context Packet:/);
    assert.match(prompt, new RegExp(`- ${promptPath.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}`));
    assert.match(prompt, /- \.ai\/artifacts\/workflow-runner\/state\/context\.md/);
    assert.match(prompt, /- \.ai\/instructions\/index\.md/);
    assert.match(prompt, /- \.ai\/instructions\/shared\/workflow-state\.md/);
    assert.match(prompt, new RegExp(`${action}:\\n\\.ai/plans/workflow-runner\\.md`));
    if (promptPath === ".ai/prompts/unblock-plan.md") {
      assert.match(prompt, /Unblock evidence note:\n\(none provided\)/);
    }
    assert.match(prompt, new RegExp(`Workflow prompt content:\\n<workflow-prompt>\\n${promptContent}\\n</workflow-prompt>`));
  }
});

test("review prompt requires compact terminal output", async () => {
  const prompt = await readFile(".ai/prompts/review-changes.md", "utf8");

  assert.match(prompt, /Keep output compact for terminal readability/);
  assert.match(prompt, /`\*\*Summary\*\*` starts with the stage result\/state line, then at most 2-3 short high-signal bullets/);
  assert.match(prompt, /If Summary is `NEEDS FIX` or `HIGH RISK`, `\*\*Issues\*\*` must include at least one issue bullet/);
  assert.match(prompt, /terminal issue bullets should focus on the problem details, not lead with file paths/i);
  assert.match(prompt, /inline terminal refs only when needed to avoid ambiguity/i);
  assert.match(prompt, /\*\*Plan\*\*/);
  assert.match(prompt, /\*\*Summary\*\*/);
  assert.match(prompt, /\*\*Issues\*\*/);
  assert.match(prompt, /\*\*Final Verdict\*\*/);
  assert.match(prompt, /\*\*Next\*\*/);
  assert.match(prompt, /- \[ \] safe to merge/);
  assert.match(prompt, /- \[ \] requires fixes/);
  assert.match(prompt, /- \[ \] block merge/);
});

test("non-review prompts use the shared terminal output contract", async () => {
  const prompts = await Promise.all([
    readWorkflowPrompt("plan-validator.md"),
    readWorkflowPrompt("fix-plan.md"),
    readWorkflowPrompt("execute-plan.md"),
    readWorkflowPrompt("fix-review.md"),
    readWorkflowPrompt("reopen-plan.md"),
    readWorkflowPrompt("unblock-plan.md"),
    readWorkflowPrompt("commit-summary.md"),
  ]);

  for (const prompt of prompts) {
    assert.match(prompt, /\*\*Plan\*\*/);
    assert.match(prompt, /\*\*Summary\*\*/);
    assert.match(prompt, /\*\*Key Details\*\*/);
    assert.match(prompt, /\*\*Next\*\*/);
    assert.match(prompt, /Status:/);
    assert.match(prompt, /Next Action:/);
  }

  assert.match(prompts[2], /\*\*Validation\*\*/);
  assert.match(prompts[6], /single conventional-commit subject line/i);
  assert.match(prompts[6], /short user-facing summary list prefixed with `--`/i);
  assert.match(prompts[6], /do not include a branch line/i);
});

test("superpowers prompt describes analysis as advisory guidance, not a missing skill", async () => {
  const prompt = await readFile(".ai/prompts/superpowers.md", "utf8");

  assert.match(prompt, /Use this advisory layer to think through complex logic/);
  assert.match(prompt, /Do not load `think`, `analyze`, or `edge-cases` as filesystem skills/);
  assert.doesNotMatch(prompt, /Use skill: think, analyze, edge-cases/);
});

test("unblock workflow prompt includes runner-provided evidence", () => {
  const prompt = generateWorkflowPrompt({
    promptPath: ".ai/prompts/unblock-plan.md",
    planPath: ".ai/plans/workflow-runner.md",
    promptContent: "UNBLOCK PLAN PROMPT",
    unblockNote: "Checked /en/dashboard at 1440px. Expected visible dashboard. Actual visible dashboard.",
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

  const activeContextPacket = prompt.match(/Active Context Packet:[\s\S]*?Use the Active Context Packet and index-selected instruction files only\./)?.[0] ?? prompt;
  assert.match(prompt, /Active Context Packet:/);
  assert.match(prompt, /\.codex\/AGENTS\.md/);
  assert.match(prompt, /\.ai\/prompts\/review-changes\.md/);
  assert.match(prompt, /\.ai\/artifacts\/workflow-runner\/state\/context\.md/);
  assert.doesNotMatch(activeContextPacket, /\n- \.ai\/plans\/workflow-runner\.md/);
  assert.match(prompt, /\.ai\/instructions\/index\.md/);
  assert.match(prompt, /\.ai\/instructions\/shared\/workflow-state\.md/);
  assert.match(prompt, /\.ai\/specs\/dashboard-home\.spec\.md/);
  assert.match(prompt, /Open event artifacts only when the snapshot references them and specific evidence is needed/i);
  assert.match(prompt, /Do not broadly load `\.ai\/artifacts\/\*\*`/i);
  assert.match(prompt, /Use the Active Context Packet and index-selected instruction files only/i);
  assert.match(prompt, /Plan-scoped diff boundary:/);
});

test("execute workflow prompt adds stricter token guardrails after a prior token spike", () => {
  const prompt = generateWorkflowPrompt({
    promptPath: ".ai/prompts/execute-plan.md",
    planPath: ".ai/plans/workflow-runner.md",
    promptContent: "EXECUTE PLAN PROMPT",
    executeTokenGuardrail: {
      stageInputTokens: 2_100_000,
      stageUncachedInputTokens: 150_000,
    },
  });

  assert.match(prompt, /Execute token guardrail:/);
  assert.match(prompt, /The previous stage exceeded token thresholds/i);
  assert.match(prompt, /Use the snapshot as the default source/i);
  assert.match(prompt, /Open the full plan or event artifacts only when exact detail is required/i);
  assert.match(prompt, /Do not broadly load `\.ai\/artifacts\/\*\*` or full historical plan sections/i);
});

test("review workflow prompt does not add stricter execute token guardrails after a prior token spike", () => {
  const prompt = generateWorkflowPrompt({
    promptPath: ".ai/prompts/review-changes.md",
    planPath: ".ai/plans/workflow-runner.md",
    promptContent: "REVIEW CHANGES PROMPT",
    executeTokenGuardrail: {
      stageInputTokens: 2_100_000,
      stageUncachedInputTokens: 150_000,
    },
  });

  assert.doesNotMatch(prompt, /Execute token guardrail:/);
});

test("workflow prompt includes ai-workflow instructions for .ai-owned plan files", () => {
  const prompt = generateWorkflowPrompt({
    promptPath: ".ai/prompts/review-changes.md",
    planPath: ".ai/plans/workflow-runner.md",
    promptContent: "REVIEW CHANGES PROMPT",
    planContent: planWithFileScope(
      "review",
      "review-plan",
      { modified: [".ai/prompts/create-plan.md", ".ai/scripts/workflow-runner.ts"] },
      "## Spec\n\n* .ai/scripts/workflow-runner.spec.md\n",
    ),
    reviewStagingPaths: [".ai/prompts/create-plan.md", ".ai/scripts/workflow-runner.ts"],
  });

  const activeContextPacket =
    prompt.match(/Active Context Packet:[\s\S]*?Use the Active Context Packet and index-selected instruction files only\./)?.[0] ??
    prompt;

  assert.match(activeContextPacket, /\.ai\/instructions\/ai-workflow\.md/);
  assert.match(activeContextPacket, /\.ai\/scripts\/workflow-runner\.spec\.md/);
});

test("workflow context snapshot keeps current state and latest unresolved history only", () => {
  const snapshot = generateWorkflowContextSnapshot({
    planName: "workflow-runner",
    planPath: ".ai/plans/workflow-runner.md",
    planContent: `# Plan: workflow-runner

## Status

active

## Next Action

execute-plan

## Spec

.ai/scripts/workflow-runner.spec.md

## Files (MANDATORY)

### Created files

* None

### Modified files

* .ai/scripts/workflow-runner.ts
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
    latestTokenUsage: {
      iteration: 7,
      promptPath: ".ai/prompts/review-changes.md",
      model: "gpt-5.5",
      reasoning: "xhigh",
      stageInputTokens: 1234,
      stageUncachedInputTokens: 934,
      stageOutputTokens: 120,
      stageTotalTokens: 1354,
      totalTokens: 54321,
    },
  });

  assert.match(snapshot, /# Workflow Context Snapshot: workflow-runner/);
  assert.match(snapshot, /## Current State/);
  assert.match(snapshot, /\* Status: active/);
  assert.match(snapshot, /\* Next Action: execute-plan/);
  assert.match(snapshot, /\.ai\/scripts\/workflow-runner\.spec\.md/);
  assert.match(snapshot, /## Summary/);
  assert.match(snapshot, /## Key Details/);
  assert.match(snapshot, /## Validation/);
  assert.match(snapshot, /## Review/);
  assert.match(snapshot, /Snapshot generation is implemented/);
  assert.match(snapshot, /latest execution summary to keep/);
  assert.match(snapshot, /PASS/);
  assert.match(snapshot, /\.ai\/artifacts\/workflow-runner\/events\/review-v2\.md/);
  assert.match(snapshot, /## Latest Review Remediation Context/);
  assert.match(snapshot, /\* Source Review: Review v2/);
  assert.match(snapshot, /\* Summary: NEEDS FIX/);
  assert.match(snapshot, /\* Decision: active/);
  assert.match(snapshot, /\* Evidence: \.ai\/artifacts\/workflow-runner\/events\/review-v2\.md/);
  assert.match(snapshot, /active blocker to keep/);
  assert.match(snapshot, /Stage Input Tokens: 1234/);
  assert.match(snapshot, /Stage Uncached Input Tokens: 934/);
  assert.match(snapshot, /Stage Output Tokens: 120/);
  assert.doesNotMatch(snapshot, /old execution history that should be dropped/);
  assert.doesNotMatch(snapshot, /old validation history that should be dropped/);
  assert.doesNotMatch(snapshot, /old review history that should be dropped/);
  assert.doesNotMatch(snapshot, /Resolved: historical fix should not be repeated/);
  assert.doesNotMatch(snapshot, /## Threshold Warnings/);
});

test("workflow context snapshot emits no remediation context when not resuming execute after review", () => {
  const snapshot = generateWorkflowContextSnapshot({
    planName: "workflow-runner",
    planPath: ".ai/plans/workflow-runner.md",
    planContent: `# Plan: workflow-runner

## Status

review

## Next Action

review-plan

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

## Status

active

## Next Action

execute-plan

## Blockers

(empty)
`,
  });

  assert.match(snapshot, /## Active Blockers\s*\n\(none\)/);
  assert.doesNotMatch(snapshot, /\* ## Blockers/);
});

test("workflow prompts tell agents to use the snapshot first and avoid full historical plan loads", async () => {
  const executePrompt = await readFile(".ai/prompts/execute-plan.md", "utf8");
  const reviewPrompt = await readFile(".ai/prompts/review-changes.md", "utf8");
  const commitSummaryPrompt = await readFile(".ai/prompts/commit-summary.md", "utf8");

  for (const prompt of [executePrompt, reviewPrompt, commitSummaryPrompt]) {
    assert.match(prompt, /context snapshot/i);
    assert.match(prompt, /primary current-state source/i);
    assert.match(prompt, /read the full plan only/i);
    assert.match(prompt, /do not load full historical sections unless the snapshot is insufficient/i);
  }
});

test("scope cleanup prompt references the snapshot and paths instead of inlining full plan or spec content", () => {
  const prompt = generateScopeCleanupPrompt({
    promptContent: "SCOPE CLEANUP PROMPT",
    planPath: ".ai/plans/workflow-runner.md",
    contextSnapshotPath: ".ai/artifacts/workflow-runner/state/context.md",
    specPaths: [".ai/scripts/workflow-runner.spec.md"],
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
  assert.match(prompt, /Snapshot path: \.ai\/artifacts\/workflow-runner\/state\/context\.md/);
  assert.match(prompt, /Spec paths:/);
  assert.match(prompt, /\.ai\/scripts\/workflow-runner\.spec\.md/);
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
      { modified: [".ai/scripts/workflow-runner.ts"] },
      "## Spec\n\n* .ai/scripts/workflow-runner.spec.md\n",
    ),
  });

  const activeContextPacket =
    prompt.match(/Active Context Packet:[\s\S]*?Use the Active Context Packet and index-selected instruction files only\./)?.[0] ??
    prompt;

  assert.match(activeContextPacket, /\.ai\/scripts\/workflow-runner\.spec\.md/);
});

test("workflow prompt pins superpower skills to the installed global skill root", () => {
  const prompt = generateWorkflowPrompt({
    promptPath: ".ai/prompts/execute-plan.md",
    planPath: ".ai/plans/workflow-runner.md",
    promptContent: "EXECUTE PLAN PROMPT",
    planContent: planWith("active", "execute-plan"),
  });

  assert.match(prompt, /Superpower skill root:/);
  assert.match(prompt, /\/home\/jetermulo\/\.agents\/skills/);
  assert.match(prompt, /using-superpowers\/SKILL\.md/);
  assert.match(prompt, /executing-plans\/SKILL\.md/);
  assert.match(prompt, /subagent-driven-development\/SKILL\.md/);
  assert.match(prompt, /Do not read superpower skills from \/home\/jetermulo\/\.codex-shared\/skills/);
});

test("workflow prompt selects area instructions from plan-owned paths", () => {
  const prompt = generateWorkflowPrompt({
    promptPath: ".ai/prompts/execute-plan.md",
    planPath: ".ai/plans/workflow-runner.md",
    promptContent: "EXECUTE PLAN PROMPT",
    planContent: planWithFileScope("active", "execute-plan", {
      modified: [
        "apps/web/src/features/dashboard/page.tsx",
        "packages/supabase/src/client.ts",
        "apps/backend/test/chat/chat.service.spec.ts",
      ],
    }),
  });

  assert.match(prompt, /\.ai\/instructions\/web\.md/);
  assert.match(prompt, /\.ai\/instructions\/supabase\.md/);
  assert.match(prompt, /\.ai\/instructions\/shared\/testing\.md/);
  assert.match(prompt, /\.ai\/instructions\/architecture\.md/);
});

test("review workflow prompt includes plan-scoped staged diff commands for plan-owned paths", () => {
  const prompt = generateWorkflowPrompt({
    promptPath: ".ai/prompts/review-changes.md",
    planPath: ".ai/plans/workflow-runner.md",
    promptContent: "REVIEW CHANGES PROMPT",
    reviewStagingPaths: [".ai/scripts/workflow-runner.ts", ".ai/scripts/workflow-runner.test.ts"],
  });

  assert.match(prompt, /Plan-scoped diff boundary:/);
  assert.match(
    prompt,
    /git diff --staged --name-status -- \.ai\/scripts\/workflow-runner\.ts \.ai\/scripts\/workflow-runner\.test\.ts/,
  );
  assert.match(
    prompt,
    /git diff --staged -- \.ai\/scripts\/workflow-runner\.ts \.ai\/scripts\/workflow-runner\.test\.ts/,
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
  assert.match(prompt, /Use only these non-ignored plan-owned implementation paths:/);
  assert.match(prompt, /git status --short -- apps\/web\/src\/simple\.ts 'docs\/plan notes\.md'/);
  assert.match(prompt, /git diff --name-status -- apps\/web\/src\/simple\.ts 'docs\/plan notes\.md'/);
  assert.match(prompt, /git add --all -- apps\/web\/src\/simple\.ts 'docs\/plan notes\.md'/);
  assert.match(
    prompt,
    /git diff --staged --name-status -- apps\/web\/src\/simple\.ts 'docs\/plan notes\.md'/,
  );
  assert.match(
    prompt,
    /git commit -m "<generated message>" -- apps\/web\/src\/simple\.ts 'docs\/plan notes\.md'/,
  );
  assert.match(prompt, /Do not stage \.ai files/);
  assert.doesNotMatch(prompt, /use sub-agents/);
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
    /git diff --staged -- src\/simple\.ts 'docs\/plan notes\.md' 'src\/it'\\''s\.ts'/,
  );
  assert.match(
    prompt,
    /git diff --staged --name-status -- src\/simple\.ts 'docs\/plan notes\.md' 'src\/it'\\''s\.ts'/,
  );
});

test("non-review workflow prompts do not include review diff boundary instructions", () => {
  const prompt = generateWorkflowPrompt({
    promptPath: ".ai/prompts/execute-plan.md",
    planPath: ".ai/plans/workflow-runner.md",
    promptContent: "EXECUTE PLAN PROMPT",
    reviewStagingPaths: [".ai/scripts/workflow-runner.ts"],
  });

  assert.doesNotMatch(prompt, /Plan-scoped diff boundary:/);
  assert.doesNotMatch(prompt, /git diff --staged --/);
  assert.doesNotMatch(prompt, /Ignore staged files outside this path list/);
});

test(`startup validation fails before ${CODEX_EXEC_LABEL} for invalid plan inputs`, async () => {
  const workspace = await setupWorkspace();
  try {
    const processCalls: Parameters<ProcessRunner>[0][] = [];
    const processRunner: ProcessRunner = async (call) => {
      processCalls.push(call);
      return { launched: true, stdout: "", stderr: "", exitCode: 0 };
    };

    assert.equal(
      (
        await runWorkflowRunner({
          planName: "",
          rootDir: workspace.root,
          processRunner,
        })
      ).success,
      false,
    );
    assert.match(
      (
        await runWorkflowRunner({
          planName: planArg("missing"),
          rootDir: workspace.root,
          processRunner,
        })
      ).reason,
      /plan file does not exist/,
    );

    await writePlan(workspace.root, "missing-status", "## Next Action\n\nexecute-plan\n");
    await writePlan(workspace.root, "missing-action", "## Status\n\nactive\n");
    await writePlan(workspace.root, "empty-status", "## Status\n\n## Next Action\n\nexecute-plan\n");
    await writePlan(workspace.root, "empty-action", "## Status\n\nactive\n\n## Next Action\n");
    await writePlan(workspace.root, "unknown-status", planWith("unknown", "execute-plan"));
    await writePlan(workspace.root, "unknown-action", planWith("active", "unknown"));

    for (const planName of [
      "missing-status",
      "missing-action",
      "empty-status",
      "empty-action",
      "unknown-status",
      "unknown-action",
    ]) {
      const result = await runWorkflowRunner({
        planName: planArg(planName),
        rootDir: workspace.root,
        processRunner,
      });
      assert.equal(result.success, false, planName);
    }
    assert.equal(processCalls.length, 0);
  } finally {
    await workspace.cleanup();
  }
});

test("parsePlan requires the repo-relative .ai/plans markdown path", async () => {
  const workspace = await setupWorkspace();
  try {
    await writePlan(workspace.root, "workflow-runner", planWith("active", "execute-plan"));
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
      planWith("`draft`", "`plan-validator`").replace("thin-plan-v1", "`thin-plan-v1`"),
    );
    const parsed = await parsePlan({
      planName: planArg("workflow-runner"),
      rootDir: workspace.root,
    });

    assert.equal(parsed.ok, true);
    assert.equal(parsed.ok && parsed.status, "draft");
    assert.equal(parsed.ok && parsed.nextAction, "plan-validator");
  } finally {
    await workspace.cleanup();
  }
});

test("parsePlan requires thin-plan-v1 before a workflow plan is runnable", async () => {
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
    assert.match(parsed.ok ? "" : parsed.reason, /thin-plan-v1/);
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
      evidence: "rtk pnpm exec tsx --test-name-pattern thin-plan .ai/scripts/workflow-runner.test.ts",
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
    await writeWorkflowEventArtifact({
      root: workspace.root,
      planName: "thin-stubs",
      kind: "deployment-validation",
      version: 1,
    });
    await writePlan(
      workspace.root,
      "thin-stubs",
      planWith(
        "deployment-validation",
        "commit-summary",
        `## Validation History

### Validation v1

* Summary: Required tests passed.
* Result: APPROVED
* Evidence: .ai/artifacts/thin-stubs/events/validation-v1.md

## Review History

### Review v1

* Summary: Safe for deployment validation.
* Decision: deployment-validation
* Evidence: .ai/artifacts/thin-stubs/events/review-v1.md

## Deployment Validation

### Deployment Validation v1

* Summary: Manual production check remains pending.
* Status: pending
* Evidence: .ai/artifacts/thin-stubs/events/deployment-validation-v1.md
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
    assert.match(oversizedEntry.ok ? "" : oversizedEntry.reason, /entry exceeds 512 bytes/);

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

test("oversized aggregate thin-plan history warns without blocking the workflow", async () => {
  const workspace = await setupWorkspace();
  try {
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
        "completed",
        "commit-summary",
        `## Validation History

${aggregateEntries}
`,
      ),
    );
    const output = collectConsole();

    const result = await runWorkflowRunner({
      planName: planArg("oversized-thin-history"),
      rootDir: workspace.root,
      console: output.console,
      processRunner: runnerReturning({
        launched: true,
        stdout: turnCompletedUsageDetailLine({
          inputTokens: 100,
          cachedInputTokens: 50,
          outputTokens: 40,
          reasoningOutputTokens: 10,
        }),
        stderr: "",
        exitCode: 0,
      }),
    });

    assert.equal(result.success, true);
    assert.equal(
      output.lines.some((line) => /WARNING: Thin-plan workflow history is .* > 4 KB/i.test(line)),
      true,
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
    assert.match(parsed.ok ? "" : parsed.reason, /forbidden narrative section.*Review Required Fixes/);
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
    assert.match(missingArtifact.ok ? "" : missingArtifact.reason, /event artifact does not exist/);

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
    assert.match(mismatched.ok ? "" : mismatched.reason, /must be \.ai\/artifacts\/path-mismatch\/events\/review-v1\.md/);

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
    assert.match(oversized.ok ? "" : oversized.reason, /artifact summary exceeds 1 KB/);

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
    assert.match(oversizedEntry.ok ? "" : oversizedEntry.reason, /entry exceeds 512 bytes/);

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
    assert.match(oversizedArtifact.ok ? "" : oversizedArtifact.reason, /artifact exceeds 20 KB/);

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
    assert.match(tooManyIssues.ok ? "" : tooManyIssues.reason, /unsupported field.*Issues/);
  } finally {
    await workspace.cleanup();
  }
});

test("parsePlan accepts deployment-validation as a workflow status", async () => {
  const workspace = await setupWorkspace();
  try {
    await writePlan(workspace.root, "workflow-runner", planWith("deployment-validation", "unblock-plan"));
    const parsed = await parsePlan({
      planName: planArg("workflow-runner"),
      rootDir: workspace.root,
    });

    assert.equal(parsed.ok, true);
    assert.equal(parsed.ok && parsed.status, "deployment-validation");
    assert.equal(parsed.ok && parsed.nextAction, "unblock-plan");
  } finally {
    await workspace.cleanup();
  }
});

test(`plan argument validation rejects unsupported path forms before ${CODEX_EXEC_LABEL}`, async () => {
  const workspace = await setupWorkspace();
  try {
    const processCalls: Parameters<ProcessRunner>[0][] = [];
    for (const planName of [
      "workflow-runner",
      "workflow-runner.md",
      ".ai/plans/workflow-runner",
      ".ai/plans/workflow-runner.txt",
      "docs/workflow-runner.md",
      "../workflow-runner.md",
      "/tmp/workflow-runner.md",
    ]) {
      const result = await runWorkflowRunner({
        planName,
        rootDir: workspace.root,
        processRunner: async (call) => {
          processCalls.push(call);
          return { launched: true, stdout: "", stderr: "", exitCode: 0 };
        },
      });
      assert.equal(result.success, false, planName);
      assert.match(result.reason, /plan argument/, planName);
    }
    assert.equal(processCalls.length, 0);
  } finally {
    await workspace.cleanup();
  }
});

test("routes only spec-defined executable pairs and sends blocked plans through unblock", async () => {
  const workspace = await setupWorkspace();
  try {
    const cases = [
      ["draft-validator", "draft", "plan-validator", ".ai/prompts/plan-validator.md", "gpt-5.4", "high"],
      ["draft-fix", "draft", "fix-plan", ".ai/prompts/fix-plan.md", "gpt-5.4", "medium"],
      ["approved-execute", "approved", "execute-plan", ".ai/prompts/execute-plan.md", "gpt-5.5", "high"],
      ["active-execute", "active", "execute-plan", ".ai/prompts/execute-plan.md", "gpt-5.5", "high"],
      ["blocked-unblock", "blocked", "unblock-plan", ".ai/prompts/unblock-plan.md", "gpt-5.4", "medium"],
      ["blocked-legacy", "blocked", "execute-plan", ".ai/prompts/unblock-plan.md", "gpt-5.4", "medium"],
      [
        "deployment-validation-commit",
        "deployment-validation",
        "commit-summary",
        ".ai/prompts/commit-summary.md",
        "gpt-5.3-codex-spark",
        "medium",
      ],
      [
        "deployment-validation-unblock",
        "deployment-validation",
        "unblock-plan",
        ".ai/prompts/unblock-plan.md",
        "gpt-5.4",
        "medium",
      ],
      ["review-review", "review", "review-plan", ".ai/prompts/review-changes.md", "gpt-5.5", "xhigh"],
      ["reopen-reopen", "reopening", "reopen-plan", ".ai/prompts/reopen-plan.md", "gpt-5.4", "medium"],
      ["completed-commit", "completed", "commit-summary", ".ai/prompts/commit-summary.md", "gpt-5.3-codex-spark", "medium"],
    ] as const;
    const launchedPrompts: string[] = [];
    const launchedModels: string[] = [];
    const launchedReasoning: string[] = [];
    for (const [name, status, nextAction, promptPath, model, reasoning] of cases) {
      await writePlan(workspace.root, name, planWith(status, nextAction));
      const launchedBefore = launchedPrompts.length;
      const result = await runWorkflowRunner({
        planName: planArg(name),
        rootDir: workspace.root,
        processRunner: runnerReturning(
          { launched: true, stdout: "done", stderr: "", exitCode: 0 },
          (call) => {
            if (call.command === CODEX_COMMAND && call.promptPath !== ".ai/prompts/scope-cleanup.md") {
              launchedPrompts.push(call.promptPath);
              launchedModels.push(call.args[3] ?? "");
              launchedReasoning.push(call.args[5] ?? "");
            }
            if (promptPath === ".ai/prompts/unblock-plan.md") {
              const nextPlan =
                status === "deployment-validation"
                  ? planWith("deployment-validation", "unblock-plan", deploymentValidationSection(name))
                  : planWith("active", "execute-plan");
              if (status === "deployment-validation") {
                writeWorkflowEventArtifactSync({
                  root: workspace.root,
                  planName: name,
                  kind: "deployment-validation",
                  version: 1,
                });
              }
              writeFileSync(join(workspace.root, ".ai", "plans", `${name}.md`), nextPlan);
              return;
            }
            if (promptPath === ".ai/prompts/execute-plan.md") {
              writeFileSync(
                join(workspace.root, ".ai", "plans", `${name}.md`),
                planWith("blocked", "unblock-plan"),
              );
              return;
            }
            if (status === "deployment-validation" && promptPath === ".ai/prompts/commit-summary.md") {
              writeWorkflowEventArtifactSync({
                root: workspace.root,
                planName: name,
                kind: "deployment-validation",
                version: 1,
              });
              writeFileSync(
                join(workspace.root, ".ai", "plans", `${name}.md`),
                planWith("deployment-validation", "unblock-plan", deploymentValidationSection(name)),
              );
              return;
            }
            if (promptPath !== ".ai/prompts/commit-summary.md") {
              writeFileSync(
                join(workspace.root, ".ai", "plans", `${name}.md`),
                planWith("blocked", "unblock-plan"),
              );
            }
          },
        ),
      });
      assert.equal(launchedPrompts[launchedBefore], promptPath);
      assert.equal(launchedModels[launchedBefore], model);
      assert.equal(launchedReasoning[launchedBefore], `model_reasoning_effort="${reasoning}"`);
      assert.equal(typeof result.reason, "string");
    }

    await writePlan(workspace.root, "undefined", planWith("draft", "execute-plan"));
    const undefinedPair = await runWorkflowRunner({
      planName: planArg("undefined"),
      rootDir: workspace.root,
      processRunner: runnerReturning({ launched: true, stdout: "", stderr: "", exitCode: 0 }),
    });
    assert.equal(undefinedPair.success, false);
    assert.match(undefinedPair.reason, /undefined status\/next action pair/);

    await writePlan(workspace.root, "completed-reopen", planWith("completed", "reopen-plan"));
    const completedReopen = await runWorkflowRunner({
      planName: planArg("completed-reopen"),
      rootDir: workspace.root,
      processRunner: runnerReturning({ launched: true, stdout: "", stderr: "", exitCode: 0 }),
    });
    assert.equal(completedReopen.success, false);
    assert.match(completedReopen.reason, /undefined status\/next action pair/);
  } finally {
    await workspace.cleanup();
  }
});

test("deployment-validation commit-summary stops with deployment-validation outcome after recording commit metadata", async () => {
  const workspace = await setupWorkspace();
  try {
    await writePlan(workspace.root, "deploy-check", planWith("deployment-validation", "commit-summary"));
    const output = collectConsole();
    const calls: Parameters<ProcessRunner>[0][] = [];
    const result = await runWorkflowRunner({
      planName: planArg("deploy-check"),
      rootDir: workspace.root,
      console: output.console,
      processRunner: runnerReturning({ launched: true, stdout: "summary", stderr: "", exitCode: 0 }, (call) => {
        calls.push(call);
        writeWorkflowEventArtifactSync({
          root: workspace.root,
          planName: "deploy-check",
          kind: "deployment-validation",
          version: 1,
          evidence: "Commit: abc1234",
        });
        writeFileSync(
          join(workspace.root, ".ai", "plans", "deploy-check.md"),
          planWith("deployment-validation", "unblock-plan", deploymentValidationSection("deploy-check")),
        );
      }),
    });

    assert.equal(result.success, false);
    assert.match(result.reason, /deployment validation/);
    assert.deepEqual(
      calls.filter((call) => call.command === CODEX_COMMAND).map((call) => call.promptPath),
      [".ai/prompts/commit-summary.md"],
    );
    assert.match(output.lines.join("\n"), /DEPLOYMENT VALIDATION/);
    assert.doesNotMatch(output.lines.join("\n"), /abc1234/);
    const artifact = await readFile(
      join(workspace.root, ".ai", "artifacts", "deploy-check", "events", "deployment-validation-v1.md"),
      "utf8",
    );
    assert.match(artifact, /abc1234/);
  } finally {
    await workspace.cleanup();
  }
});

test("review safe path routes to completed commit-summary and succeeds after plan-owned paths are clean", async () => {
  const workspace = await setupWorkspace();
  try {
    await writePlan(
      workspace.root,
      "safe-review",
      planWithFileScope("review", "review-plan", {
        modified: ["src/file.ts"],
      }),
    );
    const calls: Parameters<ProcessRunner>[0][] = [];
    const result = await runWorkflowRunner({
      planName: planArg("safe-review"),
      rootDir: workspace.root,
      processRunner: async (call) => {
        calls.push(call);
        if (call.command === "git" && call.args[0] === "diff") {
          return {
            launched: true,
            stdout: [
              "diff --git a/src/file.ts b/src/file.ts",
              "index 1111111..2222222 100644",
              "--- a/src/file.ts",
              "+++ b/src/file.ts",
              "@@ -10,0 +11,2 @@",
              '+const unrelated = "remove";',
              "+const note = true;",
            ].join("\n"),
            stderr: "",
            exitCode: 0,
          };
        }
        if (call.command === "git") {
          return { launched: true, stdout: "", stderr: "", exitCode: 0 };
        }
        if (call.promptPath === ".ai/prompts/review-changes.md") {
          await writePlan(
            workspace.root,
            "safe-review",
            planWithFileScope("completed", "commit-summary", {
              modified: ["src/file.ts"],
            }),
          );
        }
        return { launched: true, stdout: "summary", stderr: "", exitCode: 0 };
      },
    });

    assert.equal(result.success, true);
    assert.deepEqual(
      calls.filter((call) => call.command === CODEX_COMMAND).map((call) => call.promptPath),
      [
        ".ai/prompts/scope-cleanup.md",
        ".ai/prompts/review-changes.md",
        ".ai/prompts/commit-summary.md",
      ],
    );
    assert.deepEqual(
      calls.filter((call) => call.command === "git").map((call) => call.args.slice(0, 4)),
      [
        ["diff", "--staged", "--name-status", "--"],
        ["add", "--all", "--", "src/file.ts"],
        ["diff", "--cached", "--unified=0", "--"],
        ["status", "--short", "--", "src/file.ts"],
      ],
    );
  } finally {
    await workspace.cleanup();
  }
});

test("completed commit-summary fails when plan-owned changes remain dirty after successful summary", async () => {
  const workspace = await setupWorkspace();
  try {
    await writePlan(
      workspace.root,
      "dirty-summary",
      planWithFileScope("completed", "commit-summary", {
        modified: ["src/file.ts"],
      }),
    );
    const calls: Parameters<ProcessRunner>[0][] = [];
    const result = await runWorkflowRunner({
      planName: planArg("dirty-summary"),
      rootDir: workspace.root,
      processRunner: async (call) => {
        calls.push(call);
        if (call.command === "git" && call.args[0] === "status") {
          return { launched: true, stdout: " M src/file.ts\n", stderr: "", exitCode: 0 };
        }
        return { launched: true, stdout: "summary", stderr: "", exitCode: 0 };
      },
    });

    assert.equal(result.success, false);
    assert.match(result.reason, /plan-owned changes remain after commit-summary/);
    assert.deepEqual(
      calls.filter((call) => call.command === CODEX_COMMAND).map((call) => call.promptPath),
      [".ai/prompts/commit-summary.md"],
    );
    assert.deepEqual(
      calls.filter((call) => call.command === "git").map((call) => call.args),
      [["status", "--short", "--", "src/file.ts"]],
    );
    const log = await readFile(join(workspace.root, ".ai", "artifacts", "dirty-summary", "logs", "runner.log"), "utf8");
    assertFailureMetadata(log, {
      kind: "dirty-plan-owned-paths",
      reason: /failureReason: plan-owned changes remain after commit-summary/,
      nextSuggestedAction: /nextSuggestedAction: inspect plan-owned changes, commit them, then rerun workflow-runner/,
    });
  } finally {
    await workspace.cleanup();
  }
});

test("workflow runner succeeds after review defers final browser validation to manual follow-up", async () => {
  const workspace = await setupWorkspace();
  try {
    const planContent = (
      status: string,
      nextAction: string,
      extra = "",
    ) =>
      planWithFileScope(
        status,
        nextAction,
        {
          modified: ["apps/web/src/browser-deferred.ts"],
        },
        extra,
      );
    await writePlan(workspace.root, "browser-deferred", planContent("active", "execute-plan"));

    const output = collectConsole();
    const calls: Parameters<ProcessRunner>[0][] = [];
    const result = await runWorkflowRunner({
      planName: planArg("browser-deferred"),
      rootDir: workspace.root,
      console: output.console,
      processRunner: runnerReturning({ launched: true, stdout: "ok", stderr: "", exitCode: 0 }, (call) => {
        calls.push(call);
        if (call.promptPath === ".ai/prompts/execute-plan.md") {
          writeWorkflowEventArtifactSync({
            root: workspace.root,
            planName: "browser-deferred",
            kind: "execution",
            version: 1,
          });
          writeFileSync(
            join(workspace.root, ".ai", "plans", "browser-deferred.md"),
            planContent(
              "review",
              "review-plan",
              `## Execution Log

### Execution v1

* Summary: Implementation and local validation complete.
* Result: completed
* Evidence: .ai/artifacts/browser-deferred/events/execution-v1.md
`,
            ),
          );
          return;
        }
        if (call.promptPath === ".ai/prompts/review-changes.md") {
          writeWorkflowEventArtifactSync({
            root: workspace.root,
            planName: "browser-deferred",
            kind: "review",
            version: 1,
          });
          writeFileSync(
            join(workspace.root, ".ai", "plans", "browser-deferred.md"),
            planContent(
              "completed",
              "commit-summary",
              `## Review History

### Review v1

* Summary: SAFE - DEFERRED VALIDATION
* Evidence: .ai/artifacts/browser-deferred/events/review-v1.md
* Decision: completed
`,
            ),
          );
          return;
        }
        if (call.promptPath === ".ai/prompts/commit-summary.md") {
          writeFileSync(
            join(workspace.root, ".ai", "plans", "browser-deferred.md"),
            planContent("completed", "commit-summary"),
          );
        }
      }),
    });

    assert.equal(result.success, true);
    assert.equal(result.reason, "completed + commit-summary finished");
    assert.deepEqual(
      calls.filter((call) => call.command === CODEX_COMMAND).map((call) => call.promptPath),
      [
        ".ai/prompts/execute-plan.md",
        ".ai/prompts/scope-cleanup.md",
        ".ai/prompts/review-changes.md",
        ".ai/prompts/commit-summary.md",
      ],
    );
    assert.deepEqual(
      calls.filter((call) => call.command === "git").map((call) => call.args[0]),
      ["diff", "add", "diff", "status"],
    );
    const consoleOutput = output.lines.join("\n");
    assert.match(consoleOutput, /SUCCESS/);
    assert.doesNotMatch(consoleOutput, /BLOCKED/);
    assert.doesNotMatch(consoleOutput, /DEPLOYMENT VALIDATION/);
  } finally {
    await workspace.cleanup();
  }
});

test("execute-plan blocked output is concise and includes the latest unresolved blocker detail", async () => {
  const workspace = await setupWorkspace();
  try {
    await writePlan(
      workspace.root,
      "blocked",
      planWith(
        "active",
        "execute-plan",
        `## Blockers

### Blocker 1

* Status: resolved
* Description: old resolved blocker
* Required Action: old action
* Next Step: old next step

### Blocker 2

* Type: source-of-truth conflict
* Status: unresolved
* Description: spec must be updated before plan can be fixed
* Required Action: update the workflow runner spec
* Next Step: rerun plan-validator after the spec changes
`,
      ),
    );

    const output = collectConsole();
    let launches = 0;
    const result = await runWorkflowRunner({
      planName: planArg("blocked"),
      rootDir: workspace.root,
      console: output.console,
      processRunner: async () => {
        launches += 1;
        await writePlan(
          workspace.root,
          "blocked",
          planWith(
            "blocked",
            "unblock-plan",
            `## Blockers

### Blocker 1

* Status: resolved
* Description: old resolved blocker
* Required Action: old action
* Next Step: old next step

### Blocker 2

* Type: source-of-truth conflict
* Status: unresolved
* Description: spec must be updated before plan can be fixed
* Required Action: update the workflow runner spec
* Next Step: rerun plan-validator after the spec changes
`,
          ),
        );
        return { launched: true, stdout: "", stderr: "", exitCode: 0 };
      },
    });

    assert.equal(result.success, false);
    assert.equal(launches, 1);
    assert.equal(result.reason, "plan blocked after execute-plan: spec must be updated before plan can be fixed");
    assert.deepEqual(output.lines.slice(-11), [
      "BLOCKED",
      "- Reason: BLOCKED",
      "-> spec must be updated before plan can be fixed",
      "-> Next: Run Codex CLI with this:",
      "`use unblock-plan.md`",
      "`evidence: ...`",
      "`.ai/plans/blocked.md`",
      "",
      "- Workflow log: .ai/artifacts/blocked/logs/runner.log",
      "- Token usage ledger: .ai/artifacts/blocked/logs/token-usage.jsonl",
      "- Worked for 0s",
    ]);
  } finally {
    await workspace.cleanup();
  }
});

test("execute-plan browser validation blockers use a short browser validation reason", async () => {
  const workspace = await setupWorkspace();
  try {
    await writePlan(workspace.root, "browser-blocked", planWith("active", "execute-plan"));

    const output = collectConsole();
    const result = await runWorkflowRunner({
      planName: planArg("browser-blocked"),
      rootDir: workspace.root,
      console: output.console,
      processRunner: async () => {
        await writePlan(
          workspace.root,
          "browser-blocked",
          planWith(
            "blocked",
            "unblock-plan",
            `## Blockers

### Blocker 1

* Type: browser validation
* Status: unresolved
* Description: Mandatory browser validation cannot be performed because no authenticated dashboard session is available.
* Required Action: Provide an authenticated browser session.
* Next Step: Rerun unblock-plan with manual validation evidence.
`,
          ),
        );
        return { launched: true, stdout: "", stderr: "", exitCode: 0 };
      },
    });

    assert.equal(result.success, false);
    assert.equal(
      result.reason,
      "plan blocked after execute-plan: Browser validation: no authenticated dashboard session is available",
    );
    assert.equal(output.lines.includes("BLOCKED"), true);
    assert.equal(
      output.lines.includes("- Reason: BROWSER VALIDATION"),
      true,
    );
    assert.equal(
      output.lines.includes("-> no authenticated dashboard session is available"),
      true,
    );
    assert.equal(
      output.lines.includes("-> Next: Run Codex CLI with this:"),
      true,
    );
    assert.equal(output.lines.includes("`use unblock-plan.md`"), true);
    assert.equal(output.lines.includes("`evidence: ...`"), true);
    assert.equal(
      output.lines.includes("`.ai/plans/browser-blocked.md`"),
      true,
    );
  } finally {
    await workspace.cleanup();
  }
});

test(`missing selected prompt files fail before ${CODEX_EXEC_LABEL}`, async () => {
  const workspace = await setupWorkspace();
  try {
    await rm(join(workspace.root, ".ai", "prompts", "execute-plan.md"));
    await writePlan(workspace.root, "workflow-runner", planWith("active", "execute-plan"));
    let launched = false;
    const result = await runWorkflowRunner({
      planName: planArg("workflow-runner"),
      rootDir: workspace.root,
      processRunner: async () => {
        launched = true;
        return { launched: true, stdout: "", stderr: "", exitCode: 0 };
      },
    });
    assert.equal(result.success, false);
    assert.equal(launched, false);
    assert.match(result.reason, /prompt file does not exist/);
  } finally {
    await workspace.cleanup();
  }
});

test(`${CODEX_EXEC_LABEL} prompt contains selected prompt content and exact plan path in fresh invocations`, async () => {
  const workspace = await setupWorkspace();
  try {
    await writePlan(workspace.root, "workflow-runner", planWith("active", "execute-plan"));
    const calls: Parameters<ProcessRunner>[0][] = [];
    const result = await runWorkflowRunner({
      planName: planArg("workflow-runner"),
      rootDir: workspace.root,
      processRunner: runnerReturning(
        { launched: true, stdout: "ok", stderr: "", exitCode: 0 },
        (call) => {
          calls.push(call);
          if (call.promptPath === ".ai/prompts/execute-plan.md") {
            writeFileSync(
              join(workspace.root, ".ai", "plans", "workflow-runner.md"),
              planWith("review", "review-plan"),
            );
          }
        },
      ),
    });
    assert.equal(result.success, false);
    assert.equal(calls.length, 7);
    assert.deepEqual(
      calls.map((call) => [call.command, call.args[0], call.promptPath]),
      [
        [CODEX_COMMAND, "exec", ".ai/prompts/execute-plan.md"],
        ["git", "diff", "git-pre-review-staged-check"],
        ["git", "add", "git-staging"],
        ["git", "diff", "git-scope-cleanup-diff"],
        [CODEX_COMMAND, "exec", ".ai/prompts/scope-cleanup.md"],
        [CODEX_COMMAND, "exec", ".ai/prompts/review-changes.md"],
        ["git", "restore", "git-review-unstage"],
      ],
    );
    assert.equal(calls[0].args.length, 7);
    assert.equal(calls[0].input, "");
    assert.match(calls[0].env?.CODEX_HOME ?? "", new RegExp(`${CODEX_HOME_SUFFIX.replace("/", "\\/")}$`));
    assert.match(calls[0].env?.PATH ?? "", /\/\.nvm\/versions\/node\/v20\.20\.2\/bin/);
    assert.match(calls[0].args[6], /^Use \.ai\/prompts\/execute-plan\.md/);
    assert.match(calls[0].args[6], /Execute:\n\.ai\/plans\/workflow-runner\.md/);
    assert.match(calls[0].args[6], /EXECUTE PLAN PROMPT/);
  } finally {
    await workspace.cleanup();
  }
});

test("reopen-plan prompts include selected prompt content and continue to execute-plan", async () => {
  const workspace = await setupWorkspace();
  try {
    await writePlan(workspace.root, "workflow-runner", planWith("reopening", "reopen-plan"));
    const calls: Parameters<ProcessRunner>[0][] = [];
    const result = await runWorkflowRunner({
      planName: planArg("workflow-runner"),
      rootDir: workspace.root,
      processRunner: runnerReturning(
        { launched: true, stdout: "ok", stderr: "", exitCode: 0 },
        (call) => {
          calls.push(call);
          if (call.promptPath === ".ai/prompts/reopen-plan.md") {
            writeFileSync(
              join(workspace.root, ".ai", "plans", "workflow-runner.md"),
              planWith("active", "execute-plan"),
            );
            return;
          }
          if (call.promptPath === ".ai/prompts/execute-plan.md") {
            writeFileSync(
              join(workspace.root, ".ai", "plans", "workflow-runner.md"),
              planWith("blocked", "unblock-plan"),
            );
          }
        },
      ),
    });
    assert.equal(result.success, false);
    assert.deepEqual(
      calls.map((call) => [call.command, call.args[0], call.promptPath]),
      [
        [CODEX_COMMAND, "exec", ".ai/prompts/reopen-plan.md"],
        [CODEX_COMMAND, "exec", ".ai/prompts/execute-plan.md"],
      ],
    );
    assert.equal(calls[0].args.length, 7);
    assert.equal(calls[0].input, "");
    assert.match(calls[0].args[6], /^Use \.ai\/prompts\/reopen-plan\.md/);
    assert.match(calls[0].args[6], /Reopen:\n\.ai\/plans\/workflow-runner\.md/);
    assert.match(calls[0].args[6], /REOPEN PLAN PROMPT/);
  } finally {
    await workspace.cleanup();
  }
});

test("codex execution config requires an explicit prompt mapping", () => {
  assert.deepEqual(codexExecutionConfig(".ai/prompts/commit-summary.md"), {
    model: "gpt-5.3-codex-spark",
    reasoning: "medium",
  });
  assert.throws(
    () => codexExecutionConfig(".ai/prompts/unknown.md"),
    /workflow runner codex config missing for prompt: \.ai\/prompts\/unknown\.md/,
  );
});

test(`${CODEX_EXEC_LABEL} uses prompt-tier model and reasoning policy`, async () => {
  const workspace = await setupWorkspace();
  try {
    await writePlan(workspace.root, "workflow-runner", planWith("review", "review-plan"));
    const calls: Parameters<ProcessRunner>[0][] = [];
    const result = await runWorkflowRunner({
      planName: planArg("workflow-runner"),
      rootDir: workspace.root,
      processRunner: runnerReturning(
        { launched: true, stdout: "ok", stderr: "", exitCode: 0 },
        (call) => {
          calls.push(call);
          if (call.command === CODEX_COMMAND && call.promptPath === ".ai/prompts/review-changes.md") {
            writeFileSync(
              join(workspace.root, ".ai", "plans", "workflow-runner.md"),
              planWith("completed", "commit-summary"),
            );
          }
        },
      ),
    });

    assert.equal(result.success, true);
    const codexCalls = calls.filter((call) => call.command === CODEX_COMMAND);
    assert.equal(codexCalls.length, 3);
    assert.deepEqual(codexCalls[0].args.slice(0, 6), [
      "exec",
      "--json",
      "--model",
      "gpt-5.5",
      "-c",
      'model_reasoning_effort="xhigh"',
    ]);
    assert.deepEqual(codexCalls[1].args.slice(0, 6), [
      "exec",
      "--json",
      "--model",
      "gpt-5.5",
      "-c",
      'model_reasoning_effort="xhigh"',
    ]);
    assert.deepEqual(codexCalls[2].args.slice(0, 6), [
      "exec",
      "--json",
      "--model",
      "gpt-5.3-codex-spark",
      "-c",
      'model_reasoning_effort="medium"',
    ]);
    assert.match(codexCalls[0].args[6], /^Use \.ai\/prompts\/scope-cleanup\.md/);
    assert.match(
      codexCalls[1].args[6],
      /git diff --staged -- \.ai\/scripts\/workflow-runner\.test\.ts \.ai\/scripts\/workflow-runner\.ts/,
    );
    assert.match(
      codexCalls[1].args[6],
      /git diff --staged --name-status -- \.ai\/scripts\/workflow-runner\.test\.ts \.ai\/scripts\/workflow-runner\.ts/,
    );
    assert.match(codexCalls[1].args[6], /^Use \.ai\/prompts\/review-changes\.md/);
    assert.equal(codexCalls[2].args.includes("--add-dir"), true);
    assert.equal(codexCalls[2].args.includes(join(workspace.root, ".git")), true);
    assert.match(codexCalls[2].args.at(-1) ?? "", /^Use \.ai\/prompts\/commit-summary\.md/);

    const log = await readFile(join(workspace.root, ".ai", "artifacts", "workflow-runner", "logs", "runner.log"), "utf8");
    assert.match(log, /model: gpt-5\.5/);
    assert.match(log, /model: gpt-5\.3-codex-spark/);
    assert.match(log, /reasoning: xhigh/);
    assert.match(log, /reasoning: medium/);
  } finally {
    await workspace.cleanup();
  }
});

test(`${CODEX_EXEC_LABEL} grants commit-summary explicit write access to .git`, async () => {
  const workspace = await setupWorkspace();
  try {
    await writePlan(workspace.root, "workflow-runner", planWith("review", "review-plan"));
    const calls: Parameters<ProcessRunner>[0][] = [];
    const result = await runWorkflowRunner({
      planName: planArg("workflow-runner"),
      rootDir: workspace.root,
      processRunner: runnerReturning(
        { launched: true, stdout: "ok", stderr: "", exitCode: 0 },
        (call) => {
          calls.push(call);
          if (call.command === CODEX_COMMAND && call.promptPath === ".ai/prompts/review-changes.md") {
            writeFileSync(
              join(workspace.root, ".ai", "plans", "workflow-runner.md"),
              planWith("completed", "commit-summary"),
            );
          }
        },
      ),
    });

    assert.equal(result.success, true);
    const commitSummaryCall = calls.find(
      (call) => call.command === CODEX_COMMAND && call.promptPath === ".ai/prompts/commit-summary.md",
    );
    assert.ok(commitSummaryCall);
    assert.equal(commitSummaryCall.args.includes("--add-dir"), true);
    assert.equal(commitSummaryCall.args.includes(join(workspace.root, ".git")), true);
  } finally {
    await workspace.cleanup();
  }
});

test("iteration logs include parsed context window usage from codex json output", async () => {
  const workspace = await setupWorkspace();
  try {
    await writePlan(workspace.root, "workflow-runner", planWith("completed", "commit-summary"));
    const result = await runWorkflowRunner({
      planName: planArg("workflow-runner"),
      rootDir: workspace.root,
      processRunner: runnerReturning({
        launched: true,
        stdout: tokenCountLine(129200, 258400),
        stderr: "",
        exitCode: 0,
      }),
    });

    assert.equal(result.success, true);
    const log = await readFile(join(workspace.root, ".ai", "artifacts", "workflow-runner", "logs", "runner.log"), "utf8");
    assert.match(log, /contextWindowTokens: 258400/);
    assert.match(log, /contextWindowUsedTokens: 129200/);
    assert.match(log, /contextWindowUsedPercent: 50\.00/);
  } finally {
    await workspace.cleanup();
  }
});

test("successful workflow stages append token usage ledger entries and report the ledger path", async () => {
  const workspace = await setupWorkspace();
  try {
    await writePlan(workspace.root, "workflow-runner", planWith("completed", "commit-summary"));
    const output = collectConsole();
    const result = await runWorkflowRunner({
      planName: planArg("workflow-runner"),
      rootDir: workspace.root,
      console: output.console,
      processRunner: runnerReturning({
        launched: true,
        stdout: turnCompletedUsageDetailLine({
          inputTokens: 1200,
          cachedInputTokens: 400,
          outputTokens: 90,
          reasoningOutputTokens: 30,
        }),
        stderr: "",
        exitCode: 0,
      }),
    });

    assert.equal(result.success, true);
    assert.equal(
      output.lines.includes("- Token usage ledger: .ai/artifacts/workflow-runner/logs/token-usage.jsonl"),
      true,
    );
    const ledger = await readTokenUsageLedger(workspace.root, "workflow-runner");
    assert.equal(ledger.length, 1);
    assert.deepEqual(ledger[0], {
      timestamp: ledger[0]?.timestamp,
      iteration: 1,
      planPath: ".ai/plans/workflow-runner.md",
      startingStatus: "completed",
      startingNextAction: "commit-summary",
      promptPath: ".ai/prompts/commit-summary.md",
      model: "gpt-5.3-codex-spark",
      reasoning: "medium",
      result: "success",
      signal: null,
      usageAvailable: true,
      stageInputTokens: 1200,
      stageCachedInputTokens: 400,
      stageUncachedInputTokens: 800,
      stageOutputTokens: 90,
      stageReasoningOutputTokens: 30,
      stageTotalTokens: 1290,
      contextWindowTokens: "unavailable",
      contextWindowUsedTokens: 1200,
      contextWindowUsedPercent: "unavailable",
      inputTokens: 1200,
      cachedInputTokens: 400,
      uncachedInputTokens: 800,
      outputTokens: 90,
      reasoningOutputTokens: 30,
      totalTokens: 1290,
    });
  } finally {
    await workspace.cleanup();
  }
});

test("token usage ledger analysis identifies the latest stage and prompt action", async () => {
  const workspace = await setupWorkspace();
  try {
    await writePlan(workspace.root, "workflow-runner", planWith("active", "execute-plan"));
    mkdirSync(join(workspace.root, ".ai", "artifacts", "workflow-runner", "logs"), { recursive: true });
    writeFileSync(
      join(workspace.root, ".ai", "artifacts", "workflow-runner", "logs", "token-usage.jsonl"),
      [
        JSON.stringify({
          iteration: 1,
          promptPath: ".ai/prompts/execute-plan.md",
          stageInputTokens: 90,
          stageUncachedInputTokens: 40,
          inputTokens: 90,
          totalTokens: 120,
        }),
        JSON.stringify({
          iteration: 2,
          promptPath: ".ai/prompts/review-changes.md",
          stageInputTokens: 2_100_000,
          stageUncachedInputTokens: 120_000,
          inputTokens: 2_100_090,
          totalTokens: 2_100_250,
        }),
      ].join("\n") + "\n",
      "utf8",
    );

    const analysis = await analyzeTokenUsageLedger(workspace.root, "workflow-runner");

    assert.deepEqual(analysis, {
      ledgerPath: ".ai/artifacts/workflow-runner/logs/token-usage.jsonl",
      latestStage: {
        iteration: 2,
        promptPath: ".ai/prompts/review-changes.md",
        promptAction: "review-changes",
        totalInputTokens: 2_100_000,
        uncachedInputTokens: 120_000,
      },
      cumulative: {
        inputTokens: 2_100_090,
        totalTokens: 2_100_250,
      },
    });
  } finally {
    await workspace.cleanup();
  }
});

test("workflow runner writes the context snapshot before launching a workflow prompt", async () => {
  const workspace = await setupWorkspace();
  try {
    await writePlan(workspace.root, "workflow-runner", planWith("completed", "commit-summary"));
    let sawSnapshot = false;
    const result = await runWorkflowRunner({
      planName: planArg("workflow-runner"),
      rootDir: workspace.root,
      processRunner: async (call) => {
        if (call.command === "git" && call.args[0] === "status") {
          return { launched: true, stdout: "", stderr: "", exitCode: 0 };
        }
        if (call.command === CODEX_COMMAND) {
          sawSnapshot = existsSync(join(workspace.root, workflowContextSnapshotRelativePath("workflow-runner")));
          const snapshot = await readFile(
            join(workspace.root, workflowContextSnapshotRelativePath("workflow-runner")),
            "utf8",
          );
          assert.match(snapshot, /## Current State/);
          assert.match(snapshot, /\* Status: completed/);
        }
        return {
          launched: true,
          stdout: turnCompletedUsageDetailLine({
            inputTokens: 100,
            cachedInputTokens: 50,
            outputTokens: 40,
            reasoningOutputTokens: 10,
          }),
          stderr: "",
          exitCode: 0,
        };
      },
    });

    assert.equal(result.success, true);
    assert.equal(sawSnapshot, true);
  } finally {
    await workspace.cleanup();
  }
});

test("high token stages log one short advisory warning while keeping token usage details", async () => {
  const workspace = await setupWorkspace();
  try {
    await writePlan(
      workspace.root,
      "workflow-runner",
      `${planWith("completed", "commit-summary")}\n${"x".repeat(110 * 1024)}`,
    );
    const output = collectConsole();
    const result = await runWorkflowRunner({
      planName: planArg("workflow-runner"),
      rootDir: workspace.root,
      console: output.console,
      processRunner: runnerReturning({
        launched: true,
        stdout: turnCompletedUsageDetailLine({
          inputTokens: 2_000_100,
          cachedInputTokens: 50,
          outputTokens: 90,
          reasoningOutputTokens: 30,
        }),
        stderr: "",
        exitCode: 0,
      }),
    });

    assert.equal(result.success, true);
    assert.equal(output.lines.some((line) => /WARNING: Plan file is/i.test(line)), true);
    const tokenWarnings = output.lines.filter((line) => /WARNING: Stage token usage is high/i.test(line));
    assert.equal(tokenWarnings.length, 1);
    assert.doesNotMatch(tokenWarnings[0], />/);
    assert.doesNotMatch(tokenWarnings[0], /100,000|2,000,000/);

    const snapshot = await readFile(
      join(workspace.root, workflowContextSnapshotRelativePath("workflow-runner")),
      "utf8",
    );
    assert.match(snapshot, /## Latest Token Usage Summary/);
    assert.match(snapshot, /Stage Input Tokens: 2000100/);
    assert.match(snapshot, /Stage Uncached Input Tokens: 2000050/);
    assert.match(snapshot, /Stage Output Tokens: 90/);
    assert.doesNotMatch(snapshot, /## Threshold Warnings/);

    const log = await readFile(
      join(workspace.root, ".ai", "artifacts", "workflow-runner", "logs", "runner.log"),
      "utf8",
    );
    assert.doesNotMatch(log, /thresholdWarnings:/);
  } finally {
    await workspace.cleanup();
  }
});

test("high-token prior stages add stricter guardrail guidance only to the next execute prompt", async () => {
  const workspace = await setupWorkspace();
  try {
    await writePlan(workspace.root, "workflow-runner", planWith("active", "execute-plan"));
    mkdirSync(join(workspace.root, ".ai", "artifacts", "workflow-runner", "logs"), { recursive: true });
    writeFileSync(
      join(workspace.root, ".ai", "artifacts", "workflow-runner", "logs", "token-usage.jsonl"),
      `${JSON.stringify({
        timestamp: "2026-06-29T00:00:00.000Z",
        iteration: 3,
        promptPath: ".ai/prompts/review-changes.md",
        stageInputTokens: 2_100_000,
        stageCachedInputTokens: 1_950_000,
        stageUncachedInputTokens: 150_000,
        stageOutputTokens: 800,
        stageTotalTokens: 2_100_800,
        totalTokens: 2_100_800,
      })}\n`,
      "utf8",
    );

    const calls: Parameters<ProcessRunner>[0][] = [];
    await runWorkflowRunner({
      planName: planArg("workflow-runner"),
      rootDir: workspace.root,
      processRunner: runnerReturning(
        { launched: true, stdout: "ok", stderr: "", exitCode: 0 },
        (call) => {
          calls.push(call);
          if (call.promptPath === ".ai/prompts/execute-plan.md") {
            writeFileSync(
              join(workspace.root, ".ai", "plans", "workflow-runner.md"),
              planWith("blocked", "unblock-plan"),
            );
          }
        },
      ),
    });

    const executeCall = calls.find((call) => call.promptPath === ".ai/prompts/execute-plan.md");
    assert.ok(executeCall);
    assert.match(executeCall.args[6], /Execute token guardrail:/);
    assert.match(executeCall.args[6], /previous stage exceeded token thresholds/i);
  } finally {
    await workspace.cleanup();
  }
});

test("high-token prior stages do not add stricter execute guardrail guidance to review prompts", async () => {
  const workspace = await setupWorkspace();
  try {
    await writePlan(workspace.root, "workflow-runner", planWith("review", "review-plan"));
    mkdirSync(join(workspace.root, ".ai", "artifacts", "workflow-runner", "logs"), { recursive: true });
    writeFileSync(
      join(workspace.root, ".ai", "artifacts", "workflow-runner", "logs", "token-usage.jsonl"),
      `${JSON.stringify({
        timestamp: "2026-06-29T00:00:00.000Z",
        iteration: 3,
        promptPath: ".ai/prompts/execute-plan.md",
        stageInputTokens: 2_100_000,
        stageCachedInputTokens: 1_950_000,
        stageUncachedInputTokens: 150_000,
        stageOutputTokens: 800,
        stageTotalTokens: 2_100_800,
        totalTokens: 2_100_800,
      })}\n`,
      "utf8",
    );

    const calls: Parameters<ProcessRunner>[0][] = [];
    await runWorkflowRunner({
      planName: planArg("workflow-runner"),
      rootDir: workspace.root,
      processRunner: runnerReturning(
        { launched: true, stdout: "ok", stderr: "", exitCode: 0 },
        (call) => {
          calls.push(call);
          if (call.promptPath === ".ai/prompts/review-changes.md") {
            writeFileSync(
              join(workspace.root, ".ai", "plans", "workflow-runner.md"),
              planWith("completed", "commit-summary"),
            );
          }
        },
      ),
    });

    const reviewCall = calls.find((call) => call.promptPath === ".ai/prompts/review-changes.md");
    assert.ok(reviewCall);
    assert.doesNotMatch(reviewCall.args[6], /Execute token guardrail:/);
  } finally {
    await workspace.cleanup();
  }
});

test("thin plans keep latest-stage token summaries without warning remediation text", async () => {
  const workspace = await setupWorkspace();
  try {
    await writePlan(workspace.root, "thin-token-spike", planWith("completed", "commit-summary"));
    mkdirSync(join(workspace.root, ".ai", "artifacts", "thin-token-spike", "logs"), { recursive: true });
    writeFileSync(
      join(workspace.root, ".ai", "artifacts", "thin-token-spike", "logs", "token-usage.jsonl"),
      `${JSON.stringify({
        timestamp: "2026-06-26T00:00:00.000Z",
        iteration: 9,
        promptPath: ".ai/prompts/execute-plan.md",
        stageInputTokens: 6_173_271,
        stageCachedInputTokens: 5_856_512,
        stageUncachedInputTokens: 316_759,
        stageOutputTokens: 10_000,
        stageTotalTokens: 6_183_271,
        totalTokens: 6_183_271,
      })}\n`,
      "utf8",
    );
    const output = collectConsole();

    const result = await runWorkflowRunner({
      planName: planArg("thin-token-spike"),
      rootDir: workspace.root,
      console: output.console,
      processRunner: runnerReturning({
        launched: true,
        stdout: turnCompletedUsageDetailLine({
          inputTokens: 100,
          cachedInputTokens: 20,
          outputTokens: 30,
          reasoningOutputTokens: 10,
        }),
        stderr: "",
        exitCode: 0,
      }),
    });

    assert.equal(result.success, true);
    const terminalOutput = output.lines.join("\n");
    assert.doesNotMatch(terminalOutput, /Latest stage total input tokens/i);
    assert.doesNotMatch(terminalOutput, /Latest stage uncached input tokens/i);
    assert.doesNotMatch(terminalOutput, /pathological/i);

    const snapshot = await readFile(
      join(workspace.root, workflowContextSnapshotRelativePath("thin-token-spike")),
      "utf8",
    );
    assert.match(snapshot, /## Latest Token Usage Summary/);
    assert.match(snapshot, /Stage Input Tokens: 100/);
    assert.match(snapshot, /Stage Uncached Input Tokens: 80/);
    assert.match(snapshot, /Stage Output Tokens: 30/);
    assert.doesNotMatch(snapshot, /## Threshold Warnings/);
  } finally {
    await workspace.cleanup();
  }
});

test("token usage ledger accumulates totals across multiple workflow stages", async () => {
  const workspace = await setupWorkspace();
  try {
    await writePlan(workspace.root, "workflow-runner", planWith("review", "review-plan"));
    const result = await runWorkflowRunner({
      planName: planArg("workflow-runner"),
      rootDir: workspace.root,
      processRunner: async (call) => {
        if (call.command === "git") {
          return { launched: true, stdout: "", stderr: "", exitCode: 0 };
        }
        if (call.command === CODEX_COMMAND && call.promptPath === ".ai/prompts/review-changes.md") {
          await writePlan(workspace.root, "workflow-runner", planWith("completed", "commit-summary"));
          return {
            launched: true,
            stdout: turnCompletedUsageDetailLine({
              inputTokens: 100,
              cachedInputTokens: 20,
              outputTokens: 30,
              reasoningOutputTokens: 10,
            }),
            stderr: "",
            exitCode: 0,
          };
        }
        if (call.command === CODEX_COMMAND && call.promptPath === ".ai/prompts/scope-cleanup.md") {
          return { launched: true, stdout: "", stderr: "", exitCode: 0 };
        }
        return {
          launched: true,
          stdout: turnCompletedUsageDetailLine({
            inputTokens: 200,
            cachedInputTokens: 50,
            outputTokens: 40,
            reasoningOutputTokens: 12,
          }),
          stderr: "",
          exitCode: 0,
        };
      },
    });

    assert.equal(result.success, true);
    const ledger = await readTokenUsageLedger(workspace.root, "workflow-runner");
    assert.equal(ledger.length, 2);
    assert.equal(ledger[0]?.endingStatus, "completed");
    assert.equal(ledger[0]?.endingNextAction, "commit-summary");
    assert.equal(ledger[0]?.inputTokens, 100);
    assert.equal(ledger[0]?.cachedInputTokens, 20);
    assert.equal(ledger[0]?.uncachedInputTokens, 80);
    assert.equal(ledger[0]?.outputTokens, 30);
    assert.equal(ledger[0]?.reasoningOutputTokens, 10);
    assert.equal(ledger[0]?.totalTokens, 130);
    assert.equal(ledger[1]?.inputTokens, 300);
    assert.equal(ledger[1]?.cachedInputTokens, 70);
    assert.equal(ledger[1]?.uncachedInputTokens, 230);
    assert.equal(ledger[1]?.outputTokens, 70);
    assert.equal(ledger[1]?.reasoningOutputTokens, 22);
    assert.equal(ledger[1]?.totalTokens, 370);
  } finally {
    await workspace.cleanup();
  }
});

test("workflow runner continues after a pathological nonterminal stage because token spikes are logging-only", async () => {
  const workspace = await setupWorkspace();
  try {
    await writePlan(workspace.root, "workflow-runner", planWith("active", "execute-plan"));
    const output = collectConsole();
    let codexCalls = 0;
    const result = await runWorkflowRunner({
      planName: planArg("workflow-runner"),
      rootDir: workspace.root,
      console: output.console,
      processRunner: async (call) => {
        if (call.command !== CODEX_COMMAND) {
          return { launched: true, stdout: "", stderr: "", exitCode: 0 };
        }
        codexCalls += 1;
        if (codexCalls === 1) {
          await writePlan(
            workspace.root,
            "workflow-runner",
            planWith("active", "execute-plan", "\n## Latest Execution Summary\n\n* Finished one chunk.\n"),
          );
          return {
            launched: true,
            stdout: turnCompletedUsageDetailLine({
              inputTokens: 2_100_000,
              cachedInputTokens: 1_950_000,
              outputTokens: 100,
              reasoningOutputTokens: 20,
            }),
            stderr: "",
            exitCode: 0,
          };
        }
        await writePlan(workspace.root, "workflow-runner", planWith("blocked", "unblock-plan"));
        return {
          launched: true,
          stdout: turnCompletedUsageDetailLine({
            inputTokens: 100,
            cachedInputTokens: 20,
            outputTokens: 30,
            reasoningOutputTokens: 10,
          }),
          stderr: "",
          exitCode: 0,
        };
      },
    });

    assert.equal(result.success, false);
    assert.equal(result.iterations, 2);
    assert.equal(codexCalls, 2);
    assert.match(result.reason, /plan blocked after execute-plan/i);
    const tokenWarnings = output.lines.filter((line) => /WARNING: Stage token usage is high/i.test(line));
    assert.equal(tokenWarnings.length, 1);
    assert.doesNotMatch(tokenWarnings[0], /100,000|2,000,000/);
    assert.equal(output.lines.some((line) => /fresh workflow runner invocation/i.test(line)), false);

    const ledger = await readTokenUsageLedger(workspace.root, "workflow-runner");
    assert.equal(ledger.length, 2);
    assert.equal(ledger[0]?.stageInputTokens, 2_100_000);
    assert.equal(ledger[1]?.stageInputTokens, 100);
  } finally {
    await workspace.cleanup();
  }
});
test("interrupted workflow stages append partial token usage without changing exact cumulative totals", async () => {
  const workspace = await setupWorkspace();
  try {
    await writePlan(workspace.root, "workflow-runner", planWith("active", "execute-plan"));
    const result = await runWorkflowRunner({
      planName: planArg("workflow-runner"),
      rootDir: workspace.root,
      processRunner: async () =>
        ({
          launched: true,
          stdout: tokenCountLine(450, 1000),
          stderr: "interrupted",
          exitCode: 130,
          exitSignal: "SIGINT",
        }) as Awaited<ReturnType<ProcessRunner>>,
    });

    assert.equal(result.success, false);
    assert.equal(result.exitCode, 130);
    const ledger = await readTokenUsageLedger(workspace.root, "workflow-runner");
    assert.equal(ledger.length, 1);
    assert.equal(ledger[0]?.result, "interrupted");
    assert.equal(ledger[0]?.signal, "SIGINT");
    assert.equal(ledger[0]?.usageAvailable, false);
    assert.equal(ledger[0]?.stageInputTokens, null);
    assert.equal(ledger[0]?.contextWindowTokens, 1000);
    assert.equal(ledger[0]?.contextWindowUsedTokens, 450);
    assert.equal(ledger[0]?.inputTokens, 0);
    assert.equal(ledger[0]?.totalTokens, 0);
  } finally {
    await workspace.cleanup();
  }
});

test(`${CODEX_COMMAND} stdout and stderr are streamed while still captured for logs`, async () => {
  const workspace = await setupWorkspace();
  try {
    await writePlan(workspace.root, "workflow-runner", planWith("completed", "commit-summary"));
    let streamedStdout = "";
    let streamedStderr = "";
    const result = await runWorkflowRunner({
      planName: planArg("workflow-runner"),
      rootDir: workspace.root,
      outputStream: {
        stdout: (chunk) => {
          streamedStdout += chunk;
        },
        stderr: (chunk) => {
          streamedStderr += chunk;
        },
      },
      processRunner: async (call) => {
        if (call.command === "git" && call.args[0] === "status") {
          return { launched: true, stdout: "", stderr: "", exitCode: 0 };
        }
        const rawStdout = `${codexCommandStartedLine("git status --short")}\n${codexCommandOutputLine(
          " M src/file.ts\n",
          "git status --short",
        )}\n`;
        call.onStdout?.(rawStdout);
        call.onStderr?.("live stderr\n");
        return {
          launched: true,
          stdout: rawStdout,
          stderr: "captured stderr",
          exitCode: 0,
        };
      },
    });

    assert.equal(result.success, true);
    assert.equal(
      streamedStdout,
      "Ran git status --short\n\n",
    );
    assert.equal(streamedStderr, "live stderr\n");
    const log = await readFile(join(workspace.root, ".ai", "artifacts", "workflow-runner", "logs", "runner.log"), "utf8");
    assert.match(log, /stdout: omitted \d+ bytes, \d+ lines/);
    assert.match(log, /stderr: omitted \d+ bytes, 1 lines/);
    assert.doesNotMatch(log, /\{"type":"item.started"/);
    assert.doesNotMatch(log, /captured stderr/);
    assert.equal(
      existsSync(join(workspace.root, ".ai", "artifacts", "workflow-runner", "logs", "failure.jsonl")),
      false,
    );
    assert.doesNotMatch(log, /failureDebugPath:/);
  } finally {
    await workspace.cleanup();
  }
});

test("workflow runner does not emit heartbeat lines while codex is streaming output", async () => {
  const workspace = await setupWorkspace();
  try {
    await writePlan(workspace.root, "heartbeat", planWith("active", "execute-plan"));
    const terminalEvents: string[] = [];
    const outputStream = {
      isTTY: true,
      stdout: (chunk: string) => {
        terminalEvents.push(`stdout:${chunk}`);
      },
      stderr: (chunk: string) => {
        terminalEvents.push(`stderr:${chunk}`);
      },
    };
    const hasHeartbeat = () =>
      terminalEvents.some((event) => event.toLowerCase().includes("working:"));

    await runWorkflowRunner({
      planName: planArg("heartbeat"),
      rootDir: workspace.root,
      now: () => 0,
      outputStream,
      processRunner: async (call) => {
        if (call.command === CODEX_COMMAND) {
          assert.equal(hasHeartbeat(), false);
          call.onStdout?.(codexAgentMessageLine("Executing plan"));
          await writePlan(
            workspace.root,
            "heartbeat",
            planWith("blocked", "unblock-plan", "\n## Blockers\n\n### Blocker 1\n\n* Description: waiting\n"),
          );
        }
        return { launched: true, stdout: codexAgentMessageLine("Executing plan"), stderr: "", exitCode: 0 };
      },
    });

    const agentOutputIndex = terminalEvents.findIndex((event) => event.includes("[agent]\nExecuting plan"));
    assert(agentOutputIndex >= 0);
    assert.equal(hasHeartbeat(), false);
  } finally {
    await workspace.cleanup();
  }
});

test("full .ai/plans path invocation writes to the normalized plan log", async () => {
  const workspace = await setupWorkspace();
  try {
    await writePlan(workspace.root, "workflow-runner", planWith("completed", "commit-summary"));
    const result = await runWorkflowRunner({
      argv: [".ai/plans/workflow-runner.md"],
      rootDir: workspace.root,
      processRunner: runnerReturning({ launched: true, stdout: "summary", stderr: "", exitCode: 0 }),
    });

    assert.equal(result.success, true);
    assert.equal(
      existsSync(join(workspace.root, ".ai", "artifacts", "workflow-runner", "logs", "runner.log")),
      true,
    );
    assert.equal(existsSync(join(workspace.root, ".ai", "artifacts", "workflow-runner", "logs", ".ai")), false);
  } finally {
    await workspace.cleanup();
  }
});

test(`commit-summary stops before ${CODEX_COMMAND} when all plan-owned paths are ignored`, async () => {
  const workspace = await setupWorkspace();
  try {
    await writePlan(workspace.root, "workflow-runner", planWith("completed", "commit-summary"));
    const calls: Parameters<ProcessRunner>[0][] = [];
    const result = await runWorkflowRunner({
      argv: [".ai/plans/workflow-runner.md"],
      rootDir: workspace.root,
      isIgnored: async (relativePath) => relativePath.startsWith(".ai/"),
      processRunner: async (call) => {
        calls.push(call);
        return { launched: true, stdout: "summary", stderr: "", exitCode: 0 };
      },
    });

    assert.equal(result.success, false);
    assert.match(result.reason, /commit summary file scope invalid: all commit summary paths are git-ignored/);
    assert.equal(calls.length, 0);
  } finally {
    await workspace.cleanup();
  }
});

test("workflow runner stops before execution when another live runner owns a plan file", async () => {
  const workspace = await setupWorkspace();
  try {
    await writePlan(
      workspace.root,
      "current-plan",
      planWithFileScope("active", "execute-plan", {
        modified: ["apps/web/src/shared.ts"],
      }),
    );
    await writeWorkflowFileLock(workspace.root, "apps/web/src/shared.ts", {
      planPath: ".ai/plans/other-plan.md",
      pid: process.pid,
      createdAt: "2026-06-04T00:00:00.000Z",
      path: "apps/web/src/shared.ts",
    });

    const calls: Parameters<ProcessRunner>[0][] = [];
    const result = await runWorkflowRunner({
      argv: [".ai/plans/current-plan.md"],
      rootDir: workspace.root,
      processRunner: async (call) => {
        calls.push(call);
        return { launched: true, stdout: "", stderr: "", exitCode: 0 };
      },
    });

    assert.equal(result.success, false);
    assert.match(result.reason, /workflow file ownership conflict/);
    assert.match(result.reason, /\.ai\/plans\/other-plan\.md/);
    assert.match(result.reason, /apps\/web\/src\/shared\.ts/);
    assert.equal(calls.length, 0);
  } finally {
    await workspace.cleanup();
  }
});

test("workflow runner excludes transferred file ownership releases from execution locks", async () => {
  const workspace = await setupWorkspace();
  try {
    const sharedPath = "apps/web/src/shared.ts";
    const remainingPath = "apps/web/src/remaining.ts";
    await writePlan(
      workspace.root,
      "current-plan",
      planWithFileScope(
        "active",
        "execute-plan",
        {
          modified: [sharedPath, remainingPath],
        },
        ownershipReleaseSection(sharedPath, ".ai/plans/dependent-plan.md"),
      ),
    );
    const dependentLockPath = await writeWorkflowFileLock(workspace.root, sharedPath, {
      planPath: ".ai/plans/dependent-plan.md",
      pid: process.pid,
      createdAt: "2026-06-04T00:00:00.000Z",
      path: sharedPath,
    });

    const calls: Parameters<ProcessRunner>[0][] = [];
    const result = await runWorkflowRunner({
      argv: [".ai/plans/current-plan.md"],
      rootDir: workspace.root,
      processRunner: runnerReturning(
        { launched: true, stdout: "", stderr: "", exitCode: 0 },
        (call) => {
          calls.push(call);
          writeFileSync(
            join(workspace.root, ".ai", "plans", "current-plan.md"),
            planWithFileScope(
              "blocked",
              "unblock-plan",
              {
                modified: [sharedPath, remainingPath],
              },
              ownershipReleaseSection(sharedPath, ".ai/plans/dependent-plan.md"),
            ),
          );
        },
      ),
    });

    assert.equal(result.success, false);
    assert.match(result.reason, /plan blocked after execute-plan/);
    assert.equal(calls.filter((call) => call.command === CODEX_COMMAND).length, 1);
    assert.equal(existsSync(dependentLockPath), true);
    assert.equal(existsSync(workflowFileLockPath(workspace.root, remainingPath)), false);
  } finally {
    await workspace.cleanup();
  }
});

test("workflow runner allows execution when live file locks do not overlap plan paths", async () => {
  const workspace = await setupWorkspace();
  try {
    await writePlan(
      workspace.root,
      "current-plan",
      planWithFileScope("active", "execute-plan", {
        modified: ["apps/web/src/current.ts"],
      }),
    );
    await writeWorkflowFileLock(workspace.root, "apps/web/src/other.ts", {
      planPath: ".ai/plans/other-plan.md",
      pid: process.pid,
      createdAt: "2026-06-04T00:00:00.000Z",
      path: "apps/web/src/other.ts",
    });

    const calls: Parameters<ProcessRunner>[0][] = [];
    const result = await runWorkflowRunner({
      argv: [".ai/plans/current-plan.md"],
      rootDir: workspace.root,
      processRunner: runnerReturning(
        { launched: true, stdout: "", stderr: "", exitCode: 0 },
        (call) => {
          calls.push(call);
          writeFileSync(
            join(workspace.root, ".ai", "plans", "current-plan.md"),
            planWithFileScope("blocked", "unblock-plan", {
              modified: ["apps/web/src/current.ts"],
            }),
          );
        },
      ),
    });

    assert.equal(result.success, false);
    assert.equal(calls.filter((call) => call.command === CODEX_COMMAND).length, 1);
  } finally {
    await workspace.cleanup();
  }
});

test("workflow runner removes stale file locks and continues execution", async () => {
  const workspace = await setupWorkspace();
  try {
    await writePlan(
      workspace.root,
      "current-plan",
      planWithFileScope("active", "execute-plan", {
        modified: ["apps/web/src/shared.ts"],
      }),
    );
    const staleLockPath = await writeWorkflowFileLock(workspace.root, "apps/web/src/shared.ts", {
      planPath: ".ai/plans/old-plan.md",
      pid: 2147483647,
      createdAt: "2026-06-04T00:00:00.000Z",
      path: "apps/web/src/shared.ts",
    });

    const calls: Parameters<ProcessRunner>[0][] = [];
    const result = await runWorkflowRunner({
      argv: [".ai/plans/current-plan.md"],
      rootDir: workspace.root,
      processRunner: runnerReturning(
        { launched: true, stdout: "", stderr: "", exitCode: 0 },
        (call) => {
          calls.push(call);
          writeFileSync(
            join(workspace.root, ".ai", "plans", "current-plan.md"),
            planWithFileScope("blocked", "unblock-plan", {
              modified: ["apps/web/src/shared.ts"],
            }),
          );
        },
      ),
    });

    assert.equal(result.success, false);
    assert.equal(calls.filter((call) => call.command === CODEX_COMMAND).length, 1);
    assert.equal(existsSync(staleLockPath), false);
  } finally {
    await workspace.cleanup();
  }
});

test("workflow runner stops before execution when an existing file lock is malformed", async () => {
  const workspace = await setupWorkspace();
  try {
    await writePlan(
      workspace.root,
      "current-plan",
      planWithFileScope("active", "execute-plan", {
        modified: ["apps/web/src/shared.ts"],
      }),
    );
    await writeWorkflowFileLock(workspace.root, "apps/web/src/shared.ts", "{not json");

    const calls: Parameters<ProcessRunner>[0][] = [];
    const result = await runWorkflowRunner({
      argv: [".ai/plans/current-plan.md"],
      rootDir: workspace.root,
      processRunner: async (call) => {
        calls.push(call);
        return { launched: true, stdout: "", stderr: "", exitCode: 0 };
      },
    });

    assert.equal(result.success, false);
    assert.match(result.reason, /workflow file lock is malformed/);
    assert.equal(calls.length, 0);
  } finally {
    await workspace.cleanup();
  }
});

test("workflow runner releases file ownership locks after failure and STOP outcomes", async () => {
  const workspace = await setupWorkspace();
  try {
    for (const [planName, processResult] of [
      [
        "failed-run",
        {
          launched: true as const,
          stdout: "",
          stderr: "",
          exitCode: 2,
        },
      ],
      [
        "stop-run",
        {
          launched: true as const,
          stdout: codexAgentMessageLine("STOP: validation incomplete"),
          stderr: "",
          exitCode: 0,
        },
      ],
    ] as const) {
      const ownedPath = `apps/web/src/${planName}.ts`;
      await writePlan(
        workspace.root,
        planName,
        planWithFileScope("active", "execute-plan", {
          modified: [ownedPath],
        }),
      );

      const result = await runWorkflowRunner({
        argv: [`.ai/plans/${planName}.md`],
        rootDir: workspace.root,
        processRunner: runnerReturning(processResult),
      });

      assert.equal(result.success, false);
      assert.equal(existsSync(workflowFileLockPath(workspace.root, ownedPath)), false);
    }
  } finally {
    await workspace.cleanup();
  }
});

test("workflow runner releases file ownership locks after success and blocked outcomes", async () => {
  const workspace = await setupWorkspace();
  try {
    await writePlan(
      workspace.root,
      "success-run",
      planWithFileScope("completed", "commit-summary", {
        modified: ["apps/web/src/success-run.ts"],
      }),
    );
    const successResult = await runWorkflowRunner({
      argv: [".ai/plans/success-run.md"],
      rootDir: workspace.root,
      processRunner: runnerReturning({ launched: true, stdout: "", stderr: "", exitCode: 0 }),
    });

    assert.equal(successResult.success, true);
    assert.equal(existsSync(workflowFileLockPath(workspace.root, "apps/web/src/success-run.ts")), false);

    await writePlan(
      workspace.root,
      "blocked-run",
      planWithFileScope("active", "execute-plan", {
        modified: ["apps/web/src/blocked-run.ts"],
      }),
    );
    const blockedResult = await runWorkflowRunner({
      argv: [".ai/plans/blocked-run.md"],
      rootDir: workspace.root,
      processRunner: runnerReturning(
        { launched: true, stdout: "", stderr: "", exitCode: 0 },
        () => {
          writeFileSync(
            join(workspace.root, ".ai", "plans", "blocked-run.md"),
            planWithFileScope("blocked", "unblock-plan", {
              modified: ["apps/web/src/blocked-run.ts"],
            }),
          );
        },
      ),
    });

    assert.equal(blockedResult.success, false);
    assert.match(blockedResult.reason, /plan blocked after execute-plan/);
    assert.equal(existsSync(workflowFileLockPath(workspace.root, "apps/web/src/blocked-run.ts")), false);
  } finally {
    await workspace.cleanup();
  }
});

test("compact CLI mode parses the plan argument and reports the workflow log path", async () => {
  const workspace = await setupWorkspace();
  try {
    await writePlan(workspace.root, "workflow-runner", planWith("completed", "commit-summary"));
    const { lines, console } = collectConsole();
    let streamedStdout = "";
    let streamedStderr = "";
    const result = await runWorkflowRunner({
      argv: ["--compact", ".ai/plans/workflow-runner.md"],
      rootDir: workspace.root,
      console,
      outputStream: {
        stdout: (chunk) => {
          streamedStdout += chunk;
        },
        stderr: (chunk) => {
          streamedStderr += chunk;
        },
      },
      processRunner: async (call) => {
        if (call.command === "git" && call.args[0] === "status") {
          return { launched: true, stdout: "", stderr: "", exitCode: 0 };
        }
        const rawStdout = `${codexCommandStartedLine("git status --short")}\n${codexCommandOutputLine(
          " M src/file.ts\n",
          "git status --short",
        )}\n`;
        call.onStdout?.(rawStdout);
        call.onStderr?.("live stderr\n");
        return {
          launched: true,
          stdout: rawStdout,
          stderr: "captured stderr",
          exitCode: 0,
        };
      },
    });

    assert.equal(result.success, true);
    assert.equal(streamedStdout, "");
    assert.equal(streamedStderr, "");
    assert.match(
      lines.join("\n"),
      /\[1\/100\] STAGE SUMMARY\ncompleted -> commit-summary\nmodel: gpt-5\.3-codex-spark \| reasoning: medium/,
    );
    assert.equal(lines.includes("SUCCESS"), true);
    assert.equal(lines.includes("- Workflow log: .ai/artifacts/workflow-runner/logs/runner.log"), true);

    const log = await readFile(
      join(workspace.root, ".ai", "artifacts", "workflow-runner", "logs", "runner.log"),
      "utf8",
    );
    assert.match(log, /stdout: omitted \d+ bytes, \d+ lines/);
    assert.match(log, /stderr: omitted \d+ bytes, 1 lines/);
    assert.doesNotMatch(log, /\{"type":"item.started"/);
    assert.doesNotMatch(log, /captured stderr/);
  } finally {
    await workspace.cleanup();
  }
});

test(`compact CLI validation failures stop before ${CODEX_EXEC_LABEL}`, async () => {
  const workspace = await setupWorkspace();
  try {
    const processCalls: Parameters<ProcessRunner>[0][] = [];
    const processRunner: ProcessRunner = async (call) => {
      processCalls.push(call);
      return { launched: true, stdout: "", stderr: "", exitCode: 0 };
    };

    const missingPlan = await runWorkflowRunner({
      argv: ["--compact"],
      rootDir: workspace.root,
      processRunner,
    });
    assert.equal(missingPlan.success, false);
    assert.match(missingPlan.reason, /plan name is required/);

    const invalidPath = await runWorkflowRunner({
      argv: ["--compact", "workflow-runner.md"],
      rootDir: workspace.root,
      processRunner,
    });
    assert.equal(invalidPath.success, false);
    assert.match(invalidPath.reason, /plan argument/);

    const misplacedCompact = await runWorkflowRunner({
      argv: [".ai/plans/workflow-runner.md", "--compact"],
      rootDir: workspace.root,
      processRunner,
    });
    assert.equal(misplacedCompact.success, false);
    assert.match(misplacedCompact.reason, /--compact must appear before the plan argument/);

    const missingUnblockNote = await runWorkflowRunner({
      argv: ["--compact", ".ai/plans/workflow-runner.md", "--unblock-note"],
      rootDir: workspace.root,
      processRunner,
    });
    assert.equal(missingUnblockNote.success, false);
    assert.match(missingUnblockNote.reason, /--unblock-note requires a value/);

    assert.equal(processCalls.length, 0);
  } finally {
    await workspace.cleanup();
  }
});

test("compact CLI failure output includes the stop reason and workflow log path", async () => {
  const workspace = await setupWorkspace();
  try {
    await writePlan(workspace.root, "workflow-runner", planWith("completed", "commit-summary"));
    const { lines, console } = collectConsole();
    const result = await runWorkflowRunner({
      argv: ["--compact", ".ai/plans/workflow-runner.md"],
      rootDir: workspace.root,
      console,
      processRunner: runnerReturning({
        launched: true,
        stdout: codexAgentMessageLine("STOP: spec must be updated before implementation"),
        stderr: "",
        exitCode: 0,
      }),
    });

    assert.equal(result.success, false);
    assert.match(result.reason, /STOP: spec must be updated before implementation/);
    assert.equal(
      lines.includes(`FAILED: ${CODEX_EXEC_LABEL} output contained STOP: spec must be updated before implementation`),
      true,
    );
    assert.equal(lines.includes("- Workflow log: .ai/artifacts/workflow-runner/logs/runner.log"), true);
  } finally {
    await workspace.cleanup();
  }
});

test(`${CODEX_COMMAND} launch failures, nonzero exits, STOP output, and empty captures stop without retry`, async () => {
  const workspace = await setupWorkspace();
  try {
    const cases = [
      {
        name: "launch-failure",
        processResult: { launched: false as const, stdout: "", stderr: "spawn ENOENT", error: "spawn ENOENT" },
        reason: new RegExp(`could not launch ${CODEX_EXEC_LABEL}`),
        failureKind: "codex-launch",
        failureReason: new RegExp(`failureReason: could not launch ${CODEX_EXEC_LABEL}: spawn ENOENT`),
        nextSuggestedAction: /nextSuggestedAction: fix Codex launch environment, then rerun workflow-runner/,
      },
      {
        name: "nonzero",
        processResult: { launched: true as const, stdout: "", stderr: "bad", exitCode: 2 },
        reason: new RegExp(`${CODEX_EXEC_LABEL} exited with code 2`),
        failureKind: "codex-exit",
        failureReason: new RegExp(`failureReason: ${CODEX_EXEC_LABEL} exited with code 2`),
        nextSuggestedAction: /nextSuggestedAction: inspect workflow log, fix runtime failure, then rerun workflow-runner/,
      },
      {
        name: "stdout-stop",
        processResult: { launched: true as const, stdout: "STOP", stderr: "", exitCode: 0 },
        reason: new RegExp(`${CODEX_EXEC_LABEL} output contained STOP`),
        failureKind: "codex-stop",
        failureReason: /failureReason: STOP/,
        nextSuggestedAction: /nextSuggestedAction: unblock-plan with evidence/,
      },
      {
        name: "json-inline-code-stop",
        processResult: { launched: true as const, stdout: codexAgentMessageLine("`STOP`"), stderr: "", exitCode: 0 },
        reason: new RegExp(`${CODEX_EXEC_LABEL} output contained STOP`),
        failureKind: "codex-stop",
        failureReason: /failureReason: STOP/,
        nextSuggestedAction: /nextSuggestedAction: unblock-plan with evidence/,
      },
      {
        name: "stderr-stop",
        processResult: { launched: true as const, stdout: "", stderr: "STOP", exitCode: 0 },
        reason: new RegExp(`${CODEX_EXEC_LABEL} output contained STOP`),
        failureKind: "codex-stop",
        failureReason: /failureReason: STOP/,
        nextSuggestedAction: /nextSuggestedAction: unblock-plan with evidence/,
      },
      {
        name: "empty-captures",
        processResult: { launched: true as const, stdout: "", stderr: "", exitCode: 0 },
        reason: /plan content unchanged/,
        failureKind: "unchanged-plan",
        failureReason: /failureReason: plan content unchanged after successful nonterminal workflow action/,
        nextSuggestedAction: /nextSuggestedAction: inspect workflow output and update plan state, then rerun workflow-runner/,
      },
    ];
    for (const item of cases) {
      await writePlan(workspace.root, item.name, planWith("active", "execute-plan"));
      let launches = 0;
      const result = await runWorkflowRunner({
        planName: planArg(item.name),
        rootDir: workspace.root,
        processRunner: runnerReturning(item.processResult, () => {
          launches += 1;
        }),
      });
      assert.equal(result.success, false, item.name);
      assert.match(result.reason, item.reason, item.name);
      assert.equal(launches, 1, item.name);
      const log = await readFile(join(workspace.root, ".ai", "artifacts", item.name, "logs", "runner.log"), "utf8");
      assert.match(log, /stdout:/);
      assert.match(log, /stderr:/);
      assertFailureMetadata(log, {
        kind: item.failureKind,
        reason: item.failureReason,
        nextSuggestedAction: item.nextSuggestedAction,
      });
      assert.match(
        log,
        new RegExp(
          String.raw`failureDebugPath: \.ai/artifacts/${item.name}/logs/failure\.jsonl#L1`,
        ),
      );
    }
  } finally {
    await workspace.cleanup();
  }
});

test("STOP failures write bounded debug sidecars while keeping the main log compact", async () => {
  const workspace = await setupWorkspace();
  try {
    await writePlan(workspace.root, "stop-sidecar", planWith("active", "execute-plan"));
    const stopMessage = [
      "STOP: spec is incomplete for market research fallback behavior and needs a user decision.",
      "Do not guess the shape.",
    ].join("\n");
    const result = await runWorkflowRunner({
      planName: planArg("stop-sidecar"),
      rootDir: workspace.root,
      processRunner: runnerReturning({
        launched: true,
        stdout: [
          codexCommandStartedLine('rtk rg -n "workflow-runner" .ai/scripts/workflow-runner.ts'),
          codexCommandOutputLine(
            [
              "101: const oldVerboseLog = true",
              "102: aggregated_output should never hit the main log",
              "103: STOP breadcrumbs belong in the failure sidecar only",
              "104: raw stderr blobs are too expensive",
              "105: extra line that should be truncated from excerpts",
            ].join("\n"),
            'rtk rg -n "workflow-runner" .ai/scripts/workflow-runner.ts',
          ),
          codexAgentMessageLine(stopMessage),
        ].join("\n"),
        stderr: "",
        exitCode: 0,
      }),
    });

    assert.equal(result.success, false);
    const log = await readFile(join(workspace.root, ".ai", "artifacts", "stop-sidecar", "logs", "runner.log"), "utf8");
    assert.match(log, /failureDebugPath: \.ai\/artifacts\/stop-sidecar\/logs\/failure\.jsonl#L1/);
    assert.doesNotMatch(log, /aggregated_output/);
    assert.doesNotMatch(log, /oldVerboseLog/);
    const debug = await readFailureDebugLedger(workspace.root, "stop-sidecar");
    assert.equal(debug.length, 1);
    assert.equal(debug[0]?.failureKind, "codex-stop");
    assert.match(String(debug[0]?.stopReason ?? ""), /spec is incomplete/);
    assert.match(String(debug[0]?.stopExcerpt ?? ""), /spec is incomplete/);
    assert.match(String(debug[0]?.lastAgentMessageExcerpt ?? ""), /Do not guess the shape/);
    assert.equal(Array.isArray(debug[0]?.recentCommands), true);
    const recentCommands = debug[0]?.recentCommands as Array<Record<string, unknown>>;
    assert.equal(recentCommands.length, 1);
    assert.match(String(recentCommands[0]?.command ?? ""), /rtk rg -n/);
    assert.match(String(recentCommands[0]?.outputExcerpt ?? ""), /oldVerboseLog/);
    assert.doesNotMatch(String(recentCommands[0]?.outputExcerpt ?? ""), /extra line that should be truncated/);
  } finally {
    await workspace.cleanup();
  }
});

test("nonzero exits write command summaries and bounded stderr excerpts to the failure sidecar", async () => {
  const workspace = await setupWorkspace();
  try {
    await writePlan(workspace.root, "exit-sidecar", planWith("active", "execute-plan"));
    const stderr = [
      "first failure line",
      "second failure line",
      "third failure line",
      "fourth failure line",
      "fifth failure line should be truncated",
    ].join("\n");
    const result = await runWorkflowRunner({
      planName: planArg("exit-sidecar"),
      rootDir: workspace.root,
      processRunner: runnerReturning({
        launched: true,
        stdout: [
          codexCommandStartedLine(JEST_FAILED_COMMAND),
          JSON.stringify({
            type: "item.completed",
            item: {
              id: "item_command",
              command: JEST_FAILED_COMMAND,
              type: "command_execution",
              aggregated_output: [
                "FAIL test/onboarding/document-content-generator.service.spec.ts",
                "  widens unmapped suffixless",
                "",
                "Expected: 2",
                "Received: 1",
                "extra line that should not survive the bounded excerpt",
              ].join("\n"),
              exit_code: 1,
              status: "completed",
            },
          }),
        ].join("\n"),
        stderr,
        exitCode: 2,
      }),
    });

    assert.equal(result.success, false);
    const debug = await readFailureDebugLedger(workspace.root, "exit-sidecar");
    assert.equal(debug.length, 1);
    assert.equal(debug[0]?.failureKind, "codex-exit");
    assert.match(String(debug[0]?.stderrExcerpt ?? ""), /first failure line/);
    assert.doesNotMatch(String(debug[0]?.stderrExcerpt ?? ""), /fifth failure line should be truncated/);
    const recentCommands = debug[0]?.recentCommands as Array<Record<string, unknown>>;
    assert.equal(recentCommands.length, 1);
    assert.match(String(recentCommands[0]?.command ?? ""), /jest/);
    assert.equal(recentCommands[0]?.exitCode, 1);
    assert.match(String(recentCommands[0]?.outputExcerpt ?? ""), /Expected: 2/);
    assert.doesNotMatch(
      String(recentCommands[0]?.outputExcerpt ?? ""),
      /extra line that should not survive the bounded excerpt/,
    );
  } finally {
    await workspace.cleanup();
  }
});

test("iteration handling rereads changed plans, rejects unchanged plans, enforces max iterations, and succeeds after commit-summary", async () => {
  const workspace = await setupWorkspace();
  try {
    await writePlan(workspace.root, "unchanged", planWith("draft", "fix-plan"));
    const unchanged = await runWorkflowRunner({
      planName: planArg("unchanged"),
      rootDir: workspace.root,
      processRunner: runnerReturning({ launched: true, stdout: "ok", stderr: "", exitCode: 0 }),
    });
    assert.equal(unchanged.success, false);
    assert.match(unchanged.reason, /plan content unchanged/);

    await writePlan(workspace.root, "terminal", planWith("review", "review-plan"));
    let terminalCodexLaunches = 0;
    const terminal = await runWorkflowRunner({
      planName: planArg("terminal"),
      rootDir: workspace.root,
      processRunner: runnerReturning(
        { launched: true, stdout: "ok", stderr: "", exitCode: 0 },
        (call) => {
          if (call.command === CODEX_COMMAND) {
            terminalCodexLaunches += 1;
            writeFileSync(
              join(workspace.root, ".ai", "plans", "terminal.md"),
              planWith("completed", "commit-summary"),
            );
          }
        },
      ),
    });
    assert.equal(terminal.success, true);
    assert.equal(terminalCodexLaunches, 3);

    await writePlan(workspace.root, "max", planWith("draft", "fix-plan"));
    let maxLaunches = 0;
    const maxed = await runWorkflowRunner({
      planName: planArg("max"),
      rootDir: workspace.root,
      processRunner: runnerReturning(
        { launched: true, stdout: "ok", stderr: "", exitCode: 0 },
        () => {
          maxLaunches += 1;
          writeFileSync(
            join(workspace.root, ".ai", "plans", "max.md"),
            `${planWith("draft", "fix-plan")}\n${maxLaunches}`,
          );
        },
      ),
    });
    assert.equal(maxed.success, false);
    assert.match(maxed.reason, /maximum iterations/);
    assert.equal(maxLaunches, 100);
    const maxLog = await readFile(join(workspace.root, ".ai", "artifacts", "max", "logs", "runner.log"), "utf8");
    assertFailureMetadata(maxLog, {
      kind: "max-iterations",
      reason: /failureReason: maximum iterations 100 reached/,
      nextSuggestedAction: /nextSuggestedAction: inspect plan progress, then resume with workflow-runner if still valid/,
    });
  } finally {
    await workspace.cleanup();
  }
});

test("transition guards enforce execute-plan and review-changes handoffs", async () => {
  const workspace = await setupWorkspace();
  try {
    const executeTransitions = [
      ["exec-review", "review", "review-plan", false],
      ["exec-blocked", "blocked", "execute-plan", false],
      ["exec-completed", "completed", "commit-summary", true],
      ["exec-other", "draft", "fix-plan", true],
    ] as const;
    for (const [name, status, nextAction, shouldFailTransition] of executeTransitions) {
      await writePlan(workspace.root, name, planWith("active", "execute-plan"));
      const result = await runWorkflowRunner({
        planName: planArg(name),
        rootDir: workspace.root,
        processRunner: runnerReturning(
          { launched: true, stdout: "ok", stderr: "", exitCode: 0 },
          () => {
            writeFileSync(join(workspace.root, ".ai", "plans", `${name}.md`), planWith(status, nextAction));
          },
        ),
      });
      if (shouldFailTransition) {
        assert.equal(result.success, false, name);
        assert.match(result.reason, /execute-plan may only hand off/);
        const log = await readFile(join(workspace.root, ".ai", "artifacts", name, "logs", "runner.log"), "utf8");
        assertFailureMetadata(log, {
          kind: "invalid-transition",
          reason: /failureReason: execute-plan may only hand off/,
          nextSuggestedAction: /nextSuggestedAction: fix plan status and next action, then rerun workflow-runner/,
        });
      }
    }

    const reopenTransitions = [
      ["reopen-active", "active", "execute-plan", false],
      ["reopen-review", "review", "review-plan", true],
      ["reopen-completed", "completed", "commit-summary", true],
    ] as const;
    for (const [name, status, nextAction, shouldFailTransition] of reopenTransitions) {
      await writePlan(workspace.root, name, planWith("reopening", "reopen-plan"));
      const result = await runWorkflowRunner({
        planName: planArg(name),
        rootDir: workspace.root,
        processRunner: runnerReturning(
          { launched: true, stdout: "ok", stderr: "", exitCode: 0 },
          () => {
            writeFileSync(join(workspace.root, ".ai", "plans", `${name}.md`), planWith(status, nextAction));
          },
        ),
      });
      if (shouldFailTransition) {
        assert.equal(result.success, false, name);
        assert.match(result.reason, /reopen-plan may only hand off/);
        const log = await readFile(join(workspace.root, ".ai", "artifacts", name, "logs", "runner.log"), "utf8");
        assertFailureMetadata(log, {
          kind: "invalid-transition",
          reason: /failureReason: reopen-plan may only hand off/,
          nextSuggestedAction: /nextSuggestedAction: fix plan status and next action, then rerun workflow-runner/,
        });
      }
    }

    const deploymentValidationTransitions = [
      ["deploy-still-pending", "deployment-validation", "unblock-plan", ["unblock"], false],
      ["deploy-passed", "completed", "commit-summary", ["unblock", "commit-summary"], false],
      ["deploy-failed", "reopening", "reopen-plan", ["unblock", "reopen", "execute"], false],
      ["deploy-active", "active", "execute-plan", ["unblock"], true],
    ] as const;
    for (const [name, status, nextAction, expectedStages, shouldFailTransition] of deploymentValidationTransitions) {
      writeWorkflowEventArtifactSync({
        root: workspace.root,
        planName: name,
        kind: "deployment-validation",
        version: 1,
      });
      await writePlan(
        workspace.root,
        name,
        planWith("deployment-validation", "unblock-plan", deploymentValidationSection(name)),
      );
      const launchedPrompts: string[] = [];
      const result = await runWorkflowRunner({
        planName: planArg(name),
        rootDir: workspace.root,
        processRunner: runnerReturning(
          { launched: true, stdout: "ok", stderr: "", exitCode: 0 },
          (call) => {
            if (call.command !== CODEX_COMMAND) {
              return;
            }
            launchedPrompts.push(call.promptPath);
            if (call.promptPath === ".ai/prompts/unblock-plan.md") {
              writeWorkflowEventArtifactSync({
                root: workspace.root,
                planName: name,
                kind: "deployment-validation",
                version: 1,
              });
              const deploymentValidationExtra =
                deploymentValidationSection(name, status === "completed" ? "passed" : "pending") +
                (status === "deployment-validation"
                  ? "\n## Unblock History\n\n### Unblock v1\n\n* Summary: deployment evidence recorded\n* Evidence: .ai/artifacts/" +
                    name +
                    "/events/unblock-v1.md\n* Decision: active\n"
                  : "");
              if (status === "deployment-validation") {
                writeWorkflowEventArtifactSync({
                  root: workspace.root,
                  planName: name,
                  kind: "unblock",
                  version: 1,
                });
              }
              writeFileSync(
                join(workspace.root, ".ai", "plans", `${name}.md`),
                planWith(status, nextAction, deploymentValidationExtra),
              );
              return;
            }
            if (call.promptPath === ".ai/prompts/reopen-plan.md") {
              writeFileSync(join(workspace.root, ".ai", "plans", `${name}.md`), planWith("active", "execute-plan"));
            }
            if (call.promptPath === ".ai/prompts/execute-plan.md") {
              writeFileSync(join(workspace.root, ".ai", "plans", `${name}.md`), planWith("blocked", "unblock-plan"));
            }
          },
        ),
      });

      assert.deepEqual(
        launchedPrompts.map((promptPath) =>
          promptPath === ".ai/prompts/unblock-plan.md"
            ? "unblock"
            : promptPath === ".ai/prompts/commit-summary.md"
              ? "commit-summary"
              : promptPath === ".ai/prompts/reopen-plan.md"
                ? "reopen"
                : "execute",
        ),
        expectedStages,
        name,
      );
      if (shouldFailTransition) {
        assert.equal(result.success, false, name);
        assert.match(result.reason, /deployment-validation unblock-plan may only hand off/, name);
        const log = await readFile(join(workspace.root, ".ai", "artifacts", name, "logs", "runner.log"), "utf8");
        assertFailureMetadata(log, {
          kind: "invalid-transition",
          reason: /failureReason: deployment-validation unblock-plan may only hand off/,
          nextSuggestedAction: /nextSuggestedAction: fix plan status and next action, then rerun workflow-runner/,
        });
      }
    }

    await writePlan(workspace.root, "review-completed", planWith("review", "review-plan"));
    const reviewCompleted = await runWorkflowRunner({
      planName: planArg("review-completed"),
      rootDir: workspace.root,
      processRunner: runnerReturning(
        { launched: true, stdout: "ok", stderr: "", exitCode: 0 },
        (call) => {
          if (call.command === CODEX_COMMAND) {
            writeFileSync(
              join(workspace.root, ".ai", "plans", "review-completed.md"),
              planWith("completed", "commit-summary"),
            );
          }
        },
      ),
    });
    assert.equal(reviewCompleted.success, true);

    await writePlan(workspace.root, "review-deployment-validation", planWith("review", "review-plan"));
    const reviewDeploymentValidation = await runWorkflowRunner({
      planName: planArg("review-deployment-validation"),
      rootDir: workspace.root,
      processRunner: runnerReturning(
        { launched: true, stdout: "ok", stderr: "", exitCode: 0 },
        (call) => {
          if (call.command === CODEX_COMMAND) {
            writeWorkflowEventArtifactSync({
              root: workspace.root,
              planName: "review-deployment-validation",
              kind: "deployment-validation",
              version: 1,
            });
            writeFileSync(
              join(workspace.root, ".ai", "plans", "review-deployment-validation.md"),
              planWith(
                "deployment-validation",
                "commit-summary",
                deploymentValidationSection("review-deployment-validation"),
              ),
            );
          }
        },
      ),
    });
    assert.equal(reviewDeploymentValidation.success, false);
    assert.match(reviewDeploymentValidation.reason, /review-changes may only hand off/);
  } finally {
    await workspace.cleanup();
  }
});

test("execute-plan may keep the plan active when implementation work remains", async () => {
  const workspace = await setupWorkspace();
  try {
    await writePlan(workspace.root, "active-follow-up", planWith("active", "execute-plan"));
    const launchedPrompts: string[] = [];
    const result = await runWorkflowRunner({
      planName: planArg("active-follow-up"),
      rootDir: workspace.root,
      processRunner: runnerReturning(
        { launched: true, stdout: "ok", stderr: "", exitCode: 0 },
        (call) => {
          if (call.command !== CODEX_COMMAND) {
            return;
          }
          launchedPrompts.push(call.promptPath);
          if (launchedPrompts.length === 1) {
            writeWorkflowEventArtifactSync({
              root: workspace.root,
              planName: "active-follow-up",
              kind: "execution",
              version: 1,
            });
          }
          const nextContent =
            launchedPrompts.length === 1
              ? planWith(
                  "active",
                  "execute-plan",
                  "\n## Execution Log\n\n### Execution v1\n\n* Summary: Follow-up implementation tasks remain.\n* Result: partial\n* Evidence: .ai/artifacts/active-follow-up/events/execution-v1.md\n",
                )
              : planWith("blocked", "unblock-plan", "\n## Blockers\n\n### Blocker 1\n\n* Description: validation environment unavailable\n");
          writeFileSync(join(workspace.root, ".ai", "plans", "active-follow-up.md"), nextContent);
        },
      ),
    });

    assert.equal(result.success, false);
    assert.equal(launchedPrompts.length, 2);
    assert.deepEqual(launchedPrompts, [".ai/prompts/execute-plan.md", ".ai/prompts/execute-plan.md"]);
    assert.match(result.reason, /plan blocked after execute-plan/);
  } finally {
    await workspace.cleanup();
  }
});

test("logs are append-only and include required iteration and review staging fields", async () => {
  const workspace = await setupWorkspace();
  try {
    await writePlan(workspace.root, "workflow-runner", planWith("review", "review-plan"));
    mkdirSync(join(workspace.root, ".ai", "artifacts", "workflow-runner", "logs"), { recursive: true });
    writeFileSync(join(workspace.root, ".ai", "artifacts", "workflow-runner", "logs", "runner.log"), "existing\n");
    await runWorkflowRunner({
      planName: planArg("workflow-runner"),
      rootDir: workspace.root,
      processRunner: runnerReturning(
        { launched: true, stdout: "ok", stderr: "", exitCode: 0 },
        (call) => {
          if (call.command === CODEX_COMMAND) {
            writeFileSync(
              join(workspace.root, ".ai", "plans", "workflow-runner.md"),
              planWith("completed", "commit-summary"),
            );
          }
        },
      ),
    });
    const log = await readFile(join(workspace.root, ".ai", "artifacts", "workflow-runner", "logs", "runner.log"), "utf8");
    assert.match(log, /^existing/);
    assert.match(log, /timestamp:/);
    assert.match(log, /iteration: 1/);
    assert.match(log, /planPath: .ai\/plans\/workflow-runner.md/);
    assert.match(log, /startingStatus: review/);
    assert.match(log, /startingNextAction: review-plan/);
    assert.match(log, /promptPath: .ai\/prompts\/review-changes.md/);
    assert.match(log, /result: launched/);
    assert.match(log, /exitCode: 0/);
    assert.match(log, /durationMs: \d+/);
    assert.match(log, /stdout: omitted 2 bytes, 1 lines/);
    assert.doesNotMatch(log, /stdout: ok/);
    assert.match(log, /stderr:/);
    assert.match(log, /reviewStagingCommand: git add --all --/);
    assert.match(log, /reviewStagingExitCode: 0/);
    assert.match(log, /reviewStagingStdout:/);
    assert.match(log, /reviewStagingStderr:/);
    assert.match(log, /contextWindowTokens: unavailable/);
    assert.match(log, /contextWindowUsedTokens: unavailable/);
    assert.match(log, /contextWindowUsedPercent: unavailable/);
  } finally {
    await workspace.cleanup();
  }
});

test("workflow runner logs edited file summaries and colorizes live diff counts", async () => {
  const workspace = await setupWorkspace();
  const originalForceColor = process.env.FORCE_COLOR;
  const originalNoColor = process.env.NO_COLOR;
  try {
    process.env.FORCE_COLOR = "1";
    delete process.env.NO_COLOR;
    mkdirSync(join(workspace.root, "src"), { recursive: true });
    writeFileSync(join(workspace.root, "src", "file.ts"), "one\n");
    await writePlan(
      workspace.root,
      "edited-summary",
      planWithFileScope("completed", "commit-summary", { modified: ["src/file.ts"] }),
    );
    const output = collectConsole();
    const result = await runWorkflowRunner({
      planName: planArg("edited-summary"),
      rootDir: workspace.root,
      console: output.console,
      processRunner: runnerReturning({ launched: true, stdout: "summary", stderr: "", exitCode: 0 }, (call) => {
        if (call.command === CODEX_COMMAND) {
          writeFileSync(join(workspace.root, "src", "file.ts"), "one\ntwo\n");
        }
      }),
    });

    assert.equal(result.success, true);
    assert.match(
      output.lines.join("\n"),
      /\* \u001b\[34mEdited\u001b\[0m src\/file\.ts \(\u001b\[32m\+1\u001b\[0m \u001b\[31m-0\u001b\[0m\)/,
    );
    const log = await readFile(join(workspace.root, ".ai", "artifacts", "edited-summary", "logs", "runner.log"), "utf8");
    assert.match(log, /editedFiles: Edited src\/file\.ts \(\+1 -0\)/);
  } finally {
    if (originalForceColor === undefined) {
      delete process.env.FORCE_COLOR;
    } else {
      process.env.FORCE_COLOR = originalForceColor;
    }
    if (originalNoColor === undefined) {
      delete process.env.NO_COLOR;
    } else {
      process.env.NO_COLOR = originalNoColor;
    }
    await workspace.cleanup();
  }
});

test("workflow runner prints edited file summaries before the completed turn marker", async () => {
  const workspace = await setupWorkspace();
  const originalForceColor = process.env.FORCE_COLOR;
  const originalNoColor = process.env.NO_COLOR;
  try {
    process.env.FORCE_COLOR = "0";
    delete process.env.NO_COLOR;
    mkdirSync(join(workspace.root, "src"), { recursive: true });
    writeFileSync(join(workspace.root, "src", "file.ts"), "one\n");
    await writePlan(
      workspace.root,
      "edited-summary-spacing",
      planWithFileScope("completed", "commit-summary", { modified: ["src/file.ts"] }),
    );
    let output = "";
    const result = await runWorkflowRunner({
      planName: planArg("edited-summary-spacing"),
      rootDir: workspace.root,
      console: {
        log: (message) => {
          output += `${message}\n`;
        },
        error: (message) => {
          output += `${message}\n`;
        },
      },
      outputStream: {
        stdout: (chunk) => {
          output += chunk;
        },
        stderr: (chunk) => {
          output += chunk;
        },
      },
      processRunner: runnerReturning(
        {
          launched: true,
          stdout: `${codexAgentMessageLine("Done")}\n${JSON.stringify({ type: "turn.completed" })}\n`,
          stderr: "",
          exitCode: 0,
        },
        (call) => {
          if (call.command === CODEX_COMMAND) {
            writeFileSync(join(workspace.root, "src", "file.ts"), "one\ntwo\n");
            call.onStdout?.(
              `${codexAgentMessageLine("Done")}\n${JSON.stringify({ type: "turn.completed" })}\n`,
            );
          }
        },
      ),
    });

    assert.equal(result.success, true);
    assert.match(
      output,
      /\[agent\]\nDone\n\n\* Edited src\/file\.ts \(\+1 -0\)\n\[codex\] turn completed\n\nSUCCESS/,
    );
  } finally {
    if (originalForceColor === undefined) {
      delete process.env.FORCE_COLOR;
    } else {
      process.env.FORCE_COLOR = originalForceColor;
    }
    if (originalNoColor === undefined) {
      delete process.env.NO_COLOR;
    } else {
      process.env.NO_COLOR = originalNoColor;
    }
    await workspace.cleanup();
  }
});

test("review staging parses and filters concrete non-ignored files and rejects unsafe paths", async () => {
  const workspace = await setupWorkspace();
  try {
    mkdirSync(join(workspace.root, "src"), { recursive: true });
    writeFileSync(join(workspace.root, "src", "file.ts"), "");
    mkdirSync(join(workspace.root, "src", "dir"), { recursive: true });
    const plan = `## Files (MANDATORY)

### Created files

* src/file.ts (assumed)
* ignored.log

### Modified files

* None

### Deleted files

* deleted.ts
`;
    const parsed = await parseReviewStagingPaths({
      content: plan,
      rootDir: workspace.root,
      isIgnored: async (path) => path === "ignored.log",
    });
    assert.deepEqual(parsed.ok && parsed.paths, ["src/file.ts", "deleted.ts"]);

    for (const [name, bullet] of [
      ["empty", "* "],
      ["absolute", "* /tmp/file.ts"],
      ["parent", "* ../file.ts"],
      ["directory", "* src/dir"],
    ] as const) {
      const unsafe = await parseReviewStagingPaths({
        content: planWith("review", "review-plan", `### Created files\n\n${bullet}\n`),
        rootDir: workspace.root,
        isIgnored: async () => false,
      });
      assert.equal(unsafe.ok, false, name);
    }

    const ignoredOnly = await parseReviewStagingPaths({
      content: planWith("review", "review-plan", "### Created files\n\n* ignored.log\n"),
      rootDir: workspace.root,
      isIgnored: async () => true,
    });
    assert.equal(ignoredOnly.ok, false);
    assert.match(ignoredOnly.ok ? "" : ignoredOnly.reason, /all review staging paths are git-ignored/);
  } finally {
    await workspace.cleanup();
  }
});

test("review staging excludes transferred file ownership releases", async () => {
  const parsed = await parseReviewStagingPaths({
    content: planWithFileScope(
      "review",
      "review-plan",
      {
        modified: ["src/shared.ts", "src/owned.ts"],
      },
      ownershipReleaseSection("src/shared.ts", ".ai/plans/dependent-plan.md"),
    ),
    isIgnored: async () => false,
  });

  assert.deepEqual(parsed.ok && parsed.paths, ["src/owned.ts"]);
});

test("review staging rejects unsafe transferred file ownership release paths", async () => {
  const workspace = await setupWorkspace();
  try {
    mkdirSync(join(workspace.root, "src", "dir"), { recursive: true });
    for (const [name, releasePath, reason] of [
      ["empty", "", /file ownership release path is empty/],
      ["absolute", "/tmp/shared.ts", /file ownership release path is absolute/],
      ["parent", "../shared.ts", /file ownership release path contains \.\./],
      ["directory", "src/dir", /file ownership release path is an existing directory/],
    ] as const) {
      const parsed = await parseReviewStagingPaths({
        content: planWithFileScope(
          "review",
          "review-plan",
          {
            modified: ["src/owned.ts"],
          },
          ownershipReleaseSection(releasePath, ".ai/plans/dependent-plan.md"),
        ),
        rootDir: workspace.root,
        isIgnored: async () => false,
      });
      assert.equal(parsed.ok, false, name);
      assert.match(parsed.ok ? "" : parsed.reason, reason);
    }
  } finally {
    await workspace.cleanup();
  }
});

test("commit-summary excludes transferred file ownership releases from commit boundary", async () => {
  const workspace = await setupWorkspace();
  try {
    await writePlan(
      workspace.root,
      "current-plan",
      planWithFileScope(
        "completed",
        "commit-summary",
        {
          modified: ["src/shared.ts", "src/owned.ts"],
        },
        ownershipReleaseSection("src/shared.ts", ".ai/plans/dependent-plan.md"),
      ),
    );
    const calls: Parameters<ProcessRunner>[0][] = [];
    const result = await runWorkflowRunner({
      argv: [".ai/plans/current-plan.md"],
      rootDir: workspace.root,
      processRunner: runnerReturning({ launched: true, stdout: "summary", stderr: "", exitCode: 0 }, (call) => {
        calls.push(call);
      }),
    });

    assert.equal(result.success, true);
    const codexCall = calls.find((call) => call.command === CODEX_COMMAND);
    assert.ok(codexCall);
    const prompt = codexCall.args.at(-1) ?? "";
    assert.match(prompt, /- src\/owned\.ts/);
    assert.doesNotMatch(prompt, /- src\/shared\.ts/);
    assert.match(prompt, /git add --all -- src\/owned\.ts/);
    assert.doesNotMatch(prompt, /git add --all -- src\/shared\.ts/);
  } finally {
    await workspace.cleanup();
  }
});

test("review staging ignores Files section rule bullets after concrete file lists", async () => {
  const parsed = await parseReviewStagingPaths({
    content: `## Files (MANDATORY)

### Created files

* src/created.ts

### Modified files

* src/modified.ts

### Deleted files

* None

Rules:

* MUST use concrete file paths
* MUST NOT use vague terms like "service layer" or "module"
`,
    isIgnored: async () => false,
  });

  assert.deepEqual(parsed.ok && parsed.paths, ["src/created.ts", "src/modified.ts"]);
});

test("review staging ignores common no-file placeholders", async () => {
  const parsed = await parseReviewStagingPaths({
    content: `## Files (MANDATORY)

### Created files

* src/created.ts

### Modified files

* none
- None
* (none)
- (None)
* N/A
- (n/a)
* no files
- (no files)

### Deleted files

* deleted.ts
`,
    isIgnored: async () => false,
  });

  assert.deepEqual(parsed.ok && parsed.paths, ["src/created.ts", "deleted.ts"]);
});

test("review staging rejects annotated file bullets that are not exact paths", async () => {
  const parsed = await parseReviewStagingPaths({
    content: `## Files (MANDATORY)

### Created files

* src/file.ts (inspect only if needed)

### Modified files

* src/other.ts (only if coverage changes)

### Deleted files

* None
`,
    isIgnored: async () => false,
  });

  assert.equal(parsed.ok, false);
  assert.match(
    parsed.ok ? "" : parsed.reason,
    /review staging path contains annotation; Files \(MANDATORY\) entries must be exact file paths/,
  );
});

test(`review staging git add runs before review ${CODEX_COMMAND}, unstages plan-owned files, and stops on staging failure`, async () => {
  const workspace = await setupWorkspace();
  try {
    await writePlan(workspace.root, "workflow-runner", planWith("review", "review-plan"));
    const calls: Parameters<ProcessRunner>[0][] = [];
    const output = collectConsole();
    const failed = await runWorkflowRunner({
      planName: planArg("workflow-runner"),
      rootDir: workspace.root,
      console: output.console,
      processRunner: async (call) => {
        calls.push(call);
        if (call.command === "git" && call.args[0] === "add") {
          assert.equal(
            output.lines.some((line) => /Staging 2 plan-owned files for review/i.test(line)),
            true,
          );
          return { launched: true, stdout: "", stderr: "fatal", exitCode: 1 };
        }
        if (call.command === "git" && call.args[0] === "restore") {
          return { launched: true, stdout: "", stderr: "", exitCode: 0 };
        }
        return { launched: true, stdout: "", stderr: "", exitCode: 0 };
      },
    });
    assert.equal(failed.success, false);
    assert.match(failed.reason, /review staging git add exited with code 1/);
    assert.match(failed.reason, /fatal/);
    assert.deepEqual(calls.map((call) => [call.command, call.args[0]]), [
      ["git", "diff"],
      ["git", "add"],
      ["git", "restore"],
    ]);
    assert.deepEqual(calls[1].args, [
      "add",
      "--all",
      "--",
      ".ai/scripts/workflow-runner.test.ts",
      ".ai/scripts/workflow-runner.ts",
    ]);
    assert.deepEqual(calls[2].args, [
      "restore",
      "--staged",
      "--",
      ".ai/scripts/workflow-runner.test.ts",
      ".ai/scripts/workflow-runner.ts",
    ]);
    const log = await readFile(join(workspace.root, ".ai", "artifacts", "workflow-runner", "logs", "runner.log"), "utf8");
    assert.match(log, /reviewStagingExitCode: 1/);
    assert.match(log, /reviewStagingStderr: omitted 5 bytes, 1 lines/);
    assert.doesNotMatch(log, /reviewStagingStderr: fatal/);
    assertFailureMetadata(log, {
      kind: "review-staging",
      reason: /failureReason: review staging git add exited with code 1: fatal/,
      nextSuggestedAction: /nextSuggestedAction: fix review staging paths or git error, then rerun workflow-runner/,
    });
  } finally {
    await workspace.cleanup();
  }
});

test("review-plan stops before staging or prompt execution when any staged files already exist", async () => {
  const workspace = await setupWorkspace();
  try {
    await writePlan(workspace.root, "review-guard", planWith("review", "review-plan"));
    const calls: Parameters<ProcessRunner>[0][] = [];
    const output = collectConsole();
    const failed = await runWorkflowRunner({
      planName: planArg("review-guard"),
      rootDir: workspace.root,
      console: output.console,
      processRunner: async (call) => {
        calls.push(call);
        if (
          call.command === "git" &&
          call.args[0] === "diff" &&
          call.args[1] === "--staged" &&
          call.args[2] === "--name-status"
        ) {
          return {
            launched: true,
            stdout: ["M\tother-plan.ts", "A\tsrc/leftover.ts"].join("\n"),
            stderr: "",
            exitCode: 0,
          };
        }
        return { launched: true, stdout: "", stderr: "", exitCode: 0 };
      },
    });

    assert.equal(failed.success, false);
    assert.match(
      failed.reason,
      /review blocked before review-plan because staged files already exist; finish pending staged work or another review first/,
    );
    assert.match(failed.reason, /other-plan\.ts/);
    assert.match(failed.reason, /src\/leftover\.ts/);
    assert.deepEqual(
      calls.map((call) => [call.command, call.args[0] ?? "", call.promptPath]),
      [["git", "diff", "git-pre-review-staged-check"]],
    );
    assert.equal(
      output.lines.some((line) => /staged files already exist/i.test(line) && /other-plan\.ts/.test(line)),
      true,
    );

    const log = await readFile(
      join(workspace.root, ".ai", "artifacts", "review-guard", "logs", "runner.log"),
      "utf8",
    );
    assertFailureMetadata(log, {
      kind: "review-entry-staged-work",
      reason:
        /failureReason: review blocked before review-plan because staged files already exist; finish pending staged work or another review first: M\tother-plan\.ts; A\tsrc\/leftover\.ts/,
      nextSuggestedAction:
        /nextSuggestedAction: finish or unstage existing staged work before starting review-plan, then rerun workflow-runner/,
    });
  } finally {
    await workspace.cleanup();
  }
});

test("review-plan stages plan-owned files normally when the repo has no pre-existing staged work", async () => {
  const workspace = await setupWorkspace();
  try {
    await writePlan(workspace.root, "review-clean-entry", planWith("review", "review-plan"));
    const calls: Parameters<ProcessRunner>[0][] = [];
    const result = await runWorkflowRunner({
      planName: planArg("review-clean-entry"),
      rootDir: workspace.root,
      processRunner: async (call) => {
        calls.push(call);
        if (
          call.command === "git" &&
          call.args[0] === "diff" &&
          call.args[1] === "--staged" &&
          call.args[2] === "--name-status"
        ) {
          return { launched: true, stdout: "", stderr: "", exitCode: 0 };
        }
        if (call.command === "git") {
          return { launched: true, stdout: "", stderr: "", exitCode: 0 };
        }
        if (call.promptPath === ".ai/prompts/review-changes.md") {
          await writePlan(workspace.root, "review-clean-entry", planWith("completed", "commit-summary"));
        }
        return { launched: true, stdout: "summary", stderr: "", exitCode: 0 };
      },
    });

    assert.equal(result.success, true);
    assert.deepEqual(
      calls.map((call) => [call.command, call.args[0] ?? "", call.promptPath]),
      [
        ["git", "diff", "git-pre-review-staged-check"],
        ["git", "add", "git-staging"],
        ["git", "diff", "git-scope-cleanup-diff"],
        [CODEX_COMMAND, "exec", ".ai/prompts/review-changes.md"],
        [CODEX_COMMAND, "exec", ".ai/prompts/commit-summary.md"],
        ["git", "status", "git-commit-summary-clean-check"],
      ],
    );
  } finally {
    await workspace.cleanup();
  }
});

test("review staging auto-unstages unrelated hunks before review prompt runs", async () => {
  const workspace = await setupWorkspace();
  try {
    await writePlan(
      workspace.root,
      "review-scope-cleanup",
      planWithFileScope("review", "review-plan", {
        modified: ["src/file.ts"],
      }),
    );
    const calls: Parameters<ProcessRunner>[0][] = [];
    const result = await runWorkflowRunner({
      planName: planArg("review-scope-cleanup"),
      rootDir: workspace.root,
      processRunner: async (call) => {
        calls.push(call);
        if (call.command === "git" && call.args[0] === "diff") {
          return {
            launched: true,
            stdout: [
              "diff --git a/src/file.ts b/src/file.ts",
              "index 1111111..2222222 100644",
              "--- a/src/file.ts",
              "+++ b/src/file.ts",
              "@@ -10,0 +11,2 @@",
              '+const unrelated = "remove";',
              "+const note = true;",
            ].join("\n"),
            stderr: "",
            exitCode: 0,
          };
        }
        if (call.command === "git") {
          return { launched: true, stdout: "", stderr: "", exitCode: 0 };
        }
        if (call.promptPath === ".ai/prompts/scope-cleanup.md") {
          return {
            launched: true,
            stdout: codexAgentMessageLine(
              JSON.stringify({
                action: "unstage",
                patch: [
                  "diff --git a/src/file.ts b/src/file.ts",
                  "index 1111111..2222222 100644",
                  "--- a/src/file.ts",
                  "+++ b/src/file.ts",
                  "@@ -10,0 +11,2 @@",
                  '+const unrelated = "remove";',
                  "+const note = true;",
                ].join("\\n"),
              }),
            ),
            stderr: "",
            exitCode: 0,
          };
        }
        if (call.promptPath === ".ai/prompts/review-changes.md") {
          await writePlan(
            workspace.root,
            "review-scope-cleanup",
            planWithFileScope("completed", "commit-summary", {
              modified: ["src/file.ts"],
            }),
          );
        }
        return { launched: true, stdout: "summary", stderr: "", exitCode: 0 };
      },
    });

    assert.equal(result.success, true);
    assert.deepEqual(
      calls.map((call) => [call.command, call.args[0] ?? "", call.promptPath]),
      [
        ["git", "diff", "git-pre-review-staged-check"],
        ["git", "add", "git-staging"],
        ["git", "diff", "git-scope-cleanup-diff"],
        [CODEX_COMMAND, "exec", ".ai/prompts/scope-cleanup.md"],
        ["git", "apply", "git-scope-cleanup-unstage"],
        [CODEX_COMMAND, "exec", ".ai/prompts/review-changes.md"],
        [CODEX_COMMAND, "exec", ".ai/prompts/commit-summary.md"],
        ["git", "status", "git-commit-summary-clean-check"],
      ],
    );
    assert.equal(calls[4].input.includes('const unrelated = "remove";'), true);
  } finally {
    await workspace.cleanup();
  }
});

test(`review ${CODEX_COMMAND} failure after staging unstages plan-owned files before exiting`, async () => {
  const workspace = await setupWorkspace();
  try {
    await writePlan(workspace.root, "review-stop", planWith("review", "review-plan"));
    const calls: Parameters<ProcessRunner>[0][] = [];
    const failed = await runWorkflowRunner({
      planName: planArg("review-stop"),
      rootDir: workspace.root,
      processRunner: async (call) => {
        calls.push(call);
        if (call.command === "git") {
          return { launched: true, stdout: "", stderr: "", exitCode: 0 };
        }
        return { launched: true, stdout: "STOP: review requires manual fix", stderr: "", exitCode: 0 };
      },
    });

    assert.equal(failed.success, false);
    assert.match(failed.reason, /output contained STOP: review requires manual fix/);
    assert.deepEqual(calls.map((call) => [call.command, call.args[0] ?? ""]), [
      ["git", "diff"],
      ["git", "add"],
      ["git", "diff"],
      [CODEX_COMMAND, "exec"],
      ["git", "restore"],
    ]);
    assert.deepEqual(calls[4].args, [
      "restore",
      "--staged",
      "--",
      ".ai/scripts/workflow-runner.test.ts",
      ".ai/scripts/workflow-runner.ts",
    ]);
  } finally {
    await workspace.cleanup();
  }
});

test("review cleanup failures write staging and cleanup command evidence to the failure sidecar", async () => {
  const workspace = await setupWorkspace();
  try {
    await writePlan(workspace.root, "review-cleanup-failure", planWith("review", "review-plan"));
    const result = await runWorkflowRunner({
      planName: planArg("review-cleanup-failure"),
      rootDir: workspace.root,
      processRunner: async (call) => {
        if (call.command === "git" && call.args[0] === "add") {
          return { launched: true, stdout: "staged", stderr: "", exitCode: 0 };
        }
        if (call.command === "git" && call.args[0] === "diff") {
          return { launched: true, stdout: "", stderr: "", exitCode: 0 };
        }
        if (call.command === "git" && call.args[0] === "restore") {
          return {
            launched: true,
            stdout: "",
            stderr: [
              "cleanup failed line 1",
              "cleanup failed line 2",
              "cleanup failed line 3",
              "cleanup failed line 4",
              "cleanup failed line 5 should be truncated",
            ].join("\n"),
            exitCode: 1,
          };
        }
        return {
          launched: true,
          stdout: codexAgentMessageLine("STOP: manual review fix required"),
          stderr: "",
          exitCode: 0,
        };
      },
    });

    assert.equal(result.success, false);
    const log = await readFile(
      join(workspace.root, ".ai", "artifacts", "review-cleanup-failure", "logs", "runner.log"),
      "utf8",
    );
    assert.match(
      log,
      /failureDebugPath: \.ai\/artifacts\/review-cleanup-failure\/logs\/failure\.jsonl#L1/,
    );
    const debug = await readFailureDebugLedger(workspace.root, "review-cleanup-failure");
    assert.equal(debug.length, 1);
    assert.equal(debug[0]?.failureKind, "codex-stop");
    const recentCommands = debug[0]?.recentCommands as Array<Record<string, unknown>>;
    assert.equal(recentCommands.length >= 2, true);
    assert.match(String(recentCommands[0]?.command ?? ""), /git add --all --/);
    assert.match(String(recentCommands[1]?.command ?? ""), /git restore --staged --/);
    assert.match(String(recentCommands[1]?.stderrExcerpt ?? ""), /cleanup failed line 1/);
    assert.doesNotMatch(
      String(recentCommands[1]?.stderrExcerpt ?? ""),
      /cleanup failed line 5 should be truncated/,
    );
  } finally {
    await workspace.cleanup();
  }
});

test(`review returning to active unstages plan-owned files before resuming execute-plan`, async () => {
  const workspace = await setupWorkspace();
  try {
    await writePlan(workspace.root, "review-active", planWith("review", "review-plan"));
    const calls: Parameters<ProcessRunner>[0][] = [];
    let executeSnapshot = "";
    const result = await runWorkflowRunner({
      planName: planArg("review-active"),
      rootDir: workspace.root,
      processRunner: async (call) => {
        calls.push(call);
        if (call.command === "git") {
          return { launched: true, stdout: "", stderr: "", exitCode: 0 };
        }
        if (call.command === CODEX_COMMAND && call.promptPath === ".ai/prompts/review-changes.md") {
          writeWorkflowEventArtifactSync({
            root: workspace.root,
            planName: "review-active",
            kind: "review",
            version: 1,
          });
          writeFileSync(
            join(workspace.root, ".ai", "plans", "review-active.md"),
            planWith(
              "active",
              "execute-plan",
              "\n## Review History\n\n### Review v1\n\n* Summary: NEEDS FIX\n* Decision: active\n* Evidence: .ai/artifacts/review-active/events/review-v1.md\n",
            ),
          );
          return { launched: true, stdout: "needs fix", stderr: "", exitCode: 0 };
        }
        if (call.command === CODEX_COMMAND && call.promptPath === ".ai/prompts/execute-plan.md") {
          executeSnapshot = await readFile(
            join(workspace.root, workflowContextSnapshotRelativePath("review-active")),
            "utf8",
          );
          writeFileSync(
            join(workspace.root, ".ai", "plans", "review-active.md"),
            planWith("blocked", "unblock-plan", "\n## Blockers\n\n### Blocker 1\n\n* Description: follow-up fix required\n"),
          );
          return { launched: true, stdout: "blocked", stderr: "", exitCode: 0 };
        }
        return { launched: true, stdout: "", stderr: "", exitCode: 0 };
      },
    });

    assert.equal(result.success, false);
    assert.match(result.reason, /plan blocked after execute-plan/);
    assert.deepEqual(calls.map((call) => [call.command, call.args[0] ?? "", call.promptPath]), [
      ["git", "diff", "git-pre-review-staged-check"],
      ["git", "add", "git-staging"],
      ["git", "diff", "git-scope-cleanup-diff"],
      [CODEX_COMMAND, "exec", ".ai/prompts/review-changes.md"],
      ["git", "restore", "git-review-unstage"],
      [CODEX_COMMAND, "exec", ".ai/prompts/execute-plan.md"],
    ]);
    assert.deepEqual(calls[4].args, [
      "restore",
      "--staged",
      "--",
      ".ai/scripts/workflow-runner.test.ts",
      ".ai/scripts/workflow-runner.ts",
    ]);
    assert.match(executeSnapshot, /## Latest Review Remediation Context/);
    assert.match(executeSnapshot, /\* Source Review: Review v1/);
    assert.match(executeSnapshot, /\* Summary: NEEDS FIX/);
  } finally {
    await workspace.cleanup();
  }
});

test("console output reports concise progress and final outcomes", async () => {
  const workspace = await setupWorkspace();
  try {
    await writePlan(workspace.root, "workflow-runner", planWith("completed", "commit-summary"));
    const output = collectConsole();
    let nowMs = 0;
    const result = await runWorkflowRunner({
      planName: planArg("workflow-runner"),
      rootDir: workspace.root,
      processRunner: runnerReturning({ launched: true, stdout: "summary", stderr: "", exitCode: 0 }, () => {
        nowMs = 1_315_000;
      }),
      console: output.console,
      now: () => nowMs,
    });
    assert.equal(result.success, true);
    assert.match(
      output.lines.join("\n"),
      /\[1\/100\] STAGE SUMMARY\ncompleted -> commit-summary\nmodel: gpt-5\.3-codex-spark \| reasoning: medium/,
    );
    assert.match(output.lines.join("\n"), /SUCCESS/);
    assert.match(output.lines.join("\n"), /- Worked for 21m 55s/);
  } finally {
    await workspace.cleanup();
  }
});

test("console output reports elapsed time when startup validation fails", async () => {
  const workspace = await setupWorkspace();
  try {
    const output = collectConsole();
    const ticks = [0, 12_000];
    const result = await runWorkflowRunner({
      argv: [],
      rootDir: workspace.root,
      processRunner: runnerReturning({ launched: true, stdout: "", stderr: "", exitCode: 0 }),
      console: output.console,
      now: () => ticks.shift() ?? 12_000,
    });
    assert.equal(result.success, false);
    assert.deepEqual(output.lines, ["FAILED: plan name is required", "- Worked for 12s"]);
  } finally {
    await workspace.cleanup();
  }
});

test("CLI without a plan argument fails before execution", async () => {
  const workspace = await setupWorkspace();
  try {
    let launched = false;
    const result = await runWorkflowRunner({
      argv: [],
      rootDir: workspace.root,
      processRunner: async () => {
        launched = true;
        return { launched: true, stdout: "", stderr: "", exitCode: 0 };
      },
    });
    assert.equal(result.success, false);
    assert.match(result.reason, /plan name is required/);
    assert.equal(launched, false);
  } finally {
    await workspace.cleanup();
  }
});
