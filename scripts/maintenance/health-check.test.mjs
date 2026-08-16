import assert from 'node:assert/strict';
import { mkdtemp, mkdir, readFile, rm, unlink, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';

import { parseHealthCheckArgs, runHealthCheck, workflowRoot } from './health-check.mjs';

const bootstrapPaths = ['.gitignore', 'AGENTS.md', 'README.md', 'package.json', 'pnpm-lock.yaml'];

const wrapperPaths = [
  'wrappers/README.md',
  'wrappers/bug-intake-rca.md',
  'wrappers/create-plan.md',
  'wrappers/execute-plan.md',
  'wrappers/feature-intake.md',
  'wrappers/generate-bugfix-spec.md',
  'wrappers/generate-feature-spec.md',
  'wrappers/generate-flow-artifacts.md',
  'wrappers/goal-checkpoint.md',
  'wrappers/resume-goal.md',
  'wrappers/select-workflow.md',
];

const localInstructionPaths = [
  'instructions/admin.md',
  'instructions/architecture.md',
  'instructions/auth.md',
  'instructions/backend.md',
  'instructions/i18n.md',
  'instructions/pull-requests.md',
  'instructions/supabase.md',
  'instructions/ui.md',
  'instructions/web.md',
  'instructions/workers.md',
];

const writeFixtureFile = async (root, relativePath, content = '# fixture\n') => {
  const target = path.join(root, relativePath);
  await mkdir(path.dirname(target), { recursive: true });
  await writeFile(target, content);
};

const createFixture = async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), 'ai-health-check-'));
  const sourcePaths = [
    ...bootstrapPaths,
    'config/agent-models.toml',
    'instructions/ai-workflow.md',
    'instructions/shared/testing.md',
    'prompts/select-workflow.md',
    'scripts/check.test.mjs',
    'templates/plan.template.md',
    ...wrapperPaths,
  ];
  for (const relativePath of sourcePaths) {
    await writeFixtureFile(root, relativePath);
  }
  for (const relativePath of localInstructionPaths) {
    await writeFixtureFile(root, relativePath);
  }
  await writeFixtureFile(
    root,
    'instructions/index.md',
    '- Load `ai-workflow.md`, `shared/testing.md`, and `architecture.md` for workflow checks.\n',
  );
  return { root, sourcePaths };
};

const createCommandExecutor = ({
  root,
  sourcePaths,
  parentGit = true,
  parentTrackedPaths = [],
  ignoredPaths = [],
  commands = [],
}) => {
  const localPaths = new Set([
    'instructions/index.md',
    'instructions/architecture.md',
    'instructions/ui.md',
    'plans/.health-check-probe',
    'specs/.health-check-probe',
    'artifacts/.health-check-probe',
    'logs/.health-check-probe',
    'state/.health-check-probe',
  ]);
  const isInPathspec = (candidate, pathspec) =>
    candidate === pathspec || candidate.startsWith(`${pathspec}/`);
  const result = (exitCode, stdout = '', stderr = '') => ({
    exitCode,
    stdout,
    stderr,
  });

  return async (command) => {
    commands.push(command);
    if (command.command !== 'git') return result(0);

    const [operation] = command.args;
    if (operation === 'rev-parse') return result(parentGit ? 0 : 1, parentGit ? 'true\n' : '');
    if (operation === 'check-ignore') {
      const target = command.args.at(-1);
      if (ignoredPaths.includes(target)) return result(1);
      return result(localPaths.has(target) ? 0 : 1);
    }
    if (operation === 'ls-files') {
      const pathspecs = command.args.slice(command.args.indexOf('--') + 1);
      const paths =
        command.cwd === path.dirname(root)
          ? parentTrackedPaths
          : sourcePaths.filter((sourcePath) =>
              pathspecs.some((pathspec) => isInPathspec(sourcePath, pathspec)),
            );
      return result(0, paths.join('\0') + (paths.length > 0 ? '\0' : ''));
    }
    return result(1, '', 'unexpected git command');
  };
};

const runFixture = async (options = {}) => {
  const fixture = await createFixture();
  const output = [];
  const commands = [];
  const commandExecutor = createCommandExecutor({
    ...fixture,
    commands,
    ...options,
  });
  const result = await runHealthCheck({
    args: options.args ?? [],
    commandExecutor,
    stderr: (message) => output.push(message),
    stdout: (message) => output.push(message),
    workflowDirectory: fixture.root,
  });
  return { ...fixture, commands, output, result };
};

const withFixture = async (callback) => {
  const fixture = await createFixture();
  try {
    return await callback(fixture);
  } finally {
    await rm(fixture.root, { force: true, recursive: true });
  }
};

test('health check accepts only default, full, and help modes', () => {
  assert.deepEqual(parseHealthCheckArgs([]), { full: false });
  assert.deepEqual(parseHealthCheckArgs(['--full']), { full: true });
  assert.deepEqual(parseHealthCheckArgs(['--help']), {
    help: true,
    full: false,
  });
  assert.match(parseHealthCheckArgs(['--runner-tests']).error, /Unknown option/);
});

test('health check root is derived from the script location', () => {
  const expectedRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
  assert.equal(workflowRoot, expectedRoot);
});

test('help is independent of the caller working directory', async () => {
  const output = [];
  const result = await runHealthCheck({
    args: ['--help'],
    commandExecutor: async () => {
      throw new Error('help must not run commands');
    },
    stdout: (message) => output.push(message),
    stderr: (message) => output.push(message),
  });

  assert.equal(result.ok, true);
  assert.equal(result.root, workflowRoot);
  assert.match(output.join('\n'), /health-check\.mjs \[--full\]/);
});

