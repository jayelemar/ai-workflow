#!/usr/bin/env node

import { spawn } from "node:child_process";
import { constants, writeSync } from "node:fs";
import {
  access,
  appendFile,
  chmod,
  lstat,
  mkdir,
  readdir,
  readFile,
  readlink,
  realpath,
  symlink,
  unlink,
  writeFile,
} from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const OVERRIDE_NAME = "AGENTS.override.md";
const SKILL_NAMES = [
  "create-plan",
  "worktree-setup",
  "git-commit",
  "pull-request",
  "show-summary",
  "manual-qa-checklist",
];
const SKILL_PATHS = SKILL_NAMES.map((name) => `.agents/skills/${name}`);
const LEGACY_SKILL_NAMES = [
  "ai-build",
  "ai-worktree-setup",
  "ai-commit",
  "ai-pr",
  "show-qa-checklist",
];
const LEGACY_SKILL_PATHS = LEGACY_SKILL_NAMES.map(
  (name) => `.agents/skills/${name}`,
);
const CONFIG_PATH = ".codex/config.toml";
const MANAGED_ANCESTORS = [".agents", ".agents/skills", ".codex"];
const MANAGED_PATHS = [OVERRIDE_NAME, ...SKILL_PATHS, CONFIG_PATH];
const EXCLUDE_RULES = MANAGED_PATHS.map((name) => `/${name}`);
const PREVIOUS_OVERRIDE_CONTENT = `# Local Project AI Instructions

Read and follow \`.ai/AGENTS.md\` before starting work.
Use \`.ai/instructions/index.md\` to load only instructions relevant to the request.

## Code Review Rules

- Before approving changes, check that login and access control still work.
- Do not expose private client, user, or firm data.
- Run the relevant tests. If a test cannot be run, clearly say why.

## Parallel Work Rules

- Agents may research or review in parallel.
- Never have more than one agent edit the same file at the same time.
`;
const ROUTING_BLOCK = `<!-- ai-workflow-routing:start -->

Read and follow \`AGENTS.md\` first when it exists in this workspace root.
Then read and follow \`.ai/AGENTS.md\` before starting work.
Use \`.ai/instructions/index.md\` to load only instructions relevant to the request.
<!-- ai-workflow-routing:end -->`;
const OVERRIDE_CONTENT = PREVIOUS_OVERRIDE_CONTENT.replace(
  "Read and follow `.ai/AGENTS.md` before starting work.\nUse `.ai/instructions/index.md` to load only instructions relevant to the request.",
  ROUTING_BLOCK,
);
const REQUIRED_WORKFLOW_FILES = ["AGENTS.md", "instructions/index.md"];
const PRIVATE_ACCOUNT_PATH = "instructions/local/github.md";
const PRIVATE_ACCOUNT_CONTENT = [
  "# Local GitHub Accounts",
  "",
  "## Rules",
  "",
  "- This file is local and ignored by Git. Keep account mappings here, never in public instructions.",
  "- Replace the placeholders below with one mapping per Git repository, including any independent nested workflow repository.",
  "- Placeholder rows are unconfigured. Follow instructions/shared/delivery-hygiene.md before asking for an account or profile.",
  "- Verify the effective login and repository access before publishing. A CLI profile does not select Git push credentials.",
  "- Store credentials in the GitHub CLI credential store, never in this file.",
  "",
  "## Repository Mappings",
  "",
  "| Repository         | GitHub login   | GitHub CLI profile (GH_CONFIG_DIR) |",
  "| ------------------ | -------------- | ---------------------------------- |",
  "| <owner/repository> | <github-login> | <absolute-profile-directory>       |",
  "",
].join("\n");

const workflowRoot = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  "../..",
);
const projectRoot = path.dirname(workflowRoot);
const overridePath = path.join(projectRoot, OVERRIDE_NAME);
const completedWrites = [];
let attemptedWrite;
const gitEnvironment = Object.fromEntries(
  Object.entries(process.env).filter(
    ([name]) => !name.toUpperCase().startsWith("GIT_"),
  ),
);

const writeOutput = (message) => writeSync(process.stdout.fd, `${message}\n`);
const writeError = (message) => writeSync(process.stderr.fd, `${message}\n`);

const describeCommandFailure = (result) => {
  const detail = result.stderr.trim() || result.stdout.trim();
  return detail || `Git exited with status ${result.exitCode}`;
};

const runCommand = (command, args, cwd, env, input) =>
  new Promise((resolve) => {
    const child = spawn(command, args, {
      cwd,
      env,
      stdio: [input === undefined ? "ignore" : "pipe", "pipe", "pipe"],
    });
    let stdout = "";
    let stderr = "";
    child.stdout.setEncoding("utf8");
    child.stderr.setEncoding("utf8");
    child.stdout.on("data", (chunk) => (stdout += chunk));
    child.stderr.on("data", (chunk) => (stderr += chunk));
    child.on("error", (error) =>
      resolve({ exitCode: 127, stderr: error.message, stdout }),
    );
    child.on("close", (exitCode) =>
      resolve({ exitCode: exitCode ?? 1, stderr, stdout }),
    );
    if (input !== undefined) {
      // Early command failures are reported through their exit status.
      child.stdin.on("error", () => {});
      child.stdin.end(input);
    }
  });

const runGit = (args, input) =>
  runCommand("git", args, projectRoot, gitEnvironment, input);

