import assert from "node:assert/strict";
import { access, readdir, readFile } from "node:fs/promises";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

const workflowRoot = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  "../..",
);
const readSource = (relativePath) =>
  readFile(path.join(workflowRoot, relativePath), "utf8");
const normalize = (source) => source.replace(/\s+/g, " ");

const pathExists = async (relativePath) => {
  try {
    await access(path.join(workflowRoot, relativePath));
    return true;
  } catch {
    return false;
  }
};

const collectFiles = async (relativeDirectory, predicate) => {
  const files = [];
  for (const entry of await readdir(
    path.join(workflowRoot, relativeDirectory),
    {
      withFileTypes: true,
    },
  )) {
    const relativePath = path.posix.join(relativeDirectory, entry.name);
    if (entry.isDirectory()) {
      files.push(...(await collectFiles(relativePath, predicate)));
    } else if (predicate(relativePath)) {
      files.push(relativePath);
    }
  }
  return files.sort();
};

test("explicit stages retain intake, spec, plan, and execution boundaries", async () => {
  const [agents, selection, stages, createPlan, execute] = await Promise.all([
    readSource("AGENTS.md"),
    readSource("prompts/select-workflow.md"),
    readSource("instructions/shared/workflow-state.md"),
    readSource("prompts/create-plan.md"),
    readSource("prompts/execute-plan.md"),
  ]);

  assert.match(selection, /This invocation is read-only/);
  assert.match(stages, /Only an explicit user invocation starts a stage/);
  assert.match(stages, /LOW never executes from a conversational plan/);
  assert.match(agents, /A saved artifact never authorizes the next stage/);
  assert.match(createPlan, /Saving a plan does not implement it/);
  assert.match(execute, /Run only when the user explicitly invokes/);
  assert.doesNotMatch(
    stages,
    /P0|review round|risk decision|reviewer runtime/i,
  );
});

test("classification uses deterministic LOW and HIGH triggers with MEDIUM fallback", async () => {
  const selection = normalize(await readSource("prompts/select-workflow.md"));

  for (const trigger of [
    "multiple repositories",
    "migration or destructive behavior",
    "authentication, authorization, payment, secret",
    "external security boundary",
    "independently committed task workflows",
  ]) {
    assert.match(selection, new RegExp(trigger.replaceAll(" ", "\\s+"), "i"));
  }
  for (const lowRequirement of [
    "bounded",
    "understood",
    "contained in one repository",
    "no migration or destructive behavior",
    "no external integration",
    "no unresolved behavior decision",
  ]) {
    assert.match(selection, new RegExp(lowRequirement, "i"));
  }
  assert.match(selection, /Choose `MEDIUM` for everything else/);
  assert.match(selection, /Apply these rules in order/);
});

test("spec and flow artifact formats remain unchanged", async () => {
  const [spec, flowPrompt, flowInstruction] = await Promise.all([
    readSource("prompts/generate-spec.md"),
    readSource("prompts/generate-flow-artifacts.md"),
    readSource("instructions/shared/flow-trace-artifacts.md"),
  ]);

  assert.match(spec, /feature-spec@1 \| bugfix-spec@1/);
  assert.match(spec, /root-cause analysis is mandatory/i);
  for (const source of [flowPrompt, flowInstruction]) {
    assert.match(source, /user-journey@1/);
    assert.match(source, /implementation-map@1/);
  }
});

