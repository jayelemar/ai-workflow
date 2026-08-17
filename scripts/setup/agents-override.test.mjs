import assert from 'node:assert/strict';
import { execFile } from 'node:child_process';
import {
  chmod,
  lstat,
  mkdir,
  mkdtemp,
  readFile,
  readlink,
  rename,
  rm,
  stat,
  symlink,
  writeFile,
} from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { promisify } from 'node:util';
import { fileURLToPath } from 'node:url';

const execFileAsync = promisify(execFile);
const repositoryRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const utilitySourcePath = path.join(repositoryRoot, 'scripts/setup/agents-override.mjs');
const overrideContent = `# Local Project AI Instructions

Read and follow \`.ai/AGENTS.md\` before starting work.
Use \`.ai/instructions/index.md\` to load only instructions relevant to the request.
`;
const excludeRule = '/AGENTS.override.md';

const run = async (command, args, options = {}) => {
  try {
    const result = await execFileAsync(command, args, {
      encoding: 'utf8',
      maxBuffer: 1024 * 1024,
      ...options,
    });
    return { exitCode: 0, ...result };
  } catch (error) {
    return {
      exitCode: error.code ?? 1,
      stderr: error.stderr ?? error.message,
      stdout: error.stdout ?? '',
    };
  }
};

const git = async (cwd, ...args) => {
  const result = await run('git', args, { cwd });
  assert.equal(result.exitCode, 0, result.stderr);
  return result.stdout.trim();
};

const installWorkflow = async (projectRoot, { nestedGit = true } = {}) => {
  const workflowRoot = path.join(projectRoot, '.ai');
  const utilityPath = path.join(workflowRoot, 'scripts/setup/agents-override.mjs');
  await mkdir(path.dirname(utilityPath), { recursive: true });
  await mkdir(path.join(workflowRoot, 'instructions'), { recursive: true });
  await writeFile(path.join(workflowRoot, 'AGENTS.md'), '# Fixture workflow instructions\n');
  await writeFile(path.join(workflowRoot, 'instructions/index.md'), '# Fixture routes\n');
  await writeFile(utilityPath, await readFile(utilitySourcePath, 'utf8'));
  await writeFile(
    path.join(workflowRoot, 'package.json'),
    `${JSON.stringify(
      {
        name: '@fixture/ai-workflow',
        packageManager: 'pnpm@10.34.4',
        private: true,
        type: 'module',
        scripts: {
          'setup:agents-override': 'node scripts/setup/agents-override.mjs',
        },
      },
      null,
      2,
    )}\n`,
  );
  if (nestedGit) {
    await git(workflowRoot, 'init', '-q');
  }
  return { utilityPath, workflowRoot };
};

const createFixture = async ({ initializeParent = true } = {}) => {
  const temporaryRoot = await mkdtemp(path.join(os.tmpdir(), 'agents-override-'));
  const projectRoot = path.join(temporaryRoot, 'project');
  await mkdir(projectRoot);
  await writeFile(
    path.join(projectRoot, 'package.json'),
    '{"private":true,"packageManager":"pnpm@10.34.4"}\n',
  );
  if (initializeParent) {
    await git(projectRoot, 'init', '-q');
  }
  const workflow = await installWorkflow(projectRoot);
  return { ...workflow, projectRoot, temporaryRoot };
};

const excludePathFor = async (projectRoot) =>
  git(projectRoot, 'rev-parse', '--path-format=absolute', '--git-path', 'info/exclude');

const invokeNode = (fixture, options = {}) =>
  run(process.execPath, [fixture.utilityPath], {
    cwd: options.cwd ?? fixture.workflowRoot,
    env: { ...process.env, ...options.env },
  });

const invokePnpm = (fixture, args, cwd) =>
  run('pnpm', args, {
    cwd,
    env: process.env,
  });

const readManagedState = async (fixture) => {
  const overridePath = path.join(fixture.projectRoot, 'AGENTS.override.md');
  const excludePath = await excludePathFor(fixture.projectRoot);
  return {
    exclude: await readFile(excludePath, 'utf8'),
    excludePath,
    override: await readFile(overridePath, 'utf8'),
    overridePath,
  };
};