const readOptionalFile = async (targetPath, label) => {
  try {
    return await readFile(targetPath, "utf8");
  } catch (error) {
    if (error.code === "ENOENT") return null;
    throw new Error(`could not read ${label}: ${error.message}`);
  }
};

const entryExists = async (targetPath) => {
  try {
    await lstat(targetPath);
    return true;
  } catch (error) {
    if (error.code === "ENOENT") return false;
    throw error;
  }
};

const requireCanonicalSpelling = async (targetPath, label) => {
  let entries;
  try {
    entries = await readdir(path.dirname(targetPath));
  } catch (error) {
    if (error.code === "ENOENT") return;
    throw error;
  }
  // Reserve the name even on case-sensitive filesystems, including a sibling
  // alias beside a correctly spelled entry. Exact excludes cannot hide aliases.
  const name = path.basename(targetPath);
  if (
    entries.some(
      (entry) => entry !== name && entry.toLowerCase() === name.toLowerCase(),
    )
  ) {
    throw new Error(
      `${label} has a noncanonical filesystem spelling; resolve its case alias explicitly before setup`,
    );
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
    if (error.code === "ENOENT") return [];
    throw error;
  }
};

const fallbackReferencesLegacyAgents = (config) => {
  const assignment = /^[ \t]*project_doc_fallback_filenames[ \t]*=[ \t]*/m.exec(
    config,
  );
  if (!assignment) return false;

  let index = assignment.index + assignment[0].length;
  while (/\s/.test(config[index] ?? "")) index += 1;
  if (config[index] !== "[") return false;

  let depth = 0;
  let quote;
  let value = "";
  const values = [];
  for (; index < config.length; index += 1) {
    const character = config[index];
    if (quote) {
      if (character === "\\") {
        const escaped = config[index + 1];
        if (escaped === undefined) return false;
        value += escaped;
        index += 1;
      } else if (character === quote) {
        values.push(value);
        value = "";
        quote = undefined;
      } else {
        value += character;
      }
      continue;
    }
    if (character === "#") {
      while (index < config.length && config[index] !== "\n") index += 1;
      continue;
    }
    if (character === '"' || character === "'") {
      quote = character;
      value = "";
    } else if (character === "[") {
      depth += 1;
    } else if (character === "]") {
      depth -= 1;
      if (depth === 0) return values.includes(".codex/AGENTS.md");
      if (depth < 0) return false;
    }
  }
  return false;
};

const detectLegacyConflicts = async () => {
  const conflicts = [];
  const codexAgentsPath = path.join(projectRoot, ".codex", "AGENTS.md");
  if (await entryExists(codexAgentsPath))
    conflicts.push(".codex/AGENTS.md exists");

  const configPath = path.join(projectRoot, ".codex", "config.toml");
  const config = await readOptionalFile(configPath, ".codex/config.toml");
  if (config !== null && fallbackReferencesLegacyAgents(config)) {
    conflicts.push(".codex/config.toml fallback references .codex/AGENTS.md");
  }

  const hooksConfigPath = path.join(projectRoot, ".codex", "hooks.json");
  const hooksConfig = await readOptionalFile(
    hooksConfigPath,
    ".codex/hooks.json",
  );
  if (hooksConfig !== null && /manual_token_|manual-token-/.test(hooksConfig)) {
    conflicts.push(".codex/hooks.json configures manual-token hooks");
  }

  const hookEntries = await collectMatchingEntries(
    path.join(projectRoot, ".codex", "hooks"),
    /^manual_token_/,
  );
  for (const entryPath of hookEntries) {
    conflicts.push(
      path.relative(projectRoot, entryPath).split(path.sep).join("/"),
    );
  }

  const stateEntries = await collectMatchingEntries(
    path.join(projectRoot, ".codex", "state"),
    /^manual-token-/,
  );
  for (const entryPath of stateEntries) {
    conflicts.push(
      path.relative(projectRoot, entryPath).split(path.sep).join("/"),
    );
  }

  return conflicts.sort();
};

const inspectRootInstructions = async () => {
  const targetPath = path.join(projectRoot, "AGENTS.md");
  let metadata;
  try {
    metadata = await lstat(targetPath);
  } catch (error) {
    if (error.code === "ENOENT") return;
    throw new Error(
      `could not inspect parent-root AGENTS.md: ${error.message}`,
    );
  }
  if (metadata.isSymbolicLink() || !metadata.isFile()) {
    throw new Error(
      "parent-root AGENTS.md must be a readable regular file, not a symbolic link or non-file; resolve it explicitly before setup",
    );
  }
  await readOptionalFile(targetPath, "parent-root AGENTS.md");
};

