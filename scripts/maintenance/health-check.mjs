#!/usr/bin/env node

import { spawn } from 'node:child_process';
import { constants } from 'node:fs';
import { access, lstat, readdir, readFile, stat } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

export const workflowRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');

const BOOTSTRAP_SOURCE_PATHS = [
  '.gitignore',
  'AGENTS.md',
  'README.md',
  'package.json',
  'pnpm-lock.yaml',
];

const CANONICAL_SOURCE_ROOTS = [
  '.github',
  'config',
  'docs',
  'instructions/shared',
  'prompts',
  'scripts',
  'templates',
  'wrappers',
];

const EXPECTED_WRAPPER_PATHS = [
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

const LOCAL_ONLY_ROOTS = ['artifacts', 'logs', 'plans', 'specs', 'state', 'tmp'];

const LOCAL_IGNORE_PROBES = [
  'instructions/.health-check-probe.md',
  'plans/.health-check-probe',
  'specs/.health-check-probe',
  'artifacts/.health-check-probe',
  'logs/.health-check-probe',
  'state/.health-check-probe',
  'tmp/.health-check-probe',
];

const FORBIDDEN_PATHS = [
  'changelogs',
  'instructions/ai-workflow.md',
  'prompts/generate-user-flow.md',
  'prompts/manual-preview.md',
  'prompts/plan-validator.md',
  'wrappers/generate-user-flow.md',
  'scripts/workflow/runner',
  'scripts/workflow/runner.spec.md',
  'scripts/workflow/telemetry',
  'tmp/workflow-runner-test.log',
];

const FORMAT_ROOTS = [
  '.github',
  'AGENTS.md',
  'README.md',
  'docs/codex-agent.md',
  'instructions',
  'prompts',
  'templates',
  'wrappers',
  'scripts',
  'package.json',
  'pnpm-lock.yaml',
];

const REFERENCE_ROOTS = [
  'AGENTS.md',
  'README.md',
  'docs/codex-agent.md',
  'instructions',
  'prompts',
  'templates',
  'wrappers',
];

const pathExists = async (targetPath) => {
  try {
    await access(targetPath, constants.F_OK);
    return true;
  } catch {
    return false;
  }
};

const pathEntryExists = async (targetPath) => {
  try {
    await lstat(targetPath);
    return true;
  } catch {
    return false;
  }
};

const pathIsDirectory = async (targetPath) => {
  try {
    return (await stat(targetPath)).isDirectory();
  } catch {
    return false;
  }
};

const pathIsFile = async (targetPath) => {
  try {
    return (await stat(targetPath)).isFile();
  } catch {
    return false;
  }
};

const collectFiles = async (root, targetPath, predicate) => {
  const absolutePath = path.join(root, targetPath);
  if (!(await pathExists(absolutePath))) return [];
  if (!(await pathIsDirectory(absolutePath))) {
    return predicate(targetPath) ? [targetPath] : [];
  }

  const collected = [];
  for (const entry of await readdir(absolutePath, { withFileTypes: true })) {
    if (['.git', 'node_modules'].includes(entry.name)) {
      continue;
    }
    const relativePath = path.posix.join(targetPath, entry.name);
    if (entry.isDirectory()) {
      collected.push(...(await collectFiles(root, relativePath, predicate)));
    } else if (predicate(relativePath)) {
      collected.push(relativePath);
    }
  }
  return collected;
};

const collectFromRoots = async (root, roots, predicate) => {
  const files = await Promise.all(
    roots.map((sourceRoot) => collectFiles(root, sourceRoot, predicate)),
  );
  return [...new Set(files.flat())].sort();
};

const runCommand = (command) =>
  new Promise((resolve) => {
    const child = spawn(command.command, command.args, {
      cwd: command.cwd,
      env: process.env,
      stdio: ['ignore', 'pipe', 'pipe'],
    });
    let stdout = '';
    let stderr = '';
    child.stdout.setEncoding('utf8');
    child.stderr.setEncoding('utf8');
    child.stdout.on('data', (chunk) => (stdout += chunk));
    child.stderr.on('data', (chunk) => (stderr += chunk));
    child.on('error', (error) => resolve({ exitCode: 127, stdout, stderr: error.message }));
    child.on('close', (exitCode) => resolve({ exitCode: exitCode ?? 1, stdout, stderr }));
  });

export const parseHealthCheckArgs = (args) => {
  if (args.length === 0) return { full: false };
  if (args.length === 1 && args[0] === '--full') return { full: true };
  if (args.length === 1 && ['-h', '--help'].includes(args[0])) {
    return { help: true, full: false };
  }
  return { error: `Unknown option: ${args.join(' ')}`, full: false };
};

const runStep = async ({ label, command, commandExecutor, root, stderr }) => {
  const result = await commandExecutor({ ...command, cwd: root });
  if (result.exitCode === 0) return { ok: true, result };
  stderr(`FAIL ${label}`);
  if (result.stdout?.trim()) stderr(result.stdout.trim());
  if (result.stderr?.trim()) stderr(result.stderr.trim());
  return { ok: false, result };
};

const gitCheck = async ({ label, args, expectExitCode, commandExecutor, root, stderr }) => {
  const result = await commandExecutor({
    command: 'git',
    args,
    cwd: root,
  });
  if (result.exitCode === expectExitCode) return true;
  stderr(`FAIL ${label}`);
  if (result.stdout?.trim()) stderr(result.stdout.trim());
  if (result.stderr?.trim()) stderr(result.stderr.trim());
  return false;
};

const listTrackedPaths = async ({ commandExecutor, cwd, pathspecs }) => {
  const result = await commandExecutor({
    command: 'git',
    args: ['ls-files', '-z', '--', ...pathspecs],
    cwd,
  });
  return {
    ...result,
    paths: result.stdout.split('\0').filter(Boolean).sort(),
  };
};

const validateNestedRepository = async ({ commandExecutor, root, stderr }) => {
  const nestedGit = await commandExecutor({
    command: 'git',
    args: ['rev-parse', '--show-toplevel'],
    cwd: root,
  });
  if (nestedGit.exitCode !== 0) {
    stderr('FAIL inspect nested Git repository');
    if (nestedGit.stdout?.trim()) stderr(nestedGit.stdout.trim());
    if (nestedGit.stderr?.trim()) stderr(nestedGit.stderr.trim());
    return false;
  }

  const detectedRoot = nestedGit.stdout.trim();
  if (!detectedRoot) {
    stderr('FAIL inspect nested Git repository: empty top-level path');
    return false;
  }
  if (path.resolve(detectedRoot) !== root) {
    stderr(`FAIL inspect nested Git repository: unexpected top-level path ${detectedRoot}`);
    return false;
  }

  return true;
};

const validateCanonicalSource = async ({ commandExecutor, root, stderr }) => {
  const discovered = [
    ...BOOTSTRAP_SOURCE_PATHS,
    ...(await collectFromRoots(root, CANONICAL_SOURCE_ROOTS, () => true)),
  ].sort();

  for (const relativePath of discovered) {
    if (!(await pathIsFile(path.join(root, relativePath)))) {
      stderr(`FAIL required source is missing or not a file: ${relativePath}`);
      return false;
    }
  }

  for (const relativePath of EXPECTED_WRAPPER_PATHS) {
    const wrapperPath = path.join(root, relativePath);
    if (!(await pathExists(wrapperPath))) {
      stderr(`FAIL missing expected wrapper: ${relativePath}`);
      return false;
    }
    if (!(await pathIsFile(wrapperPath))) {
      stderr(`FAIL expected wrapper is not a file: ${relativePath}`);
      return false;
    }
  }

  for (const relativePath of discovered) {
    if (
      !(await gitCheck({
        label: `canonical source is allowlisted: ${relativePath}`,
        args: ['check-ignore', '--no-index', '-q', '--', relativePath],
        expectExitCode: 1,
        commandExecutor,
        root,
        stderr,
      }))
    ) {
      return false;
    }
  }

  const tracked = await listTrackedPaths({
    commandExecutor,
    cwd: root,
    pathspecs: [...BOOTSTRAP_SOURCE_PATHS, ...CANONICAL_SOURCE_ROOTS],
  });
  if (tracked.exitCode !== 0) {
    stderr('FAIL list nested tracked source');
    if (tracked.stderr?.trim()) stderr(tracked.stderr.trim());
    return false;
  }

  const trackedPaths = new Set(tracked.paths);
  const untracked = discovered.filter((relativePath) => !trackedPaths.has(relativePath));
  if (untracked.length > 0) {
    stderr(`FAIL canonical source is untracked:\n${untracked.join('\n')}`);
    return false;
  }

  const missing = [];
  for (const relativePath of tracked.paths) {
    if (!(await pathIsFile(path.join(root, relativePath)))) {
      missing.push(relativePath);
    }
  }
  if (missing.length > 0) {
    stderr(`FAIL tracked source is missing or not a file:\n${missing.join('\n')}`);
    return false;
  }

  return true;
};

const isLocalInstructionPath = (relativePath) =>
  relativePath.startsWith('instructions/') && !relativePath.startsWith('instructions/shared/');

const validateLocalPaths = async ({ commandExecutor, instructionRoutes, root, stderr }) => {
  const localFiles = await collectFromRoots(root, LOCAL_ONLY_ROOTS, () => true);
  const localInstructionFiles = await collectFiles(root, 'instructions', isLocalInstructionPath);
  const routedLocalInstructions = instructionRoutes
    .filter((route) => !route.startsWith('shared/'))
    .map((route) => path.posix.join('instructions', route));
  const ignorePaths = [
    ...new Set([
      ...LOCAL_IGNORE_PROBES,
      ...localFiles,
      ...localInstructionFiles,
      ...routedLocalInstructions,
    ]),
  ].sort();

  for (const relativePath of ignorePaths) {
    if (
      !(await gitCheck({
        label: `local path remains ignored: ${relativePath}`,
        args: ['check-ignore', '--no-index', '-q', '--', relativePath],
        expectExitCode: 0,
        commandExecutor,
        root,
        stderr,
      }))
    ) {
      return false;
    }
  }

  const tracked = await listTrackedPaths({
    commandExecutor,
    cwd: root,
    pathspecs: ['instructions', ...LOCAL_ONLY_ROOTS],
  });
  if (tracked.exitCode !== 0) {
    stderr('FAIL list tracked local workflow paths');
    if (tracked.stderr?.trim()) stderr(tracked.stderr.trim());
    return false;
  }
  const trackedLocalPaths = tracked.paths.filter(
    (relativePath) =>
      isLocalInstructionPath(relativePath) ||
      LOCAL_ONLY_ROOTS.some(
        (localRoot) => relativePath === localRoot || relativePath.startsWith(`${localRoot}/`),
      ),
  );
  if (trackedLocalPaths.length > 0) {
    stderr(`FAIL local path is tracked:\n${trackedLocalPaths.join('\n')}`);
    return false;
  }
  return true;
};

const validateLiteralReferences = async ({ root, stderr }) => {
  const markdownFiles = await collectFromRoots(root, REFERENCE_ROOTS, (file) =>
    file.endsWith('.md'),
  );
  const missing = new Set();

  for (const markdownFile of markdownFiles) {
    const source = await readFile(path.join(root, markdownFile), 'utf8');
    for (const match of source.matchAll(/\.ai\/[A-Za-z0-9_./*<>@-]+/g)) {
      const reference = match[0].replace(/[.,;:]+$/, '');
      if (/[<>*]/.test(reference)) continue;
      if (/^\.ai\/(artifacts|logs|plans|specs|state)(\/|$)/.test(reference)) {
        continue;
      }
      const target = path.resolve(root, '..', reference);
      if (!(await pathExists(target))) {
        missing.add(`${markdownFile}: ${reference}`);
      }
    }
  }

  if (missing.size === 0) return true;
  stderr(`FAIL missing literal .ai references:\n${[...missing].sort().join('\n')}`);
  return false;
};

const readInstructionRoutes = async ({ root, stderr }) => {
  const indexPath = path.join(root, 'instructions/index.md');
  if (!(await pathExists(indexPath))) {
    stderr('FAIL missing local instruction index: instructions/index.md');
    return null;
  }

  const indexSource = await readFile(indexPath, 'utf8');
  const rulesHeading = /^## Rules\s*$/m.exec(indexSource);
  if (!rulesHeading) {
    stderr('FAIL instruction index is missing its Rules section');
    return null;
  }
  const afterHeading = indexSource.slice(rulesHeading.index + rulesHeading[0].length);
  const nextSection = afterHeading.search(/^## /m);
  const rulesSource = nextSection < 0 ? afterHeading : afterHeading.slice(0, nextSection);
  const loadBullets = [];
  let currentBullet;
  for (const line of rulesSource.split('\n')) {
    if (line.startsWith('- ')) {
      if (currentBullet?.includes('Load ')) loadBullets.push(currentBullet);
      currentBullet = line;
    } else if (currentBullet !== undefined) {
      currentBullet += `\n${line}`;
    }
  }
  if (currentBullet?.includes('Load ')) loadBullets.push(currentBullet);

  const routes = new Set();
  for (const bullet of loadBullets) {
    for (const match of bullet.matchAll(/`((?:shared\/)?[a-z0-9-]+\.md)`/g)) {
      routes.add(match[1]);
    }
  }
  return [...routes].sort();
};

const validateInstructionRoutes = async ({ instructionRoutes, root, stderr }) => {
  const missing = new Set();
  for (const route of instructionRoutes) {
    if (!(await pathIsFile(path.join(root, 'instructions', route)))) {
      missing.add(route);
    }
  }

  if (missing.size === 0) return true;
  stderr(`FAIL missing relative instruction routes:\n${[...missing].sort().join('\n')}`);
  return false;
};

const validateParentIndex = async ({ commandExecutor, root, stdout, stderr }) => {
  const parentRoot = path.dirname(root);
  const parentGitEntry = path.join(parentRoot, '.git');
  try {
    await lstat(parentGitEntry);
  } catch (error) {
    if (error?.code === 'ENOENT') {
      stdout('SKIP parent .ai index isolation: not applicable');
      return true;
    }
    stderr('FAIL inspect parent Git repository entry');
    stderr(error instanceof Error ? error.message : String(error));
    return false;
  }

  const parentGit = await commandExecutor({
    command: 'git',
    args: ['rev-parse', '--show-toplevel'],
    cwd: parentRoot,
  });
  if (parentGit.exitCode !== 0) {
    stderr('FAIL inspect parent Git repository');
    if (parentGit.stdout?.trim()) stderr(parentGit.stdout.trim());
    if (parentGit.stderr?.trim()) stderr(parentGit.stderr.trim());
    return false;
  }

  const detectedRoot = parentGit.stdout.trim();
  if (!detectedRoot) {
    stderr('FAIL inspect parent Git repository: empty top-level path');
    return false;
  }
  if (path.resolve(detectedRoot) !== parentRoot) {
    stderr(`FAIL inspect parent Git repository: unexpected top-level path ${detectedRoot}`);
    return false;
  }

  const tracked = await listTrackedPaths({
    commandExecutor,
    cwd: parentRoot,
    pathspecs: ['.ai'],
  });
  if (tracked.exitCode !== 0) {
    stderr('FAIL list parent tracked .ai paths');
    if (tracked.stderr?.trim()) stderr(tracked.stderr.trim());
    return false;
  }
  if (tracked.paths.length === 0) return true;

  stderr(`FAIL parent tracks .ai paths:\n${tracked.paths.join('\n')}`);
  return false;
};

export const runHealthCheck = async ({
  args = process.argv.slice(2),
  commandExecutor = runCommand,
  stdout = console.log,
  stderr = console.error,
  workflowDirectory = workflowRoot,
} = {}) => {
  const root = path.resolve(workflowDirectory);
  const options = parseHealthCheckArgs(args);
  if (options.help) {
    stdout('Usage: node scripts/maintenance/health-check.mjs [--full]');
    return { ok: true, root };
  }
  if (options.error) {
    stderr(`FAIL parse arguments: ${options.error}`);
    return { ok: false, root };
  }

  if (!(await validateNestedRepository({ commandExecutor, root, stderr }))) {
    return { ok: false, root };
  }

  for (const relativePath of FORBIDDEN_PATHS) {
    if (await pathEntryExists(path.join(root, relativePath))) {
      stderr(`FAIL retired workflow path still exists: ${relativePath}`);
      return { ok: false, root };
    }
  }

  if (!(await validateCanonicalSource({ commandExecutor, root, stderr }))) {
    return { ok: false, root };
  }

  const instructionRoutes = await readInstructionRoutes({ root, stderr });
  if (!instructionRoutes) return { ok: false, root };

  if (!(await validateLocalPaths({ commandExecutor, instructionRoutes, root, stderr }))) {
    return { ok: false, root };
  }
  if (!(await validateLiteralReferences({ root, stderr }))) {
    return { ok: false, root };
  }
  if (!(await validateInstructionRoutes({ instructionRoutes, root, stderr }))) {
    return { ok: false, root };
  }
  if (!(await validateParentIndex({ commandExecutor, root, stdout, stderr }))) {
    return { ok: false, root };
  }

  const formatFiles = await collectFromRoots(root, FORMAT_ROOTS, (file) =>
    /\.(md|mjs|ts|json|yaml)$/.test(file),
  );
  const formatStep = await runStep({
    label: 'workflow Markdown and script formatting',
    command: {
      command: 'pnpm',
      args: ['exec', 'prettier', '--check', ...formatFiles],
    },
    commandExecutor,
    root,
    stderr,
  });
  if (!formatStep.ok) return { ok: false, root };

  if (options.full) {
    const testFiles = await collectFiles(root, 'scripts', (file) => /\.test\.(mjs|ts)$/.test(file));
    const testStep = await runStep({
      label: 'workflow script tests',
      command: {
        command: process.execPath,
        args: ['--import', 'tsx', '--test', ...testFiles.sort()],
      },
      commandExecutor,
      root,
      stderr,
    });
    if (!testStep.ok) return { ok: false, root };
  }

  stdout('PASS .ai health check');
  return { ok: true, root };
};

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const result = await runHealthCheck();
  process.exitCode = result.ok ? 0 : 1;
}
