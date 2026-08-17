#!/usr/bin/env node

import { lstat, mkdir, readdir, rmdir, unlink } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

export const workflowRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
export const LOCAL_RECORD_ROOTS = ['artifacts', 'logs', 'plans', 'specs', 'state', 'tmp'];

const isContained = (root, targetPath) => {
  const relativePath = path.relative(root, targetPath);
  return relativePath !== '' && !relativePath.startsWith(`..${path.sep}`) && relativePath !== '..';
};

const relativeToWorkflow = (root, targetPath) =>
  path.relative(root, targetPath).split(path.sep).join('/');

export const parseCleanupArgs = (args) => {
  if (args.length === 0) return { apply: false };
  if (args.length === 1 && args[0] === '--apply') return { apply: true };
  if (args.length === 1 && ['-h', '--help'].includes(args[0])) return { apply: false, help: true };
  return { apply: false, error: `Unknown option: ${args.join(' ')}` };
};

const collectRootEntries = async ({ root, rootPath }) => {
  let metadata;
  try {
    metadata = await lstat(rootPath);
  } catch (error) {
    if (error.code === 'ENOENT') return [];
    throw error;
  }
  if (metadata.isSymbolicLink()) {
    throw new Error(
      `unsafe managed root is a symbolic link: ${relativeToWorkflow(root, rootPath)}`,
    );
  }
  if (!metadata.isDirectory()) {
    throw new Error(
      `unsafe managed root is not a directory: ${relativeToWorkflow(root, rootPath)}`,
    );
  }
  if (!isContained(root, rootPath)) {
    throw new Error(`unsafe managed root escapes the workflow directory: ${rootPath}`);
  }

  const entries = [];
  const visit = async (directoryPath) => {
    const children = await readdir(directoryPath, { withFileTypes: true });
    for (const child of children) {
      const childPath = path.join(directoryPath, child.name);
      if (!isContained(root, childPath)) {
        throw new Error(`unsafe cleanup target escapes the workflow directory: ${childPath}`);
      }
      entries.push({
        directory: child.isDirectory() && !child.isSymbolicLink(),
        path: childPath,
        relativePath: relativeToWorkflow(root, childPath),
      });
      if (child.isDirectory() && !child.isSymbolicLink()) {
        await visit(childPath);
      }
    }
  };

  await visit(rootPath);
  return entries;
};

export const preflightCleanup = async ({ workflowDirectory = workflowRoot } = {}) => {
  const root = path.resolve(workflowDirectory);
  const rootMetadata = await lstat(root);
  if (!rootMetadata.isDirectory() || rootMetadata.isSymbolicLink()) {
    throw new Error(`workflow directory is not a safe directory: ${root}`);
  }

  const roots = LOCAL_RECORD_ROOTS.map((relativePath) => path.join(root, relativePath));
  const entries = (
    await Promise.all(roots.map((rootPath) => collectRootEntries({ root, rootPath })))
  )
    .flat()
    .sort((left, right) => left.relativePath.localeCompare(right.relativePath));
  return { entries, root, roots };
};

const removeEntry = async (entry) => {
  if (entry.directory) {
    await rmdir(entry.path);
  } else {
    await unlink(entry.path);
  }
};

export const verifyManagedRoots = async (roots) => {
  for (const rootPath of roots) {
    const metadata = await lstat(rootPath);
    if (metadata.isSymbolicLink() || !metadata.isDirectory()) {
      throw new Error(`managed root is not an empty directory: ${rootPath}`);
    }
    const entries = await readdir(rootPath);
    if (entries.length > 0) {
      throw new Error(`managed root is not empty: ${rootPath}`);
    }
  }
};

const printTargets = ({ entries, output, verb }) => {
  for (const entry of entries) output(`${verb} ${entry.relativePath}`);
};

export const runCleanup = async ({
  args = process.argv.slice(2),
  output = console.log,
  remove = removeEntry,
  workflowDirectory = workflowRoot,
} = {}) => {
  const options = parseCleanupArgs(args);
  if (options.help) {
    output('Usage: pnpm cleanup:local [--apply]');
    output('Without --apply, inspect local workflow records without mutation.');
    output(
      '--apply removes every entry under artifacts/, logs/, plans/, specs/, state/, and tmp/.',
    );
    return { ok: true };
  }
  if (options.error) {
    output(`FAIL cleanup:local: ${options.error}`);
    return { ok: false };
  }

  let preflight;
  try {
    preflight = await preflightCleanup({ workflowDirectory });
  } catch (error) {
    output(`FAIL cleanup:local preflight: ${error.message}`);
    return { ok: false };
  }

  if (!options.apply) {
    printTargets({ entries: preflight.entries, output, verb: 'Would remove' });
    output(`Cleanup preview target count: ${preflight.entries.length}`);
    output('No mutation occurred.');
    output(
      'WARNING: --apply removes active specs, plans, and artifacts as well as completed records.',
    );
    return { entries: preflight.entries, ok: true };
  }

  output(
    'WARNING: --apply removes active specs, plans, and artifacts as well as completed records.',
  );
  const deletionOrder = [...preflight.entries].sort((left, right) => {
    const depthDifference =
      right.relativePath.split('/').length - left.relativePath.split('/').length;
    return depthDifference || left.relativePath.localeCompare(right.relativePath);
  });
  const removed = [];
  for (const entry of deletionOrder) {
    try {
      await remove(entry);
      removed.push(entry);
    } catch (error) {
      output(`FAIL cleanup:local deletion: ${entry.relativePath}: ${error.message}`);
      output(`Cleanup removed count before failure: ${removed.length}`);
      return { entries: preflight.entries, ok: false, removed };
    }
  }

  try {
    await Promise.all(preflight.roots.map((rootPath) => mkdir(rootPath, { recursive: true })));
    await verifyManagedRoots(preflight.roots);
  } catch (error) {
    output(`FAIL cleanup:local root postcondition: ${error.message}`);
    return { entries: preflight.entries, ok: false, removed };
  }

  printTargets({ entries: preflight.entries, output, verb: 'Removed' });
  output(`Cleanup removed count: ${removed.length}`);
  output('All managed local-record roots are present and empty.');
  return { entries: preflight.entries, ok: true, removed };
};

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const result = await runCleanup();
  process.exitCode = result.ok ? 0 : 1;
}