const hasExplicitRouting = (content) => {
  // CRLF is accepted for custom files without rewriting their original bytes.
  const normalized = content.replaceAll("\r\n", "\n");
  const lines = normalized.split("\n");
  const blockLines = ROUTING_BLOCK.split("\n");
  const start = lines.indexOf(blockLines[0]);
  if (
    start < 0 ||
    normalized.split(blockLines[0]).length !== 2 ||
    normalized.split(blockLines.at(-1)).length !== 2 ||
    lines.slice(start, start + blockLines.length).join("\n") !== ROUTING_BLOCK
  )
    return false;

  // An example in a fenced code block or comment is not an instruction route.
  let fence;
  let inComment = false;
  for (const line of lines.slice(0, start)) {
    if (!inComment) {
      const marker = /^ {0,3}(`{3,}|~{3,})(.*)$/.exec(line);
      if (marker) {
        if (!fence) fence = marker[1];
        else if (
          marker[1][0] === fence[0] &&
          marker[1].length >= fence.length &&
          marker[2].trim() === ""
        )
          fence = undefined;
      }
    }
    if (!fence) {
      for (const marker of line.matchAll(/<!--|-->/g)) {
        inComment = marker[0] === "<!--";
      }
    }
  }
  return !fence && !inComment;
};

const inspectOverride = async () => {
  await requireCanonicalSpelling(overridePath, OVERRIDE_NAME);
  let metadata;
  try {
    metadata = await lstat(overridePath);
  } catch (error) {
    if (error.code === "ENOENT") {
      return { content: OVERRIDE_CONTENT, status: "created", write: "create" };
    }
    throw new Error(`could not inspect ${OVERRIDE_NAME}: ${error.message}`);
  }

  if (metadata.isSymbolicLink()) {
    throw new Error(
      `${OVERRIDE_NAME} is a symbolic link; resolve it explicitly before setup`,
    );
  }
  if (!metadata.isFile()) {
    throw new Error(
      `${OVERRIDE_NAME} is not a regular file; resolve it explicitly before setup`,
    );
  }

  const content = await readOptionalFile(overridePath, OVERRIDE_NAME);
  if (content === PREVIOUS_OVERRIDE_CONTENT) {
    return {
      content: OVERRIDE_CONTENT,
      status: "upgraded previous generated template",
      write: "upgrade",
    };
  }
  if (content === OVERRIDE_CONTENT) {
    return { content, status: "already correct" };
  }
  if (!hasExplicitRouting(content)) {
    throw new Error(
      `${OVERRIDE_NAME} needs one exact active routing block from .ai/docs/codex-agent.md (root AGENTS.md, then .ai/AGENTS.md, then the instruction index); it was preserved. Add the documented block outside code fences and comments, then retry`,
    );
  }
  return { content, status: "custom routing preserved" };
};

const requireWorkflowFiles = async () => {
  if (path.basename(workflowRoot) !== ".ai") {
    throw new Error(
      `setup utility is not installed under a direct .ai directory: ${workflowRoot}`,
    );
  }

  // Node resolves the module URL through symlinks. Inspect the invoked .ai path
  // too, so a linked checkout cannot silently select another project's setup.
  const invokedWorkflowRoot = path.resolve(
    path.dirname(process.argv[1]),
    "../..",
  );
  await requireRealDirectory(invokedWorkflowRoot, "invoked .ai directory");
  if (
    (await realpath(invokedWorkflowRoot)) !== (await realpath(workflowRoot))
  ) {
    throw new Error(
      "invoked setup utility resolves outside its local .ai directory",
    );
  }
  await requireRealDirectory(workflowRoot, ".ai");
  await requireRealDirectory(
    path.join(workflowRoot, "instructions"),
    ".ai/instructions",
  );
  for (const relativePath of REQUIRED_WORKFLOW_FILES) {
    const targetPath = path.join(workflowRoot, relativePath);
    let metadata;
    try {
      metadata = await lstat(targetPath);
    } catch (error) {
      if (error.code === "ENOENT") {
        throw new Error(
          `required workflow file is missing: .ai/${relativePath}`,
        );
      }
      throw new Error(
        `could not inspect required workflow file .ai/${relativePath}: ${error.message}`,
      );
    }
    if (metadata.isSymbolicLink() || !metadata.isFile()) {
      throw new Error(
        `required workflow file is not a regular file: .ai/${relativePath}`,
      );
    }
    if (metadata.size === 0) {
      throw new Error(`required workflow file is empty: .ai/${relativePath}`);
    }
    await readOptionalFile(
      targetPath,
      `required workflow file .ai/${relativePath}`,
    );
  }
};

const requireRealDirectory = async (targetPath, label) => {
  let metadata;
  try {
    metadata = await lstat(targetPath);
  } catch (error) {
    throw new Error(`could not inspect ${label}: ${error.message}`);
  }
  if (metadata.isSymbolicLink() || !metadata.isDirectory()) {
    throw new Error(
      `${label} must be a real directory, not a symbolic link or non-directory`,
    );
  }
};

const requireOutsideGitDirectory = (directory, gitDirectory, label) => {
  const relative = path.relative(gitDirectory, directory);
  if (
    relative === "" ||
    (relative !== ".." &&
      !relative.startsWith(`..${path.sep}`) &&
      !path.isAbsolute(relative))
  ) {
    throw new Error(
      `${label} is inside Git metadata; resolve this repository boundary explicitly before setup`,
    );
  }
};

const requireProjectRepository = async (targetPath, label, repository) => {
  // A gitfile can point back to the parent while Git still treats this folder
  // as a nested repository during status/ignore traversal.
  if (await entryExists(path.join(targetPath, ".git"))) {
    throw new Error(
      `${label} contains nested Git metadata; resolve this repository boundary explicitly before setup`,
    );
  }
  const directory = await realpath(targetPath);
  for (const metadataRoot of [repository.gitDirectory, repository.commonRoot]) {
    requireOutsideGitDirectory(directory, metadataRoot, label);
  }
  const result = await runCommand(
    "git",
    ["rev-parse", "--show-toplevel"],
    targetPath,
    gitEnvironment,
  );
  if (result.exitCode !== 0 || !result.stdout.trim()) {
    throw new Error(`could not verify repository ownership for ${label}`);
  }
  if (path.resolve(result.stdout.trim()) !== projectRoot) {
    throw new Error(
      `${label} belongs to a different Git repository; resolve it explicitly before setup`,
    );
  }
  const gitDirResult = await runCommand(
    "git",
    ["rev-parse", "--absolute-git-dir"],
    targetPath,
    gitEnvironment,
  );
  if (gitDirResult.exitCode !== 0 || !gitDirResult.stdout.trim()) {
    throw new Error(`could not verify repository ownership for ${label}`);
  }
  if (
    (await realpath(gitDirResult.stdout.trim())) !== repository.gitDirectory
  ) {
    throw new Error(
      `${label} belongs to a different Git repository; resolve it explicitly before setup`,
    );
  }
};

const inspectConfig = async (repository) => {
  const sourceDirectory = path.join(workflowRoot, ".codex");
  await requireCanonicalSpelling(sourceDirectory, ".ai/.codex");
  await requireRealDirectory(sourceDirectory, ".ai/.codex");
  const source = path.join(workflowRoot, CONFIG_PATH);
  await requireCanonicalSpelling(source, `.ai/${CONFIG_PATH}`);
  let sourceMetadata;
  let content;
  try {
    sourceMetadata = await lstat(source);
    if (sourceMetadata.isSymbolicLink() || !sourceMetadata.isFile()) {
      throw new Error(
        "expected a readable regular file, not a symbolic link or non-file",
      );
    }
    content = await readFile(source);
  } catch (error) {
    throw new Error(
      `could not read required config source .ai/${CONFIG_PATH}: ${error.message}`,
    );
  }

  const directory = path.join(projectRoot, ".codex");
  await requireCanonicalSpelling(directory, ".codex");
  const createDirectory = !(await entryExists(directory));
  if (!createDirectory) {
    await requireRealDirectory(directory, ".codex");
    await requireProjectRepository(directory, ".codex", repository);
  }
  const target = path.join(projectRoot, CONFIG_PATH);
  await requireCanonicalSpelling(target, CONFIG_PATH);
  const createFile = !(await entryExists(target));
  let conflict = false;
  if (!createFile) {
    const metadata = await lstat(target);
    if (metadata.isSymbolicLink() || !metadata.isFile()) {
      throw new Error(
        `${CONFIG_PATH} must be a readable regular file, not a symbolic link or non-file; it was preserved`,
      );
    }
    conflict = !(await readFile(target)).equals(content);
  }
  return {
    content,
    mode: sourceMetadata.mode & 0o777,
    createDirectory,
    createFile,
    conflict,
  };
};

const inspectSkills = async (repository) => {
  for (const relativePath of [".agents", ".agents/skills"]) {
    await requireRealDirectory(
      path.join(workflowRoot, relativePath),
      `.ai/${relativePath}`,
    );
  }
  const sourceRoot = await realpath(workflowRoot);
  for (const name of SKILL_NAMES) {
    const source = path.join(workflowRoot, ".agents/skills", name);
    await requireRealDirectory(
      source,
      `required skill source .ai/.agents/skills/${name}`,
    );
    const entry = path.join(source, "SKILL.md");
    let metadata;
    try {
      metadata = await lstat(entry);
    } catch (error) {
      throw new Error(
        `could not inspect required skill source ${name}/SKILL.md: ${error.message}`,
      );
    }
    if (
      metadata.isSymbolicLink() ||
      !metadata.isFile() ||
      metadata.size === 0
    ) {
      throw new Error(
        `required skill source .ai/.agents/skills/${name}/SKILL.md must be a nonempty regular file`,
      );
    }
    const resolved = await realpath(entry);
    if (!resolved.startsWith(`${sourceRoot}${path.sep}`)) {
      throw new Error(
        `required skill source ${name} escapes this project's .ai directory`,
      );
    }
    await readOptionalFile(entry, `required skill source ${name}/SKILL.md`);
  }

  const directories = [];
  for (const relativePath of [".agents", ".agents/skills"]) {
    const target = path.join(projectRoot, relativePath);
    await requireCanonicalSpelling(target, relativePath);
    if (await entryExists(target)) {
      await requireRealDirectory(target, relativePath);
      await requireProjectRepository(target, relativePath, repository);
    } else directories.push(relativePath);
  }
  const links = [];
  for (const relativePath of SKILL_PATHS) {
    const target = path.join(projectRoot, relativePath);
    await requireCanonicalSpelling(target, relativePath);
    const expected = path.relative(
      path.dirname(target),
      path.join(workflowRoot, relativePath),
    );
    if (await entryExists(target)) {
      if (
        !(await lstat(target)).isSymbolicLink() ||
        (await readlink(target)) !== expected
      ) {
        throw new Error(
          `${relativePath} conflicts with its expected local relative skill link; it was preserved`,
        );
      }
      if (
        (await realpath(target)) !==
        (await realpath(path.join(workflowRoot, relativePath)))
      ) {
        throw new Error(
          `${relativePath} does not resolve to its expected local skill source`,
        );
      }
    } else links.push({ relativePath, expected });
  }
  const legacyLinks = [];
  for (const relativePath of LEGACY_SKILL_PATHS) {
    const target = path.join(projectRoot, relativePath);
    await requireCanonicalSpelling(target, relativePath);
    if (!(await entryExists(target))) continue;
    // Do not resolve these links: removing the old source directories makes
    // generated legacy links dangling before setup migrates them.
    const expected = `../../.ai/${relativePath}`;
    if (
      !(await lstat(target)).isSymbolicLink() ||
      (await readlink(target)) !== expected
    ) {
      throw new Error(
        `${relativePath} conflicts with its exact generated legacy skill link; it was preserved`,
      );
    }
    legacyLinks.push({ relativePath, expected });
  }
  return { directories, links, legacyLinks };
};