test("current plans use versioned structure and a required Plan name input", async () => {
  const [template, prompt, wrapper, workflow] = await Promise.all([
    readSource("templates/plan.template.md"),
    readSource("prompts/create-plan.md"),
    readSource("wrappers/create-plan.md"),
    readSource("instructions/shared/ai-workflow.md"),
  ]);

  for (const source of [template, prompt, workflow]) {
    assert.match(source, /plan-manifest@3/);
  }
  for (const source of [prompt, wrapper]) {
    assert.match(source, /Plan name: `?<kebab-case-name>`?/);
  }
  assert.match(prompt, /`Plan name` is required/);
  assert.match(template, /### Repository: <repository-id>/);
  assert.match(template, /Integration base/);
  assert.match(template, /Repository: `<exactly-one-repository-id>`/);
});

test("LOW plans are compact unless a named sensitive boundary triggers detail", async () => {
  const [template, createPlan] = await Promise.all([
    readSource("templates/plan.template.md"),
    readSource("prompts/create-plan.md"),
  ]);

  assert.match(createPlan, /Keep LOW plans compact/);
  assert.match(createPlan, /full sensitive-boundary detail only when/);
  assert.match(template, /Include this subsection only when/);
  assert.match(template, /### Sensitive Boundary Detail/);
  assert.match(template, /Sensitive-boundary trigger/);
  assert.match(template, /Targeted checks/);
  assert.match(template, /Root-cause families/);
  assert.match(template, /Adversarial matrix/);
  assert.match(template, /Mutation or property testing/);
});

test("review-strategy@2 owns all three deterministic budget selections", async () => {
  const [template, createPlan] = await Promise.all([
    readSource("templates/plan.template.md"),
    readSource("prompts/create-plan.md"),
  ]);
  const source = normalize(createPlan);

  assert.match(template, /Format: `review-strategy@2`/);
  assert.match(template, /Fresh rounds: <`1` \| `2` \| `3`/);
  assert.match(
    source,
    /`1` for single-repository MEDIUM work with no sensitive surface and no cross-boundary contract/,
  );
  assert.match(
    source,
    /`2` for every other MEDIUM plan and ordinary HIGH plan/,
  );
  assert.match(
    source,
    /`3` for HIGH work involving multiple repositories, authentication or authorization, payments, secrets, migrations, destructive behavior, or an external security boundary/,
  );
  assert.match(source, /LOW records `N\/A: LOW uses self-check`/);
});

test("review-changes is the singular review-loop authority", async () => {
  const review = await readSource("prompts/review-changes.md");
  const otherFiles = [
    "AGENTS.md",
    "README.md",
    ...(await collectFiles("docs", (file) => file.endsWith(".md"))),
    ...(await collectFiles("instructions", (file) => file.endsWith(".md"))),
    ...(await collectFiles(
      "prompts",
      (file) => file.endsWith(".md") && file !== "prompts/review-changes.md",
    )),
    ...(await collectFiles("templates", (file) => file.endsWith(".md"))),
    ...(await collectFiles("wrappers", (file) => file.endsWith(".md"))),
  ];
  const otherSource = (
    await Promise.all(otherFiles.map((file) => readSource(file)))
  ).join("\n");

  assert.match(review, /sole authority/);
  for (const uniqueProtocolText of [
    "REVIEW_ONE_MORE",
    "REVIEW_UNTIL_CLEAR",
    "ACCEPT_UNREVIEWED_REMEDIATION",
    "Awaiting risk decision",
    "Completed with accepted review risk",
    "Authoritative State Machine",
  ]) {
    assert.match(review, new RegExp(uniqueProtocolText));
    assert.doesNotMatch(otherSource, new RegExp(uniqueProtocolText));
  }
});

test("implementation-review@2 limits blocking findings to attributable scope", async () => {
  const review = normalize(await readSource("prompts/review-changes.md"));

  assert.match(review, /implementation-review@2/);
  assert.match(review, /defect introduced by the plan-owned diff/);
  assert.match(review, /direct violation of the request or finalized spec/);
  assert.match(review, /regression in a boundary changed by the plan/);
  assert.match(review, /unrelated pre-existing defect as advisory/);
  assert.match(review, /`P0`–`P2` are blocking and `P3` is advisory/);
});

test("review loop covers clear, budget exhaustion, and continuation authorization", async () => {
  const review = normalize(await readSource("prompts/review-changes.md"));

  assert.match(review, /A clear returned round sets `Ready to complete`/);
  assert.match(
    review,
    /blocking result consumed the last automatic round.*finish all known remediation.*rerun required validation.*set `Awaiting risk decision`/,
  );
  assert.match(
    review,
    /`REVIEW_ONE_MORE` authorizes exactly one additional fresh cumulative review/,
  );
  assert.match(
    review,
    /consumed only when that reviewer returns a complete report/,
  );
  assert.match(
    review,
    /runtime or evidence failure preserves the unconsumed authorization/,
  );
  assert.match(
    review,
    /`REVIEW_UNTIL_CLEAR` authorizes successive fresh cumulative reviews beyond the automatic budget/,
  );
  assert.match(
    review,
    /After each blocking report, remediate every known in-scope `P0`–`P2`.*rerun required validation.*automatically start the next fresh review/,
  );
  assert.match(
    review,
    /A clear report ends the authorization and sets `Ready to complete`/,
  );
  assert.match(
    review,
    /runtime, or evidence failure returns no round, preserves the authorization, and requires explicit resume/,
  );
  assert.match(
    review,
    /session interruption also preserves the recorded authorization for explicit resume without another risk-decision token/,
  );
  assert.match(
    review,
    /never expands implementation scope or authorizes delivery, pushing, or a pull request/,
  );
});

test("risk acceptance requires fixed findings and passing validation", async () => {
  const review = normalize(await readSource("prompts/review-changes.md"));

  assert.match(
    review,
    /`ACCEPT_UNREVIEWED_REMEDIATION` sets `Completed with accepted review risk` only when all known `P0`–`P2` are fixed, required validation passes/,
  );
  assert.match(review, /latest remediation was not independently re-reviewed/);
  assert.match(
    review,
    /status is forbidden while any known `P0`–`P2` is unresolved or required validation fails/,
  );
});

test("review stops repeated root causes and rejects invalid or stale tokens", async () => {
  const review = normalize(await readSource("prompts/review-changes.md"));

  assert.match(
    review,
    /one root-cause family remains blocking in two fresh rounds/,
  );
  assert.match(
    review,
    /return to planning for the saved architectural fallback/,
  );
  assert.match(review, /Stop incremental fixes/);
  assert.match(
    review,
    /repeated-family fallback and every other mandatory `Blocked` condition still stop the loop/,
  );
  assert.match(
    review,
    /Invalid, stale, duplicate, combined, or out-of-context tokens/,
  );
  assert.match(
    review,
    /change no state, start no reviewer, and complete nothing/,
  );
  assert.match(
    review,
    /Use `Fix required` for incomplete remediation or failed required validation/,
  );
});

test("review round evidence is monotonically increasing", async () => {
  const [review, checkpoint, resume] = await Promise.all([
    readSource("prompts/review-changes.md"),
    readSource("prompts/goal-checkpoint.md"),
    readSource("prompts/resume-goal.md"),
  ]);

  assert.match(review, /positive and strictly increasing/);
  assert.match(
    review,
    /duplicate, decreasing, or reset round evidence is `Blocked`/,
  );
  assert.match(checkpoint, /positive and strictly increase/);
  assert.match(resume, /positive, strictly increasing/);
});

test("goal-handoff@2 stores exact portable evidence without copied protocols", async () => {
  const checkpoint = await readSource("prompts/goal-checkpoint.md");
  const schema = checkpoint.split("## Required Handoff Content")[1];

  assert.match(checkpoint, /goal-handoff@2/);
  for (const section of [
    "Exact Goal",
    "Linked Artifacts",
    "Repository State",
    "Task and Commit Records",
    "Validation Evidence",
    "Review State",
    "Blockers",
    "Next Action",
  ]) {
    assert.match(schema, new RegExp(`## ${section}`));
  }
  assert.doesNotMatch(schema, /Process planned tasks serially/);
  assert.doesNotMatch(schema, /Create exactly one local conventional commit/);
  assert.doesNotMatch(schema, /Authoritative State Machine/);
  assert.match(
    normalize(checkpoint),
    /never embeds the review state machine or HIGH commit rules/,
  );
});

test("HIGH retains task-scoped validation, review, and commit safeguards", async () => {
  const checkpoint = normalize(await readSource("prompts/goal-checkpoint.md"));

  assert.match(checkpoint, /Process planned tasks serially/);
  assert.match(checkpoint, /Run the task's exact validation/);
  assert.match(checkpoint, /review its actual diff/);
  assert.match(checkpoint, /Stage only task-owned changes/);
  assert.match(checkpoint, /Create exactly one local conventional commit/);
  assert.match(
    checkpoint,
    /one local conventional remediation commit per changed repository/,
  );
  assert.match(checkpoint, /Do not copy final-review transitions/);
});

test("legacy artifacts are rejected precisely without migration or deletion", async () => {
  const requiredFiles = [
    "prompts/create-plan.md",
    "prompts/execute-plan.md",
    "prompts/review-changes.md",
    "prompts/goal-checkpoint.md",
    "prompts/resume-goal.md",
    "prompts/prepare-worktree.md",
  ];
  const exactResponse =
    /Legacy workflow artifact: <path> uses <format>; replan using the current contract before execution or resume\./;

  for (const file of requiredFiles) {
    const source = normalize(await readSource(file));
    assert.match(source, exactResponse, file);
    assert.match(
      source,
      /Do not migrate, overwrite, or delete|Never migrate, overwrite, or delete/i,
      file,
    );
  }
  assert.match(
    await readSource("prompts/prepare-worktree.md"),
    /same `plan-manifest@3`/,
  );
});

test("corrective-deviation criteria have one owner", async () => {
  const agents = await readSource("AGENTS.md");
  const otherFiles = [
    ...(await collectFiles("instructions", (file) => file.endsWith(".md"))),
    ...(await collectFiles("prompts", (file) => file.endsWith(".md"))),
    ...(await collectFiles("templates", (file) => file.endsWith(".md"))),
  ];
  const otherSource = (
    await Promise.all(otherFiles.map((file) => readSource(file)))
  ).join("\n");

  assert.match(agents, /## Corrective-Deviation Decision/);
  assert.match(agents, /\| Corrective deviation\s+\|/);
  assert.match(agents, /\| Material discovery\s+\|/);
  assert.match(
    agents,
    /restores behavior already required by the finalized spec/,
  );
  assert.doesNotMatch(
    otherSource,
    /restores behavior already required by the finalized spec/,
  );
  assert.doesNotMatch(
    otherSource,
    /introduces no new user-visible behavior or unresolved decision/,
  );
});

test("every shared instruction has an explicit route or direct prompt owner", async () => {
  const sharedFiles = await collectFiles("instructions/shared", (file) =>
    file.endsWith(".md"),
  );
  const consumers = [
    await readSource("instructions/index.md"),
    ...(await Promise.all(
      (await collectFiles("prompts", (file) => file.endsWith(".md"))).map(
        (file) => readSource(file),
      ),
    )),
    await readSource("instructions/shared/ai-workflow.md"),
  ].join("\n");

  for (const file of sharedFiles) {
    const name = path.posix.basename(file);
    assert.match(consumers, new RegExp(name.replace(".", "\\.")), name);
  }
  const index = await readSource("instructions/index.md");
  for (const explicitRoute of [
    "shared/security-observability.md",
    "shared/performance-observability.md",
    "shared/delivery-hygiene.md",
  ]) {
    assert.match(index, new RegExp(explicitRoute.replace(".", "\\.")));
  }
});

test("repository docs support Git parents and unversioned coordination roots", async () => {
  const [agents, readme, createPlan, prepare] = await Promise.all([
    readSource("AGENTS.md"),
    readSource("README.md"),
    readSource("prompts/create-plan.md"),
    readSource("prompts/prepare-worktree.md"),
  ]);

  for (const source of [agents, readme, createPlan, prepare]) {
    const normalizedSource = normalize(source);
    assert.match(normalizedSource, /Git parent checkout/i);
    assert.match(normalizedSource, /unversioned.*coordination root/i);
  }
});

test("HIGH response and resume preserve exact explicit goal invocation", async () => {
  const [createPlan, resume] = await Promise.all([
    readSource("prompts/create-plan.md"),
    readSource("prompts/resume-goal.md"),
  ]);
  const highResponse = createPlan.split("HIGH returns exactly:")[1];

  assert.match(
    highResponse,
    /```text\n\/goal <finalized spec `## Goal` text verbatim>\n\nplan: \.ai\/plans\/<plan-name>\.md\n```/,
  );
  assert.match(
    resume,
    /Return the handoff's exact `## Next Action` without invoking it/,
  );
});

test("wrappers remain thin input adapters", async () => {
  const wrapperFiles = (
    await collectFiles("wrappers", (file) => file.endsWith(".md"))
  ).filter((file) => file !== "wrappers/README.md");

  for (const wrapperFile of wrapperFiles) {
    const source = await readSource(wrapperFile);
    const nonEmptyLines = source
      .split("\n")
      .filter((line) => line.trim()).length;
    assert.match(source, /Use `.ai\/prompts\//, wrapperFile);
    assert.ok(nonEmptyLines <= 10, `${wrapperFile} duplicates prompt behavior`);
    assert.doesNotMatch(
      source,
      /## (Rules|Validation|Final Response|Document Format)/,
    );
  }
});

test("workflow sources load AGENTS directly and omit retired state concepts", async () => {
  const promptFiles = [
    "prompts/select-workflow.md",
    "prompts/generate-spec.md",
    "prompts/generate-flow-artifacts.md",
    "prompts/create-plan.md",
    "prompts/execute-plan.md",
    "prompts/review-changes.md",
    "prompts/goal-checkpoint.md",
    "prompts/resume-goal.md",
    "prompts/create-pull-request.md",
  ];
  for (const promptFile of promptFiles) {
    assert.match(await readSource(promptFile), /\.ai\/AGENTS\.md/, promptFile);
  }

  const activeFiles = [
    "AGENTS.md",
    "README.md",
    ...(await collectFiles("instructions/shared", (file) =>
      file.endsWith(".md"),
    )),
    ...(await collectFiles("prompts", (file) => file.endsWith(".md"))),
    ...(await collectFiles("templates", (file) => file.endsWith(".md"))),
    ...(await collectFiles("wrappers", (file) => file.endsWith(".md"))),
  ];
  const source = (
    await Promise.all(activeFiles.map((file) => readSource(file)))
  ).join("\n");
  assert.doesNotMatch(
    source,
    /runner-managed|workflowState|sync-plan-artifacts/,
  );
  assert.doesNotMatch(source, /approved (spec|plan|objective|state)/i);
});

test("retired workflow paths remain absent", async () => {
  for (const retiredPath of [
    "changelogs",
    "instructions/ai-workflow.md",
    "prompts/manual-preview.md",
    "prompts/plan-validator.md",
    "scripts/workflow/runner",
  ]) {
    assert.equal(await pathExists(retiredPath), false, retiredPath);
  }
});

test("pull request creation remains explicit and delivery-owned", async () => {
  const [prompt, workflow] = await Promise.all([
    readSource("prompts/create-pull-request.md"),
    readSource("instructions/shared/ai-workflow.md"),
  ]);
  assert.match(prompt, /Wait for explicit approval before pushing or creating/);
  assert.match(prompt, /\.ai\/instructions\/shared\/delivery-hygiene\.md/);
  assert.match(workflow, /optional, explicitly invoked pull/);
});

test("private package pins the self-contained toolchain", async () => {
  const packageJson = JSON.parse(await readSource("package.json"));
  assert.equal(packageJson.private, true);
  assert.equal(packageJson.engines.node, ">=20.20.2");
  assert.equal(packageJson.packageManager, "pnpm@10.34.4");
  assert.equal(packageJson.devDependencies.prettier, "3.9.6");
  assert.equal(packageJson.devDependencies.tsx, "4.23.12");
});