const assertIgnored = async (projectRoot) => {
  const ignored = await run('git', ['check-ignore', '-q', '--', 'AGENTS.override.md'], {
    cwd: projectRoot,
  });
  assert.equal(ignored.exitCode, 0, ignored.stderr);
  assert.equal(await git(projectRoot, 'ls-files', '--', 'AGENTS.override.md'), '');
  assert.equal(await git(projectRoot, 'status', '--short', '--', 'AGENTS.override.md'), '');
};

const withFixture = async (callback, options) => {
  const fixture = await createFixture(options);
  try {
    return await callback(fixture);
  } finally {
    await rm(fixture.temporaryRoot, { force: true, recursive: true });
  }
};

test('nested package command creates the exact regular override and local exclude rule', async () => {
  await withFixture(async (fixture) => {
    const result = await invokePnpm(fixture, ['setup:agents-override'], fixture.workflowRoot);
    assert.equal(result.exitCode, 0, result.stderr);
    assert.match(result.stdout, /AGENTS\.override\.md: created/);
    assert.match(result.stdout, /exclude rule: added/);
    assert.match(result.stdout, /setup verified/i);

    const state = await readManagedState(fixture);
    assert.equal(state.override, overrideContent);
    assert.equal((await lstat(state.overridePath)).isFile(), true);
    assert.equal((await lstat(state.overridePath)).isSymbolicLink(), false);
    assert.equal(state.exclude.split('\n').filter((line) => line === excludeRule).length, 1);
    await assertIgnored(fixture.projectRoot);
  });
});

test('project-root package command produces the same result', async () => {
  await withFixture(async (fixture) => {
    const result = await invokePnpm(
      fixture,
      ['--dir', '.ai', 'setup:agents-override'],
      fixture.projectRoot,
    );
    assert.equal(result.exitCode, 0, result.stderr);
    assert.equal((await readManagedState(fixture)).override, overrideContent);
    await assertIgnored(fixture.projectRoot);
  });
});

test('utility location, not caller directory, selects the target project', async () => {
  await withFixture(async (fixture) => {
    const unrelatedDirectory = await mkdtemp(path.join(os.tmpdir(), 'agents-override-caller-'));
    try {
      const result = await invokeNode(fixture, { cwd: unrelatedDirectory });
      assert.equal(result.exitCode, 0, result.stderr);
      assert.equal((await readManagedState(fixture)).override, overrideContent);
      await assert.rejects(readFile(path.join(unrelatedDirectory, 'AGENTS.override.md'), 'utf8'));

      const projectSubdirectory = path.join(fixture.projectRoot, 'packages/example');
      await mkdir(projectSubdirectory, { recursive: true });
      const repeated = await invokeNode(fixture, { cwd: projectSubdirectory });
      assert.equal(repeated.exitCode, 0, repeated.stderr);
      assert.match(repeated.stdout, /already correct/);
    } finally {
      await rm(unrelatedDirectory, { force: true, recursive: true });
    }
  });
});

test('repeated setup is byte-idempotent and preserves an unterminated exclude line', async () => {
  await withFixture(async (fixture) => {
    const excludePath = await excludePathFor(fixture.projectRoot);
    const originalExclude = '# repository-local excludes\n/custom-cache';
    await writeFile(excludePath, originalExclude);

    const first = await invokeNode(fixture);
    assert.equal(first.exitCode, 0, first.stderr);
    const firstState = await readManagedState(fixture);
    assert.equal(firstState.exclude, `${originalExclude}\n${excludeRule}\n`);
    const overrideStat = await stat(firstState.overridePath);
    const excludeStat = await stat(firstState.excludePath);

    const second = await invokeNode(fixture);
    assert.equal(second.exitCode, 0, second.stderr);
    assert.match(second.stdout, /AGENTS\.override\.md: already correct/);
    assert.match(second.stdout, /exclude rule: already present/);
    const secondState = await readManagedState(fixture);
    assert.deepEqual(secondState, firstState);
    assert.equal((await stat(secondState.overridePath)).mtimeMs, overrideStat.mtimeMs);
    assert.equal((await stat(secondState.excludePath)).mtimeMs, excludeStat.mtimeMs);
  });
});