const resolveParentGit = async () => {
  const rootResult = await runGit(["rev-parse", "--show-toplevel"]);
  if (rootResult.exitCode !== 0) {
    throw new Error(
      `direct parent is not a Git worktree root: ${describeCommandFailure(rootResult)}`,
    );
  }
  const detectedRoot = rootResult.stdout.trim();
  if (!detectedRoot || path.resolve(detectedRoot) !== projectRoot) {
    throw new Error(
      `direct parent is not the Git worktree root (Git resolved ${detectedRoot || "no root"})`,
    );
  }

  const gitDirResult = await runGit(["rev-parse", "--absolute-git-dir"]);
  if (gitDirResult.exitCode !== 0 || !gitDirResult.stdout.trim()) {
    throw new Error("could not resolve the parent Git directory identity");
  }
  const gitDirectory = await realpath(gitDirResult.stdout.trim());
  requireOutsideGitDirectory(
    await realpath(projectRoot),
    gitDirectory,
    "project root",
  );

  const excludeResult = await runGit([
    "rev-parse",
    "--path-format=absolute",
    "--git-path",
    "info/exclude",
  ]);
  if (excludeResult.exitCode !== 0 || !excludeResult.stdout.trim()) {
    throw new Error(
      `could not resolve the repository-local Git exclude: ${describeCommandFailure(excludeResult)}`,
    );
  }
  const excludePath = path.resolve(projectRoot, excludeResult.stdout.trim());
  const commonResult = await runGit([
    "rev-parse",
    "--path-format=absolute",
    "--git-common-dir",
  ]);
  if (commonResult.exitCode !== 0 || !commonResult.stdout.trim()) {
    throw new Error(
      `could not resolve repository-local Git metadata: ${describeCommandFailure(commonResult)}`,
    );
  }
  const commonRoot = await realpath(
    path.resolve(projectRoot, commonResult.stdout.trim()),
  );
  requireOutsideGitDirectory(
    await realpath(projectRoot),
    commonRoot,
    "project root",
  );
  const infoDirectory = path.join(commonRoot, "info");
  await requireRealDirectory(
    infoDirectory,
    "repository-local Git info directory",
  );
  if ((await realpath(path.dirname(excludePath))) !== infoDirectory) {
    throw new Error(
      "repository-local Git exclude escapes the Git info directory",
    );
  }
  return { excludePath, gitDirectory, commonRoot };
};

