import assert from "node:assert/strict";
import { existsSync } from "node:fs";
import { readFile } from "node:fs/promises";
import { join } from "node:path";
import test from "node:test";

import {
  estimateBossSummaryPercent,
  validateTaskCommitBoundaries,
} from "../runner.ts";
import { planWithTaskSavepoints } from "./__tests__/helpers/runner-plan.ts";

const readWorkflowPrompt = (name: string) =>
  readFile(join(process.cwd(), ".ai", "prompts", name), "utf8");
const readWorkflowWrapper = (name: string) =>
  readFile(join(process.cwd(), ".ai", "wrappers", name), "utf8");
const readInstruction = (name: string) =>
  readFile(join(process.cwd(), ".ai", "instructions", name), "utf8");
const readPlanTemplate = () =>
  readFile(join(process.cwd(), ".ai", "templates", "plan.template.md"), "utf8");
const readWorkflowRunnerSource = (name: string) =>
  readFile(
    join(process.cwd(), ".ai", "scripts", "workflow", "runner", name),
    "utf8",
  );

const compactEvidencePromptNames = [
  "execute-plan.md",
  "review-changes.md",
  "plan-validator.md",
] as const;

const assertPromptContract = (
  promptName: string,
  prompt: string,
  pattern: RegExp,
  concept: string,
) => {
  assert.ok(pattern.test(prompt), `${promptName} missing ${concept}`);
};

test("workflow prompts define compact evidence and forbid raw event artifact bodies", async () => {
  for (const promptName of compactEvidencePromptNames) {
    const prompt = await readWorkflowPrompt(promptName);

    assertPromptContract(
      promptName,
      prompt,
      /compact evidence/i,
      "compact evidence guidance",
    );
    assertPromptContract(promptName, prompt, /\bcommand\b/i, "command concept");
    assertPromptContract(promptName, prompt, /\bresult\b/i, "result concept");
    assertPromptContract(
      promptName,
      prompt,
      /short excerpt/i,
      "short excerpt concept",
    );
    assertPromptContract(
      promptName,
      prompt,
      /evidence path/i,
      "evidence path concept",
    );
    assertPromptContract(
      promptName,
      prompt,
      /\b(risk|deferred validation)\b/i,
      "risk or deferred validation concept",
    );
    assertPromptContract(
      promptName,
      prompt,
      /(?:forbid|discourage|do not|must not)[\s\S]{0,160}full raw stdout\/stderr bodies/i,
      "full raw stdout/stderr body prohibition",
    );
    assertPromptContract(
      promptName,
      prompt,
      /(?:forbid|discourage|do not|must not)[\s\S]{0,160}full raw diffs/i,
      "full raw diff prohibition",
    );
    assertPromptContract(
      promptName,
      prompt,
      /(?:forbid|discourage|do not|must not)[\s\S]{0,160}raw Codex event streams/i,
      "raw Codex event stream prohibition",
    );
    assertPromptContract(
      promptName,
      prompt,
      /event artifacts?[\s\S]{0,240}(?:full raw stdout\/stderr bodies|full raw diffs|raw Codex event streams)/i,
      "event artifact raw body prohibition",
    );
  }
});

test("generate-user-flow prompt defines the user-journey artifact contract", async () => {
  const prompt = await readWorkflowPrompt("generate-user-flow.md");
  const wrapper = await readWorkflowWrapper("generate-user-flow.md");

  assert.match(prompt, /\.ai\/artifacts\/<plan-name>\/user-journey\.md/);
  assert.match(prompt, /approved spec/i);
  assert.match(prompt, /codebase inspection/i);
  assert.match(prompt, /must not invent desired behavior beyond the spec/i);
  assert.match(prompt, /Markdown \+ Mermaid only/i);
  for (const section of [
    "Goal",
    "Actors",
    "Entry Points",
    "User Flows",
    "Mermaid Diagram",
    "States",
    "Failures",
    "Acceptance Scenarios",
    "Open Decisions",
  ]) {
    assert.match(prompt, new RegExp(`## ${section}`));
  }
  assert.match(wrapper, /Use: \.ai\/prompts\/generate-user-flow\.md/);
  assert.match(wrapper, /Spec file:/);
  assert.match(wrapper, /Output artifact:/);
});

