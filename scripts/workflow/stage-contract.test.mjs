import assert from 'node:assert/strict';
import { access, readdir, readFile } from 'node:fs/promises';
import path from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';

const workflowRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const readSource = (relativePath) => readFile(path.join(workflowRoot, relativePath), 'utf8');

const pathExists = async (relativePath) => {
  try {
    await access(path.join(workflowRoot, relativePath));
    return true;
  } catch {
    return false;
  }
};

const collectFiles = async (relativeDirectory, predicate) => {
  const absoluteDirectory = path.join(workflowRoot, relativeDirectory);
  const files = [];
  for (const entry of await readdir(absoluteDirectory, {
    withFileTypes: true,
  })) {
    const relativePath = path.posix.join(relativeDirectory, entry.name);
    if (entry.isDirectory()) {
      files.push(...(await collectFiles(relativePath, predicate)));
    } else if (predicate(relativePath)) {
      files.push(relativePath);
    }
  }
  return files.sort();
};

test('workflow uses explicit stages and LOW saves a reference plan', async () => {
  const [agents, selection, workflow, createPlan, execute] = await Promise.all([
    readSource('AGENTS.md'),
    readSource('prompts/select-workflow.md'),
    readSource('instructions/shared/workflow-state.md'),
    readSource('prompts/create-plan.md'),
    readSource('prompts/execute-plan.md'),
  ]);

  assert.match(selection, /This invocation is read-only/);
  assert.match(selection, /explicitly invoke `\.ai\/prompts\/generate-spec\.md`/i);
  assert.match(selection, /must save `\.ai\/plans\/<plan-name>\.md`/);
  assert.match(selection, /describing a plan in conversation is not enough/i);
  assert.match(workflow, /read-only intake/i);
  assert.match(workflow, /explicitly invoked stage/i);
  assert.match(workflow, /LOW cannot execute from a conversational plan/);
  assert.doesNotMatch(createPlan, /in Plan mode/);
  assert.match(createPlan, /save:\s*\n\n`\.ai\/plans\/<plan-name>\.md`/);
  assert.match(execute, /conversation(?:al)? plan result\s+is not an execution input/i);
  assert.match(agents, /Planning always saves a plan file, including\s+for LOW/);

  for (const command of [
    'execute .ai/plans/<plan-name>.md',
    '/goal <exact-goal>',
    'plan: .ai/plans/<plan-name>.md',
  ]) {
    assert.match(createPlan, new RegExp(command.replace(/[./<>]/g, '\\$&')));
  }
});

test('one typed prompt owns feature and evidence-backed bugfix specs', async () => {
  const spec = await readSource('prompts/generate-spec.md');

  assert.match(spec, /Spec type: feature-spec@1 \| bugfix-spec@1/);
  assert.match(spec, /feature-spec@1/);
  assert.match(spec, /bugfix-spec@1/);
  assert.match(spec, /root-cause analysis is mandatory/i);
  assert.match(spec, /observed failure, affected boundary, causal mechanism/);
  assert.match(spec, /A symptom, guess, temporal correlation, or desired\s+patch is not an RCA/);
  assert.match(spec, /Evidence.*Root Cause Analysis/s);
  assert.match(spec, /Open Decisions` must be exactly `None`/);
  assert.match(spec, /Spec finalized at .*\[<spec-type>\]/);
  assert.doesNotMatch(spec, /create a plan|begin implementation/i);
});

test('one flow contract creates user-journey@1 and implementation-map@1', async () => {
  const [prompt, instruction] = await Promise.all([
    readSource('prompts/generate-flow-artifacts.md'),
    readSource('instructions/shared/flow-trace-artifacts.md'),
  ]);

  for (const source of [prompt, instruction]) {
    assert.match(source, /user-journey@1/);
    assert.match(source, /implementation-map@1/);
    assert.match(source, /user-journey\.md/);
    assert.match(source, /implementation-map\.md/);
  }
  for (const section of [
    'Canonical Ownership',
    'Contract and Data',
    'Services',
    'Validation',
    'Open Decisions',
  ]) {
    assert.match(prompt, new RegExp(`## ${section}`));
    assert.match(instruction, new RegExp(section));
  }
  assert.match(prompt, /Create one complete mapping for every user action and acceptance scenario/);
  assert.equal(await pathExists('prompts/generate-user-flow.md'), false);
  assert.equal(await pathExists('wrappers/generate-user-flow.md'), false);
});