const requireUntrackedOutputs = async () => {
  const ancestors = MANAGED_ANCESTORS;
  for (const relativePath of [
    ...ancestors,
    ...MANAGED_PATHS,
    ...LEGACY_SKILL_PATHS,
  ]) {
    const trackedResult = await runGit([
      "ls-files",
      "--stage",
      "-z",
      "--",
      // Reserve managed names case-insensitively, including tracked contents
      // deleted locally. Git's literal pathspec ignores filesystem casing.
      `:(icase,literal)${relativePath}`,
    ]);
    if (trackedResult.exitCode !== 0) {
      throw new Error(
        `could not inspect whether ${relativePath} is tracked: ${describeCommandFailure(trackedResult)}`,
      );
    }
    const records = trackedResult.stdout.split("\0").filter(Boolean);
    // A gitlink (mode 160000) is tracked at the ancestor itself, never at a
    // managed leaf. Ignore unrelated tracked descendants of ordinary folders.
    const tracked = ancestors.includes(relativePath)
      ? records.some(
          (record) =>
            record.slice(record.indexOf("\t") + 1).toLowerCase() ===
            relativePath,
        )
      : records.length > 0;
    if (tracked) {
      throw new Error(
        `${relativePath} is tracked by Git; managed outputs must not overwrite tracked paths or cross tracked file/submodule ancestors`,
      );
    }
  }
};

const containsExcludeRule = (content, rule) =>
  content.split("\n").some((line) => line === rule || line === `${rule}\r`);

const appendExcludeRules = async (excludePath, excludeContent, rules) => {
  const separator =
    excludeContent && !excludeContent.endsWith("\n") ? "\n" : "";
  try {
    await appendFile(excludePath, `${separator}${rules.join("\n")}\n`, "utf8");
  } catch (error) {
    throw new Error(`could not append Git exclude rule: ${error.message}`);
  }
};

const inspectExclude = async (excludePath) => {
  if (await entryExists(excludePath)) {
    const metadata = await lstat(excludePath);
    if (metadata.isSymbolicLink() || !metadata.isFile()) {
      throw new Error(
        "could not read repository-local Git exclude: expected a regular file, not a symbolic link or non-file",
      );
    }
  }
  return (
    (await readOptionalFile(excludePath, "repository-local Git exclude")) ?? ""
  );
};