test('one or more existing exact exclude rules are preserved without another duplicate', async () => {
  await withFixture(async (fixture) => {
    const overridePath = path.join(fixture.projectRoot, 'AGENTS.override.md');
    const excludePath = await excludePathFor(fixture.projectRoot);
    const duplicateExclude = `/first\n${excludeRule}\n/middle\n${excludeRule}\n/last`;
    await writeFile(overridePath, overrideContent);
    await writeFile(excludePath, duplicateExclude);

    const result = await invokeNode(fixture);
    assert.equal(result.exitCode, 0, result.stderr);
    assert.equal(await readFile(excludePath, 'utf8'), duplicateExclude);
    assert.equal(await readFile(overridePath, 'utf8'), overrideContent);
  });
});

test('a CRLF-terminated exact exclude rule is preserved byte-for-byte', async () => {
  await withFixture(async (fixture) => {
    const overridePath = path.join(fixture.projectRoot, 'AGENTS.override.md');
    const excludePath = await excludePathFor(fixture.projectRoot);
    const crlfExclude = `/first\r\n${excludeRule}\r\n/last\r\n`;
    await writeFile(overridePath, overrideContent);
    await writeFile(excludePath, crlfExclude);

    const result = await invokeNode(fixture);
    assert.equal(result.exitCode, 0, result.stderr);
    assert.match(result.stdout, /exclude rule: already present/);
    assert.equal(await readFile(excludePath, 'utf8'), crlfExclude);
  });
});

test('Git environment overrides cannot redirect repository metadata', async () => {
  await withFixture(async (fixture) => {
    const foreignRoot = path.join(fixture.temporaryRoot, 'foreign');
    await mkdir(foreignRoot);
    await git(foreignRoot, 'init', '-q');
    const foreignExcludePath = await excludePathFor(foreignRoot);
    const foreignExcludeBefore = await readFile(foreignExcludePath, 'utf8');

    const result = await invokeNode(fixture, {
      env: {
        GIT_DIR: path.join(foreignRoot, '.git'),
        GIT_INDEX_FILE: path.join(foreignRoot, '.git/index'),
        GIT_WORK_TREE: fixture.projectRoot,
      },
    });

    assert.equal(result.exitCode, 0, result.stderr);
    assert.equal((await readManagedState(fixture)).override, overrideContent);
    assert.equal(await readFile(foreignExcludePath, 'utf8'), foreignExcludeBefore);
    await assertIgnored(fixture.projectRoot);
  });
});

test('a missing resolved exclude file is created at the Git-provided path', async () => {
  await withFixture(async (fixture) => {
    const excludePath = await excludePathFor(fixture.projectRoot);
    await rm(excludePath);

    const result = await invokeNode(fixture);
    assert.equal(result.exitCode, 0, result.stderr);
    assert.equal(await readFile(excludePath, 'utf8'), `${excludeRule}\n`);
    await assertIgnored(fixture.projectRoot);
  });
});

test('workflow prerequisite failures happen before either managed target changes', async (t) => {
  const cases = [
    ['missing AGENTS.md', 'AGENTS.md', null],
    ['empty AGENTS.md', 'AGENTS.md', ''],
    ['non-file AGENTS.md', 'AGENTS.md', 'directory'],
    ['missing instruction index', 'instructions/index.md', null],
    ['empty instruction index', 'instructions/index.md', ''],
    ['non-file instruction index', 'instructions/index.md', 'directory'],
  ];

  for (const [name, relativePath, replacement] of cases) {
    await t.test(name, async () => {
      await withFixture(async (fixture) => {
        const target = path.join(fixture.workflowRoot, relativePath);
        if (replacement === null) {
          await rm(target);
        } else if (replacement === 'directory') {
          await rm(target);
          await mkdir(target);
        } else {
          await writeFile(target, replacement);
        }
        const excludePath = await excludePathFor(fixture.projectRoot);
        const excludeBefore = await readFile(excludePath, 'utf8');

        const result = await invokeNode(fixture);
        assert.notEqual(result.exitCode, 0);
        assert.match(result.stderr, /required workflow file/i);
        assert.equal(await readFile(excludePath, 'utf8'), excludeBefore);
        await assert.rejects(readFile(path.join(fixture.projectRoot, 'AGENTS.override.md')));
      });
    });
  }
});

