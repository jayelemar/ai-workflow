#!/usr/bin/env node

import { spawn } from 'node:child_process';
import { writeSync } from 'node:fs';
import { appendFile, lstat, readdir, readFile, stat, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const OVERRIDE_NAME = 'AGENTS.override.md';
const EXCLUDE_RULE = `/${OVERRIDE_NAME}`;
const OVERRIDE_CONTENT = `# Local Project AI Instructions

Read and follow \`.ai/AGENTS.md\` before starting work.
Use \`.ai/instructions/index.md\` to load only instructions relevant to the request.
`;
const REQUIRED_WORKFLOW_FILES = ['AGENTS.md', 'instructions/index.md'];

const workflowRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const projectRoot = path.dirname(workflowRoot);
const overridePath = path.join(projectRoot, OVERRIDE_NAME);
const gitEnvironment = Object.fromEntries(
  Object.entries(process.env).filter(([name]) => !name.toUpperCase().startsWith('GIT_')),
);

const writeOutput = (message) => writeSync(process.stdout.fd, `${message}\n`);
const writeError = (message) => writeSync(process.stderr.fd, `${message}\n`);

const describeCommandFailure = (result) => {
  const detail = result.stderr.trim() || result.stdout.trim();
  return detail || `Git exited with status ${result.exitCode}`;
};

const runCommand = (command, args, cwd, env) =>
  new Promise((resolve) => {
    const child = spawn(command, args, {
      cwd,
      env,
      stdio: ['ignore', 'pipe', 'pipe'],
    });
    let stdout = '';
    let stderr = '';
    child.stdout.setEncoding('utf8');
    child.stderr.setEncoding('utf8');
    child.stdout.on('data', (chunk) => (stdout += chunk));
    child.stderr.on('data', (chunk) => (stderr += chunk));
    child.on('error', (error) => resolve({ exitCode: 127, stderr: error.message, stdout }));
    child.on('close', (exitCode) => resolve({ exitCode: exitCode ?? 1, stderr, stdout }));
  });

const runGit = (args) => runCommand('git', args, projectRoot, gitEnvironment);

const readOptionalFile = async (targetPath, label) => {
  try {
    return await readFile(targetPath, 'utf8');
  } catch (error) {
    if (error.code === 'ENOENT') return null;
    throw new Error(`could not read ${label}: ${error.message}`);
  }
};

const entryExists = async (targetPath) => {
  try {
    await lstat(targetPath);
    return true;
  } catch (error) {
    if (error.code === 'ENOENT') return false;
    throw error;
  }
};

const collectMatchingEntries = async (directoryPath, namePattern) => {
  try {
    const entries = await readdir(directoryPath, { withFileTypes: true });
    const matches = [];
    for (const entry of entries) {
      const entryPath = path.join(directoryPath, entry.name);
      if (namePattern.test(entry.name)) matches.push(entryPath);
      if (entry.isDirectory() && !entry.isSymbolicLink()) {
        matches.push(...(await collectMatchingEntries(entryPath, namePattern)));
      }
    }
    return matches;
  } catch (error) {
    if (error.code === 'ENOENT') return [];
    throw error;
  }
};

const fallbackReferencesLegacyAgents = (config) => {
  const assignment = /^[ \t]*project_doc_fallback_filenames[ \t]*=[ \t]*/m.exec(config);
  if (!assignment) return false;

  let index = assignment.index + assignment[0].length;
  while (/\s/.test(config[index] ?? '')) index += 1;
  if (config[index] !== '[') return false;

  let depth = 0;
  let quote;
  let value = '';
  const values = [];
  for (; index < config.length; index += 1) {
    const character = config[index];
    if (quote) {
      if (character === '\\') {
        const escaped = config[index + 1];
        if (escaped === undefined) return false;
        value += escaped;
        index += 1;
      } else if (character === quote) {
        values.push(value);
        value = '';
        quote = undefined;
      } else {
        value += character;
      }
      continue;
    }
    if (character === '#') {
      while (index < config.length && config[index] !== '\n') index += 1;
      continue;
    }
    if (character === '"' || character === "'") {
      quote = character;
      value = '';
    } else if (character === '[') {
      depth += 1;
    } else if (character === ']') {
      depth -= 1;
      if (depth === 0) return values.includes('.codex/AGENTS.md');
      if (depth < 0) return false;
    }
  }
  return false;
};

const detectLegacyConflicts = async () => {
  const conflicts = [];
  const rootAgentsPath = path.join(projectRoot, 'AGENTS.md');
  if (await entryExists(rootAgentsPath)) conflicts.push('parent-root AGENTS.md exists');

  const codexAgentsPath = path.join(projectRoot, '.codex', 'AGENTS.md');
  if (await entryExists(codexAgentsPath)) conflicts.push('.codex/AGENTS.md exists');

  const configPath = path.join(projectRoot, '.codex', 'config.toml');
  const config = await readOptionalFile(configPath, '.codex/config.toml');
  if (config !== null && fallbackReferencesLegacyAgents(config)) {
    conflicts.push('.codex/config.toml fallback references .codex/AGENTS.md');
  }

  const hooksConfigPath = path.join(projectRoot, '.codex', 'hooks.json');
  const hooksConfig = await readOptionalFile(hooksConfigPath, '.codex/hooks.json');
  if (hooksConfig !== null && /manual_token_|manual-token-/.test(hooksConfig)) {
    conflicts.push('.codex/hooks.json configures manual-token hooks');
  }

  const hookEntries = await collectMatchingEntries(
    path.join(projectRoot, '.codex', 'hooks'),
    /^manual_token_/,
  );
  for (const entryPath of hookEntries) {
    conflicts.push(path.relative(projectRoot, entryPath).split(path.sep).join('/'));
  }

  const stateEntries = await collectMatchingEntries(
    path.join(projectRoot, '.codex', 'state'),
    /^manual-token-/,
  );
  for (const entryPath of stateEntries) {
    conflicts.push(path.relative(projectRoot, entryPath).split(path.sep).join('/'));
  }

  return conflicts.sort();
};

const inspectOverride = async () => {
  let metadata;
  try {
    metadata = await lstat(overridePath);
  } catch (error) {
    if (error.code === 'ENOENT') return { exists: false };
    throw new Error(`could not inspect ${OVERRIDE_NAME}: ${error.message}`);
  }

  if (metadata.isSymbolicLink()) {
    throw new Error(`${OVERRIDE_NAME} is a symbolic link; resolve it explicitly before setup`);
  }
  if (!metadata.isFile()) {
    throw new Error(`${OVERRIDE_NAME} is not a regular file; resolve it explicitly before setup`);
  }

  const content = await readOptionalFile(overridePath, OVERRIDE_NAME);
  if (content !== OVERRIDE_CONTENT) {
    throw new Error(`${OVERRIDE_NAME} has different content; it was preserved`);
  }
  return { exists: true };
};

const requireWorkflowFiles = async () => {
  if (path.basename(workflowRoot) !== '.ai') {
    throw new Error(`setup utility is not installed under a direct .ai directory: ${workflowRoot}`);
  }

  for (const relativePath of REQUIRED_WORKFLOW_FILES) {
    const targetPath = path.join(workflowRoot, relativePath);
    let metadata;
    try {
      metadata = await stat(targetPath);
    } catch (error) {
      if (error.code === 'ENOENT') {
        throw new Error(`required workflow file is missing: .ai/${relativePath}`);
      }
      throw new Error(
        `could not inspect required workflow file .ai/${relativePath}: ${error.message}`,
      );
    }
    if (!metadata.isFile()) {
      throw new Error(`required workflow file is not a regular file: .ai/${relativePath}`);
    }
    if (metadata.size === 0) {
      throw new Error(`required workflow file is empty: .ai/${relativePath}`);
    }
  }
};

const resolveParentGit = async () => {
  const rootResult = await runGit(['rev-parse', '--show-toplevel']);
  if (rootResult.exitCode !== 0) {
    throw new Error(
      `direct parent is not a Git worktree root: ${describeCommandFailure(rootResult)}`,
    );
  }
  const detectedRoot = rootResult.stdout.trim();
  if (!detectedRoot || path.resolve(detectedRoot) !== projectRoot) {
    throw new Error(
      `direct parent is not the Git worktree root (Git resolved ${detectedRoot || 'no root'})`,
    );
  }

  const excludeResult = await runGit([
    'rev-parse',
    '--path-format=absolute',
    '--git-path',
    'info/exclude',
  ]);
  if (excludeResult.exitCode !== 0 || !excludeResult.stdout.trim()) {
    throw new Error(
      `could not resolve the repository-local Git exclude: ${describeCommandFailure(excludeResult)}`,
    );
  }
  return path.resolve(projectRoot, excludeResult.stdout.trim());
};

const requireUntrackedOverride = async () => {
  const trackedResult = await runGit(['ls-files', '--stage', '--', `:(literal)${OVERRIDE_NAME}`]);
  if (trackedResult.exitCode !== 0) {
    throw new Error(
      `could not inspect whether ${OVERRIDE_NAME} is tracked: ${describeCommandFailure(trackedResult)}`,
    );
  }
  if (trackedResult.stdout.trim()) {
    throw new Error(
      `${OVERRIDE_NAME} is tracked by Git; an exclude rule cannot make a tracked file local`,
    );
  }
};

const containsExcludeRule = (content) =>
  content.split('\n').some((line) => line === EXCLUDE_RULE || line === `${EXCLUDE_RULE}\r`);

const appendExcludeRule = async (excludePath, excludeContent) => {
  const separator = excludeContent && !excludeContent.endsWith('\n') ? '\n' : '';
  try {
    await appendFile(excludePath, `${separator}${EXCLUDE_RULE}\n`, 'utf8');
  } catch (error) {
    throw new Error(`could not append Git exclude rule: ${error.message}`);
  }
};

const createOverride = async () => {
  try {
    await writeFile(overridePath, OVERRIDE_CONTENT, { encoding: 'utf8', flag: 'wx' });
  } catch (error) {
    throw new Error(`could not create ${OVERRIDE_NAME}: ${error.message}`);
  }
};

const verifyResult = async (excludePath) => {
  let metadata;
  try {
    metadata = await lstat(overridePath);
  } catch (error) {
    throw new Error(`could not verify ${OVERRIDE_NAME}: ${error.message}`);
  }
  if (metadata.isSymbolicLink() || !metadata.isFile()) {
    throw new Error(`could not verify ${OVERRIDE_NAME} as an exact regular file`);
  }
  const content = await readOptionalFile(overridePath, OVERRIDE_NAME);
  if (content !== OVERRIDE_CONTENT) {
    throw new Error(`could not verify the exact ${OVERRIDE_NAME} content`);
  }

  const excludeContent = await readOptionalFile(excludePath, 'repository-local Git exclude');
  if (excludeContent === null || !containsExcludeRule(excludeContent)) {
    throw new Error(`could not verify the exact ${EXCLUDE_RULE} Git exclude rule`);
  }

  await requireUntrackedOverride();
  const ignoredResult = await runGit(['check-ignore', '-q', '--', OVERRIDE_NAME]);
  if (ignoredResult.exitCode !== 0) {
    const detail =
      ignoredResult.exitCode === 1
        ? 'Git did not report it as ignored'
        : describeCommandFailure(ignoredResult);
    throw new Error(`could not verify that ${OVERRIDE_NAME} is ignored: ${detail}`);
  }
};

const setupAgentsOverride = async () => {
  if (process.argv.length > 2) {
    throw new Error('setup:agents-override does not accept arguments or force-overwrite options');
  }

  await requireWorkflowFiles();
  const excludePath = await resolveParentGit();
  await requireUntrackedOverride();
  const conflicts = await detectLegacyConflicts();
  if (conflicts.length > 0) {
    throw new Error(
      `resolve all instruction and legacy Codex conflicts before setup:\n${conflicts.join('\n')}`,
    );
  }
  const overrideState = await inspectOverride();
  const excludeContent = await readOptionalFile(excludePath, 'repository-local Git exclude');
  const excludeRuleExists = excludeContent !== null && containsExcludeRule(excludeContent);

  if (!overrideState.exists) {
    await createOverride();
  }
  if (!excludeRuleExists) {
    await appendExcludeRule(excludePath, excludeContent ?? '');
  }

  await verifyResult(excludePath);
  writeOutput(`${OVERRIDE_NAME}: ${overrideState.exists ? 'already correct' : 'created'}`);
  writeOutput(`${EXCLUDE_RULE} exclude rule: ${excludeRuleExists ? 'already present' : 'added'}`);
  writeOutput('Local AGENTS override setup verified.');
};

try {
  await setupAgentsOverride();
} catch (error) {
  writeError(`Setup failed: ${error.message}`);
  process.exitCode = 1;
}