test("create-plan prompt gates flow artifacts and records N/A when end-to-end mapping is unnecessary", async () => {
  const prompt = await readWorkflowPrompt("create-plan.md");
  const instructions = await readInstruction("shared/flow-trace-artifacts.md");

  assert.match(prompt, /\.ai\/instructions\/shared\/flow-trace-artifacts\.md/);
  assert.match(
    instructions,
    /flow-trace artifacts are required only when the scope needs end-to-end flow\s+mapping/i,
  );
  assert.match(instructions, /\.ai\/artifacts\/<plan-name>\/user-journey\.md/);
  assert.match(
    instructions,
    /create or regenerate `?user-journey\.md`? by applying[\s\S]*`?\.ai\/prompts\/generate-user-flow\.md`?/i,
  );
  assert.match(
    instructions,
    /missing, stale,[\s\S]*inconsistent with the spec/i,
  );
  assert.match(
    instructions,
    /read the validated user journey before phase planning/i,
  );
  assert.match(instructions, /When flow-trace artifacts are not required/i);
  assert.match(instructions, /exactly\s+`N\/A:/i);
  assert.match(instructions, /end-to-end flow mapping is unnecessary/i);
});

test("create-plan prompt completes implementation-map preflight before finalizing plan phases", async () => {
  const prompt = await readWorkflowPrompt("create-plan.md");
  const instructions = await readInstruction("shared/flow-trace-artifacts.md");

  assert.match(prompt, /run the create-plan preflight from/i);
  assert.match(
    instructions,
    /During plan creation, and during any draft preflight/i,
  );
  assert.match(instructions, /1\.\s+derive the plan name from the spec path/i);
  assert.match(
    instructions,
    /2\.\s+classify the scope using this instruction/i,
  );
  assert.match(
    instructions,
    /create or regenerate `?user-journey\.md`? by applying[\s\S]*`?\.ai\/prompts\/generate-user-flow\.md`?/i,
  );
  assert.match(instructions, /derive or repair `?implementation-map\.md`?/i);
  assert.match(
    instructions,
    /5\.\s+before returning a draft plan, apply the complete atomic task and commit\s+contract/i,
  );
  assert.match(
    instructions,
    /each mapped user action must include applicable coverage/i,
  );
});

test("create-plan prompt self-checks savepoints and spec behavior ownership before returning", async () => {
  const [instructions, flowInstructions] = await Promise.all([
    readWorkflowPrompt("create-plan.md"),
    readInstruction("shared/flow-trace-artifacts.md"),
  ]);

  assert.match(instructions, /Task Savepoints/);
  assert.match(instructions, /\[task:NN-readable-words\]/);
  assert.match(
    instructions,
    /independently implementable\s+and validatable/i,
  );
  assert.match(instructions, /- Behavior: <one exact outcome>/);
  assert.match(instructions, /- Validation: <exact runnable commands>/);
  assert.match(
    instructions,
    /- Completes: <exact acceptance-criterion text>/,
  );
  assert.match(
    flowInstructions,
    /each mapped user action must include applicable coverage/i,
  );
});

test("create-plan prompt auto-corrects preflight defects and STOPs only when unresolved", async () => {
  const instructions = await readInstruction("shared/flow-trace-artifacts.md");

  assert.match(instructions, /auto-correct/i);
  assert.match(instructions, /task-contract defects/i);
  assert.match(
    instructions,
    /stop only when the preflight still cannot satisfy these rules/i,
  );
});

test("create-plan prompt defines manual and runner-managed execution modes", async () => {
  const prompt = await readWorkflowPrompt("create-plan.md");
  const wrapper = await readWorkflowWrapper("create-plan.md");

  assert.match(prompt, /## Execution Mode \(MANDATORY\)/);
  assert.match(prompt, /`manual`/);
  assert.match(prompt, /`runner-managed`/);
  assert.match(prompt, /If the operator does not explicitly specify a mode:/i);
  assert.match(
    prompt,
    /Which execution mode should create-plan use: manual or runner-managed\?/i,
  );
  assert.match(wrapper, /Execution mode:/i);
  assert.match(wrapper, /`manual` or `runner-managed`/);
  assert.doesNotMatch(wrapper, /Default when omitted:\s*`manual`/i);
});

test("workflow selector defines all four classifications and exact next paths", async () => {
  const [prompt, wrapper, workflowReadme, wrappersReadme] = await Promise.all([
    readWorkflowPrompt("select-workflow.md"),
    readWorkflowWrapper("select-workflow.md"),
    readFile(new URL("../../../README.md", import.meta.url), "utf8"),
    readWorkflowWrapper("README.md"),
  ]);

  for (const content of [prompt, workflowReadme, wrappersReadme]) {
    assert.match(content, /`LOW`/);
    assert.match(content, /`MEDIUM`/);
    assert.match(content, /`HIGH-GOAL`/);
    assert.match(content, /`HIGH-RUNNER`/);
  }

  assert.match(prompt, /analysis-only/i);
  assert.match(prompt, /Do not create, modify, or delete files/i);
  assert.match(prompt, /Simple session-local `\/plan`/i);
  assert.match(prompt, /Spec \+ manual plan/i);
  assert.match(prompt, /Codex `\/goal` path/i);
  assert.match(prompt, /Runner-managed path/i);
  assert.match(
    prompt,
    /\| `LOW` \| Simple session-local `\/plan` \| Start `\/plan` in this session; create no durable workflow artifacts\. \|/,
  );
  assert.match(
    prompt,
    /\| `MEDIUM` \| Spec \+ manual plan \| Create a spec, then use `create-plan` with `Execution mode: manual`\. \|/,
  );
  assert.match(
    prompt,
    /\| `HIGH-GOAL` \| Codex `\/goal` path \| Start `\/goal` with the approved objective and a stable kebab-case goal name\. \|/,
  );
  assert.match(
    prompt,
    /\| `HIGH-RUNNER` \| Runner-managed path \| Create a spec, use `create-plan` with `Execution mode: runner-managed`, complete review and approval, then invoke the runner\. \|/,
  );
  assert.match(prompt, /operator must explicitly choose `HIGH-GOAL` or\s+`HIGH-RUNNER`/i);
  assert.match(prompt, /do not choose or override/i);
  assert.match(prompt, /Next action:/);
  assert.match(wrapper, /Use: `\.ai\/prompts\/select-workflow\.md`/);
});

test("manual plans keep portable handoffs at the artifact root and load them", async () => {
  const [createPrompt, template, executePrompt, handoffPrompt, handoffWrapper] =
    await Promise.all([
      readWorkflowPrompt("create-plan.md"),
      readPlanTemplate(),
      readWorkflowPrompt("manual-execute-plan.md"),
      readWorkflowPrompt("manual-handoff.md"),
      readWorkflowWrapper("manual-handoff.md"),
    ]);

  for (const content of [createPrompt, template, executePrompt, handoffPrompt]) {
    assert.match(content, /\.ai\/artifacts\/<plan-name>\/manual-handoff\.md/);
  }
  assert.match(createPrompt, /do not place it under `state\/` or `events\/`/i);
  assert.match(executePrompt, /When `manual-handoff\.md` exists, read it before implementation/i);
  assert.match(executePrompt, /spec, plan, and current Git state remain\s+authoritative/i);
  assert.match(executePrompt, /Before pausing[\s\S]*switching agent or\s+provider/i);
  assert.match(handoffPrompt, /Create or refresh only\s+`\.ai\/artifacts\/<plan-name>\/manual-handoff\.md`/i);
  assert.match(createPrompt, /Initialize it with the `manual-handoff` structure/i);
  assert.match(handoffWrapper, /before pausing manual plan work/i);
});

test("HIGH-GOAL checkpoints and resume stay portable and never write runner state", async () => {
  const [checkpoint, resume, checkpointWrapper, resumeWrapper] = await Promise.all([
    readWorkflowPrompt("goal-checkpoint.md"),
    readWorkflowPrompt("resume-goal.md"),
    readWorkflowWrapper("goal-checkpoint.md"),
    readWorkflowWrapper("resume-goal.md"),
  ]);

  for (const content of [checkpoint, resume]) {
    assert.match(content, /\.ai\/artifacts\/<goal-name>\/goal-handoff\.md/);
    assert.match(content, /runner state/i);
    assert.match(content, /Do not invoke the workflow runner/i);
  }
  assert.match(checkpoint, /checkpoint-only/i);
  assert.match(checkpoint, /before `\/goal pause`, ending a session, or\s+switching provider or account/i);
  assert.match(checkpoint, /stable kebab-case identifier/i);
  for (const section of [
    "Exact Goal",
    "Repository State",
    "Verified Progress",
    "Decisions",
    "Blockers",
    "Next Action",
  ]) {
    assert.match(checkpoint, new RegExp(`## ${section}`));
  }
  assert.match(checkpoint, /Never copy secrets, raw diffs, or full command output/i);
  assert.match(resume, /In Codex, restore the saved objective with `\/goal <exact goal>`/i);
  assert.match(resume, /another provider/i);
  assert.match(checkpointWrapper, /Goal name:/);
  assert.match(resumeWrapper, /Other providers use the same artifact/i);
});

test("create-plan hard-stops on protected branches before planning", async () => {
  const [prompt, wrapper] = await Promise.all([
    readWorkflowPrompt("create-plan.md"),
    readWorkflowWrapper("create-plan.md"),
  ]);

  for (const branch of ["main", "master", "dev", "development", "staging"]) {
    assert.match(prompt, new RegExp("`" + branch + "`"));
    assert.match(wrapper, new RegExp("`" + branch + "`"));
  }
  assert.match(
    prompt,
    /Before resolving execution mode, reading the spec, or creating or modifying any\s+file/i,
  );
  assert.match(prompt, /git rev-parse --abbrev-ref HEAD/);
  assert.match(prompt, /plan creation blocked on protected branch <branch>/i);
  assert.match(wrapper, /Before resolving execution mode or reading any planning input/i);
});

