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
    read(".agents/skills/create-plan/SKILL.md"),
    read(".agents/skills/create-plan/references/plan-template.md"),
    read("instructions/shared/plan-review.md"),
    read(".agents/skills/create-plan/agents/openai.yaml"),
  ]);

  assert.match(skill, /^---\nname: create-plan\ndescription: .+\n---/);
  assert.match(skill, /references\/plan-template\.md/);
  assert.doesNotMatch(skill, /## Implement safely|## Review controlled work/);
  assert.match(plan, /## Tasks and Progress/);
  assert.match(
    plan,
    /generated filename stem must contain 2–4 meaningful\s+words/i,
  );
  assert.match(plan, /ready-to-copy\s+execution prompt/i);
  assert.match(plan, /\/goal Implement <exact-plan-path>/);
  assert.match(review, /Review the actual Git diff/);
  assert.match(metadata, /\$create-plan/);
});

test("routine, planned, and controlled work stay proportional", async () => {
  const [agents, skill, readme] = await Promise.all([
    read("AGENTS.md"),
    read(".agents/skills/create-plan/SKILL.md"),
    read("README.md"),
  ]);
  const source = `${agents}\n${skill}\n${readme}`;

  assert.match(
    source,
    /without\s+creating workflow artifacts?|creates no\s+workflow artifact/i,
  );
  assert.match(source, /one living plan/i);
  assert.match(source, /After saving a new plan[\s\S]+ready-to-copy `\/goal`/i);
  assert.match(source, /Do not start the Goal automatically/i);
  assert.match(source, /authentication, authorization, payments, secrets/);
  assert.match(source, /independent final review/i);
  assert.match(source, /resolve material decisions/i);
});

test("safety and delivery boundaries remain explicit", async () => {
  const [agents, skill, review] = await Promise.all([
    read("AGENTS.md"),
    read(".agents/skills/create-plan/SKILL.md"),
    read("instructions/shared/plan-review.md"),
  ]);
  const source = `${agents}\n${skill}\n${review}`;

  for (const expectation of [
    /Preserve unrelated work/i,
    /private client, user, firm/i,
    /Required acceptance evidence cannot be (?:deferred|downgraded)/i,
    /Do not commit, push, open a pull request, deploy, release/i,
    /Prevent concurrent agents from editing the same file/i,
    /explicit authority before destructive actions/i,
  ]) {
    assert.match(source, expectation);
  }
});

test("root authority separates planning from saved-plan execution", async () => {
  const [agents, setupDoc] = await Promise.all([
    read("AGENTS.md"),
    read("docs/codex-setup.md"),
  ]);

  assert.match(agents, /\.ai\/\.agents\/skills\/create-plan\/SKILL\.md/);
  assert.match(agents, /native Execute plan, `\/goal`, and ordinary requests/);
  assert.match(agents, /execution does not require invoking `create-plan`/);
  assert.match(agents, /instructions\/shared\/plan-review\.md/);
  assert.match(
    agents,
    /Controlled review must\s+finish before claiming completion/,
  );
  assert.match(setupDoc, /relative link/i);
  assert.match(setupDoc, /`\.ai\/\.agents\/skills\/create-plan\/SKILL\.md`/);
});