const inspectEffectiveExcludes = async (excludeContent) => {
  const globalConfig = await runGit([
    "config",
    "--null",
    "--path",
    "--get",
    "core.excludesFile",
  ]);
  const globalOptions = [];
  if (globalConfig.exitCode === 0) {
    const values = globalConfig.stdout.split("\0");
    if (values.length !== 2 || values[1] !== "") {
      throw new Error(
        "could not resolve global Git exclude configuration: unexpected Git response",
      );
    }
    if (values[0]) {
      // An absolute source label distinguishes a global file from the same
      // file evaluated as a per-directory .gitignore. Configuration stays local
      // to this read-only invocation; its contents and value are not printed.
      globalOptions.push(
        "-c",
        `core.excludesFile=${path.resolve(projectRoot, values[0])}`,
      );
    }
  } else if (globalConfig.exitCode !== 1) {
    throw new Error("could not resolve global Git exclude configuration");
  }
  const result = await runGit(
    [
      ...globalOptions,
      "check-ignore",
      "--verbose",
      "--non-matching",
      "--no-index",
      "-z",
      "--stdin",
    ],
    `${MANAGED_PATHS.join("\0")}\0`,
  );
  if (result.exitCode !== 0 && result.exitCode !== 1) {
    throw new Error(
      `could not inspect effective Git ignore rules: ${describeCommandFailure(result)}`,
    );
  }
  const fields = result.stdout.split("\0");
  if (fields.pop() !== "" || fields.length !== MANAGED_PATHS.length * 4) {
    throw new Error(
      "could not inspect effective Git ignore rules: incomplete Git response",
    );
  }
  const missingRules = [];
  for (let index = 0; index < MANAGED_PATHS.length; index += 1) {
    const [source, line, pattern, relativePath] = fields.slice(
      index * 4,
      index * 4 + 4,
    );
    if (
      relativePath !== MANAGED_PATHS[index] ||
      (source ? !/^\d+$/.test(line) || !pattern : line || pattern)
    ) {
      throw new Error(
        "could not inspect effective Git ignore rules: unexpected Git response",
      );
    }
    // Per-directory rules outrank info/exclude. Git evaluates their patterns
    // against the eventual file/symlink paths, including ignored ancestors.
    const perDirectorySources = [".gitignore"];
    for (
      let ancestor = path.posix.dirname(relativePath);
      ancestor !== ".";
      ancestor = path.posix.dirname(ancestor)
    ) {
      perDirectorySources.push(`${ancestor}/.gitignore`);
    }
    const perDirectorySource = perDirectorySources.includes(source);
    if (pattern.startsWith("!") && perDirectorySource) {
      throw new Error(
        `${relativePath} is re-included by ${source}:${line}; resolve this Git ignore conflict before setup`,
      );
    }
    const rule = EXCLUDE_RULES[index];
    if (!containsExcludeRule(excludeContent, rule) || pattern.startsWith("!")) {
      // Appending also repairs an exact local rule overridden by a later local
      // negation; global rules have lower priority than these local rules.
      missingRules.push(rule);
    }
  }
  return missingRules;
};

const requireWritable = async (targetPath, label, directory = false) => {
  try {
    await access(targetPath, constants.W_OK | (directory ? constants.X_OK : 0));
  } catch (error) {
    throw new Error(
      `could not write ${label} during preflight: ${error.message}`,
    );
  }
};

const inspectPrivateAccounts = async () => {
  const label = ".ai/" + PRIVATE_ACCOUNT_PATH;
  const instructions = path.join(workflowRoot, "instructions");
  const local = path.join(workflowRoot, "instructions/local");
  const target = path.join(workflowRoot, PRIVATE_ACCOUNT_PATH);
  await requireCanonicalSpelling(
    path.join(workflowRoot, "instructions"),
    ".ai/instructions",
  );
  await requireCanonicalSpelling(local, ".ai/instructions/local");
  const createDirectory = !(await entryExists(local));
  if (!createDirectory) {
    await requireRealDirectory(local, ".ai/instructions/local");
  }
  await requireCanonicalSpelling(target, label);

  const root = await runGit([
    "-C",
    workflowRoot,
    "rev-parse",
    "--show-toplevel",
  ]);
  if (
    root.exitCode !== 0 ||
    path.resolve(root.stdout.trim()) !== workflowRoot
  ) {
    throw new Error(
      "private GitHub instructions require an independent workflow Git repository",
    );
  }
  for (const directory of [instructions, ...(createDirectory ? [] : [local])]) {
    if (await entryExists(path.join(directory, ".git"))) {
      throw new Error(
        "private GitHub instructions directory contains nested Git metadata",
      );
    }
    const owner = await runGit([
      "-C",
      directory,
      "rev-parse",
      "--show-toplevel",
    ]);
    if (
      owner.exitCode !== 0 ||
      path.resolve(owner.stdout.trim()) !== workflowRoot
    ) {
      throw new Error(
        "private GitHub instructions directory belongs to another repository",
      );
    }
  }
  for (const [directory, relative, ancestors] of [
    [
      workflowRoot,
      PRIVATE_ACCOUNT_PATH,
      ["instructions", "instructions/local"],
    ],
    [projectRoot, ".ai/" + PRIVATE_ACCOUNT_PATH, []],
  ]) {
    const tracked = await runGit([
      "-C",
      directory,
      "ls-files",
      "--stage",
      "-z",
      "--",
      ...[...ancestors, relative].map((name) => ":(icase,literal)" + name),
    ]);
    if (tracked.exitCode !== 0) {
      throw new Error(
        "could not inspect tracking of private GitHub instructions",
      );
    }
    const names = tracked.stdout
      .split("\0")
      .filter(Boolean)
      .map((record) => record.slice(record.indexOf("\t") + 1).toLowerCase());
    if (
      names.some(
        (name) =>
          ancestors.includes(name) ||
          name === relative ||
          name.startsWith(relative + "/"),
      )
    ) {
      throw new Error(
        "private GitHub instructions or their ancestors are tracked; resolve them before setup",
      );
    }
  }
  const ignored = await runGit([
    "-C",
    workflowRoot,
    "check-ignore",
    "--quiet",
    "--no-index",
    "--",
    PRIVATE_ACCOUNT_PATH,
  ]);
  if (ignored.exitCode !== 0) {
    throw new Error(
      "private GitHub instructions must already be ignored by the workflow repository; resolve its local ignore rules before setup",
    );
  }
  const createFile = !(await entryExists(target));
  let content = Buffer.from(PRIVATE_ACCOUNT_CONTENT);
  if (!createFile) {
    const metadata = await lstat(target);
    if (
      metadata.isSymbolicLink() ||
      !metadata.isFile() ||
      metadata.nlink !== 1
    ) {
      throw new Error(
        label + " must be an independent regular file; it was preserved",
      );
    }
    content = await readFile(target);
  }
  return { createDirectory, createFile, content };
};