test('create-plan creates missing required flow artifacts in one invocation', async () => {
  const [createPlan, flowPrompt, workflow, flowInstruction] = await Promise.all([
    readSource('prompts/create-plan.md'),
    readSource('prompts/generate-flow-artifacts.md'),
    readSource('instructions/shared/workflow-state.md'),
    readSource('instructions/shared/flow-trace-artifacts.md'),
  ]);

  assert.match(createPlan, /Treat an omitted `Flow artifacts` value as `AUTO`/);
  assert.match(
    createPlan,
    /IF either required artifact is missing, THEN create or complete\s+the pair/,
  );
  assert.match(createPlan, /before saving the\s+plan/);
  assert.match(flowPrompt, /when an explicit\s+`.ai\/prompts\/create-plan\.md` invocation/);
  assert.match(flowPrompt, /return control to create-plan/);
  assert.match(workflow, /is not\s+required/);
  assert.match(flowInstruction, /separate invocation is optional/);
});

test('plan-manifest@2 declares repositories, bases, and HIGH ownership', async () => {
  const [createPlan, template, workflow] = await Promise.all([
    readSource('prompts/create-plan.md'),
    readSource('templates/plan.template.md'),
    readSource('instructions/shared/ai-workflow.md'),
  ]);

  for (const source of [createPlan, template, workflow]) {
    assert.match(source, /plan-manifest@2/);
    assert.match(source, /repository/i);
    assert.match(source, /integration(?:-| )base/i);
  }
  assert.match(template, /## Repositories/);
  assert.match(template, /### Repository: <repository-id>/);
  assert.match(template, /[-*] Root: `<git-repository-root>`/);
  assert.match(template, /[-*] Integration base: `<ref-or-commit>`/);
  assert.match(template, /[-*] Repository: `<exactly-one-repository-id>`/);
  assert.match(createPlan, /each task declares exactly one repository ID/);
  assert.match(createPlan, /split any cross-repository task\s+into dependent tasks/);
  assert.match(template, /Split cross-repository outcomes into dependent tasks/);
});

test('HIGH plan response returns only the exact goal command', async () => {
  const createPlan = await readSource('prompts/create-plan.md');
  const highResponse = createPlan.split('For HIGH, return exactly:')[1];

  assert.match(
    highResponse,
    /```text\n\/goal <finalized spec `## Goal` text verbatim>\n\nplan: \.ai\/plans\/<plan-name>\.md\n```/,
  );
  assert.match(highResponse, /path after the lowercase `plan:` label/);
  assert.doesNotMatch(
    highResponse,
    /\[HIGH\]|<goal-handoff>|<plan>|Goal Command:|Scope:|Required Behavior:|Constraints:|Verifications:|Plan Reference:/,
  );
});

test('resume reports the handoff command and retired progress aliases are absent', async () => {
  const resume = await readSource('prompts/resume-goal.md');
  const activeFiles = [
    'README.md',
    ...(await collectFiles('instructions', (file) => file.endsWith('.md'))),
    ...(await collectFiles('prompts', (file) => file.endsWith('.md'))),
    ...(await collectFiles('templates', (file) => file.endsWith('.md'))),
    ...(await collectFiles('wrappers', (file) => file.endsWith('.md'))),
  ];
  const activeSource = (await Promise.all(activeFiles.map((file) => readSource(file)))).join('\n');

  assert.match(resume, /Return the handoff's exact `## Next Action`/);
  assert.match(resume, /\/goal <exact-goal>\s+plan: <linked-plan-path>/);
  assert.match(resume, /Do not invoke the command/);
  assert.match(resume, /Stop\. The user must explicitly invoke/);
  assert.equal(await pathExists('prompts/plan-progress.md'), false);
  assert.doesNotMatch(activeSource, /plan-progress|plan progress/i);
});

test('HIGH keeps its reusable task commit protocol', async () => {
  const [checkpoint, createPlan, resume, review] = await Promise.all([
    readSource('prompts/goal-checkpoint.md'),
    readSource('prompts/create-plan.md'),
    readSource('prompts/resume-goal.md'),
    readSource('prompts/review-changes.md'),
  ]);

  for (const phrase of [
    'Process tasks serially. Never combine two planned tasks in one commit',
    "Run the task's exact declared validation successfully",
    'Review the task diff for regressions, out-of-scope files',
    'Stage only files owned by that task',
    'Create exactly one local, conventional, task-specific Git commit',
    'Confirm no remaining change owned by the completed task is left uncommitted',
  ]) {
    assert.match(checkpoint, new RegExp(phrase.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')));
  }
  assert.match(
    checkpoint,
    /If a required role\s+cannot run or lacks its result, STOP the task as `Blocked`/,
  );
  assert.match(createPlan, /unchanged HIGH\s+commit protocol/);
  assert.match(createPlan, /copy the finalized spec's `## Goal` text verbatim/);
  assert.match(resume, /\/goal <exact-goal>\s+plan: <linked-plan-path>/);
  assert.match(review, /unchanged task commit\s+protocol/);
});

test('execution permits reviewed spec-preserving corrective deviations', async () => {
  const [agents, workflow, reasoning, execute, checkpoint, createPlan, flow] =
    await Promise.all([
      readSource('AGENTS.md'),
      readSource('instructions/shared/workflow-state.md'),
      readSource('instructions/shared/reasoning-quality.md'),
      readSource('prompts/execute-plan.md'),
      readSource('prompts/goal-checkpoint.md'),
      readSource('prompts/create-plan.md'),
      readSource('instructions/shared/flow-trace-artifacts.md'),
    ]);

  for (const source of [agents, workflow, reasoning, execute, checkpoint]) {
    assert.match(source, /corrective[- ]deviation/i);
  }
  assert.match(agents, /without operator approval/);
  assert.match(agents, /stays inside a repository already declared/);
  assert.match(checkpoint, /Do not ask for operator approval solely because/);
  assert.match(checkpoint, /separate focused\s+`fix\(<scope>\)/);
  assert.match(createPlan, /provider-to-consumer internal contract/);
  assert.match(flow, /callable internal contract/);
  assert.match(
    checkpoint,
    /automatic goal or checkpoint continuation[\s\S]*is not a new failed attempt/,
  );
});

test('pull request creation is explicit and summary-only', async () => {
  const [prompt, workflow, wrapper] = await Promise.all([
    readSource('prompts/create-pull-request.md'),
    readSource('instructions/shared/ai-workflow.md'),
    readSource('wrappers/create-pull-request.md'),
  ]);

  assert.match(prompt, /Use conventional-commit format/);
  assert.match(prompt, /For multiple commits, synthesize one title/);
  assert.match(prompt, /Generate exactly this structure/);
  assert.match(prompt, /## Summary/);
  assert.match(prompt, /as many concise bullets as needed/);
  assert.match(prompt, /do not impose a fixed bullet count/);
  assert.doesNotMatch(prompt, /one to three|1(?:–|-)3/i);
  assert.match(prompt, /Wait for explicit approval before pushing or creating/);
  assert.match(prompt, /already has an open pull request/);
  assert.match(prompt, /Never commit, amend, rebase, squash, force-push, merge, close/);
  assert.doesNotMatch(prompt, /^## (Validation|Risk|Migrations|Deferred Checks)$/m);
  assert.match(workflow, /optional, explicitly invoked delivery action/);
  assert.match(wrapper, /Use `.ai\/prompts\/create-pull-request\.md`/);
});

test('MEDIUM and HIGH require an independent final review loop', async () => {
  const [agents, workflow, execute, review, checkpoint, registry] = await Promise.all([
    readSource('AGENTS.md'),
    readSource('instructions/shared/workflow-state.md'),
    readSource('prompts/execute-plan.md'),
    readSource('prompts/review-changes.md'),
    readSource('prompts/goal-checkpoint.md'),
    readSource('config/agent-models.toml'),
  ]);

  assert.match(agents, /After all MEDIUM or HIGH implementation, require an independent reviewer/);
  assert.match(execute, /independent whole-plan review[\s\S]*configured\s+`reviewer` subagent/);
  assert.match(review, /Spawn a fresh reviewer subagent for every review round/);
  assert.match(review, /committed HIGH task changes/);
  assert.match(review, /`P0`, `P1`, and `P2` are blocking/);
  assert.match(review, /`P3` is advisory/);
  assert.match(
    review,
    /active P0\/P1\/P2 finding when Fix required[\s\S]*external or missing-input blocker when Blocked/,
  );
  assert.match(
    review,
    /Repeat until a\s+fresh round is clear[\s\S]*true external or\s+missing-input blocker/,
  );

  assert.match(checkpoint, /After every planned task has completed the task commit protocol/);
  assert.match(checkpoint, /mandatory regardless of the tasks' saved delegation decisions/);
  assert.match(
    checkpoint,
    /exactly one local conventional commit per changed repository for the\s+round/,
  );
  assert.match(
    checkpoint,
    /subject must name the resolved behavior or risk[\s\S]*fix\(<affected component>\): <imperative summary/,
  );
  assert.match(checkpoint, /When no stable component scope exists[\s\S]*fix: <imperative summary/);
  assert.match(checkpoint, /Its body must state the review round/);
  assert.match(checkpoint, /summaries of every resolved `P0`\/`P1`\/`P2` finding/);
  assert.match(checkpoint, /validation\s+commands\/results/);
  assert.doesNotMatch(checkpoint, /use\s+`fix\(review\):/);
  assert.match(
    checkpoint,
    /Repeat remediation, validation, review-round commits, and fresh review until\s+clear/,
  );
  assert.match(
    workflow,
    /After all task\s+commits, a mandatory independent reviewer checks the cumulative whole-plan\s+diff/,
  );

  const frontierModel = registry.match(/\[tiers\.frontier\]\s+model = "([a-z0-9._-]+)"/)?.[1];
  assert.ok(frontierModel, 'frontier reviewer model must be locked');
  assert.match(
    registry,
    /\[roles\.reviewer\][\s\S]*tier = "frontier"[\s\S]*reasoning_effort = "xhigh"/,
  );
  assert.match(registry, /\[spawn\][\s\S]*fork_turns = 4/);
});

test('future plans consolidate adversarial review by root cause', async () => {
  const [createPlan, template, review, checkpoint] = await Promise.all([
    readSource('prompts/create-plan.md'),
    readSource('templates/plan.template.md'),
    readSource('prompts/review-changes.md'),
    readSource('prompts/goal-checkpoint.md'),
  ]);

  assert.match(template, /## Review Strategy/);
  assert.match(template, /Format: `review-strategy@1`/);
  assert.match(template, /Root-cause classes/);
  assert.match(template, /Adversarial matrix/);
  assert.match(template, /Architectural fallback/);
  assert.match(template, /External evidence/);

  assert.match(createPlan, /Populate `## Review Strategy` as `review-strategy@1`/);
  assert.match(createPlan, /later-assignment[\s\S]*invocation-wrapper[\s\S]*container\/member/);
  assert.match(createPlan, /architecture-escalation trigger, not a\s+review limit/);
  assert.match(createPlan, /never automatically\s+cleared, ignored, or downgraded/);

  assert.match(
    review,
    /Plans without that versioned section retain the\s+independent review loop above unchanged/,
  );
  assert.match(review, /Complete the entire cumulative review before returning/);
  assert.match(review, /even after the\s+first blocking finding is confirmed/);
  assert.match(review, /Group confirmed variants by the failed invariant/);
  assert.match(review, /stable root-cause identifier/);
  assert.match(review, /report all confirmed `P0`, `P1`, and `P2` families together/);
  assert.match(review, /same class remains blocking in two fresh rounds/);
  assert.match(review, /external\/operator evidence as separate results/);

  assert.match(checkpoint, /close every applicable variant in the\s+saved adversarial matrix/);
  assert.match(checkpoint, /Do not patch only the reviewer's example spelling/);
  assert.match(checkpoint, /stop incremental remediation and return to planning/);
  assert.match(checkpoint, /threshold never automatically clears/);
  assert.match(
    checkpoint,
    /finish the complete\s+saved matrix and report all grouped root-cause families/,
  );
});

test('wrappers remain thin input adapters', async () => {
  const wrapperFiles = (await collectFiles('wrappers', (file) => file.endsWith('.md'))).filter(
    (file) => file !== 'wrappers/README.md',
  );

  for (const wrapperFile of wrapperFiles) {
    const source = await readSource(wrapperFile);
    const nonEmptyLines = source.split('\n').filter((line) => line.trim()).length;
    assert.match(source, /Use `.ai\/prompts\//, wrapperFile);
    assert.ok(nonEmptyLines <= 10, `${wrapperFile} duplicates more than input adaptation`);
    assert.doesNotMatch(
      source,
      /## (Rules|Validation|Final Response|Document Format)/,
      wrapperFile,
    );
    assert.doesNotMatch(source, /Return only|STOP|Do not /, wrapperFile);
  }
});

test('active workflow source loads .ai/AGENTS.md directly', async () => {
  const promptFiles = [
    'prompts/select-workflow.md',
    'prompts/generate-spec.md',
    'prompts/generate-flow-artifacts.md',
    'prompts/create-plan.md',
    'prompts/execute-plan.md',
    'prompts/review-changes.md',
    'prompts/goal-checkpoint.md',
    'prompts/resume-goal.md',
    'prompts/create-pull-request.md',
  ];

  for (const promptFile of promptFiles) {
    assert.match(await readSource(promptFile), /\.ai\/AGENTS\.md/, promptFile);
  }

  const activeInstructionFiles = [
    'AGENTS.md',
    ...(await collectFiles('instructions', (file) => file.endsWith('.md'))),
    ...(await collectFiles('prompts', (file) => file.endsWith('.md'))),
    ...(await collectFiles('templates', (file) => file.endsWith('.md'))),
    ...(await collectFiles('wrappers', (file) => file.endsWith('.md'))),
  ];
  const activeInstructionSource = (
    await Promise.all(activeInstructionFiles.map((file) => readSource(file)))
  ).join('\n');
  assert.doesNotMatch(activeInstructionSource, /\.codex\/(\.?)AGENTS\.md/);
  assert.match(await readSource('README.md'), /repository root/);
});

test('shared workflow source is project-neutral and free of retired state concepts', async () => {
  const sharedFiles = await collectFiles('instructions/shared', (file) => file.endsWith('.md'));
  const workflowFiles = [
    'AGENTS.md',
    'README.md',
    ...sharedFiles,
    ...(await collectFiles('prompts', (file) => file.endsWith('.md'))),
    ...(await collectFiles('templates', (file) => file.endsWith('.md'))),
    ...(await collectFiles('wrappers', (file) => file.endsWith('.md'))),
  ];
  const source = (await Promise.all(workflowFiles.map((file) => readSource(file)))).join('\n');
  const sharedSource = (await Promise.all(sharedFiles.map((file) => readSource(file)))).join('\n');

  assert.doesNotMatch(sharedSource, /Gondoor|Mobii|Meteor|shadcn|Next\.js|route\.ts/i);
  assert.doesNotMatch(source, /runner-managed|thin-plan(?:-v2)?|workflowState|sync-plan-artifacts/);
  assert.doesNotMatch(source, /approved (spec|plan|objective|state)/i);
  assert.doesNotMatch(source, /\.ai\/changelogs|\.changelog\.md/);
});

test('retired runner, validator, preview, and changelog paths are absent', async () => {
  for (const retiredPath of [
    'changelogs',
    'instructions/ai-workflow.md',
    'prompts/manual-preview.md',
    'prompts/plan-validator.md',
    'scripts/workflow/runner',
    'scripts/workflow/runner.spec.md',
  ]) {
    assert.equal(await pathExists(retiredPath), false, retiredPath);
  }
});

test('local instruction index routes debugging, maintainability, and runbooks', async () => {
  const [index, architecture] = await Promise.all([
    readSource('instructions/index.md'),
    readSource('instructions/architecture.md'),
  ]);
  for (const instruction of [
    'shared/debugging.md',
    'shared/maintainability.md',
    'shared/documentation-runbooks.md',
  ]) {
    assert.match(index, new RegExp(instruction.replace('.', '\\.')));
  }
  assert.match(index, /`shared\/ai-workflow\.md`/);
  assert.doesNotMatch(index, /`ai-workflow\.md`/);
  assert.doesNotMatch(architecture, /Meteor/i);
});

test('local AGENTS override setup delegates to one deterministic utility', async () => {
  const [packageSource, prompt, readme, codexAgent, utility] = await Promise.all([
    readSource('package.json'),
    readSource('prompts/setup-agents-override.md'),
    readSource('README.md'),
    readSource('docs/codex-agent.md'),
    readSource('scripts/setup/agents-override.mjs'),
  ]);
  const packageJson = JSON.parse(packageSource);
  const expectedOverride = `# Local Project AI Instructions

Read and follow \`.ai/AGENTS.md\` before starting work.
Use \`.ai/instructions/index.md\` to load only instructions relevant to the request.`;

  assert.equal(
    packageJson.scripts['setup:agents-override'],
    'node scripts/setup/agents-override.mjs',
  );
  assert.match(prompt, /pnpm --dir \.ai setup:agents-override/);
  assert.match(prompt, /delegate[s]? all mutation and validation to the package utility/i);
  assert.match(prompt, /actual command output and exit status/i);
  assert.ok(
    prompt.split('\n').filter((line) => line.trim()).length <= 12,
    'setup prompt must remain a thin command adapter',
  );
  assert.doesNotMatch(
    prompt,
    /# Local Project AI Instructions|\/AGENTS\.override\.md|info\/exclude|rev-parse|check-ignore|writeFile|appendFile/,
  );

  for (const documentation of [readme, codexAgent]) {
    assert.match(documentation, /pnpm setup:agents-override/);
    assert.match(documentation, /pnpm --dir \.ai setup:agents-override/);
    assert.ok(documentation.includes(expectedOverride));
    assert.match(documentation, /repository-local Git exclude/i);
    assert.match(documentation, /AGENTS\.md.*\.codex\/AGENTS\.md.*fallback/is);
    assert.match(documentation, /refuses|conflicts/i);
  }

  assert.match(utility, /fileURLToPath\(import\.meta\.url\)/);
  assert.match(utility, /'--git-path',\s*'info\/exclude'/);
  assert.match(utility, /'check-ignore'/);
  assert.match(utility, /flag: 'wx'/);
  assert.doesNotMatch(utility, /process\.cwd\(\)/);
});

test('private package pins the self-contained toolchain', async () => {
  const packageJson = JSON.parse(await readSource('package.json'));
  assert.equal(packageJson.private, true);
  assert.equal(packageJson.engines.node, '>=20.20.2');
  assert.equal(packageJson.packageManager, 'pnpm@10.34.4');
  assert.equal(packageJson.devDependencies.prettier, '3.9.6');
  assert.equal(packageJson.devDependencies.tsx, '4.23.12');
  assert.equal(await pathExists('pnpm-lock.yaml'), true);
});