test("runner-managed workflow requires independent review before invocation", async () => {
  const reviewWrapper = await readWorkflowWrapper("review-high-risk-plan.md");
  const wrappersReadme = await readWorkflowWrapper("README.md");
  const workflowReadme = await readFile(
    new URL("../../../README.md", import.meta.url),
    "utf8",
  );
  const operatorGuide = await readFile(
    new URL("../../../docs/operator-gated-workflow.md", import.meta.url),
    "utf8",
  );

  for (const content of [
    reviewWrapper,
    wrappersReadme,
    workflowReadme,
    operatorGuide,
  ]) {
    assert.match(content, /(?:review every|every).*`?runner-managed`? plan/i);
    assert.match(content, /fresh (?:Plan Mode|analysis-only|independent)/i);
    assert.match(content, /`OKAY`/);
    assert.match(content, /`APPROVE IMPLEMENTATION`/);
  }
});

test("create-plan uses sync-plan-artifacts only for runner-managed plans", async () => {
  const prompt = await readWorkflowPrompt("create-plan.md");
  const template = await readPlanTemplate();
  const wrapper = await readWorkflowWrapper("create-plan.md");

  assert.match(
    template,
    /## Workflow State\s*\n\s*draft-artifact-sync/,
  );
  assert.match(
    prompt,
    /For `runner-managed` plans, new draft plans MUST start at/i,
  );
  assert.match(prompt, /workflowState\s*=\s*draft-artifact-sync/i);
  assert.match(
    prompt,
    /"planPath": "\.ai\/plans\/<plan-name>\.md"[\s\S]*"workflowState": "draft-artifact-sync"[\s\S]*"latest": \{\}[\s\S]*"history": \[\][\s\S]*"unresolvedBlockers": \[\][\s\S]*"updatedAt": "<ISO timestamp>"/,
  );
  assert.match(prompt, /sidecar containing only\s+`workflowState` is incomplete/i);
  assert.match(
    prompt,
    /For `manual` plans, set `## Workflow State` to\s+`N\/A: manual plan-bound execution`/i,
  );
  assert.match(wrapper, /sync-plan-artifacts/i);
  assert.match(
    wrapper,
    /If execution mode is `runner-managed`, the workflow runner performs the\s+`sync-plan-artifacts` stage before validation/i,
  );
});

