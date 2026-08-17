import assert from 'node:assert/strict';
import { mkdtemp, mkdir, readFile, rm, symlink, unlink, writeFile } from 'node:fs/promises';
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
  const temporaryRoot = await mkdtemp(path.join(os.tmpdir(), 'ai-health-check-'));
  const root = path.join(temporaryRoot, '.ai');
  await mkdir(path.join(temporaryRoot, '.git'), { recursive: true });
  const sourcePaths = [
    ...bootstrapPaths,
    '.github/workflows/health.yml',
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
    '# Index Instructions\n\n## Rules\n\n- Load `ai-workflow.md`, `shared/testing.md`, and `architecture.md` for workflow checks.\n',
  );
  return { root, sourcePaths, temporaryRoot };
};

const createCommandExecutor = ({
  root,
  sourcePaths,
  nestedGitInAncestor = false,
  nestedGitError,
  parentGit = true,
  parentGitError,
  parentTrackedPaths = [],
  localTrackedPaths = [],
  ignoredPaths = [],
  commands = [],
}) => {
  const localInstructionPathsWithIndex = new Set([
    'instructions/index.md',
    ...localInstructionPaths,
  ]);
  const localOnlyRoots = ['artifacts', 'logs', 'plans', 'specs', 'state', 'tmp'];
  const isInPathspec = (candidate, pathspec) =>
    candidate === pathspec || candidate.startsWith(`${pathspec}/`);
  const isLocalPath = (candidate) =>
    candidate === 'instructions/.health-check-probe.md' ||
    localInstructionPathsWithIndex.has(candidate) ||
    localOnlyRoots.some((localRoot) => isInPathspec(candidate, localRoot));
  const result = (exitCode, stdout = '', stderr = '') => ({
    exitCode,
    stdout,
    stderr,
  });

  return async (command) => {
    commands.push(command);
    if (command.command !== 'git') return result(0);

    const [operation] = command.args;
    if (operation === 'rev-parse') {
      if (command.cwd === root) {
        if (nestedGitError) return result(128, '', nestedGitError);
        return result(0, `${nestedGitInAncestor ? path.dirname(root) : root}\n`);
      }
      if (parentGitError) return result(128, '', parentGitError);
      return parentGit
        ? result(0, `${path.dirname(root)}\n`)
        : result(128, '', 'fatal: not a git repository');
    }
    if (operation === 'check-ignore') {
      const target = command.args.at(-1);
      if (ignoredPaths.includes(target)) return result(1);
      return result(isLocalPath(target) ? 0 : 1);
    }
    if (operation === 'ls-files') {
      const pathspecs = command.args.slice(command.args.indexOf('--') + 1);
      const paths =
        command.cwd === path.dirname(root)
          ? parentTrackedPaths
          : [...sourcePaths, ...localTrackedPaths].filter((sourcePath) =>
              pathspecs.some((pathspec) => isInPathspec(sourcePath, pathspec)),
            );
      return result(0, paths.join('\0') + (paths.length > 0 ? '\0' : ''));
    }
    return result(1, '', 'unexpected git command');
  };
};

const runFixture = async (options = {}) => {
  const fixture = await createFixture();
  if (options.parentGit === false) {
    await rm(path.join(fixture.temporaryRoot, '.git'), { force: true, recursive: true });
  }
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
    await rm(fixture.temporaryRoot, { force: true, recursive: true });
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
    await rm(fixture.temporaryRoot, { force: true, recursive: true });
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
    await rm(fixture.temporaryRoot, { force: true, recursive: true });
  }
});

test('health fails when a canonical source is replaced by a directory', async () => {
  await withFixture(async (fixture) => {
    const sourcePath = path.join(fixture.root, 'README.md');
    await unlink(sourcePath);
    await mkdir(sourcePath);
    const output = [];
    const result = await runHealthCheck({
      commandExecutor: createCommandExecutor(fixture),
      stderr: (message) => output.push(message),
      stdout: (message) => output.push(message),
      workflowDirectory: fixture.root,
    });

    assert.equal(result.ok, false);
    assert.match(output.join('\n'), /required source is missing or not a file/);
    assert.match(output.join('\n'), /README\.md/);
  });
});