test('full health performs formatting and every discovered script test', async () => {
  const fixture = await runFixture({ args: ['--full'] });
  try {
    assert.equal(fixture.result.ok, true, fixture.output.join('\n'));
    assert.ok(
      fixture.commands.some(
        (command) => command.command === 'pnpm' && command.args.includes('prettier'),
      ),
    );
    assert.ok(
      fixture.commands.some(
        (command) =>
          command.command === process.execPath && command.args.includes('scripts/check.test.mjs'),
      ),
    );
  } finally {
    await rm(fixture.root, { force: true, recursive: true });
  }
});

test('health fails when a canonical source is not tracked', async () => {
  const fixture = await runFixture({
    sourcePaths: bootstrapPaths,
  });
  try {
    assert.equal(fixture.result.ok, false);
    assert.match(fixture.output.join('\n'), /canonical source is untracked/);
    assert.match(fixture.output.join('\n'), /config\/agent-models\.toml/);
  } finally {
    await rm(fixture.root, { force: true, recursive: true });
  }
});

test('health fails when a tracked source no longer exists on disk', async () => {
  await withFixture(async (fixture) => {
    const removedPath = 'prompts/removed.md';
    const commandExecutor = createCommandExecutor({
      ...fixture,
      sourcePaths: [...fixture.sourcePaths, removedPath],
    });
    const output = [];
    const result = await runHealthCheck({
      commandExecutor,
      stderr: (message) => output.push(message),
      stdout: (message) => output.push(message),
      workflowDirectory: fixture.root,
    });

    assert.equal(result.ok, false);
    assert.match(output.join('\n'), /tracked source is missing/);
    assert.match(output.join('\n'), /prompts\/removed\.md/);
  });
});

test('health fails when an expected wrapper is absent', async () => {
  await withFixture(async (fixture) => {
    await unlink(path.join(fixture.root, 'wrappers/resume-goal.md'));
    const output = [];
    const result = await runHealthCheck({
      commandExecutor: createCommandExecutor(fixture),
      stderr: (message) => output.push(message),
      stdout: (message) => output.push(message),
      workflowDirectory: fixture.root,
    });

    assert.equal(result.ok, false);
    assert.match(output.join('\n'), /missing expected wrapper/);
  });
});

test('health fails for a missing relative instruction route', async () => {
  await withFixture(async (fixture) => {
    await writeFixtureFile(
      fixture.root,
      'instructions/index.md',
      '- Load `shared/missing.md` and `architecture.md` for this fixture.\n',
    );
    const output = [];
    const result = await runHealthCheck({
      commandExecutor: createCommandExecutor(fixture),
      stderr: (message) => output.push(message),
      stdout: (message) => output.push(message),
      workflowDirectory: fixture.root,
    });

    assert.equal(result.ok, false);
    assert.match(output.join('\n'), /missing relative instruction routes/);
    assert.match(output.join('\n'), /shared\/missing\.md/);
  });
});

test('health validates direct instruction routes from the local index', async () => {
  await withFixture(async (fixture) => {
    await unlink(path.join(fixture.root, 'instructions/architecture.md'));
    const output = [];
    const result = await runHealthCheck({
      commandExecutor: createCommandExecutor(fixture),
      stderr: (message) => output.push(message),
      stdout: (message) => output.push(message),
      workflowDirectory: fixture.root,
    });

    assert.equal(result.ok, false);
    assert.match(output.join('\n'), /missing relative instruction routes/);
    assert.match(output.join('\n'), /architecture\.md/);
  });
});

test('health fails when a local-only path is not ignored', async () => {
  const fixture = await runFixture({ ignoredPaths: ['plans/.health-check-probe'] });
  try {
    assert.equal(fixture.result.ok, false);
    assert.match(fixture.output.join('\n'), /local path remains ignored/);
  } finally {
    await rm(fixture.root, { force: true, recursive: true });
  }
});

test('health reports every parent-tracked .ai path', async () => {
  const fixture = await runFixture({
    parentTrackedPaths: ['.ai/artifacts/review.md', '.ai/state/workflow.json'],
  });
  try {
    assert.equal(fixture.result.ok, false);
    assert.match(fixture.output.join('\n'), /parent tracks \.ai paths/);
    assert.match(fixture.output.join('\n'), /\.ai\/artifacts\/review\.md/);
    assert.match(fixture.output.join('\n'), /\.ai\/state\/workflow\.json/);
  } finally {
    await rm(fixture.root, { force: true, recursive: true });
  }
});

test('a standalone checkout reports parent isolation as not applicable', async () => {
  const fixture = await runFixture({ parentGit: false });
  try {
    assert.equal(fixture.result.ok, true, fixture.output.join('\n'));
    assert.match(fixture.output.join('\n'), /not applicable/);
  } finally {
    await rm(fixture.root, { force: true, recursive: true });
  }
});

test('test:all delegates to full health while focused tests remain fast', async () => {
  const packageJson = JSON.parse(await readFile(path.join(workflowRoot, 'package.json'), 'utf8'));

  assert.equal(packageJson.scripts['test:all'], 'pnpm health:full');
  assert.match(packageJson.scripts['test:focused'], /--test/);
  assert.doesNotMatch(packageJson.scripts['test:focused'], /health:full/);
});

test('health implementation is read-only and has no retired progress expectation', async () => {
  const sourcePath = path.join(workflowRoot, 'scripts/maintenance/health-check.mjs');
  const source = await readFile(sourcePath, 'utf8');

  assert.doesNotMatch(source, /shell:\s*true/);
  assert.doesNotMatch(source, /\$\(find/);
  assert.doesNotMatch(source, /writeFile|mkdir|rm\(/);
  assert.doesNotMatch(source, /plan-progress/);
  assert.match(source, /CANONICAL_SOURCE_ROOTS/);
  assert.match(source, /EXPECTED_WRAPPER_PATHS/);
});