const preflightWrites = async (
  overrideState,
  skillState,
  configState,
  excludePath,
  missingRules,
  accountState,
) => {
  if (accountState.createFile) {
    await requireWritable(
      path.join(
        workflowRoot,
        accountState.createDirectory ? "instructions" : "instructions/local",
      ),
      "private GitHub instructions",
      true,
    );
  }
  if (overrideState.write) {
    await requireWritable(
      overrideState.write === "create" ? projectRoot : overridePath,
      OVERRIDE_NAME,
      overrideState.write === "create",
    );
  }
  for (const relativePath of [
    ...skillState.directories,
    ...skillState.links.map(({ relativePath }) => relativePath),
    ...skillState.legacyLinks.map(({ relativePath }) => relativePath),
    ...(configState.createDirectory ? [".codex"] : []),
    ...(configState.createFile ? [CONFIG_PATH] : []),
  ]) {
    let ancestor = path.dirname(path.join(projectRoot, relativePath));
    while (!(await entryExists(ancestor))) ancestor = path.dirname(ancestor);
    await requireWritable(ancestor, relativePath, true);
  }
  if (missingRules.length > 0) {
    const exists = await entryExists(excludePath);
    await requireWritable(
      exists ? excludePath : path.dirname(excludePath),
      "repository-local Git exclude",
      !exists,
    );
  }
};

const performWrite = async (label, operation) => {
  attemptedWrite = label;
  await operation();
  completedWrites.push(label);
  attemptedWrite = undefined;
};

const writeOverride = async (operation) => {
  try {
    await writeFile(overridePath, OVERRIDE_CONTENT, {
      encoding: "utf8",
      flag: operation === "create" ? "wx" : "w",
    });
  } catch (error) {
    throw new Error(
      `could not ${operation} ${OVERRIDE_NAME}: ${error.message}`,
    );
  }
};

const verifyResult = async (
  repository,
  expectedContent,
  expectedConfig,
  expectedAccounts,
) => {
  const { excludePath } = repository;
  await requireCanonicalSpelling(overridePath, OVERRIDE_NAME);
  let metadata;
  try {
    metadata = await lstat(overridePath);
  } catch (error) {
    throw new Error(`could not verify ${OVERRIDE_NAME}: ${error.message}`);
  }
  if (metadata.isSymbolicLink() || !metadata.isFile()) {
    throw new Error(
      `could not verify ${OVERRIDE_NAME} as an exact regular file`,
    );
  }
  const content = await readOptionalFile(overridePath, OVERRIDE_NAME);
  if (content !== expectedContent) {
    throw new Error(`could not verify the exact ${OVERRIDE_NAME} content`);
  }

  const excludeContent = await inspectExclude(excludePath);
  for (const rule of EXCLUDE_RULES) {
    if (!containsExcludeRule(excludeContent, rule)) {
      throw new Error(`could not verify the exact ${rule} Git exclude rule`);
    }
  }

  const skillState = await inspectSkills(repository);
  if (skillState.directories.length || skillState.links.length) {
    throw new Error("could not verify all expected local skill links");
  }
  const configState = await inspectConfig(repository);
  if (
    configState.createDirectory ||
    configState.createFile ||
    configState.conflict ||
    !configState.content.equals(expectedConfig)
  ) {
    throw new Error(`could not verify the exact regular ${CONFIG_PATH} copy`);
  }
  const accounts = await inspectPrivateAccounts();
  if (
    accounts.createDirectory ||
    accounts.createFile ||
    !accounts.content.equals(expectedAccounts)
  ) {
    throw new Error(
      "could not verify the preserved private GitHub instructions",
    );
  }
  await requireUntrackedOutputs();
  for (const relativePath of MANAGED_PATHS) {
    const ignoredResult = await runGit([
      "check-ignore",
      "-q",
      "--",
      relativePath,
    ]);
    if (ignoredResult.exitCode !== 0) {
      const detail =
        ignoredResult.exitCode === 1
          ? "Git did not report it as ignored"
          : describeCommandFailure(ignoredResult);
      throw new Error(
        `could not verify that ${relativePath} is ignored: ${detail}`,
      );
    }
  }
};