test('a utility installed outside a direct .ai directory is rejected', async () => {
  await withFixture(async (fixture) => {
    const misplacedRoot = path.join(fixture.projectRoot, 'workflow');
    await rename(fixture.workflowRoot, misplacedRoot);
    const misplacedFixture = {
      ...fixture,
      utilityPath: path.join(misplacedRoot, 'scripts/setup/agents-override.mjs'),
      workflowRoot: misplacedRoot,
    };
    const excludePath = await excludePathFor(fixture.projectRoot);
    const excludeBefore = await readFile(excludePath, 'utf8');

    const result = await invokeNode(misplacedFixture);
    assert.notEqual(result.exitCode, 0);
    assert.match(result.stderr, /not installed under a direct \.ai directory/i);
    assert.equal(await readFile(excludePath, 'utf8'), excludeBefore);
    await assert.rejects(readFile(path.join(fixture.projectRoot, 'AGENTS.override.md')));
  });
});

test('an unreadable resolved exclude target fails before creating the override', async () => {
  await withFixture(async (fixture) => {
    const excludePath = await excludePathFor(fixture.projectRoot);
    await rm(excludePath);
    await mkdir(excludePath);

    const result = await invokeNode(fixture);
    assert.notEqual(result.exitCode, 0);
    assert.match(result.stderr, /could not read repository-local Git exclude/i);
    await assert.rejects(readFile(path.join(fixture.projectRoot, 'AGENTS.override.md')));
  });
});

test('a direct parent below the Git root is rejected without mutation', async () => {
  const temporaryRoot = await mkdtemp(path.join(os.tmpdir(), 'agents-override-parent-'));
  try {
    const repository = path.join(temporaryRoot, 'repository');
    const projectRoot = path.join(repository, 'nested-project');
    await mkdir(projectRoot, { recursive: true });
    await git(repository, 'init', '-q');
    const workflow = await installWorkflow(projectRoot);
    const fixture = { ...workflow, projectRoot, temporaryRoot };
    const excludePath = await excludePathFor(projectRoot);
    const excludeBefore = await readFile(excludePath, 'utf8');

    const result = await invokeNode(fixture);
    assert.notEqual(result.exitCode, 0);
    assert.match(result.stderr, /direct parent is not the Git worktree root/i);
    assert.equal(await readFile(excludePath, 'utf8'), excludeBefore);
    await assert.rejects(readFile(path.join(projectRoot, 'AGENTS.override.md')));
  } finally {
    await rm(temporaryRoot, { force: true, recursive: true });
  }
});

test('a non-repository direct parent is rejected before mutation', async () => {
  await withFixture(
    async (fixture) => {
      const result = await invokeNode(fixture);
      assert.notEqual(result.exitCode, 0);
      assert.match(result.stderr, /Git worktree root/i);
      await assert.rejects(readFile(path.join(fixture.projectRoot, 'AGENTS.override.md')));
    },
    { initializeParent: false },
  );
});

