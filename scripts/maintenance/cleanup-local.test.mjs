import assert from 'node:assert/strict';
import { lstat, mkdir, mkdtemp, readFile, readdir, rm, symlink, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';

import { LOCAL_RECORD_ROOTS, runCleanup, verifyManagedRoots } from './cleanup-local.mjs';

const createFixture = async () => {
  const temporaryRoot = await mkdtemp(path.join(os.tmpdir(), 'cleanup-local-'));
  const workflowDirectory = path.join(temporaryRoot, '.ai');
  await mkdir(workflowDirectory);
  return { temporaryRoot, workflowDirectory };
};

const withFixture = async (callback) => {
  const fixture = await createFixture();
  try {
    await callback(fixture);
  } finally {
    await rm(fixture.temporaryRoot, { force: true, recursive: true });
  }
};

const run = async (fixture, options = {}) => {
  const output = [];
  const result = await runCleanup({
    output: (line) => output.push(line),
    workflowDirectory: fixture.workflowDirectory,
    ...options,
  });
  return { output, result };
};

test('preview is deterministic and never mutates ordinary, hidden, nested, or linked entries', async () => {
  await withFixture(async (fixture) => {
    const plans = path.join(fixture.workflowDirectory, 'plans');
    const external = path.join(fixture.temporaryRoot, 'external.txt');
    await mkdir(path.join(plans, 'nested'), { recursive: true });
    await writeFile(path.join(plans, '.hidden'), 'hidden\n');
    await writeFile(path.join(plans, 'nested', 'plan.md'), 'plan\n');
    await writeFile(external, 'external\n');
    await symlink(external, path.join(plans, 'linked-external'));

    const before = await readFile(path.join(plans, 'nested', 'plan.md'), 'utf8');
    const { output, result } = await run(fixture);

    assert.equal(result.ok, true);
    assert.deepEqual(
      output.filter((line) => line.startsWith('Would remove ')),
      [
        'Would remove plans/.hidden',
        'Would remove plans/linked-external',
        'Would remove plans/nested',
        'Would remove plans/nested/plan.md',
      ],
    );
    assert.match(output.join('\n'), /target count: 4/);
    assert.match(output.join('\n'), /No mutation occurred/);
    assert.match(output.join('\n'), /WARNING: --apply removes active specs, plans, and artifacts/);
    assert.equal(await readFile(path.join(plans, 'nested', 'plan.md'), 'utf8'), before);
    assert.equal(await readFile(external, 'utf8'), 'external\n');
  });
});

test('apply removes every entry without traversing links and leaves all managed roots empty', async () => {
  await withFixture(async (fixture) => {
    const external = path.join(fixture.temporaryRoot, 'external.txt');
    await writeFile(external, 'external\n');
    await mkdir(path.join(fixture.workflowDirectory, 'artifacts', 'nested'), { recursive: true });
    await writeFile(path.join(fixture.workflowDirectory, 'artifacts', '.hidden'), 'hidden\n');
    await writeFile(
      path.join(fixture.workflowDirectory, 'artifacts', 'nested', 'record.md'),
      'record\n',
    );
    await symlink(external, path.join(fixture.workflowDirectory, 'artifacts', 'linked-external'));

    const { output, result } = await run(fixture, { args: ['--apply'] });

    assert.equal(result.ok, true, output.join('\n'));
    assert.match(output.join('\n'), /Cleanup removed count: 4/);
    assert.match(output.join('\n'), /WARNING: --apply removes active specs, plans, and artifacts/);
    assert.equal(await readFile(external, 'utf8'), 'external\n');
    for (const localRoot of LOCAL_RECORD_ROOTS) {
      assert.deepEqual(await readdir(path.join(fixture.workflowDirectory, localRoot)), []);
    }
  });
});

test('empty and missing roots succeed without preview mutation and apply creates all roots', async () => {
  await withFixture(async (fixture) => {
    const preview = await run(fixture);
    assert.equal(preview.result.ok, true);
    assert.match(preview.output.join('\n'), /target count: 0/);
    await assert.rejects(lstat(path.join(fixture.workflowDirectory, 'tmp')));

    const applied = await run(fixture, { args: ['--apply'] });
    assert.equal(applied.result.ok, true, applied.output.join('\n'));
    for (const localRoot of LOCAL_RECORD_ROOTS) {
      assert.equal(
        (await lstat(path.join(fixture.workflowDirectory, localRoot))).isDirectory(),
        true,
      );
    }
  });
});

test('help and invalid arguments return without mutation', async () => {
  await withFixture(async (fixture) => {
    await mkdir(path.join(fixture.workflowDirectory, 'plans'), { recursive: true });
    await writeFile(path.join(fixture.workflowDirectory, 'plans', 'record.md'), 'record\n');
    const help = await run(fixture, { args: ['--help'] });
    const invalid = await run(fixture, { args: ['--force'] });

    assert.equal(help.result.ok, true);
    assert.match(help.output.join('\n'), /Usage: pnpm cleanup:local/);
    assert.equal(invalid.result.ok, false);
    assert.match(invalid.output.join('\n'), /Unknown option: --force/);
    assert.equal(
      await readFile(path.join(fixture.workflowDirectory, 'plans', 'record.md'), 'utf8'),
      'record\n',
    );
  });
});

test('unsafe root links fail before deleting another managed root', async () => {
  await withFixture(async (fixture) => {
    const externalRoot = path.join(fixture.temporaryRoot, 'external-root');
    await mkdir(externalRoot);
    await mkdir(path.join(fixture.workflowDirectory, 'plans'), { recursive: true });
    await writeFile(path.join(fixture.workflowDirectory, 'plans', 'record.md'), 'record\n');
    await symlink(externalRoot, path.join(fixture.workflowDirectory, 'tmp'));

    const applied = await run(fixture, { args: ['--apply'] });

    assert.equal(applied.result.ok, false);
    assert.match(applied.output.join('\n'), /unsafe managed root is a symbolic link: tmp/);
    assert.equal(
      await readFile(path.join(fixture.workflowDirectory, 'plans', 'record.md'), 'utf8'),
      'record\n',
    );
  });
});

test('a dangling managed-root link fails before deleting another managed root', async () => {
  await withFixture(async (fixture) => {
    await mkdir(path.join(fixture.workflowDirectory, 'plans'), { recursive: true });
    await writeFile(path.join(fixture.workflowDirectory, 'plans', 'record.md'), 'record\n');
    await symlink('missing-root', path.join(fixture.workflowDirectory, 'tmp'));

    const applied = await run(fixture, { args: ['--apply'] });

    assert.equal(applied.result.ok, false);
    assert.match(applied.output.join('\n'), /unsafe managed root is a symbolic link: tmp/);
    assert.equal(
      await readFile(path.join(fixture.workflowDirectory, 'plans', 'record.md'), 'utf8'),
      'record\n',
    );
  });
});

test('a deletion failure identifies the incomplete target and never reports success', async () => {
  await withFixture(async (fixture) => {
    await mkdir(path.join(fixture.workflowDirectory, 'plans'), { recursive: true });
    await writeFile(path.join(fixture.workflowDirectory, 'plans', 'record.md'), 'record\n');
    const applied = await run(fixture, {
      args: ['--apply'],
      remove: async () => {
        throw new Error('simulated failure');
      },
    });

    assert.equal(applied.result.ok, false);
    assert.match(applied.output.join('\n'), /deletion: plans\/record\.md: simulated failure/);
    assert.doesNotMatch(
      applied.output.join('\n'),
      /All managed local-record roots are present and empty/,
    );
    assert.equal(
      await readFile(path.join(fixture.workflowDirectory, 'plans', 'record.md'), 'utf8'),
      'record\n',
    );
  });
});

test('managed-root postcondition verification rejects links and remaining entries', async () => {
  await withFixture(async (fixture) => {
    const roots = LOCAL_RECORD_ROOTS.map((localRoot) =>
      path.join(fixture.workflowDirectory, localRoot),
    );
    await Promise.all(roots.map((root) => mkdir(root, { recursive: true })));
    await writeFile(path.join(roots[0], 'concurrent-record.md'), 'record\n');
    await assert.rejects(verifyManagedRoots(roots), /managed root is not empty/);
    await rm(roots[0], { force: true, recursive: true });
    await symlink('missing-root', roots[0]);
    await assert.rejects(verifyManagedRoots(roots), /managed root is not an empty directory/);
  });
});
