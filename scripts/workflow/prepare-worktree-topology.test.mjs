import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const preparePrompt = await readFile(
  new URL("../../prompts/prepare-worktree.md", import.meta.url),
  "utf8",
);
const createPlanPrompt = await readFile(
  new URL("../../prompts/create-plan.md", import.meta.url),
  "utf8",
);

test("prepare-worktree permits only explicitly declared shared-parent siblings", () => {
  assert.match(preparePrompt, /immediate sibling\s+of the plan workspace/);
  assert.match(preparePrompt, /same real parent/);
  assert.match(preparePrompt, /outside root other than the explicit\n?immediate-sibling case/);
});

test("multi-repository targets always use the coordination root", () => {
  assert.match(preparePrompt, /Every multi-repository plan uses the coordination-root layout/);
  assert.match(preparePrompt, /every generated target and all control context must remain inside the task\nroot/);
  assert.match(preparePrompt, /create its linked Git worktree at the declared target child/);
});

test("prepared execution uses a verified task-local repository overlay", () => {
  assert.match(preparePrompt, /Keep the copied plan byte-for-byte unchanged/);
  assert.match(preparePrompt, /maps every repository ID to one verified target path/);
  assert.match(preparePrompt, /worktree-setup@1/);
});

test("create-plan rejects repository topology that prepare-worktree cannot use", () => {
  assert.match(createPlanPrompt, /outside root is valid only for a plan with two or\n  more repositories/);
  assert.match(createPlanPrompt, /explicitly declared immediate sibling/);
  assert.match(createPlanPrompt, /deferring the\n  incompatibility to worktree preparation/);
});