test('tracked, different, symbolic-link, and non-regular targets are preserved', async (t) => {
  const cases = [
    {
      name: 'tracked file',
      prepare: async (fixture) => {
        const target = path.join(fixture.projectRoot, 'AGENTS.override.md');
        await writeFile(target, overrideContent);
        await git(fixture.projectRoot, 'add', 'AGENTS.override.md');
        return { kind: 'file', target, value: overrideContent };
      },
      message: /tracked by Git/i,
    },
    {
      name: 'different regular file',
      prepare: async (fixture) => {
        const target = path.join(fixture.projectRoot, 'AGENTS.override.md');
        const value = '# Personal instructions\n';
        await writeFile(target, value);
        return { kind: 'file', target, value };
      },
      message: /different content/i,
    },
    {
      name: 'symbolic link',
      prepare: async (fixture) => {
        const target = path.join(fixture.projectRoot, 'AGENTS.override.md');
        const linkTarget = 'personal-agents.md';
        await writeFile(path.join(fixture.projectRoot, linkTarget), '# Personal instructions\n');
        await symlink(linkTarget, target);
        return { kind: 'symlink', target, value: linkTarget };
      },
      message: /symbolic link/i,
    },
    {
      name: 'directory',
      prepare: async (fixture) => {
        const target = path.join(fixture.projectRoot, 'AGENTS.override.md');
        await mkdir(target);
        return { kind: 'directory', target };
      },
      message: /not a regular file/i,
    },
  ];

  for (const targetCase of cases) {
    await t.test(targetCase.name, async () => {
      await withFixture(async (fixture) => {
        const targetState = await targetCase.prepare(fixture);
        const excludePath = await excludePathFor(fixture.projectRoot);
        const excludeBefore = await readFile(excludePath, 'utf8');
        const result = await invokeNode(fixture);

        assert.notEqual(result.exitCode, 0);
        assert.match(result.stderr, targetCase.message);
        assert.equal(await readFile(excludePath, 'utf8'), excludeBefore);
        if (targetState.kind === 'file') {
          assert.equal(await readFile(targetState.target, 'utf8'), targetState.value);
        } else if (targetState.kind === 'symlink') {
          assert.equal(await readlink(targetState.target), targetState.value);
        } else {
          assert.equal((await lstat(targetState.target)).isDirectory(), true);
        }
      });
    });
  }
});

test('override write failure returns non-zero without a false success report', async () => {
  await withFixture(async (fixture) => {
    const excludePath = await excludePathFor(fixture.projectRoot);
    const excludeBefore = await readFile(excludePath, 'utf8');
    await chmod(fixture.projectRoot, 0o555);
    try {
      const result = await invokeNode(fixture);
      assert.notEqual(result.exitCode, 0);
      assert.match(result.stderr, /create AGENTS\.override\.md/i);
      assert.doesNotMatch(result.stdout, /setup verified/i);
      assert.equal(await readFile(excludePath, 'utf8'), excludeBefore);
    } finally {
      await chmod(fixture.projectRoot, 0o755);
    }
  });
});

test('exclude write failure is recoverable on a later invocation', async () => {
  await withFixture(async (fixture) => {
    const excludePath = await excludePathFor(fixture.projectRoot);
    const excludeBefore = await readFile(excludePath, 'utf8');
    await chmod(excludePath, 0o444);
    try {
      const failed = await invokeNode(fixture);
      assert.notEqual(failed.exitCode, 0);
      assert.match(failed.stderr, /append Git exclude rule/i);
      assert.doesNotMatch(failed.stdout, /setup verified/i);
      assert.equal(await readFile(excludePath, 'utf8'), excludeBefore);
      assert.equal(
        await readFile(path.join(fixture.projectRoot, 'AGENTS.override.md'), 'utf8'),
        overrideContent,
      );
    } finally {
      await chmod(excludePath, 0o644);
    }

    const recovered = await invokeNode(fixture);
    assert.equal(recovered.exitCode, 0, recovered.stderr);
    assert.match(recovered.stdout, /AGENTS\.override\.md: already correct/);
    await assertIgnored(fixture.projectRoot);
  });
});

