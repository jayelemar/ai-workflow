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
  const checkpoint = await readSource("prompts/goal-checkpoint.md");
  assert.match(checkpoint, /Run the task's exact declared validation successfully/);
  assert.match(checkpoint, /Review the task diff for regressions and out-of-scope files/);
  assert.match(checkpoint, /Never combine two planned tasks in one commit/);
  assert.match(checkpoint, /only the current task before starting the next task/);
});
