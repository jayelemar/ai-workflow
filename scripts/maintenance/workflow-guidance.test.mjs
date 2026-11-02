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
    read(".agents/skills/ai-build/SKILL.md"),
    read(".agents/skills/ai-build/references/plan-template.md"),
    read(".agents/skills/ai-build/references/review-checklist.md"),
    read(".agents/skills/ai-build/agents/openai.yaml"),
  ]);

  assert.match(skill, /^---\nname: ai-build\ndescription: .+\n---/);
  assert.match(skill, /references\/plan-template\.md/);
  assert.match(skill, /references\/review-checklist\.md/);
  assert.match(
    skill,
    /generated filename stem must contain 2–4 meaningful\s+words/i,
  );
  assert.match(plan, /## Tasks and Progress/);
  assert.match(
    plan,
    /generated filename stem must contain 2–4 meaningful\s+words/i,
  );
  assert.match(plan, /Do not create a second status/);
  assert.match(plan, /ready-to-copy\s+execution prompt/i);
  assert.match(plan, /\/goal Implement <exact-plan-path>/);
  assert.match(review, /Review the actual Git diff/);
  assert.match(metadata, /\$ai-build/);
});

test("routine, planned, and controlled work stay proportional", async () => {
  const [agents, skill, usage] = await Promise.all([
    read("AGENTS.md"),
    read(".agents/skills/ai-build/SKILL.md"),
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
    read(".agents/skills/ai-build/SKILL.md"),
    read(".agents/skills/ai-build/references/review-checklist.md"),
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

  assert.match(agents, /\.ai\/\.agents\/skills\/ai-build\/SKILL\.md/);
  assert.match(setupDoc, /relative links/);
  assert.match(setupDoc, /canonical `\.ai\/\.agents\/skills\/ai-build/);
});

test("delivery utilities use repository evidence without workflow metadata", async () => {
  const [organizer, pullRequest, delivery] = await Promise.all([
    read(".agents/skills/ai-commit/SKILL.md"),
    read(".agents/skills/ai-pr/SKILL.md"),
    read("instructions/shared/delivery-hygiene.md"),
  ]);
  const source = `${organizer}\n${pullRequest}\n${delivery}`;

  assert.match(source, /git diff --cached --check/);
  assert.match(source, /complete\s+diff from the merge base/);
  assert.match(source, /explicit validation evidence/);
  assert.match(pullRequest, /## Validation/);
  assert.match(pullRequest, /Simple change example/);
  assert.match(pullRequest, /Sensitive change example/);
  assert.match(pullRequest, /missing required evidence/);
  assert.match(delivery, /Missing required evidence blocks completion/);
  assert.doesNotMatch(pullRequest, /Do not add commit SHAs, validation, risk/);
  assert.doesNotMatch(source, /Workflow-(Work-Item|Spec|Plan-Revision)/);
});

test("plan worktree setup stays native, safe, and independent", async () => {
  const [prepare, usage, promptIndex] = await Promise.all([
    read(".agents/skills/ai-worktree-setup/SKILL.md"),
    read("docs/workflow-usage.md"),
    read("prompts/README.md"),
  ]);

  assert.match(prepare, /\$ai-worktree-setup/);
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
  assert.match(
    prepare,
    /tmux new-session -s '<project-title> <plan-name>' -c '<task-root>'.*split-window.*-c '<task-root>'/,
  );
  assert.match(prepare, /exactly one optional two-pane launcher/);
  assert.doesNotMatch(prepare, /<plan-name>-<repository-id>/);
  assert.match(
    prepare,
    /\/goal Implement <task-root>\/\.ai\/plans\/<plan-name>\.md\. Use the prepared worktrees reported above for all plan-owned edits\./,
  );
  assert.doesNotMatch(
    prepare,
    /plan-manifest@|work-status@|worktree-setup@|agent-models\.toml/,
  );
  assert.match(usage, /\$ai-worktree-setup/);
  assert.match(promptIndex, /AI Worktree Setup/);
});

test("workflow cleanup requires explicit scope, confirms, and preserves branches", async () => {
  const [cleanup, usage, promptIndex] = await Promise.all([
    read("prompts/worktree-cleanup.md"),
    read("docs/workflow-usage.md"),
    read("prompts/README.md"),
  ]);

  assert.match(cleanup, /plan: \.ai\/plans\/<plan-name>\.md/);
  assert.match(cleanup, /all-plans: true/);
  assert.match(cleanup, /Reject simultaneous selectors/);
  assert.match(
    cleanup,
    /Without a selector[\s\S]+read-only plan inventory[\s\S]+no confirmation/,
  );
  assert.match(cleanup, /Never infer completion or\s+permission/);
  assert.match(cleanup, /including active\s+plans/);
  assert.match(cleanup, /Reject missing explicit plans/);
  assert.match(cleanup, /symlink|symbolic link/);
  assert.match(cleanup, /shared or ambiguous ownership/);
  assert.match(cleanup, /unselected plans[\s\S]+explicit references/);
  assert.match(
    cleanup,
    /Type PROCEED to clean up only the selected plans listed above, or CANCEL to stop\./,
  );
  assert.match(cleanup, /exact uppercase response `PROCEED` or `CANCEL`/);
  assert.match(cleanup, /On `CANCEL`, stop without mutation/);
  assert.match(cleanup, /On any other response, make no changes/);
  assert.match(cleanup, /require a new\s+`PROCEED` or `CANCEL` response/);
  assert.match(cleanup, /missing task root\s+does not block cleanup/);
  assert.match(cleanup, /Retain every Git branch/);
  assert.match(cleanup, /Preserve workflow records that are not owned/);
  assert.match(cleanup, /Do not run the global `cleanup:local` utility/);
  for (const source of [usage, promptIndex]) {
    assert.match(source, /worktree-cleanup\.md/);
    assert.match(source, /plan: \.ai\/plans\/<plan-name>\.md/);
    assert.match(source, /all-plans: true/);
  }
});

test("role guidance uses supported explicit runtime settings with context", async () => {
  for (const source of await Promise.all([
    read("AGENTS.md"),
    read("docs/codex-agent.md"),
  ])) {
    assert.match(source, /fork_turns: "none"/);
    assert.doesNotMatch(source, /fork_turns[^\n]*"4"/);
    assert.match(source, /schema before/);
    assert.match(source, /repository, relevant instruction paths/);
    assert.match(source, /bounded assignment, expected\s+result/);
    assert.match(source, /unavailable/);
    assert.match(
      source,
      /Do not silently substitute|instead of silently substituting/,
    );
  }
});

test("canonical skills declare matching metadata and enable normal matching", async () => {
  for (const name of ["ai-build", "ai-worktree-setup", "ai-commit", "ai-pr"]) {
    const skill = await read(`.agents/skills/${name}/SKILL.md`);
    const metadata = await read(`.agents/skills/${name}/agents/openai.yaml`);
    assert.ok(skill.startsWith(`---\nname: ${name}\n`));
    assert.ok(metadata.includes(`$${name}`));
    assert.doesNotMatch(metadata, /allow_implicit_invocation:\s*false/);
  }
});