test('failed ignored-status verification is reported after writes without false success', async () => {
  await withFixture(async (fixture) => {
    const wrapperDirectory = path.join(fixture.temporaryRoot, 'bin');
    const wrapperPath = path.join(wrapperDirectory, 'git');
    await mkdir(wrapperDirectory);
    await writeFile(
      wrapperPath,
      `#!/usr/bin/env node
const { spawnSync } = require('node:child_process');
const args = process.argv.slice(2);
if (args.includes('check-ignore')) process.exit(1);
const result = spawnSync('git', args, {
  env: { ...process.env, PATH: process.env.ORIGINAL_PATH },
  stdio: 'inherit',
});
process.exit(result.status ?? 1);
`,
    );
    await chmod(wrapperPath, 0o755);

    const result = await invokeNode(fixture, {
      env: {
        ORIGINAL_PATH: process.env.PATH,
        PATH: `${wrapperDirectory}${path.delimiter}${process.env.PATH}`,
      },
    });
    assert.notEqual(result.exitCode, 0);
    assert.match(result.stderr, /verify that AGENTS\.override\.md is ignored/i);
    assert.doesNotMatch(result.stdout, /setup verified/i);
    assert.equal((await readManagedState(fixture)).override, overrideContent);
  });
});

test('linked worktrees use Git-resolved exclude metadata and remain idempotent', async () => {
  const temporaryRoot = await mkdtemp(path.join(os.tmpdir(), 'agents-override-worktree-'));
  try {
    const mainRoot = path.join(temporaryRoot, 'main');
    const projectRoot = path.join(temporaryRoot, 'linked');
    await mkdir(mainRoot);
    await git(mainRoot, 'init', '-q');
    await git(mainRoot, 'config', 'user.email', 'fixture@example.com');
    await git(mainRoot, 'config', 'user.name', 'Fixture');
    await writeFile(path.join(mainRoot, 'seed.txt'), 'seed\n');
    await git(mainRoot, 'add', 'seed.txt');
    await git(mainRoot, 'commit', '-qm', 'fixture seed');
    await git(mainRoot, 'worktree', 'add', '-q', '--detach', projectRoot, 'HEAD');
    const workflow = await installWorkflow(projectRoot);
    const fixture = { ...workflow, projectRoot, temporaryRoot };
    const excludePath = await excludePathFor(projectRoot);
    assert.equal(excludePath.startsWith(path.join(mainRoot, '.git')), true);

    const first = await invokeNode(fixture);
    assert.equal(first.exitCode, 0, first.stderr);
    const firstState = await readManagedState(fixture);
    const second = await invokeNode(fixture, { cwd: mainRoot });
    assert.equal(second.exitCode, 0, second.stderr);
    assert.deepEqual(await readManagedState(fixture), firstState);
    await assertIgnored(projectRoot);
  } finally {
    await rm(temporaryRoot, { force: true, recursive: true });
  }
});

test('all root and legacy Codex conflicts are reported before managed targets change', async () => {
  await withFixture(async (fixture) => {
    const preservedFiles = new Map([
      ['AGENTS.md', '# Shared root instructions\n'],
      ['.codex/AGENTS.md', '# Legacy Codex instructions\n'],
      ['.codex/config.toml', 'project_doc_fallback_filenames = [".codex/AGENTS.md", "TEAM.md"]\n'],
      ['.codex/hooks.json', '{"hooks":{"Stop":["manual_token_stop.py"]}}\n'],
      ['.codex/hooks/manual_token_stop.py', '# legacy hook\n'],
      ['.codex/hooks/__pycache__/manual_token_stop.pyc', 'cache\n'],
      ['.codex/state/manual-token-hook.json', '{}\n'],
    ]);
    for (const [relativePath, content] of preservedFiles) {
      const target = path.join(fixture.projectRoot, relativePath);
      await mkdir(path.dirname(target), { recursive: true });
      await writeFile(target, content);
    }
    const excludePath = await excludePathFor(fixture.projectRoot);
    const excludeBefore = await readFile(excludePath, 'utf8');

    const result = await invokeNode(fixture);
    assert.notEqual(result.exitCode, 0);
    assert.match(result.stderr, /parent-root AGENTS\.md exists/);
    assert.match(result.stderr, /\.codex\/AGENTS\.md exists/);
    assert.match(result.stderr, /fallback references \.codex\/AGENTS\.md/);
    assert.match(result.stderr, /hooks\.json configures manual-token hooks/);
    assert.match(result.stderr, /hooks\/manual_token_stop\.py/);
    assert.match(result.stderr, /__pycache__\/manual_token_stop\.pyc/);
    assert.match(result.stderr, /state\/manual-token-hook\.json/);
    for (const [relativePath, content] of preservedFiles) {
      assert.equal(await readFile(path.join(fixture.projectRoot, relativePath), 'utf8'), content);
    }
    assert.equal(await readFile(excludePath, 'utf8'), excludeBefore);
    await assert.rejects(readFile(path.join(fixture.projectRoot, 'AGENTS.override.md')));
  });
});