test('health fails when source tracking comes from an ancestor repository', async () => {
  const fixture = await runFixture({ nestedGitInAncestor: true });
  try {
    assert.equal(fixture.result.ok, false);
    assert.match(fixture.output.join('\n'), /nested Git repository/);
    assert.match(fixture.output.join('\n'), /unexpected top-level path/);
  } finally {
    await rm(fixture.temporaryRoot, { force: true, recursive: true });
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

test('health fails when a tracked source is a directory', async () => {
  await withFixture(async (fixture) => {
    const trackedPath = 'prompts/removed.md';
    await mkdir(path.join(fixture.root, trackedPath));
    const commandExecutor = createCommandExecutor({
      ...fixture,
      sourcePaths: [...fixture.sourcePaths, trackedPath],
    });
    const output = [];
    const result = await runHealthCheck({
      commandExecutor,
      stderr: (message) => output.push(message),
      stdout: (message) => output.push(message),
      workflowDirectory: fixture.root,
    });

    assert.equal(result.ok, false);
    assert.match(output.join('\n'), /tracked source is missing or not a file/);
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

test('health fails when an expected wrapper is replaced by a directory', async () => {
  await withFixture(async (fixture) => {
    const wrapperPath = path.join(fixture.root, 'wrappers/bug-intake-rca.md');
    await unlink(wrapperPath);
    await mkdir(wrapperPath);
    const output = [];
    const result = await runHealthCheck({
      commandExecutor: createCommandExecutor(fixture),
      stderr: (message) => output.push(message),
      stdout: (message) => output.push(message),
      workflowDirectory: fixture.root,
    });

    assert.equal(result.ok, false);
    assert.match(output.join('\n'), /expected wrapper is not a file/);
    assert.match(output.join('\n'), /wrappers\/bug-intake-rca\.md/);
  });
});

test('health fails for a missing relative instruction route', async () => {
  await withFixture(async (fixture) => {
    await writeFixtureFile(
      fixture.root,
      'instructions/index.md',
      '# Index Instructions\n\n## Rules\n\n- Load `shared/missing.md` and `architecture.md` for this fixture.\n',
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

test('health fails when an instruction route is a directory', async () => {
  await withFixture(async (fixture) => {
    const routePath = path.join(fixture.root, 'instructions/architecture.md');
    await unlink(routePath);
    await mkdir(routePath);
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
    await rm(fixture.temporaryRoot, { force: true, recursive: true });
  }
});

test('health fails when actual local workflow data is tracked', async () => {
  await withFixture(async (fixture) => {
    const trackedPath = 'plans/tracked-plan.md';
    await writeFixtureFile(fixture.root, trackedPath);
    const output = [];
    const result = await runHealthCheck({
      commandExecutor: createCommandExecutor({
        ...fixture,
        localTrackedPaths: [trackedPath],
      }),
      stderr: (message) => output.push(message),
      stdout: (message) => output.push(message),
      workflowDirectory: fixture.root,
    });

    assert.equal(result.ok, false);
    assert.match(output.join('\n'), /local path is tracked/);
    assert.match(output.join('\n'), /plans\/tracked-plan\.md/);
  });
});

test('health fails when actual local workflow data is specifically unignored', async () => {
  await withFixture(async (fixture) => {
    const unignoredPath = 'plans/unignored-plan.md';
    await writeFixtureFile(fixture.root, unignoredPath);
    const output = [];
    const result = await runHealthCheck({
      commandExecutor: createCommandExecutor({
        ...fixture,
        ignoredPaths: [unignoredPath],
      }),
      stderr: (message) => output.push(message),
      stdout: (message) => output.push(message),
      workflowDirectory: fixture.root,
    });

    assert.equal(result.ok, false);
    assert.match(output.join('\n'), /local path remains ignored/);
    assert.match(output.join('\n'), /plans\/unignored-plan\.md/);
  });
});

test('health treats tmp as ignored local data and rejects retired telemetry paths', async () => {
  await withFixture(async (fixture) => {
    await writeFixtureFile(fixture.root, 'tmp/local-record.txt');
    const output = [];
    const result = await runHealthCheck({
      commandExecutor: createCommandExecutor(fixture),
      stderr: (message) => output.push(message),
      stdout: (message) => output.push(message),
      workflowDirectory: fixture.root,
    });

    assert.equal(result.ok, true, output.join('\n'));
    await writeFixtureFile(fixture.root, 'scripts/workflow/telemetry/manual-token-usage.ts');
    const retiredOutput = [];
    const retired = await runHealthCheck({
      commandExecutor: createCommandExecutor(fixture),
      stderr: (message) => retiredOutput.push(message),
      stdout: (message) => retiredOutput.push(message),
      workflowDirectory: fixture.root,
    });
    assert.equal(retired.ok, false);
    assert.match(
      retiredOutput.join('\n'),
      /retired workflow path still exists: scripts\/workflow\/telemetry/,
    );
  });
});

test('health rejects a dangling retired runner-log link', async () => {
  await withFixture(async (fixture) => {
    const retiredPath = path.join(fixture.root, 'tmp/workflow-runner-test.log');
    await mkdir(path.dirname(retiredPath), { recursive: true });
    await symlink('missing-runner-log', retiredPath);
    const output = [];
    const result = await runHealthCheck({
      commandExecutor: createCommandExecutor(fixture),
      stderr: (message) => output.push(message),
      stdout: (message) => output.push(message),
      workflowDirectory: fixture.root,
    });

    assert.equal(result.ok, false);
    assert.match(
      output.join('\n'),
      /retired workflow path still exists: tmp\/workflow-runner-test\.log/,
    );
  });
});

test('health validates instruction routes wrapped across a Load bullet', async () => {
  await withFixture(async (fixture) => {
    await writeFixtureFile(
      fixture.root,
      'instructions/index.md',
      '# Index Instructions\n\n## Rules\n\n- Load `architecture.md` for local work and\n  `shared/missing.md` for wrapped workflow checks.\n',
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
    await rm(fixture.temporaryRoot, { force: true, recursive: true });
  }
});

test('a standalone checkout reports parent isolation as not applicable', async () => {
  const fixture = await runFixture({ parentGit: false });
  try {
    assert.equal(fixture.result.ok, true, fixture.output.join('\n'));
    assert.match(fixture.output.join('\n'), /not applicable/);
  } finally {
    await rm(fixture.temporaryRoot, { force: true, recursive: true });
  }
});

test('health fails closed when parent Git inspection errors', async () => {
  const fixture = await runFixture({
    parentGitError: 'fatal: detected dubious ownership in repository',
  });
  try {
    assert.equal(fixture.result.ok, false);
    assert.match(fixture.output.join('\n'), /inspect parent Git repository/);
    assert.match(fixture.output.join('\n'), /dubious ownership/);
    assert.doesNotMatch(fixture.output.join('\n'), /not applicable/);
  } finally {
    await rm(fixture.temporaryRoot, { force: true, recursive: true });
  }
});

test('health fails closed when the direct parent has corrupt Git metadata', async () => {
  const fixture = await runFixture({
    parentGitError: 'fatal: not a git repository (or any of the parent directories): .git',
  });
  try {
    assert.equal(fixture.result.ok, false);
    assert.match(fixture.output.join('\n'), /inspect parent Git repository/);
    assert.match(fixture.output.join('\n'), /not a git repository/);
    assert.doesNotMatch(fixture.output.join('\n'), /not applicable/);
  } finally {
    await rm(fixture.temporaryRoot, { force: true, recursive: true });
  }
});

test('health fails closed for a dangling direct-parent .git symlink', async () => {
  await withFixture(async (fixture) => {
    const gitEntry = path.join(fixture.temporaryRoot, '.git');
    await rm(gitEntry, { force: true, recursive: true });
    await symlink('missing-git-metadata', gitEntry);
    const output = [];
    const result = await runHealthCheck({
      commandExecutor: createCommandExecutor({
        ...fixture,
        parentGitError: 'fatal: not a git repository',
      }),
      stderr: (message) => output.push(message),
      stdout: (message) => output.push(message),
      workflowDirectory: fixture.root,
    });

    assert.equal(result.ok, false);
    assert.match(output.join('\n'), /inspect parent Git repository/);
    assert.doesNotMatch(output.join('\n'), /not applicable/);
  });
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
