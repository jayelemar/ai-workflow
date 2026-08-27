#!/usr/bin/env node

import { spawn } from "node:child_process";
import {
  lstat,
  mkdir,
  readFile,
  readdir,
  rmdir,
  unlink,
} from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

import {
  LOCAL_RECORD_ROOTS,
  preflightCleanup,
  verifyManagedRoots,
} from "./cleanup-local.mjs";

export const workflowRoot = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  "../..",
);

const SAFE_TASK_NAME = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;
const CONTROL_ENTRIES = new Set([
  ".agents",
  ".ai",
  ".codex",
  "AGENTS.override.md",
]);
const gitEnvironment = Object.fromEntries(
  Object.entries(process.env).filter(
    ([name]) => !name.toUpperCase().startsWith("GIT_"),
  ),
);

const pathExists = async (targetPath) => {
  try {
    await lstat(targetPath);
    return true;
  } catch (error) {
    if (error.code === "ENOENT") return false;
    throw error;
  }
};

const isContained = (root, targetPath) => {
  const relativePath = path.relative(root, targetPath);
  return (
    relativePath !== "" &&
    relativePath !== ".." &&
    !relativePath.startsWith(`..${path.sep}`)
  );
};

const toPosix = (relativePath) => relativePath.split(path.sep).join("/");