test("delivery utilities use repository evidence without workflow metadata", async () => {
  const [organizer, pullRequest, delivery, agents, testing] = await Promise.all(
    [
      read(".agents/skills/git-commit/SKILL.md"),
      read(".agents/skills/pull-request/SKILL.md"),
      read("instructions/shared/delivery-hygiene.md"),
      read("AGENTS.md"),
      read("instructions/shared/testing.md"),
    ],
  );
  const source = `${organizer}\n${pullRequest}\n${delivery}`;

  assert.match(source, /git diff --cached --check/);
  assert.match(source, /complete\s+diff from the merge base/);
  assert.match(source, /explicit validation evidence/);
  assert.match(pullRequest, /Simple change example/);
  assert.match(pullRequest, /Sensitive change example/);
  assert.match(pullRequest, /missing required evidence/);
  assert.match(agents, /Unavailable required evidence blocks completion/);
  for (const reference of [delivery, testing]) {
    assert.match(
      reference,
      /\[Validation and Completion\]\(\.\.\/\.\.\/AGENTS\.md#validation-and-completion\)/,
    );
  }
  for (const skill of [organizer, pullRequest]) {
    assert.match(
      skill,
      /\[Commit Subjects and PR Titles\]\(\.\.\/\.\.\/\.\.\/instructions\/shared\/delivery-hygiene\.md#commit-subjects-and-pr-titles\)/,
    );
  }
  assert.match(delivery, /<type>\(<scope>\): <imperative summary>/);
  assert.match(delivery, /no longer than 72 characters/);
  assert.doesNotMatch(pullRequest, /Do not add commit SHAs, validation, risk/);
  assert.doesNotMatch(source, /Workflow-(Work-Item|Spec|Plan-Revision)/);
});

test("delivery verifies documented hooks in the actual checkout before commits or pushes", async () => {
  const source = (
    await read("instructions/shared/delivery-hygiene.md")
  ).replace(/\s+/g, " ");
  for (const expectation of [
    /Before a commit or push in a repository with documented hooks/,
    /actual checkout[\s\S]+effective hook path/,
    /expected executable launchers[\s\S]+required helper files[\s\S]+hooks are enabled/,
    /Dependency installation[\s\S]+configured hook path[\s\S]+directly passing quality scripts alone do not prove hook readiness/,
    /missing or disabled[\s\S]+repository's documented initialization procedure[\s\S]+existing setup authorization/,
    /initialization or verification cannot succeed[\s\S]+report the concrete blocker and stop the commit or push/,
    /Do not bypass hooks or redirect shared Git configuration as a workaround/,
  ]) {
    assert.match(source, expectation);
  }
});

test("plan worktree setup stays native, safe, and independent", async () => {
  const [prepare, selection, checks, copy, readme, promptIndex] =
    await Promise.all([
      read(".agents/skills/worktree-setup/SKILL.md"),
      read(".agents/skills/worktree-setup/references/context-selection.md"),
      read(".agents/skills/worktree-setup/references/worktree-checks.md"),
      read(".agents/skills/worktree-setup/references/context-copy.md"),
      read("README.md"),
      read("prompts/README.md"),
    ]);
  const source = `${prepare}\n${selection}\n${checks}\n${copy}`;
  assert.match(prepare, /\$worktree-setup/);
  assert.match(
    prepare,
    /<workspace>\/\.worktrees\/<plan-name>\/<repository-id>/,
  );
  assert.match(
    prepare,
    /Before selecting context or creating worktrees, read and follow\s+\[context-selection\.md\]/,
  );
  assert.match(
    prepare,
    /Before mutation and\s+again during verification, read and follow\s+\[worktree-checks\.md\]/,
  );
  assert.match(
    prepare,
    /Read and execute the canonical[\s\S]+references\/context-copy\.md/,
  );
  for (const expectation of [
    /worktree add -b '<branch>' '<target>' '<base-commit>'/,
    /Never use `-B`, `--force`/,
    /Preserve unrelated dirty-source changes/,
    /does not\s+authorize secret copying/i,
    /Never stash, clean, reset, switch, merge/,
    /source application changes overlapping the plan/,
    /always copy exact selected source bytes/,
    /no object hard links\s+to the source, no remotes/,
    /Do not stage additions or\s+modify source indexes/,
    /without automatic\s+rollback, source mutation, or cleanup/,
  ])
    assert.match(source, expectation);
  for (const expectation of [
    /canonical_files/,
    /local_files/,
    /workspace_files/,
    /Include source deletions in the inventory/,
    /all managed skills/,
    /no symbolic link in any component/,
    /including tracked canonical candidates and required references/,
    /Preserve an accepted\s+custom override byte-for-byte/,
    /Stop if\s+required context conflicts with an exclusion/,
  ])
    assert.match(selection, expectation);
  assert.doesNotMatch(
    prepare,
    /plan-manifest@|work-status@|worktree-setup@|agent-models\.toml/,
  );
  assert.match(readme, /\$worktree-setup/);
  assert.match(promptIndex, /Worktree Setup/);
  assert.match(
    prepare,
    /Routine setup requires no dependency installation, package manager,\s+network access/,
  );
  assert.match(
    prepare,
    /Implementation handles\s+dependency setup, repository-documented hook initialization in each prepared\s+checkout, and application validation/,
  );
  assert.match(
    prepare,
    /\[Hook verification\]\(\.\.\/\.\.\/\.\.\/instructions\/shared\/delivery-hygiene\.md#hook-verification\)/,
  );
});

test("successful setup emits only self-contained handoffs and failures cannot launch", async () => {
  const source = await read(".agents/skills/worktree-setup/SKILL.md");
  const output = source.split("## Output\n")[1];
  assert.ok(output, "setup must define its output contract");
  assert.match(
    output,
    /exactly two fenced code blocks: first `text`, then\s+`bash`/,
  );
  assert.match(
    output,
    /No headings, status report, extra success narrative, or automatic\s+execution/,
  );
  const blocks = [...output.matchAll(/```(text|bash)\n([\s\S]*?)\n```/g)];
  assert.deepEqual(
    blocks.map((block) => block[1]),
    ["text", "bash"],
  );
  assert.match(
    blocks[0][2],
    /^\/goal Implement <task-root>\/\.ai\/plans\/<plan-name>\.md\./,
  );
  assert.match(blocks[0][2], /<repository-id>=<absolute-worktree-path>/);
  assert.match(
    blocks[0][2],
    /Implementation handles dependency setup, repository-documented hook initialization in each prepared checkout, and application validation/,
  );
  assert.match(
    blocks[0][2],
    /Verify hooks before commits or pushes following \.ai\/instructions\/shared\/delivery-hygiene\.md#hook-verification/,
  );
  assert.match(
    blocks[0][2],
    /Preserve its boundaries[\s\S]+keep the task-local plan updated[\s\S]+run every required validation[\s\S]+definition of done is proven/,
  );
  assert.doesNotMatch(blocks[0][2], /reported above/);
  assert.match(
    output,
    /For controlled work, require the plan's independent final review before finishing/,
  );
  assert.match(
    blocks[1][2],
    /^tmux new-session -s '<project-title> <plan-name>' -c '<task-root>' \\; split-window -t '<project-title> <plan-name>:' -h -p 67 -c '<task-root>'$/,
  );
  assert.match(output, /one session for multiple repositories/);
  assert.match(
    output,
    /Blocked or partial setup returns only `Error:`[\s\S]+`Fix:`/,
  );
  assert.match(output, /`Created:`[\s\S]+only when partial creation occurred/);
  assert.match(
    output,
    /Emit neither the `\/goal` prompt nor\s+the tmux launch command/,
  );
  assert.doesNotMatch(
    source,
    /Preparation: Ready|Repositories: <id:|Validation: <checks passed/,
  );
});

test("workflow cleanup requires explicit scope, confirms, and preserves branches", async () => {
  const [cleanup, readme, promptIndex] = await Promise.all([
    read("prompts/worktree-cleanup.md"),
    read("README.md"),
    read("prompts/README.md"),
  ]);

  assert.match(cleanup, /plan: \.ai\/plans\/<plan-name>\.md/);
  assert.match(cleanup, /all-plans: true/);
  const exclusionExample =
    /include everything except saved-outfit-details\.md and platform-services-mobile\.md/;
  assert.match(cleanup, exclusionExample);
  for (const expectation of [
    /Reject simultaneous\/repeated selectors/,
    /With no selector[\s\S]+read-only plan inventory[\s\S]+without confirmation or mutation/,
    /Selection defines eligibility, never checkboxes, prose, filenames, age/,
    /including active\s+plans/,
    /Reject paths,\s+duplicate names, and missing or unsafe exclusions before confirmation/,
    /never\s+silently ignore an exclusion or fall back to including everything/,
    /when every plan is excluded[\s\S]+without confirmation or mutation/,
    /List both selected and excluded source plans before\s+confirmation/,
    /excluded plans and their task roots and records are unselected\s+and must remain untouched/,
    /repeat discovery, selector validation[\s\S]+same selector\s+before mutation/,
    /Reject missing\s+plans/,
    /Reject ambiguous\/shared ownership/,
    /all source plans and references, including\s+unselected plans/,
    /Type PROCEED to clean up only the selected plans listed above, or CANCEL to stop\./,
    /Accept only exact uppercase `PROCEED` or `CANCEL`/,
    /`CANCEL` stops unchanged/,
    /anything else makes no changes and repeats that exact prompt/,
    /require a new `PROCEED` or `CANCEL`/,
    /missing task root does not block source-record cleanup/,
    /Retain every Git branch/,
    /Preserve unselected plans, task roots and records, unrelated records/,
    /Never\s+substitute global `cleanup:local`/,
    /Do not remove any source plan or record until worktree\/task-root removal\s+succeeds for every selected plan/,
    /Never claim completion with a listed target remaining\s+or a required postcondition unverified/,
  ])
    assert.match(cleanup, expectation);
  for (const source of [readme, promptIndex]) {
    assert.match(source, /worktree-cleanup\.md/);
    assert.match(source, /plan: \.ai\/plans\/<plan-name>\.md/);
    assert.match(source, /all-plans: true/);
    assert.match(source, exclusionExample);
  }
});

test("workflow cleanup treats contained symlinks as leaves and rejects linked boundaries", async () => {
  const cleanup = (await read("prompts/worktree-cleanup.md")).replace(
    /\s+/g,
    " ",
  );

  for (const expectation of [
    /Inspect entries with `lstat` or equivalent no-follow metadata/,
    /Reject symlinks\s+at source `\.ai\/`, `plans\/`, source plan files, task roots, native worktree\s+roots, task-root parent, managed root directories, and every existing ancestor\s+of a cleanup target/,
    /Allow symlinks only inside selected task roots and plan-owned record\s+directories/,
    /including dependency links in `node_modules`, directory links,\s+external-target links, and dangling links/,
    /Treat each link as a leaf; never\s+traverse, inspect, or delete its target/,
    /Check containment and exact plan\s+ownership of the link's own path/,
    /Reject standalone symlink record targets/,
    /complete in-memory symlink inventory of relative entry paths and\s+`readlink` destinations/,
    /Summarize symlink counts and locations by task root or record directory/,
    /group dependency links under `node_modules` and show at most five example\s+paths per group/,
    /Contained links will be removed; external targets remain untouched\./,
    /repeat discovery[\s\S]+full\s+inspection, including the complete symlink inventory/,
    /symlink paths or destinations[\s\S]+changed,[\s\S]+require a new `PROCEED` or `CANCEL`/,
    /All removal methods, including recursive removal, must never follow\s+directory symlinks/,
    /unlink symlink entries themselves without trailing slashes or\s+target resolution/,
  ])
    assert.match(cleanup, expectation);
  assert.doesNotMatch(
    cleanup,
    /Check every target, existing ancestor, and directory descendant for symlinks/,
  );
});

test("role guidance has one canonical owner with supported runtime settings", async () => {
  const source = await read("AGENTS.md");
  const setup = await read("docs/codex-setup.md");
  assert.match(
    setup,
    /\[.*?\]\(\.\.\/AGENTS\.md(?:#subagent-models-and-names)?\)/,
  );
  assert.match(source, /fork_turns: "none"/);
  assert.doesNotMatch(source, /fork_turns[^\n]*"4"/);
  assert.match(source, /schema before/);
  assert.match(source, /repository, relevant instruction paths/);
  assert.match(source, /bounded assignment, expected\s+result/);
  assert.match(source, /unavailable/);
  assert.match(source, /Do not silently substitute/);
});

test("canonical skills declare matching metadata and enable normal matching", async () => {
  for (const name of [
    "create-plan",
    "worktree-setup",
    "git-commit",
    "pull-request",
    "show-summary",
    "show-plan-progress",
    "manual-qa-checklist",
    "brainstorm",
  ]) {
    const skill = await read(`.agents/skills/${name}/SKILL.md`);
    const metadata = await read(`.agents/skills/${name}/agents/openai.yaml`);
    assert.ok(skill.startsWith(`---\nname: ${name}\n`));
    assert.ok(metadata.includes(`$${name}`));
    assert.doesNotMatch(metadata, /allow_implicit_invocation:\s*false/);
  }
});
