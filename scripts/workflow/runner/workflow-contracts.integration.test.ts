import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { join } from "node:path";
import test from "node:test";

import {
  estimateBossSummaryPercent,
  validateTaskCommitBoundaries,
} from "../runner.ts";
import { planWithTaskSavepoints } from "./__tests__/helpers/runner-plan.ts";

const readPrompt = (name: string) =>
  readFile(join(process.cwd(), ".ai", "prompts", name), "utf8");
const readInstruction = (name: string) =>
  readFile(join(process.cwd(), ".ai", "instructions", name), "utf8");
const readTemplate = () =>
  readFile(join(process.cwd(), ".ai", "templates", "plan.template.md"), "utf8");

test("nonterminal prompts require an assigned event and preserve runner routing ownership", async () => {
  const cases = await Promise.all([
    "sync-plan-artifacts.md",
    "plan-validator.md",
    "execute-plan.md",
    "unblock-plan.md",
    "review-changes.md",
    "reopen-plan.md",
  ].map(async (name) => [name, await readPrompt(name)] as const));

  for (const [name, prompt] of cases) {
    assert.match(prompt, /runner-issued descriptor/i, `${name} requires a descriptor`);
    assert.match(prompt, /Write only the (exact )?event artifact/i, `${name} is event-only`);
    assert.match(prompt, /Do not edit the plan manifest/i, `${name} preserves the manifest`);
    assert.match(prompt, /runner(?:\s+alone)?\s+(?:owns|writes)/i, `${name} names runner state authority`);
    assert.match(prompt, /## Outcome[\s\S]*## Summary[\s\S]*## Evidence/i, `${name} defines required event sections`);
  }
});

test("stage prompts expose only the transition outcomes accepted by the runner", async () => {
  const [sync, validation, execution, unblock, review, reopen] = await Promise.all([
    readPrompt("sync-plan-artifacts.md"),
    readPrompt("plan-validator.md"),
    readPrompt("execute-plan.md"),
    readPrompt("unblock-plan.md"),
    readPrompt("review-changes.md"),
    readPrompt("reopen-plan.md"),
  ]);

  assert.match(sync, /<ready \| retry>/);
  assert.match(validation, /<approved \| retry \| blocked>/);
  assert.match(execution, /<review-ready \| active \| blocked>/);
  assert.match(unblock, /<active \| blocked>/);
  assert.match(review, /<completed \| active>/);
  assert.match(reopen, /## Outcome\s+\s*active/i);
});

test("execution and review prompts preserve the review-staging boundary", async () => {
  const [execution, review] = await Promise.all([
    readPrompt("execute-plan.md"),
    readPrompt("review-changes.md"),
  ]);

  assert.match(execution, /Do not run `git add`[\s\S]*Git index/i);
  assert.match(execution, /Leave every implementation change unstaged/i);
  assert.match(review, /must not spawn subagents/i);
  assert.match(review, /`active` is a normal nonterminal review result/i);
  assert.match(review, /NEEDS FIX[\s\S]*do not emit a `STOP` directive/i);
  assert.match(review, /include one or more actionable\s+remediation bullets/i);
});

test("workflow state guidance makes the runner the only transition authority", async () => {
  const guidance = await readInstruction("shared/workflow-state.md");

  assert.match(guidance, /runner is the sole normal writer/i);
  assert.match(guidance, /transition journal/i);
  assert.match(guidance, /draft-artifact-sync[\s\S]*ready.*retry/i);
  assert.match(guidance, /draft-validation[\s\S]*approved.*retry.*blocked/i);
  assert.match(guidance, /review[\s\S]*active.*completed/i);
  assert.match(guidance, /Existing\s+malformed plans require the explicit workflow artifact migration command/i);
});

test("runner-managed and manual plan templates keep state artifacts separate", async () => {
  const [createPlan, template, manual] = await Promise.all([
    readPrompt("create-plan.md"),
    readTemplate(),
    readPrompt("manual-execute-plan.md"),
  ]);

  assert.match(createPlan, /Choose exactly one execution mode/i);
  assert.match(createPlan, /`runner-managed` plans[\s\S]*draft-artifact-sync/i);
  assert.match(createPlan, /For `manual` plans, omit `## Workflow State`/i);
  assert.match(template, /## Workflow Content Rules\s+\s*thin-plan/i);
  assert.match(template, /Workflow state: `?\.ai\/artifacts\/<plan-name>\/state\/workflow\.json/i);
  assert.match(template, /Events: `?\.ai\/artifacts\/<plan-name>\/events\//i);
  assert.match(manual, /manual-handoff\.md.*goal-handoff\.md/i);
  assert.match(manual, /Do not invoke the workflow runner/i);
});

test("workflow selection remains an analysis-only gate with explicit HIGH routing", async () => {
  const prompt = await readPrompt("select-workflow.md");

  assert.match(prompt, /Do not create, modify, or delete files/i);
  assert.match(prompt, /LOW.*MEDIUM.*HIGH-GOAL.*HIGH-RUNNER/is);
  assert.match(prompt, /operator must explicitly choose `HIGH-GOAL` or\s+`HIGH-RUNNER`/i);
  assert.match(prompt, /choose HIGH-GOAL or HIGH-RUNNER/i);
  assert.match(prompt, /Return exactly these four lines/i);
});

test("commit summary stays plan-scoped and never pushes", async () => {
  const prompt = await readPrompt("commit-summary.md");

  assert.match(prompt, /Expected: `completed`/i);
  assert.match(prompt, /creates exactly one local git commit/i);
  assert.match(prompt, /MUST NOT push/i);
  assert.match(prompt, /Plan-scoped commit boundary/i);
  assert.match(prompt, /Do not stage `\.ai\/` files/i);
  assert.match(prompt, /Task savepoint aggregate summary[\s\S]*do NOT create a git commit/i);
});

test("task commit boundaries cover every dirty path exactly once", () => {
  const plan = `${planWithTaskSavepoints("completed", "commit-summary")}
## Commit Boundaries

### [task:01-backend-endpoints]

1. **Backend contract** — \`src/backend/{contracts,intake}/**\`
2. **Web surface** — \`src/web/**\`
`;
  const covered = validateTaskCommitBoundaries({
    planContent: plan,
    taskId: "01-backend-endpoints",
    planOwnedDirtyPaths: [
      "src/backend/contracts/dispatch.ts",
      "src/backend/intake/handler.ts",
      "src/web/page.tsx",
    ],
  });
  assert.equal(covered.ok, true);

  const invalid = validateTaskCommitBoundaries({
    planContent: plan,
    taskId: "01-backend-endpoints",
    planOwnedDirtyPaths: ["src/backend/contracts/dispatch.ts", "src/unassigned-worker.ts"],
  });
  assert.equal(invalid.ok, false);
  assert.match(invalid.ok ? "" : invalid.reason, /unassigned plan-owned paths/i);
});

test("completed task savepoints report review-range progress", () => {
  const percent = estimateBossSummaryPercent({
    tasks: [{ id: "01-db" }, { id: "02-ui" }] as never,
    completedTasks: [{}, {}] as never,
    finalStatus: "in-progress",
  });

  assert.equal(percent, 92);
});
