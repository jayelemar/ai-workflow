import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

const workflowRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
const readSource = (relativePath) => readFile(path.join(workflowRoot, relativePath), "utf8");

test("classifier exposes only LOW, MEDIUM, and HIGH and stops for uncertainty", async () => {
  const source = await readSource("prompts/select-workflow.md");
  assert.match(source, /`LOW`/);
  assert.match(source, /`MEDIUM`/);
  assert.match(source, /`HIGH`/);
  assert.match(source, /Classification: LOW \| MEDIUM \| HIGH/);
  assert.match(source, /STOP and ask for the exact missing decision input/);
  assert.match(source, /Escalate immediately/);
  assert.match(source, /spec in the intake conversation/);
  assert.match(source, /Plan mode/);
  assert.match(source, /Agent mode/);
});

test("feature and bug intake run the universal classifier", async () => {
  const [feature, bug, generic] = await Promise.all([
    readSource("wrappers/feature-intake.md"),
    readSource("wrappers/bug-intake-rca.md"),
    readSource("wrappers/select-workflow.md"),
  ]);
  for (const source of [feature, bug]) {
    assert.match(source, /exact classification, escalation,\s+LOW-to-MEDIUM safeguard, uncertainty stop, and next-stage rules/);
    assert.match(source, /Classification: LOW \| MEDIUM \| HIGH/);
    assert.doesNotMatch(source, /Approval Brief/);
    assert.match(source, /same intake conversation/);
  }
  assert.match(generic, /neither a feature\s+nor a bug, regression, or incident/);
});

test("plans require explicit authorization and LOW-to-MEDIUM safeguard", async () => {
  const [plan, flow, template] = await Promise.all([
    readSource("prompts/create-plan.md"),
    readSource("instructions/shared/flow-trace-artifacts.md"),
    readSource("templates/plan.template.md"),
  ]);
  assert.match(
    plan,
    /`execute <plan-file>` or `\/goal <description> <plan-file>` invocation is the\s+authorization boundary/,
  );
  assert.match(plan, /`LOW`: the classifier result and repository evidence\. Do not create a spec/);
  assert.match(template, /LOW plans do not use a spec/);
  assert.match(flow, /LOW must\s+escalate before planning/);
  assert.match(template, /MEDIUM review/);
  assert.match(plan, /Plan mode after the intake conversation/);
});

test("execution requires post-implementation safeguards and review statuses", async () => {
  const [execute, review] = await Promise.all([
    readSource("prompts/execute-plan.md"),
    readSource("prompts/review-changes.md"),
  ]);
  assert.match(execute, /plan's scoped validation/);
  assert.match(execute, /concise self-check/);
  assert.match(execute, /\.ai\/artifacts\/<plan-name>\/review\.md/);
  for (const status of ["Ready to complete", "Fix required", "Blocked"]) {
    assert.match(execute, new RegExp(status));
    assert.match(review, new RegExp(status));
  }
  assert.match(review, /before committing it/);
});

test("HIGH keeps task review and commit sequencing", async () => {
  const [checkpoint, plan, review, template] = await Promise.all([
    readSource("prompts/goal-checkpoint.md"),
    readSource("prompts/create-plan.md"),
    readSource("prompts/review-changes.md"),
    readSource("templates/plan.template.md"),
  ]);
  assert.match(checkpoint, /Run the task's exact declared validation successfully/);
  assert.match(checkpoint, /Review the task diff for regressions, out-of-scope files/);
  assert.match(checkpoint, /Never combine two planned tasks in one commit/);
  assert.match(checkpoint, /only the current task before starting the next task/);
  assert.match(plan, /Do not use `OPTIONAL` or defer this decision to\s+execution/);
  assert.match(template, /Delegation: `REQUIRED` \| `NONE`/);
  assert.match(template, /investigator/);
  assert.match(template, /builder/);
  assert.match(template, /reviewer/);
  assert.match(checkpoint, /If a required role\s+cannot run or lacks its result, STOP/);
  assert.match(review, /Missing or\s+failed required delegation blocks the task/);
});

test("HIGH planning creates a required initial handoff without authorizing execution", async () => {
  const [workflow, plan, template, checkpoint] = await Promise.all([
    readSource("instructions/ai-workflow.md"),
    readSource("prompts/create-plan.md"),
    readSource("templates/plan.template.md"),
    readSource("prompts/goal-checkpoint.md"),
  ]);
  assert.match(plan, /HIGH planning must create the initial goal handoff/);
  assert.match(plan, /\.ai\/artifacts\/<plan-name>\/goal-handoff\.md/);
  assert.match(plan, /not its standalone final-output instruction/);
  assert.match(template, /HIGH plans: `\.ai\/artifacts\/<plan-name>\/goal-handoff\.md`/);
  assert.match(checkpoint, /initial HIGH planning/);
  assert.match(workflow, /initial goal handoff alongside the plan/);
  assert.match(workflow, /`\/goal <description> <plan-file>` remains the only execution authorization/);
});

test("HIGH delegation keeps terminal activity understandable without durable logs", async () => {
  const [workflow, checkpoint, template, readme] = await Promise.all([
    readSource("instructions/ai-workflow.md"),
    readSource("prompts/goal-checkpoint.md"),
    readSource("templates/plan.template.md"),
    readSource("README.md"),
  ]);
  for (const source of [workflow, checkpoint, template, readme]) {
    assert.match(source, /bounded scope/i);
  }
  assert.match(workflow, /terminal transcript/i);
  assert.match(checkpoint, /root terminal/i);
  assert.match(template, /Terminal visibility/);
  assert.match(readme, /Delegation terminal visibility/);
  assert.match(checkpoint, /before\s+waiting again/i);
  assert.match(checkpoint, /never substitute `Interacted with` or `Waiting for agents`/);
  assert.match(workflow, /must not\s+create a workflow artifact, runner state, event log/i);
  assert.match(readme, /transport events/i);
});