const setupAgentsOverride = async () => {
  if (process.argv.length > 2) {
    throw new Error(
      "setup:codex does not accept arguments or force-overwrite options",
    );
  }

  await requireWorkflowFiles();
  const repository = await resolveParentGit();
  const { excludePath } = repository;
  await requireUntrackedOutputs();
  await inspectRootInstructions();
  const configState = await inspectConfig(repository);
  const conflicts = await detectLegacyConflicts();
  if (conflicts.length > 0) {
    throw new Error(
      `resolve all instruction and legacy Codex conflicts before setup:\n${conflicts.join("\n")}`,
    );
  }
  if (configState.conflict) {
    throw new Error(
      `${CONFIG_PATH} differs from .ai/${CONFIG_PATH}; custom configuration was preserved. Resolve it explicitly before setup; no automatic merge or overwrite is performed`,
    );
  }
  const overrideState = await inspectOverride();
  const skillState = await inspectSkills(repository);
  const accountState = await inspectPrivateAccounts();
  const excludeContent = await inspectExclude(excludePath);
  const missingRules = await inspectEffectiveExcludes(excludeContent);
  await preflightWrites(
    overrideState,
    skillState,
    configState,
    excludePath,
    missingRules,
    accountState,
  );

  if (overrideState.write) {
    await performWrite(OVERRIDE_NAME, () => writeOverride(overrideState.write));
  }
  for (const relativePath of skillState.directories) {
    await performWrite(relativePath, () =>
      mkdir(path.join(projectRoot, relativePath)),
    );
  }
  for (const { relativePath, expected } of skillState.links) {
    await performWrite(relativePath, () =>
      symlink(expected, path.join(projectRoot, relativePath), "dir"),
    );
  }
  if (configState.createDirectory) {
    await performWrite(".codex", () => mkdir(path.join(projectRoot, ".codex")));
  }
  if (configState.createFile) {
    await performWrite(CONFIG_PATH, async () => {
      const target = path.join(projectRoot, CONFIG_PATH);
      await writeFile(target, configState.content, {
        flag: "wx",
        mode: configState.mode,
      });
      await chmod(target, configState.mode);
    });
  }
  if (missingRules.length > 0) {
    await performWrite("repository-local Git exclude", () =>
      appendExcludeRules(excludePath, excludeContent, missingRules),
    );
  }

  if (accountState.createDirectory) {
    await performWrite(".ai/instructions/local", () =>
      mkdir(path.join(workflowRoot, "instructions/local"), { mode: 0o700 }),
    );
  }
  if (accountState.createFile) {
    await performWrite(".ai/" + PRIVATE_ACCOUNT_PATH, async () => {
      const target = path.join(workflowRoot, PRIVATE_ACCOUNT_PATH);
      await writeFile(target, accountState.content, {
        flag: "wx",
        mode: 0o600,
      });
      await chmod(target, 0o600);
    });
  }
  await verifyResult(
    repository,
    overrideState.content,
    configState.content,
    accountState.content,
  );
  // Establish every replacement before removing a legacy entry. Reinspect
  // ownership, index state, spelling, and literal link targets before each
  // unlink so a changed entry is preserved and a partial run can be retried.
  for (const { relativePath } of skillState.legacyLinks) {
    await requireUntrackedOutputs();
    const current = await inspectSkills(repository);
    if (
      current.legacyLinks.some((link) => link.relativePath === relativePath)
    ) {
      await performWrite(`${relativePath} (removed legacy link)`, () =>
        unlink(path.join(projectRoot, relativePath)),
      );
    }
  }
  const finalSkills = await inspectSkills(repository);
  if (
    finalSkills.directories.length ||
    finalSkills.links.length ||
    finalSkills.legacyLinks.length
  ) {
    throw new Error("could not verify the completed local skill migration");
  }
  writeOutput(`${OVERRIDE_NAME}: ${overrideState.status}`);
  for (const relativePath of SKILL_PATHS) {
    writeOutput(
      `${relativePath}: ${skillState.links.some((link) => link.relativePath === relativePath) ? "created" : "already correct"}`,
    );
  }
  for (const { relativePath } of skillState.legacyLinks) {
    writeOutput(`${relativePath}: removed generated legacy link`);
  }
  writeOutput(
    `${CONFIG_PATH}: ${configState.createFile ? "created" : "already correct"}`,
  );
  for (const rule of EXCLUDE_RULES) {
    writeOutput(
      `${rule} exclude rule: ${missingRules.includes(rule) ? "added" : "already present"}`,
    );
  }
  writeOutput(
    ".ai/" +
      PRIVATE_ACCOUNT_PATH +
      ": " +
      (accountState.createFile
        ? "created (fill in local account mappings)"
        : "already present (preserved)"),
  );
  writeOutput("Local AGENTS override setup verified.");
};

try {
  await setupAgentsOverride();
} catch (error) {
  writeError(`Setup failed: ${error.message}`);
  if (completedWrites.length > 0 || attemptedWrite) {
    writeError(
      `Partial setup: completed writes: ${completedWrites.join(", ") || "none"}.${attemptedWrite ? ` Failed write may be incomplete: ${attemptedWrite}.` : ""} Existing unrelated state was preserved; inspect these outputs before retrying.`,
    );
  }
  process.exitCode = 1;
}