const runGit = ({ args, cwd }) =>
  new Promise((resolve) => {
    const child = spawn("git", args, {
      cwd,
      env: gitEnvironment,
      stdio: ["ignore", "pipe", "pipe"],
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
  });

export const parseCleanupWorkflowArgs = (args) => {
  if (args.length === 0) return { mode: "preview" };
  if (args.length === 1 && ["-h", "--help"].includes(args[0])) {
    return { help: true, mode: "preview" };
  }
  if (args.length === 1 && args[0] === "--apply-clean") {
    return { mode: "apply-clean" };
  }
  if (args[0] !== "--apply-all") {
    return { error: `Unknown option: ${args.join(" ")}` };
  }

  const approvals = [];
  for (let index = 1; index < args.length; index += 1) {
    if (args[index] !== "--approve" || !args[index + 1]) {
      return { error: `Unknown option: ${args.slice(index).join(" ")}` };
    }
    const taskName = args[index + 1];
    if (!SAFE_TASK_NAME.test(taskName)) {
      return { error: `Unsafe approved task name: ${taskName}` };
    }
    approvals.push(taskName);
    index += 1;
  }
  return { approvals: [...new Set(approvals)].sort(), mode: "apply-all" };
};

const parseWorktreeList = (source) => {
  const entries = [];
  let current;
  for (const line of source.split(/\r?\n/)) {
    if (line.startsWith("worktree ")) {
      current = {
        branch: "",
        locked: false,
        path: path.resolve(line.slice("worktree ".length)),
        prunable: false,
      };
      entries.push(current);
    } else if (current && line.startsWith("branch refs/heads/")) {
      current.branch = line.slice("branch refs/heads/".length);
    } else if (current && line.startsWith("locked")) {
      current.locked = true;
      current.lockReason = line.slice("locked".length).trim();
    } else if (current && line.startsWith("prunable")) {
      current.prunable = true;
      current.pruneReason = line.slice("prunable".length).trim();
    }
  }
  return entries;
};

const inspectCandidate = async ({ commandExecutor, targetPath }) => {
  const candidate = {
    branch: "unknown",
    changes: [],
    issues: [],
    primaryPath: undefined,
    registered: false,
    targetPath,
  };
  const topLevel = await commandExecutor({
    args: ["rev-parse", "--show-toplevel"],
    cwd: targetPath,
  });
  if (topLevel.exitCode !== 0) {
    candidate.issues.push(
      `Git worktree metadata is unreadable: ${topLevel.stderr.trim() || "unknown error"}`,
    );
    return candidate;
  }
  if (path.resolve(topLevel.stdout.trim()) !== path.resolve(targetPath)) {
    candidate.issues.push("Git top-level path does not match the task target");
    return candidate;
  }

  const commonDirectory = await commandExecutor({
    args: ["rev-parse", "--git-common-dir"],
    cwd: targetPath,
  });
  if (commonDirectory.exitCode !== 0) {
    candidate.issues.push(
      `Git common directory is unreadable: ${commonDirectory.stderr.trim() || "unknown error"}`,
    );
    return candidate;
  }
  const resolvedCommonDirectory = path.resolve(
    targetPath,
    commonDirectory.stdout.trim(),
  );
  const primaryPath =
    path.basename(resolvedCommonDirectory) === ".git"
      ? path.dirname(resolvedCommonDirectory)
      : undefined;
  if (!primaryPath) {
    candidate.issues.push("Primary repository path is ambiguous");
    return candidate;
  }
  if (path.resolve(primaryPath) === path.resolve(targetPath)) {
    return {
      ...candidate,
      blocker:
        "Task root is a standalone primary repository; deleting it would also delete branch storage",
    };
  }

  const worktreeList = await commandExecutor({
    args: ["worktree", "list", "--porcelain"],
    cwd: targetPath,
  });
  if (worktreeList.exitCode !== 0) {
    candidate.issues.push(
      `Git worktree registry is unreadable: ${worktreeList.stderr.trim() || "unknown error"}`,
    );
    return candidate;
  }
  const registrations = parseWorktreeList(worktreeList.stdout);
  if (
    !registrations.some((entry) => entry.path === path.resolve(primaryPath))
  ) {
    candidate.issues.push(
      "Primary checkout is missing from the worktree registry",
    );
    return candidate;
  }
  const registration = registrations.find(
    (entry) => entry.path === path.resolve(targetPath),
  );
  if (!registration) {
    candidate.issues.push("Task target is not registered as a Git worktree");
    return candidate;
  }

  candidate.branch = registration.branch || "detached";
  candidate.primaryPath = primaryPath;
  candidate.registered = true;
  if (registration.locked) {
    candidate.issues.push(
      `Git worktree is locked${registration.lockReason ? `: ${registration.lockReason}` : ""}`,
    );
  }
  if (registration.prunable) {
    candidate.issues.push(
      `Git worktree registration is prunable${registration.pruneReason ? `: ${registration.pruneReason}` : ""}`,
    );
  }

  const status = await commandExecutor({
    args: ["status", "--porcelain=v1", "--untracked-files=all"],
    cwd: targetPath,
  });
  if (status.exitCode !== 0) {
    candidate.issues.push(
      `Git status is unreadable: ${status.stderr.trim() || "unknown error"}`,
    );
    return candidate;
  }
  candidate.changes = status.stdout.split(/\r?\n/).filter(Boolean);
  if (candidate.changes.length > 0) {
    candidate.issues.push("Worktree has uncommitted changes");
  }
  return candidate;
};

const inspectTask = async ({ commandExecutor, taskDirectory, taskName }) => {
  const task = {
    blockers: [],
    candidates: [],
    issues: [],
    name: taskName,
    path: taskDirectory,
  };
  if (!SAFE_TASK_NAME.test(taskName)) {
    task.blockers.push("Task directory name is not safe kebab-case");
    return task;
  }

  const rootGitPath = path.join(taskDirectory, ".git");
  const candidatePaths = [];
  if (await pathExists(rootGitPath)) {
    const metadata = await lstat(rootGitPath);
    if (metadata.isSymbolicLink()) {
      task.blockers.push("Task-root .git entry is a symbolic link");
      return task;
    }
    candidatePaths.push(taskDirectory);
  } else {
    for (const child of await readdir(taskDirectory, { withFileTypes: true })) {
      const childPath = path.join(taskDirectory, child.name);
      if (child.isSymbolicLink()) {
        task.blockers.push(
          `Unexpected symbolic link at ${toPosix(path.relative(taskDirectory, childPath))}`,
        );
        continue;
      }
      if (CONTROL_ENTRIES.has(child.name)) continue;
      if (
        child.isDirectory() &&
        (await pathExists(path.join(childPath, ".git")))
      ) {
        const gitMetadata = await lstat(path.join(childPath, ".git"));
        if (gitMetadata.isSymbolicLink()) {
          task.blockers.push(
            `Repository .git entry is a symbolic link: ${child.name}`,
          );
        } else {
          candidatePaths.push(childPath);
        }
      } else {
        task.issues.push(`Unexpected task-root entry: ${child.name}`);
      }
    }
  }

  if (candidatePaths.length === 0 && task.blockers.length === 0) {
    task.issues.push("Task directory has no registered application worktree");
  }
  for (const targetPath of candidatePaths.sort()) {
    const candidate = await inspectCandidate({ commandExecutor, targetPath });
    task.candidates.push(candidate);
    if (candidate.blocker) task.blockers.push(candidate.blocker);
    task.issues.push(...candidate.issues);
  }
  task.blockers = [...new Set(task.blockers)].sort();
  task.issues = [...new Set(task.issues)].sort();
  task.approvalRequired = task.issues.length > 0;
  task.clean = task.blockers.length === 0 && !task.approvalRequired;
  return task;
};

export const preflightWorkflowCleanup = async ({
  commandExecutor = runGit,
  workflowDirectory = workflowRoot,
} = {}) => {
  const root = path.resolve(workflowDirectory);
  const rootMetadata = await lstat(root);
  if (!rootMetadata.isDirectory() || rootMetadata.isSymbolicLink()) {
    throw new Error(`workflow directory is not a safe directory: ${root}`);
  }
  const workspace = path.dirname(root);
  if (workspace.split(path.sep).includes(".worktrees")) {
    throw new Error(
      "cleanup must run from the source workflow, not a task copy",
    );
  }
  const worktreesDirectory = path.join(workspace, ".worktrees");
  const tasks = [];
  const blockers = [];
  if (await pathExists(worktreesDirectory)) {
    const worktreesMetadata = await lstat(worktreesDirectory);
    if (
      !worktreesMetadata.isDirectory() ||
      worktreesMetadata.isSymbolicLink()
    ) {
      throw new Error(
        `worktrees root is not a safe directory: ${worktreesDirectory}`,
      );
    }
    for (const entry of (
      await readdir(worktreesDirectory, { withFileTypes: true })
    ).sort((left, right) => left.name.localeCompare(right.name))) {
      const taskDirectory = path.join(worktreesDirectory, entry.name);
      if (!entry.isDirectory() || entry.isSymbolicLink()) {
        blockers.push(
          `${entry.name}: task-root entry is not a safe directory${entry.isSymbolicLink() ? " (symbolic link)" : ""}`,
        );
        continue;
      }
      if (!isContained(worktreesDirectory, taskDirectory)) {
        blockers.push(`${entry.name}: task root escapes .worktrees`);
        continue;
      }
      const task = await inspectTask({
        commandExecutor,
        taskDirectory,
        taskName: entry.name,
      });
      tasks.push(task);
      blockers.push(
        ...task.blockers.map((blocker) => `${task.name}: ${blocker}`),
      );
    }
  }
  const records = await preflightCleanup({ workflowDirectory: root });
  return {
    blockers: blockers.sort(),
    records,
    root,
    tasks,
    workspace,
    worktreesDirectory,
  };
};

const printInventory = ({ inventory, output }) => {
  for (const task of inventory.tasks) {
    const status = task.blockers.length
      ? "Blocked"
      : task.approvalRequired
        ? "Approval required"
        : "Clean";
    output(`${task.name}: ${status}`);
    for (const candidate of task.candidates) {
      output(`  Worktree: ${candidate.targetPath} [${candidate.branch}]`);
      for (const change of candidate.changes) output(`    ${change}`);
    }
    for (const issue of task.issues) output(`  Issue: ${issue}`);
    for (const blocker of task.blockers) output(`  Blocker: ${blocker}`);
  }
  for (const blocker of inventory.blockers) output(`BLOCKER: ${blocker}`);
  output(`Workflow record target count: ${inventory.records.entries.length}`);
};

const collectTreeEntries = async ({ root, targetPath }) => {
  if (!isContained(root, targetPath)) {
    throw new Error(`cleanup target escapes .worktrees: ${targetPath}`);
  }
  let metadata;
  try {
    metadata = await lstat(targetPath);
  } catch (error) {
    if (error.code === "ENOENT") return [];
    throw error;
  }
  if (!metadata.isDirectory() || metadata.isSymbolicLink()) {
    throw new Error(`cleanup target is not a safe directory: ${targetPath}`);
  }
  const entries = [];
  const visit = async (directoryPath) => {
    for (const child of await readdir(directoryPath, { withFileTypes: true })) {
      const childPath = path.join(directoryPath, child.name);
      if (!isContained(root, childPath)) {
        throw new Error(`cleanup entry escapes .worktrees: ${childPath}`);
      }
      const directory = child.isDirectory() && !child.isSymbolicLink();
      entries.push({ directory, path: childPath });
      if (directory) await visit(childPath);
    }
  };
  await visit(targetPath);
  entries.push({ directory: true, path: targetPath });
  return entries.sort((left, right) => {
    const depth =
      right.path.split(path.sep).length - left.path.split(path.sep).length;
    return depth || left.path.localeCompare(right.path);
  });
};

const removeTree = async ({ root, targetPath }) => {
  for (const entry of await collectTreeEntries({ root, targetPath })) {
    if (entry.directory) await rmdir(entry.path);
    else await unlink(entry.path);
  }
};

const resolveProtectedRecords = async ({ tasks, workflowDirectory }) => {
  const protectedPaths = new Set();
  let protectAll = false;
  for (const task of tasks) {
    for (const relativePath of [
      `artifacts/${task.name}`,
      `logs/${task.name}`,
      `plans/${task.name}.md`,
      `specs/${task.name}.spec.md`,
      `state/${task.name}`,
      `tmp/${task.name}`,
    ]) {
      protectedPaths.add(relativePath);
    }

    const planCandidates = [
      path.join(workflowDirectory, "plans", `${task.name}.md`),
      path.join(task.path, ".ai", "plans", `${task.name}.md`),
    ];
    const planPath = (
      await Promise.all(
        planCandidates.map(async (candidatePath) => ({
          candidatePath,
          exists: await pathExists(candidatePath),
        })),
      )
    ).find((candidate) => candidate.exists)?.candidatePath;
    if (!planPath) {
      protectAll = true;
      continue;
    }
    let planSource;
    try {
      const metadata = await lstat(planPath);
      if (!metadata.isFile() || metadata.isSymbolicLink()) {
        protectAll = true;
        continue;
      }
      planSource = await readFile(planPath, "utf8");
    } catch {
      protectAll = true;
      continue;
    }
    for (const match of planSource.matchAll(
      /\.ai\/(artifacts|logs|plans|specs|state|tmp)\/[A-Za-z0-9._/-]+/g,
    )) {
      const relativePath = match[0]
        .slice(".ai/".length)
        .replace(/[).,;:'"\]}>]+$/, "");
      const absolutePath = path.resolve(workflowDirectory, relativePath);
      if (
        LOCAL_RECORD_ROOTS.includes(relativePath.split("/")[0]) &&
        isContained(workflowDirectory, absolutePath)
      ) {
        protectedPaths.add(relativePath);
      }
    }
  }
  return { protectAll, protectedPaths: [...protectedPaths].sort() };
};

const pathTouchesProtection = (relativePath, protectedPaths) =>
  protectedPaths.some(
    (protectedPath) =>
      relativePath === protectedPath ||
      relativePath.startsWith(`${protectedPath}/`) ||
      protectedPath.startsWith(`${relativePath}/`),
  );

const removeRecordEntries = async ({
  entries,
  output,
  protectedRecordState,
  roots,
  workflowDirectory,
}) => {
  if (protectedRecordState.protectAll) {
    output(
      "All central workflow records were preserved because retained task ownership could not be established safely.",
    );
    return { removed: [] };
  }
  const removable = entries
    .filter(
      (entry) =>
        !pathTouchesProtection(
          entry.relativePath,
          protectedRecordState.protectedPaths,
        ),
    )
    .sort((left, right) => {
      const depth =
        right.relativePath.split("/").length -
        left.relativePath.split("/").length;
      return depth || left.relativePath.localeCompare(right.relativePath);
    });
  const removed = [];
  for (const entry of removable) {
    if (entry.directory) await rmdir(entry.path);
    else await unlink(entry.path);
    removed.push(entry.relativePath);
  }
  await Promise.all(
    roots.map((rootPath) => mkdir(rootPath, { recursive: true })),
  );
  if (protectedRecordState.protectedPaths.length === 0) {
    await verifyManagedRoots(roots);
  } else {
    const postcondition = await preflightCleanup({ workflowDirectory });
    const unexpected = postcondition.entries.filter(
      (entry) =>
        !pathTouchesProtection(
          entry.relativePath,
          protectedRecordState.protectedPaths,
        ),
    );
    if (unexpected.length > 0) {
      throw new Error(
        `unapproved workflow records remain: ${unexpected
          .map((entry) => entry.relativePath)
          .join(", ")}`,
      );
    }
  }
  output(`Workflow records removed: ${removed.length}`);
  output(
    `Workflow records preserved for retained tasks: ${entries.length - removed.length}`,
  );
  return { removed };
};

const removeTasks = async ({
  forceTaskNames,
  inventory,
  output,
  selectedTasks,
  commandExecutor,
}) => {
  const removedTasks = [];
  for (const task of selectedTasks) {
    const force = forceTaskNames.has(task.name);
    for (const candidate of task.candidates) {
      if (!candidate.registered) continue;
      const args = ["worktree", "remove"];
      if (force) args.push("--force");
      args.push(candidate.targetPath);
      const result = await commandExecutor({
        args,
        cwd: candidate.primaryPath,
      });
      if (result.exitCode !== 0) {
        throw new Error(
          `${task.name}: ${candidate.targetPath}: ${result.stderr.trim() || result.stdout.trim() || "Git worktree removal failed"}`,
        );
      }
    }
    if (await pathExists(task.path)) {
      await removeTree({
        root: inventory.worktreesDirectory,
        targetPath: task.path,
      });
    }
    removedTasks.push(task.name);
    output(`Removed task root: ${task.name}`);
  }
  return removedTasks;
};

export const runWorkflowCleanup = async ({
  args = process.argv.slice(2),
  commandExecutor = runGit,
  output = console.log,
  workflowDirectory = workflowRoot,
} = {}) => {
  const options = parseCleanupWorkflowArgs(args);
  if (options.help) {
    output(
      "Usage: cleanup-workflow.mjs [--apply-clean | --apply-all [--approve <task-name>]...]",
    );
    output("Without apply flags, preview workflow records and task worktrees.");
    output(
      "--apply-clean preserves approval-required tasks and their workflow context.",
    );
    output("--apply-all requires the exact approval-required task-name set.");
    output("Git branches are always retained.");
    return { ok: true };
  }
  if (options.error) {
    output(`FAIL cleanup:workflow: ${options.error}`);
    return { ok: false };
  }

  let inventory;
  try {
    inventory = await preflightWorkflowCleanup({
      commandExecutor,
      workflowDirectory,
    });
  } catch (error) {
    output(`FAIL cleanup:workflow preflight: ${error.message}`);
    return { ok: false };
  }
  printInventory({ inventory, output });
  if (inventory.blockers.length > 0) {
    output("No mutation occurred because cleanup has blocking safety issues.");
    return { inventory, ok: false };
  }

  const approvalTasks = inventory.tasks.filter((task) => task.approvalRequired);
  if (options.mode === "preview") {
    output(
      `Clean task roots: ${inventory.tasks.length - approvalTasks.length}`,
    );
    output(`Approval-required task roots: ${approvalTasks.length}`);
    output("No mutation occurred.");
    output(
      "WARNING: applying cleanup permanently removes task-root local files; Git branches are retained.",
    );
    return { inventory, ok: true };
  }

  if (options.mode === "apply-all") {
    const expected = approvalTasks.map((task) => task.name).sort();
    if (JSON.stringify(options.approvals) !== JSON.stringify(expected)) {
      output(
        "FAIL cleanup:workflow: approval set does not match the current issue inventory.",
      );
      output(`Expected approvals: ${expected.join(", ") || "None"}`);
      output(`Received approvals: ${options.approvals.join(", ") || "None"}`);
      output("No mutation occurred.");
      return { inventory, ok: false };
    }
  }

  const selectedTasks = inventory.tasks.filter(
    (task) => options.mode === "apply-all" || task.clean,
  );
  const retainedTasks = inventory.tasks.filter(
    (task) => !selectedTasks.includes(task),
  );
  const forceTaskNames = new Set(
    options.mode === "apply-all" ? options.approvals : [],
  );
  let removedTasks;
  try {
    removedTasks = await removeTasks({
      commandExecutor,
      forceTaskNames,
      inventory,
      output,
      selectedTasks,
    });
  } catch (error) {
    output(`FAIL cleanup:workflow worktree removal: ${error.message}`);
    output(
      "Central workflow records were preserved because worktree cleanup did not complete.",
    );
    return { inventory, ok: false };
  }

  try {
    const protectedRecordState =
      options.mode === "apply-all"
        ? { protectAll: false, protectedPaths: [] }
        : await resolveProtectedRecords({
            tasks: retainedTasks,
            workflowDirectory: inventory.root,
          });
    const recordResult = await removeRecordEntries({
      entries: inventory.records.entries,
      output,
      protectedRecordState,
      roots: inventory.records.roots,
      workflowDirectory: inventory.root,
    });
    output(`Task roots removed: ${removedTasks.length}`);
    output(`Task roots retained: ${retainedTasks.length}`);
    output("Git branches retained: all");
    return { inventory, ok: true, recordResult, removedTasks };
  } catch (error) {
    output(`FAIL cleanup:workflow record removal: ${error.message}`);
    return { inventory, ok: false, removedTasks };
  }
};

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const result = await runWorkflowCleanup();
  process.exitCode = result.ok ? 0 : 1;
}
