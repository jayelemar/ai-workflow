import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const preparePrompt = await readFile(
  new URL("../../prompts/utilities/prepare-worktree.md", import.meta.url),
  "utf8",
);
const createPlanPrompt = await readFile(
  new URL("../../prompts/workflow/create-plan.md", import.meta.url),
  "utf8",
);

test("prepare-worktree permits only explicitly declared shared-parent siblings", () => {
  assert.match(preparePrompt, /immediate sibling\s+of the plan workspace/);
  assert.match(preparePrompt, /same real parent/);
  assert.match(
    preparePrompt,
    /outside root other than the explicit\n?immediate-sibling case/,
  );
});

test("multi-repository targets always use the coordination root", () => {
  assert.match(
    preparePrompt,
    /Every multi-repository plan uses the coordination-root layout/,
  );
  assert.match(
    preparePrompt,
    /every generated target and all control context must remain inside the task\nroot/,
  );
  assert.match(
    preparePrompt,
    /create its linked Git worktree at the declared target child/,
  );
});

test("prepared execution uses a verified task-local repository overlay", () => {
  assert.match(preparePrompt, /Keep the copied plan byte-for-byte unchanged/);
  assert.match(
    preparePrompt,
    /maps every repository ID to one verified target path/,
  );
  assert.match(preparePrompt, /worktree-setup@1/);
  assert.match(preparePrompt, /same `plan-manifest@3`/);
});

test("prepare-worktree mirrors populated root environments and workspace docs", () => {
  assert.match(
    preparePrompt,
    /treat an exact root-level `.env` in its primary\s+checkout as required populated configuration/i,
  );
  assert.match(
    preparePrompt,
    /`.env.example`.*never satisfies, replaces, or suppresses copying an available\s+populated\s+`.env`/s,
  );
  assert.match(
    preparePrompt,
    /mirror its complete\s+contents into `<task-root>\/docs\/`/,
  );
  assert.match(
    preparePrompt,
    /complete tree matches `<task-root>\/docs\/` with the same checksum dry-run/,
  );
});

test("create-plan rejects repository topology that prepare-worktree cannot use", () => {
  assert.match(createPlanPrompt, /For multi-repository coordination only/);
  assert.match(createPlanPrompt, /explicitly\s+declared immediate sibling/);
  assert.match(
    createPlanPrompt,
    /Reject absolute roots, symlink escapes, ancestor traversal/,
  );
});