test("plan template requires artifact pointers for implementation map and state files", async () => {
  const template = await readPlanTemplate();

  assert.match(template, /thin-plan/);
  assert.match(template, /## Execution Mode/);
  assert.match(template, /## Artifacts/);
  assert.match(template, /\.ai\/artifacts\/<plan-name>\/user-journey\.md/);
  assert.match(
    template,
    /\.ai\/artifacts\/<plan-name>\/implementation-map\.md` or `N\/A: <concrete reason>/,
  );
  assert.match(
    template,
    /\.ai\/artifacts\/<plan-name>\/state\/workflow\.json` or `N\/A: manual plan-bound execution/,
  );
  assert.match(
    template,
    /\.ai\/artifacts\/<plan-name>\/state\/file-ownership\.json` or `N\/A: manual plan-bound execution/,
  );
  assert.match(template, /\.ai\/artifacts\/<plan-name>\/state\/files\.json/);
  assert.match(template, /N\/A: <concrete reason>/);
  assert.match(template, /## Phases/);
  assert.match(template, /### Preparation/);
  assert.match(template, /### Implementation/);
  assert.match(template, /### Validation/);
  assert.match(template, /## Commit Boundaries/);
  assert.match(template, /Each task savepoint produces one local commit/);
  assert.match(template, /tests/i);
});

test("plan creation and validation define atomic runner task savepoints", async () => {
  const prompt = await readWorkflowPrompt("create-plan.md");
  const template = await readPlanTemplate();
  const validator = await readWorkflowPrompt("plan-validator.md");
  const workflowInstructions = await readInstruction("ai-workflow.md");
  const flowInstructions = await readInstruction(
    "shared/flow-trace-artifacts.md",
  );

  for (const content of [prompt, validator, workflowInstructions]) {
    assert.match(content, /\[task:(?:NN|01)-readable-words\]/);
    assert.match(content, /independently implementable\s+and validatable/i);
    assert.match(content, /distinct reason(?:s)? to review or revert/i);
    assert.match(content, /do not split tasks only by lifecycle\s+phase/i);
    assert.match(content, /implementation-only/i);
    assert.match(content, /validation-only/i);
    assert.match(content, /tiny checklist/i);
    assert.match(content, /no\s+fixed (?:savepoint|task) count/i);
    assert.doesNotMatch(content, /3-5 meaningful savepoints/i);
    for (const field of [
      "Behavior",
      "Files",
      "Validation",
      "Depends on",
      "Completes",
      "Coupling rationale",
      "Size warning",
      "Atomization warning",
    ]) {
      assert.match(content, new RegExp(`- ${field}:`));
    }
  }

  for (const content of [prompt, validator, workflowInstructions, template]) {
    assert.match(content, /maximum 50 characters/i);
    assert.match(content, /More than 8 commit paths/);
    assert.match(content, /None — prerequisite for <later task ID>/);
  }

  for (const content of [prompt, validator, workflowInstructions]) {
    assert.match(content, /Commit Boundaries/);
    assert.match(content, /two to twelve/i);
    assert.match(content, /exactly one\s+boundary/i);
    assert.match(content, /focused tests/i);
  }

  for (const content of [prompt, validator, workflowInstructions]) {
    assert.match(content, /only earlier task IDs/i);
    assert.match(content, /must not create a cycle/i);
    assert.match(content, /each acceptance criterion/i);
    assert.match(content, /exactly one task/i);
    assert.match(content, /one atomic outcome/i);
    assert.match(content, /omit.*\[task:/is);
    assert.match(content, /manual.*not.*required/is);
    assert.match(content, /active.*review.*blocked.*completed/is);
    assert.match(content, /shared source, test, migration, or generated paths/i);
    assert.match(content, /resolved concrete commit\s+path/i);
    assert.match(content, /paths marked `\(assumed\)` still count/i);
    assert.match(
      content,
      /Preparation and final aggregate validation MUST remain untagged/i,
    );
  }

  assert.match(validator, /old draft's long single-line task/i);
  assert.match(validator, /convert[\s\S]*structured fields/i);
  assert.match(workflowInstructions, /new or\s+`draft` runner-managed plans/i);
  assert.match(flowInstructions, /one bounded repair pass/i);
  assert.match(flowInstructions, /Atomization warning/i);
  assert.match(flowInstructions, /normal operator approval/i);
  assert.match(template, /^## Phases$/m);
});

test("whop pro trial plan keeps simple bugfix work in one final-commit task", async (t) => {
  const planPath = join(
    process.cwd(),
    ".ai",
    "plans",
    "whop-pro-trial-sandbox-checkout-error.md",
  );
  if (!existsSync(planPath)) {
    t.skip("local ignored plan fixture is not present");
    return;
  }

  const plan = await readFile(planPath, "utf8");

  assert.doesNotMatch(plan, /\[task:\d{2}-/);
  assert.match(plan, /staged web regression tests/i);
  assert.match(plan, /backend regression tests/i);
  assert.match(plan, /implementation/i);
  assert.match(plan, /validation/i);
  assert.match(plan, /final-commit/i);
});

test("workflow prompts define task savepoint execution, review, commit, and aggregate rules", async () => {
  const executePrompt = await readWorkflowPrompt("execute-plan.md");
  const reviewPrompt = await readWorkflowPrompt("review-changes.md");
  const commitPrompt = await readWorkflowPrompt("commit-summary.md");

  assert.match(executePrompt, /Task Savepoint Mode/);
  assert.match(executePrompt, /implement ONLY that task ID/);
  assert.match(executePrompt, /do not start the next `\[task:\.\.\.\]` item/);
  assert.match(reviewPrompt, /review ONLY the staged diff for that task ID/);
  assert.match(reviewPrompt, /if review fails, do not commit/i);
  assert.match(commitPrompt, /Task savepoint aggregate summary/);
  assert.match(commitPrompt, /do NOT create a git commit/i);
  assert.match(commitPrompt, /Task artifact path/);
  assert.match(commitPrompt, /## Commit Boundaries/);
  assert.match(commitPrompt, /one commit per boundary/i);
  assert.match(commitPrompt, /invalid commit boundaries/i);
});

test("commit boundaries cover each dirty task path exactly once", () => {
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
    planOwnedDirtyPaths: [
      "src/backend/contracts/dispatch.ts",
      "src/unassigned-worker.ts",
    ],
  });
  assert.equal(invalid.ok, false);
  assert.match(
    invalid.ok ? "" : invalid.reason,
    /invalid commit boundaries.*unassigned plan-owned paths.*src\/unassigned-worker\.ts/i,
  );
});

test("execute-plan allows narrow compatibility fixes for current-task contract changes", async () => {
  const executePrompt = await readWorkflowPrompt("execute-plan.md");

  assert.match(executePrompt, /Compatibility Regression Carve-Out/);
  assert.match(executePrompt, /changes a shared contract/i);
  assert.match(executePrompt, /existing\s+call site from a later task/i);
  assert.match(executePrompt, /smallest compatibility path/i);
  assert.match(
    executePrompt,
    /do not implement the later task's full feature/i,
  );
  assert.match(
    executePrompt,
    /missing backend RPC, migration, generated\s+database type, database regression test, or compatibility call-site repair/i,
  );
  assert.match(executePrompt, /access\/security invariant/i);
  assert.match(
    executePrompt,
    /add the exact\s+file to both artifacts and continue/i,
  );
  assert.match(
    executePrompt,
    /do not output `STOP` solely because the minimal compatibility edit touches a\s+file named in a later `\[task:\.\.\.\]` item/i,
  );
  assert.match(
    executePrompt,
    /do not output `STOP` solely because the required minimal backend contract\s+repair touches a migration, generated database contract file, or database\s+test outside the original current-task file list/i,
  );
});

test("progress-update prompt updates the boss summary artifact", async () => {
  const prompt = await readFile(".ai/prompts/progress-update.md", "utf8");

  assert.match(prompt, /\.ai\/artifacts\/<plan-name>\/boss-summary\.md/);
  assert.match(prompt, /update/i);
  assert.match(prompt, /single persisted/i);
  assert.match(prompt, /Commit <short_sha>/);
});

test("boss summary percent uses review range when all savepoints are committed", () => {
  const percent = estimateBossSummaryPercent({
    tasks: [{ id: "01-db" }, { id: "02-ui" }] as never,
    completedTasks: [{}, {}] as never,
    finalStatus: "in-progress",
  });

  assert.equal(percent, 92);
});

test("plan-validator prompt fails user-facing flow steps without implementation and validation coverage", async () => {
  const prompt = await readWorkflowPrompt("plan-validator.md");
  const instructions = await readInstruction("shared/flow-trace-artifacts.md");

  assert.match(prompt, /\.ai\/instructions\/shared\/flow-trace-artifacts\.md/);
  assert.match(prompt, /implementation-map\.md/i);
  assert.match(
    prompt,
    /source of truth for whether flow\s+artifacts are required/i,
  );
  assert.match(instructions, /each mapped user action/i);
  assert.match(instructions, /implementation coverage/i);
  assert.match(instructions, /validation coverage/i);
  assert.match(prompt, /mark as CRITICAL/i);
});

test("workflow docs expose spec to user-journey artifact to plan to runner flow", async () => {
  const readme = await readFile(
    join(process.cwd(), ".ai", "README.md"),
    "utf8",
  );
  const wrappersReadme = await readWorkflowWrapper("README.md");

  assert.match(
    readme,
    /spec -> optional user-journey artifact -> plan -> \(manual execute \| sync artifacts -> validator\/runner\)/i,
  );
  assert.match(
    wrappersReadme,
    /spec -> optional user-journey artifact -> plan -> \(manual execute \| sync artifacts -> validator\/runner\)/i,
  );
  assert.match(readme, /\.ai\/wrappers\/generate-user-flow\.md/);
  assert.match(wrappersReadme, /\.ai\/wrappers\/generate-user-flow\.md/);
});

test("workflow-state docs include the sync-plan-artifacts draft loop", async () => {
  const workflowState = await readInstruction("shared/workflow-state.md");
  const aiWorkflow = await readInstruction("ai-workflow.md");

  assert.match(workflowState, /sync-plan-artifacts/);
  assert.match(workflowState, /draft-artifact-sync/i);
  assert.match(workflowState, /Canonical State Matrix/i);
  assert.match(workflowState, /draft-validation/i);
  assert.match(aiWorkflow, /sync-plan-artifacts/);
  assert.match(aiWorkflow, /post-plan\/pre-validator sync/i);
});

test("workflow docs describe create-plan preflighting implementation maps, savepoints, and behavior ownership", async () => {
  const wrapper = await readWorkflowWrapper("create-plan.md");
  const readme = await readFile(
    join(process.cwd(), ".ai", "README.md"),
    "utf8",
  );
  const wrappersReadme = await readWorkflowWrapper("README.md");

  for (const content of [wrapper, readme, wrappersReadme]) {
    assert.match(content, /implementation-map\.md/i);
    assert.match(content, /savepoint/i);
    assert.match(content, /spec-required behavior|behavior ownership/i);
    assert.match(content, /auto-?preflight/i);
    assert.match(
      content,
      /flow-trace|required only when the scope needs end-to-end flow mapping/i,
    );
  }

  for (const content of [wrapper, readme, wrappersReadme]) {
    assert.match(content, /manual/i);
    assert.match(content, /runner-managed/i);
  }
});

test("plan-validator prompt classifies spec-origin findings as minor repairs or major decisions", async () => {
  const prompt = await readWorkflowPrompt("plan-validator.md");

  assert.match(prompt, /`MINOR SPEC REPAIR` applies ONLY to:/);
  assert.match(prompt, /typos, formatting, heading\/list consistency/);
  assert.match(
    prompt,
    /making behavior explicit when it is already unambiguously defined elsewhere in the same spec/,
  );
  assert.match(prompt, /`MAJOR SPEC DECISION REQUIRED` applies to:/);
  assert.match(prompt, /new behavior/);
  assert.match(prompt, /changed business logic/);
  assert.match(prompt, /missing product choice/);
  assert.match(prompt, /unclear data shape\/API contract/);
  assert.match(prompt, /unclear edge-case behavior/);
  assert.match(prompt, /anything that requires user authority/);
});

test("plan-validator prompt requires major spec decisions to STOP without approving", async () => {
  const prompt = await readWorkflowPrompt("plan-validator.md");

  assert.match(
    prompt,
    /`MAJOR SPEC DECISION REQUIRED` MUST output `STOP` and state the required user decision/,
  );
  assert.match(
    prompt,
    /IF any `MAJOR SPEC DECISION REQUIRED` issues exist:[\s\S]*output `STOP`/,
  );
  assert.match(prompt, /plan MUST NOT be approved/);
});

test("plan-validator prompt excludes spec issue routes from generic critical routing", async () => {
  const prompt = await readWorkflowPrompt("plan-validator.md");

  assert.match(
    prompt,
    /IF any CRITICAL issues exist and NO `MAJOR SPEC DECISION REQUIRED` issues exist and NO `MINOR SPEC REPAIR` issues exist:/,
  );
});

test("plan-validator prompt allows only bounded minor spec repairs during preflight", async () => {
  const prompt = await readWorkflowPrompt("plan-validator.md");

  assert.match(prompt, /`MINOR SPEC REPAIR` applies ONLY to:/);
  assert.match(
    prompt,
    /Spec edits are allowed ONLY for `MINOR SPEC REPAIR` findings/i,
  );
  assert.match(prompt, /one bounded repair pass/i);
  assert.match(
    prompt,
    /edit only the named spec file and named spec section\(s\)/i,
  );
  assert.match(prompt, /must not require new behavior/i);
});

test("plan-validator prompt runs the same authoring preflight before approval", async () => {
  const prompt = await readWorkflowPrompt("plan-validator.md");

  assert.match(
    prompt,
    /validator preflight from\s+`?\.ai\/instructions\/shared\/flow-trace-artifacts\.md`?/i,
  );
  assert.match(
    prompt,
    /re-read the\s+spec plus any required flow-trace artifacts/i,
  );
  assert.match(
    prompt,
    /repair missing action rows and\s+under-scoped behavior ownership/i,
  );
  assert.match(prompt, /rewrite bad task savepoints/i);
  assert.match(prompt, /remove task IDs/i);
  assert.match(
    prompt,
    /do not limit repairs to patching only the cited lines/i,
  );
});

test("plan-validator prompt updates thin-plan workflow sidecar when bounded preflight stops or approves", async () => {
  const prompt = await readWorkflowPrompt("plan-validator.md");

  assert.match(
    prompt,
    /Update `\.ai\/artifacts\/<plan-name>\/state\/workflow\.json`/,
  );
  assert.match(prompt, /`planPath`/);
  assert.match(prompt, /workflowState\s*=\s*draft-validation/);
  assert.match(prompt, /workflowState\s*=\s*approved/);
  assert.match(prompt, /`latest`/);
  assert.match(prompt, /`history`/);
  assert.match(prompt, /`unresolvedBlockers`/);
  assert.match(prompt, /`updatedAt`/);
  assert.match(prompt, /must match the plan manifest/i);
  assert.match(prompt, /Do not use legacy top-level aliases/i);
  assert.match(prompt, /`latestValidationSummary`/);
  assert.match(prompt, /`latestValidationResult`/);
  assert.match(prompt, /`latestValidationEvidence`/);
  assert.match(prompt, /`compactHistoryPointer`/);
});

test("plan-validator prompt updates thin-plan workflow sidecar with runner-readable state", async () => {
  const prompt = await readWorkflowPrompt("plan-validator.md");

  assert.match(
    prompt,
    /Update `\.ai\/artifacts\/<plan-name>\/state\/workflow\.json`/,
  );
  assert.match(prompt, /`planPath`/);
  assert.match(prompt, /`workflowState`/);
  assert.doesNotMatch(prompt, /`status`|`nextAction`/);
  assert.match(prompt, /`latest`/);
  assert.match(prompt, /`history`/);
  assert.match(prompt, /`unresolvedBlockers`/);
  assert.match(prompt, /`updatedAt`/);
  assert.match(prompt, /Do not use legacy top-level aliases/i);
  assert.match(prompt, /`latestValidationSummary`/);
  assert.match(prompt, /`latestValidationResult`/);
  assert.match(prompt, /`latestValidationEvidence`/);
  assert.match(prompt, /`compactHistoryPointer`/);
});

test("sync-plan-artifacts prompt defines the pre-validator artifact sync contract", async () => {
  const prompt = await readWorkflowPrompt("sync-plan-artifacts.md");

  assert.match(prompt, /\.ai\/instructions\/shared\/workflow-state\.md/);
  assert.match(prompt, /\.ai\/instructions\/shared\/flow-trace-artifacts\.md/);
  assert.match(prompt, /read the plan/i);
  assert.match(prompt, /read the spec/i);
  assert.match(prompt, /sync contract from/i);
  assert.match(prompt, /user-journey\.md/i);
  assert.match(prompt, /implementation-map\.md/i);
  assert.match(prompt, /plan `## Artifacts` section/i);
  assert.match(prompt, /state\/workflow\.json/i);
  assert.match(prompt, /plan-owned/i);
  assert.match(prompt, /\.ai\/plans\/<plan-name>\.md/);
  assert.match(prompt, /\.ai\/artifacts\/<plan-name>\//);
  assert.match(prompt, /must not edit app code/i);
  assert.match(prompt, /tests/i);
  assert.match(prompt, /migrations/i);
  assert.match(prompt, /generated files/i);
  assert.match(prompt, /`workflowState`\s*=\s*`draft-validation`/);
  assert.match(prompt, /STOP/i);
  assert.match(prompt, /product decision/i);
  assert.match(prompt, /draft-artifact-sync/);
});

test("manual-preview prompt supports standalone manual use without plan state", async () => {
  const prompt = await readWorkflowPrompt("manual-preview.md");

  assert.match(prompt, /standalone ad hoc work/i);
  assert.match(prompt, /does not require a plan file/i);
  assert.match(prompt, /does not read or update workflow state/i);
  assert.match(prompt, /does not create or update .*\.ai\/artifacts/i);
  assert.match(prompt, /contextual code preview/i);
  assert.match(prompt, /wait for explicit operator approval/i);
  assert.match(prompt, /does not update `## Workflow State`/i);
});

test("manual-preview prompt requires visible comments for changed preview code", async () => {
  const prompt = await readWorkflowPrompt("manual-preview.md");

  assert.match(prompt, /visible comments/i);
  assert.match(prompt, /changed lines or blocks/i);
  assert.match(prompt, /easier to see/i);
  assert.match(prompt, /minimal, meaningful preview comments/i);
  assert.match(prompt, /avoid marker-only comments/i);
});

test("plan-validator prompt forbids unclassified or unresolved major spec-origin edits", async () => {
  const prompt = await readWorkflowPrompt("plan-validator.md");

  assert.match(
    prompt,
    /major or unclassified spec issue requires user decision before plan can be fixed/,
  );
  assert.match(
    prompt,
    /If a finding is marked `MAJOR SPEC DECISION REQUIRED`, STOP only when the issue still requires user authority after this codebase reclassification check\./,
  );
  assert.match(prompt, /If a spec-origin finding is unclassified:[\s\S]*STOP/);
  assert.match(
    prompt,
    /If a `MINOR SPEC REPAIR` finding lacks exact allowed spec sections:[\s\S]*STOP/,
  );
  assert.match(
    prompt,
    /If a `MINOR SPEC REPAIR` would require behavior not already decided in the existing spec:[\s\S]*STOP/,
  );
});

test("plan-validator prompt reuses existing codebase contracts before escalating spec decisions", async () => {
  const prompt = await readWorkflowPrompt("plan-validator.md");

  assert.match(prompt, /## Codebase Contract Resolution \(MANDATORY\)/);
  assert.match(
    prompt,
    /Existing codebase contracts SHOULD be preferred over escalating to user decisions/,
  );
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

test("plan-validator prompt allows codebase-backed reclassification without spec edits", async () => {
  const prompt = await readWorkflowPrompt("plan-validator.md");

  assert.match(prompt, /## Codebase Reclassification Check \(MANDATORY\)/);
  assert.match(prompt, /removing behavior the plan invented beyond the spec/);
  assert.match(
    prompt,
    /narrowing file scope or validation scope back to the spec/,
  );
  assert.match(
    prompt,
    /reusing an existing codebase contract\/type\/rendering path that already exists in spec-scoped files/,
  );
  assert.match(
    prompt,
    /replacing an invented data shape\/API contract with an existing compatible contract already present in the codebase/,
  );
  assert.match(prompt, /adding spec-required coverage that the plan omitted/);
  assert.match(
    prompt,
    /reusing an existing sibling contract for a new spec-required section of an existing document\/API surface/,
  );
  assert.match(
    prompt,
    /including a supporting type\/contract file only because an in-scope owner file needs that already-decided shape carried through existing code/,
  );
  assert.match(
    prompt,
    /This reclassification does NOT allow spec edits unless the finding is explicitly `MINOR SPEC REPAIR`\./,
  );
  assert.match(
    prompt,
    /when applicable, replace invented plan behavior with the existing compatible codebase contract instead of asking for a new spec decision/,
  );
});

test("execute and unblock prompts keep thin-plan workflow history out of the manifest", async () => {
  const executePrompt = await readWorkflowPrompt("execute-plan.md");
  const unblockPrompt = await readWorkflowPrompt("unblock-plan.md");

  assert.match(executePrompt, /MUST NOT add inline `## Blockers`/);
  assert.match(executePrompt, /`unresolvedBlockers`/);
  assert.match(unblockPrompt, /MUST NOT add inline `## Blockers`/);
  assert.match(unblockPrompt, /MUST NOT add inline `## Unblock History`/);
  assert.match(unblockPrompt, /latest\.unblock/);
});

test("execute-plan prompt defers unavailable external final validation to review", async () => {
  const prompt = await readWorkflowPrompt("execute-plan.md");

  assert.match(prompt, /external final validation deferral/i);
  assert.match(prompt, /browser\/manual\/deployed\/external validation/i);
  assert.match(prompt, /workflowState\s*=\s*review/);
  assert.match(prompt, /review owns the completion decision/i);
  assert.match(prompt, /must not transition directly to `commit-summary`/i);
});

test("execute-plan prompt defers validation failures that only come from out-of-scope files", async () => {
  const prompt = await readWorkflowPrompt("execute-plan.md");

  assert.match(
    prompt,
    /validation command fails only on files outside the current plan scope/i,
  );
  assert.match(prompt, /do not block the active plan solely for that reason/i);
  assert.match(prompt, /record the validation as deferred or out-of-scope/i);
});

test("execute-plan prompt loads testing instructions before validation", async () => {
  const prompt = await readWorkflowPrompt("execute-plan.md");

  assert.match(prompt, /\.ai\/instructions\/shared\/testing\.md/);
  assert.match(prompt, /before running, skipping, or classifying validation/i);
});

test("shared reasoning guidance keeps harness review subagents disabled", async () => {
  const prompt = await readFile(
    ".ai/instructions/shared/reasoning-quality.md",
    "utf8",
  );

  assert.match(prompt, /do not bypass/i);
  assert.doesNotMatch(prompt, /Superpowers/i);
  assert.doesNotMatch(prompt, /subagent-driven-development/i);
});

test("review prompt loads native guidance and forbids subagent review", async () => {
  const prompt = await readWorkflowPrompt("review-changes.md");

  assert.match(prompt, /\.ai\/instructions\/shared\/reasoning-quality\.md/);
  assert.match(prompt, /must not spawn subagents/i);
  assert.doesNotMatch(prompt, /Superpowers/i);
  assert.doesNotMatch(prompt, /subagent-driven-development/i);
});

test("workflow prompts load native shared guidance instead of retired Superpowers prompt", async () => {
  const promptExpectations = [
    ["create-plan.md", ["reasoning-quality", "flow-trace-artifacts"]],
    ["plan-validator.md", ["flow-trace-artifacts"]],
    ["sync-plan-artifacts.md", ["flow-trace-artifacts"]],
    ["execute-plan.md", ["reasoning-quality", "debugging", "testing"]],
    [
      "review-changes.md",
      ["reasoning-quality", "debugging", "testing", "flow-trace-artifacts"],
    ],
    ["unblock-plan.md", ["reasoning-quality", "debugging"]],
    ["reopen-plan.md", ["reasoning-quality", "debugging"]],
    ["manual-preview.md", ["reasoning-quality", "debugging", "testing"]],
    ["generate-user-flow.md", ["reasoning-quality"]],
  ] as const;

  for (const [promptName, expectedInstructions] of promptExpectations) {
    const prompt = await readWorkflowPrompt(promptName);

    for (const instruction of expectedInstructions) {
      assert.match(
        prompt,
        new RegExp(`\\.ai\\/instructions\\/shared\\/${instruction}\\.md`),
        promptName,
      );
    }
    assert.doesNotMatch(prompt, /\.ai\/prompts\/superpowers\.md/, promptName);
  }
});

test("create-plan prompt defines artifact state as the planning-time boundary", async () => {
  const prompt = await readWorkflowPrompt("create-plan.md");

  assert.match(
    prompt,
    /These artifact-state files are required only for `runner-managed` mode/i,
  );
  assert.match(prompt, /If execution mode is `manual`:/i);
  assert.match(prompt, /N\/A: manual plan-bound execution/);
  assert.match(prompt, /state\/file-ownership\.json/);
  assert.match(prompt, /planning-time ownership boundary/i);
  assert.match(prompt, /state\/files\.json/);
  assert.match(prompt, /changed-file inventory/i);
});

test("execute-plan prompt reconciles files.json after implementation before review", async () => {
  const prompt = await readWorkflowPrompt("execute-plan.md");

  assert.match(
    prompt,
    /Reconcile `?\.ai\/artifacts\/<plan-name>\/state\/files\.json`? after implementation/i,
  );
  assert.match(
    prompt,
    /actual created, modified, and deleted plan-owned paths/i,
  );
  assert.match(prompt, /before moving to `workflowState = review`/i);
});

test("review-changes prompt routes file-list mismatches back to execution", async () => {
  const prompt = await readWorkflowPrompt("review-changes.md");

  assert.match(
    prompt,
    /If staged implementation paths do not match the expected changed-file inventory in `\.ai\/artifacts\/<plan-name>\/state\/files\.json`/,
  );
  assert.match(prompt, /file-list mismatch/i);
  assert.match(prompt, /workflowState = active/);
});

test("commit-summary prompt does not repair Files metadata", async () => {
  const prompt = await readWorkflowPrompt("commit-summary.md");

  assert.match(
    prompt,
    /relies on `\.ai\/artifacts\/<plan-name>\/state\/files\.json` as the changed-file inventory/i,
  );
  assert.match(prompt, /state\/file-ownership\.json/);
  assert.match(prompt, /must not repair `files\.json`/i);
  assert.match(prompt, /route the plan back through review or execution/i);
});

test("execute-plan prompt requires concise artifact event and validation update wording", async () => {
  const prompt = await readWorkflowPrompt("execute-plan.md");

  assert.match(
    prompt,
    /Workflow event state may contain only compact summary, state\/result\/decision, and evidence pointer fields/,
  );
  assert.match(
    prompt,
    /Do not record reasoning narration, wait-state updates, or artifact body text in the plan manifest/,
  );
  assert.match(
    prompt,
    /Artifact state updates should state what changed, what was validated, and remaining action/,
  );
});

test("review-changes prompt requires concise actionable review artifact state", async () => {
  const prompt = await readWorkflowPrompt("review-changes.md");

  assert.match(
    prompt,
    /Review state entries may contain only compact `Summary`, `Decision`, and `Evidence` pointer fields/,
  );
  assert.match(
    prompt,
    /Put all issue bullets, file references, remediation notes, missing validations, and unresolved risks in the review artifact/,
  );
  assert.match(prompt, /self-contained/i);
  assert.match(
    prompt,
    /must not rely on surrounding prose, earlier review versions, or shorthand like `same as above`/i,
  );
  assert.match(
    prompt,
    /Do not use Review History for terminal-output summaries/,
  );
});

test("plan template uses thin-plan artifact-first manifest", async () => {
  const template = await readPlanTemplate();

  assert.match(template, /thin-plan/);
  assert.match(template, /user-journey\.md/);
  assert.match(template, /implementation-map\.md/);
  assert.match(template, /^## Phases$/m);
  assert.match(template, /workflow\.json/);
  assert.match(template, /files\.json/);
  assert.match(template, /file-ownership\.json/);
  assert.doesNotMatch(template, /\* Issues:/);
  assert.doesNotMatch(template, /\* Critical Issues:/);
  assert.doesNotMatch(template, /\* Warnings:/);
  assert.doesNotMatch(template, /\* Required Fixes:/);
});

test("plan template omits inline workflow runtime sections", async () => {
  const template = await readPlanTemplate();

  assert.doesNotMatch(template, /^## Flow-to-File Mapping$/m);
  assert.doesNotMatch(template, /^## Implementation Map$/m);
  assert.doesNotMatch(template, /^## Execution Log$/m);
  assert.doesNotMatch(template, /^## Validation History$/m);
  assert.doesNotMatch(template, /^## Review History$/m);
  assert.doesNotMatch(template, /^## Blockers$/m);
  assert.doesNotMatch(template, /^## Ownership Scope$/m);
  assert.doesNotMatch(template, /^## Files \(MANDATORY\)$/m);
});

test("execute-plan prompt uses snapshot remediation context before full review history", async () => {
  const prompt = await readWorkflowPrompt("execute-plan.md");

  assert.match(prompt, /Latest Review Remediation Context/i);
  assert.match(prompt, /default fix list/i);
  assert.match(prompt, /Do not load `## Review History` by default/i);
});

test("review-changes prompt loads testing instructions before validation", async () => {
  const prompt = await readWorkflowPrompt("review-changes.md");

  assert.match(prompt, /\.ai\/instructions\/shared\/testing\.md/);
  assert.match(prompt, /before running, skipping, or classifying validation/i);
});

test("review-changes prompt validates flow-trace-required diffs against user-journey artifacts", async () => {
  const prompt = await readWorkflowPrompt("review-changes.md");
  const instructions = await readInstruction("shared/flow-trace-artifacts.md");

  assert.match(prompt, /\.ai\/artifacts\/<plan-name>\/user-journey\.md/);
  assert.match(prompt, /\.ai\/instructions\/shared\/flow-trace-artifacts\.md/);
  assert.match(prompt, /implementation-map\.md/i);
  assert.match(prompt, /each user action/i);
  assert.match(instructions, /visible state/i);
  assert.match(instructions, /failure branch/i);
  assert.match(instructions, /validation coverage/i);
  assert.match(prompt, /Spec remains authoritative/i);
  assert.match(prompt, /mark as CRITICAL/i);
  assert.match(prompt, /do not\s+require flow-artifact review/i);
});

test("testing instructions require command-level escalation for local E2E in Codex sandbox", async () => {
  const instructions = await readInstruction("shared/testing.md");

  assert.match(instructions, /Codex sandbox/i);
  assert.match(instructions, /Node\/Playwright local network/i);
  assert.match(instructions, /command-level escalation/i);
  assert.match(instructions, /Do not use `yolo`/i);
});

test("review-changes prompt returns unowned compatibility scope repairs to execution", async () => {
  const prompt = await readWorkflowPrompt("review-changes.md");

  assert.match(prompt, /Compatibility Regression\s+Carve-Out/);
  assert.match(prompt, /compatibility scope repair/i);
  assert.match(prompt, /exact required file path/i);
  assert.match(prompt, /set `workflowState = active`/);
  assert.match(prompt, /Do not output `STOP` for this eligible repair/i);
});

test("review-changes prompt owns deferred external validation and completed handoff", async () => {
  const prompt = await readWorkflowPrompt("review-changes.md");

  assert.match(
    prompt,
    /final validation requires deployed, manual, or external code/i,
  );
  assert.match(prompt, /deferred validation note/i);
  assert.match(prompt, /## Workflow State[\s\S]*completed/);
});

test("review-changes prompt is the combined review and hands off directly to commit-summary", async () => {
  const prompt = await readWorkflowPrompt("review-changes.md");

  assert.match(prompt, /combined harness review/i);
  assert.match(prompt, /review-vX/i);
  assert.match(prompt, /latest\.review/i);
  assert.doesNotMatch(prompt, /latest\.reviewSpec/i);
  assert.doesNotMatch(prompt, /runner-enforced stage-2 quality review/i);
  assert.match(prompt, /regression risk/i);
  assert.match(prompt, /maintainability/i);
  assert.match(
    prompt,
    /IF NO CRITICAL issues[\s\S]*Workflow State[\s\S]*completed/i,
  );
  assert.match(
    prompt,
    /Review passed:[\s\S]*Workflow State = completed/i,
  );
});

test("review-changes prompt requires actionable issue output for failed reviews", async () => {
  const prompt = await readWorkflowPrompt("review-changes.md");

  assert.match(
    prompt,
    /If Summary is `NEEDS FIX` or `HIGH RISK`, `\*\*Issues\*\*` must include at least one issue bullet/,
  );
  assert.match(
    prompt,
    /concrete conflict, defect, missing validation, or required fix/,
  );
  assert.match(
    prompt,
    /terminal output shows what needs to be fixed without opening the artifact file/,
  );
});

test("review prompts forbid manual restaging remediation because workflow-runner owns review staging", async () => {
  const prompt = await readWorkflowPrompt("review-changes.md");

  assert.match(prompt, /workflow-runner owns review staging/i);
  assert.match(prompt, /fix the working tree and leave files unstaged/i);
  assert.match(
    prompt,
    /Do not tell the operator to stage or restage review fixes/i,
  );
});

test("review-changes prompt expects runner pre-review cleanup for clearly unrelated hunks", async () => {
  const prompt = await readWorkflowPrompt("review-changes.md");

  assert.match(
    prompt,
    /runner may auto-unstage clearly unrelated staged hunks before review/i,
  );
  assert.match(prompt, /review the remaining path-scoped staged diff only/i);
  assert.match(prompt, /non plan-scoped changes detected/i);
  assert.match(prompt, /workflowState = active/);
  assert.doesNotMatch(prompt, /Hunk Ownership/);
  assert.doesNotMatch(
    prompt,
    /any unrelated hunk inside the path-scoped diff is a STOP condition/i,
  );
});

test("commit-summary prompt only accepts completed commit-summary plans", async () => {
  const prompt = await readWorkflowPrompt("commit-summary.md");

  assert.match(
    prompt,
    /For `completed`, it will create exactly one local git commit/,
  );
  assert.match(prompt, /IF Workflow State is not `completed`/);
  assert.match(prompt, /MUST NOT push/);
  assert.doesNotMatch(prompt, /deployment-validation/);
  assert.doesNotMatch(prompt, /## Deployment Validation/);
  assert.doesNotMatch(
    prompt,
    /Deployment Validation entries may contain only `Summary`, `Status`, and `Evidence`/,
  );
  assert.doesNotMatch(prompt, /\* Commit:/);
  assert.doesNotMatch(prompt, /\* Push Status:/);
  assert.doesNotMatch(prompt, /\* Deployment Status:/);
});

test("commit-summary prompt creates one local completed commit and forbids auto-push", async () => {
  const prompt = await readWorkflowPrompt("commit-summary.md");

  assert.match(
    prompt,
    /For `completed`, it will create exactly one local git commit/,
  );
  assert.match(prompt, /pnpm lint-staged/);
  assert.match(prompt, /git commit --cleanup=verbatim -F - <<'EOF'/);
  assert.match(prompt, /<generated subject>/);
  assert.match(prompt, /<generated body>/);
  assert.match(prompt, /Do not include workflow metadata/);
  assert.match(prompt, /Do not paste long file lists/);
  assert.match(
    prompt,
    /Do not include sections named `Plan`, `Task ID`, `Task words`, `Task artifact path`, `Changed files`, `Validation summary`, or `Review result`/,
  );
  assert.match(prompt, /execution-summary\.md/);
  assert.match(prompt, /sole writer[\s\S]*execution-summary\.md/i);
  assert.match(prompt, /task title.*semantic intent/i);
  assert.match(prompt, /reviewed staged diff.*factual source/i);
  assert.match(prompt, /narrowest stable subsystem/i);
  assert.match(prompt, /target 50 characters/i);
  assert.match(prompt, /never exceed 72 characters/i);
  assert.match(prompt, /two to four concise `-` bullets/i);
  assert.match(prompt, /wrapped at 72 characters/i);
  assert.match(prompt, /security, migration, or breaking-change context/i);
  assert.match(prompt, /<type>\(<scope>\): <imperative summary>/i);
  assert.match(prompt, /MUST NOT include runner task IDs/i);
  assert.match(prompt, /MUST NOT add a task-intent mismatch stop/i);
  assert.doesNotMatch(prompt, /git commit -m "<generated message>"/);
  assert.match(prompt, /MUST NOT push/);
});

test("commit-summary prompt does not branch for deployment validation pass-through", async () => {
  const prompt = await readWorkflowPrompt("commit-summary.md");

  assert.doesNotMatch(prompt, /Status: passed/);
  assert.doesNotMatch(prompt, /do not create a second commit/);
  assert.doesNotMatch(prompt, /recorded commit/);
});

test("commit-summary prompt unstages clearly unrelated staged hunks after path-scoped git add", async () => {
  const prompt = await readWorkflowPrompt("commit-summary.md");

  assert.match(prompt, /after the path-scoped git add/i);
  assert.match(
    prompt,
    /unstage any staged hunk that is not clearly related to the current plan or spec/i,
  );
  assert.match(prompt, /do not stop for clearly unrelated hunks/i);
});

test("unblock-plan prompt handles only blocked plan recovery", async () => {
  const prompt = await readWorkflowPrompt("unblock-plan.md");

  assert.match(prompt, /IF Workflow State is not `blocked`/);
  assert.match(prompt, /workflowState` to `active`/);
  assert.doesNotMatch(prompt, /deployment-validation/);
  assert.doesNotMatch(prompt, /Push Status/);
  assert.doesNotMatch(prompt, /Deployment Status/);
  assert.doesNotMatch(prompt, /final validation evidence/);
  assert.doesNotMatch(prompt, /reopening \+ reopen-plan/);
});

test("unblock-plan prompt does not require deployment-validation evidence", async () => {
  const prompt = await readWorkflowPrompt("unblock-plan.md");

  assert.doesNotMatch(
    prompt,
    /If no concrete new deployment-validation evidence is available/,
  );
  assert.doesNotMatch(prompt, /deployment-validation evidence is required/);
  assert.match(prompt, /MUST NOT return success without changing the plan/);
});

test("reopen-plan prompt accepts canonical reopening state", async () => {
  const prompt = await readWorkflowPrompt("reopen-plan.md");

  assert.match(prompt, /Already Reopened Fast Path/);
  assert.match(prompt, /IF Workflow State == `active`/);
  assert.match(prompt, /do not output `STOP`/);
  assert.match(prompt, /Expected:\s*\n\s*`reopening`/);
  assert.match(prompt, /IF Workflow State != `reopening`:/);
  assert.match(prompt, /After the plan is updated for the reopened work:/);
  assert.match(prompt, /## Workflow State\s*\n\s*active/);
  assert.doesNotMatch(prompt, /plan must be completed before reopening/);
});
