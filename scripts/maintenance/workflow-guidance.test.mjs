import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

const root = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  "../..",
);
const read = (relativePath) => readFile(path.join(root, relativePath), "utf8");
test("the change skill uses progressive disclosure", async () => {
  const [skill, plan, review, metadata] = await Promise.all([
    read(".agents/skills/change-workflow/SKILL.md"),
    read(".agents/skills/change-workflow/references/plan-template.md"),
    read(".agents/skills/change-workflow/references/review-checklist.md"),
    read(".agents/skills/change-workflow/agents/openai.yaml"),
  ]);

  assert.match(skill, /^---\nname: change-workflow\ndescription: .+\n---/);
  assert.match(skill, /references\/plan-template\.md/);
  assert.match(skill, /references\/review-checklist\.md/);
  assert.match(plan, /## Tasks and Progress/);
  assert.match(plan, /Do not create a second status/);
  assert.match(plan, /ready-to-copy\s+execution prompt/i);
  assert.match(plan, /\/goal Implement <exact-plan-path>/);
  assert.match(review, /Review the actual Git diff/);
  assert.match(metadata, /\$change-workflow/);
});

test("routine, planned, and controlled work stay proportional", async () => {
  const [agents, skill, usage] = await Promise.all([
    read("AGENTS.md"),
    read(".agents/skills/change-workflow/SKILL.md"),
    read("docs/workflow-usage.md"),
  ]);
  const source = `${agents}\n${skill}\n${usage}`;

  assert.match(
    source,
    /without\s+creating workflow artifacts?|creates no\s+workflow artifact/i,
  );
  assert.match(source, /one living plan/i);
  assert.match(source, /After saving a new plan[\s\S]+ready-to-copy `\/goal`/i);
  assert.match(source, /Do not start the Goal automatically/i);
  assert.match(source, /authentication, authorization, payments, secrets/);
  assert.match(source, /independent final review/i);
  assert.match(source, /no unresolved\s+material decision/i);
});

test("safety and delivery boundaries remain explicit", async () => {
  const [agents, skill, review] = await Promise.all([
    read("AGENTS.md"),
    read(".agents/skills/change-workflow/SKILL.md"),
    read(".agents/skills/change-workflow/references/review-checklist.md"),
  ]);
  const source = `${agents}\n${skill}\n${review}`;

  for (const expectation of [
    /Preserve unrelated work/i,
    /private client, user, firm/i,
    /Required acceptance evidence cannot be deferred/i,
    /Do not commit, push, open a pull request, deploy, release/i,
    /Prevent concurrent agents from editing the same file/i,
    /explicit authority before destructive actions/i,
  ]) {
    assert.match(source, expectation);
  }
});

test("root authority routes planned work to the canonical nested skill", async () => {
  const [agents, setupDoc] = await Promise.all([
    read("AGENTS.md"),
    read("docs/codex-agent.md"),
  ]);

  assert.match(agents, /\.ai\/\.agents\/skills\/change-workflow\/SKILL\.md/);
  assert.match(setupDoc, /does not copy\s+the workflow skill/);
  assert.match(setupDoc, /canonical `\.ai\/\.agents\/skills\/change-workflow/);
});

test("delivery utilities use repository evidence without workflow metadata", async () => {
  const [organizer, pullRequest, delivery] = await Promise.all([
    read("prompts/utilities/commit-organizer.md"),
    read("prompts/utilities/pull-request-creation.md"),
    read("instructions/shared/delivery-hygiene.md"),
  ]);
  const source = `${organizer}\n${pullRequest}\n${delivery}`;

  assert.match(source, /git diff --cached --check/);
  assert.match(source, /complete\s+diff from the merge base/);
  assert.match(source, /explicit validation evidence/);
  assert.doesNotMatch(source, /Workflow-(Work-Item|Spec|Plan-Revision)/);
});

test("worktree preparation stays native, safe, and independent", async () => {
  const [prepare, usage, promptIndex] = await Promise.all([
    read("prompts/utilities/prepare-worktree.md"),
    read("docs/workflow-usage.md"),
    read("prompts/README.md"),
  ]);

  assert.match(prepare, /Run \.ai\/prompts\/utilities\/prepare-worktree\.md/);
  assert.match(
    prepare,
    /<workspace>\/\.worktrees\/<plan-name>\/\<repository-id>/,
  );
  assert.match(
    prepare,
    /worktree add -b '<branch>' '<target>' '<base-commit>'/,
  );
  assert.match(prepare, /Never use `-B`, `--force`/);
  assert.match(prepare, /Preserve unrelated dirty-source changes/);
  assert.match(prepare, /does not authorize secret copying/i);
  assert.match(prepare, /exact ready-to-copy execution prompt/i);
  assert.match(prepare, /\/goal Implement <exact-plan-path>/);
  assert.doesNotMatch(
    prepare,
    /plan-manifest@|work-status@|worktree-setup@|agent-models\.toml/,
  );
  assert.match(usage, /prepare-worktree\.md/);
  assert.match(promptIndex, /Worktree preparation/);
});