test('a later-added root instruction blocks an otherwise idempotent override setup', async () => {
  await withFixture(async (fixture) => {
    const first = await invokeNode(fixture);
    assert.equal(first.exitCode, 0, first.stderr);
    const excludePath = await excludePathFor(fixture.projectRoot);
    const excludeBefore = await readFile(excludePath, 'utf8');
    await writeFile(path.join(fixture.projectRoot, 'AGENTS.md'), '# Later root instructions\n');

    const second = await invokeNode(fixture);

    assert.notEqual(second.exitCode, 0);
    assert.match(second.stderr, /parent-root AGENTS\.md exists/);
    assert.equal(await readFile(excludePath, 'utf8'), excludeBefore);
    assert.equal(
      await readFile(path.join(fixture.projectRoot, 'AGENTS.override.md'), 'utf8'),
      overrideContent,
    );
  });
});

test('unrelated fallback and hook configuration do not block clean setup', async () => {
  await withFixture(async (fixture) => {
    await mkdir(path.join(fixture.projectRoot, '.codex'), { recursive: true });
    await writeFile(
      path.join(fixture.projectRoot, '.codex/config.toml'),
      'project_doc_fallback_filenames = ["TEAM.md"]\n',
    );
    await writeFile(
      path.join(fixture.projectRoot, '.codex/hooks.json'),
      '{"hooks":{"Stop":["unrelated.py"]}}\n',
    );

    const result = await invokeNode(fixture);

    assert.equal(result.exitCode, 0, result.stderr);
    assert.equal(
      await readFile(path.join(fixture.projectRoot, '.codex/config.toml'), 'utf8'),
      'project_doc_fallback_filenames = ["TEAM.md"]\n',
    );
  });
});

test('commented and unrelated later fallback arrays do not block clean setup', async () => {
  await withFixture(async (fixture) => {
    await mkdir(path.join(fixture.projectRoot, '.codex'), { recursive: true });
    await writeFile(
      path.join(fixture.projectRoot, '.codex/config.toml'),
      [
        '# project_doc_fallback_filenames = [".codex/AGENTS.md"]',
        'project_doc_fallback_filenames = ["TEAM.md"]',
        'unrelated_paths = [".codex/AGENTS.md"]',
        '',
      ].join('\n'),
    );

    const result = await invokeNode(fixture);

    assert.equal(result.exitCode, 0, result.stderr);
  });
});

test('comments inside a fallback array are ignored while quoted brackets preserve legacy detection', async () => {
  await withFixture(async (fixture) => {
    await mkdir(path.join(fixture.projectRoot, '.codex'), { recursive: true });
    const configPath = path.join(fixture.projectRoot, '.codex/config.toml');
    await writeFile(
      configPath,
      'project_doc_fallback_filenames = ["TEAM.md", # ".codex/AGENTS.md"\n"OTHER.md"]\n',
    );
    const commented = await invokeNode(fixture);
    assert.equal(commented.exitCode, 0, commented.stderr);

    await writeFile(
      configPath,
      'project_doc_fallback_filenames = ["literal].md", ".codex/AGENTS.md"]\n',
    );
    const legacy = await invokeNode(fixture);
    assert.notEqual(legacy.exitCode, 0);
    assert.match(legacy.stderr, /fallback references \.codex\/AGENTS\.md/);
  });
});
