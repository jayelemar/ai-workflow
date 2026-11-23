#!/usr/bin/env node

import {
  lstat,
  mkdir,
  open,
  readdir,
  readlink,
  realpath,
  rmdir,
  unlink,
} from "node:fs/promises";
import { constants } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

export const workflowRoot = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  "../..",
);
export const LOCAL_RECORD_ROOTS = [
  "artifacts",
  "logs",
  "specs",
  "state",
  "tmp",
];

const isContained = (root, targetPath) => {
  const relativePath = path.relative(root, targetPath);
  return (
    relativePath !== "" &&
    !relativePath.startsWith(`..${path.sep}`) &&
    relativePath !== ".."
  );
};

const relativeToWorkflow = (root, targetPath) =>
  path.relative(root, targetPath).split(path.sep).join("/");

const sourceExpectsResources = async (root, task) => {
  const plans = path.join(root, "plans");
  const source = path.join(plans, `${task}.md`);
  let handle;
  try {
    const directory = await lstat(plans);
    if (directory.isSymbolicLink() || !directory.isDirectory()) return true;
    const metadata = await lstat(source);
    if (metadata.isSymbolicLink() || !metadata.isFile()) return true;
    handle = await open(source, constants.O_RDONLY | constants.O_NOFOLLOW);
    // Match the resource helper's bounded plan size. Unreadable or oversized
    // evidence must never make the remaining artifact directory disposable.
    const limit = 2 * 1024 * 1024;
    const bytes = Buffer.alloc(limit + 1);
    let used = 0;
    while (used < bytes.length) {
      const { bytesRead } = await handle.read(
        bytes,
        used,
        bytes.length - used,
        null,
      );
      if (!bytesRead) break;
      used += bytesRead;
    }
    return (
      used > limit ||
      /^\s*<!--\s*task-resources\b/im.test(
        new TextDecoder("utf-8", { fatal: true }).decode(
          bytes.subarray(0, used),
        ),
      )
    );
  } catch (error) {
    if (error.code === "ENOENT") return false;
    throw error;
  } finally {
    await handle?.close();
  }
};

export const parseCleanupArgs = (args) => {
  if (args.length === 0) return { apply: false };
  if (args.length === 1 && args[0] === "--apply") return { apply: true };
  if (args.length === 1 && ["-h", "--help"].includes(args[0]))
    return { apply: false, help: true };
  return { apply: false, error: `Unknown option: ${args.join(" ")}` };
};

const collectRootEntries = async ({ root, rootPath }) => {
  let metadata;
  try {
    metadata = await lstat(rootPath);
  } catch (error) {
    if (error.code === "ENOENT") return { entries: [], preserved: [] };
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
    throw new Error(
      `unsafe managed root escapes the workflow directory: ${rootPath}`,
    );
  }

  const entries = [];
  const preserved = [];
  const visit = async (directoryPath) => {
    const children = await readdir(directoryPath, { withFileTypes: true });
    // Preserve auxiliary evidence even when the expected manifest was lost.
    // Invalid markers and linked plans cannot establish legacy cleanup authority.
    if (
      path.dirname(directoryPath) === path.join(root, "artifacts") &&
      (children.some((child) => child.name === "resources.json") ||
        (await sourceExpectsResources(root, path.basename(directoryPath))))
    ) {
      return true;
    }
    for (const child of children) {
      const childPath = path.join(directoryPath, child.name);
      if (!isContained(root, childPath)) {
        throw new Error(
          `unsafe cleanup target escapes the workflow directory: ${childPath}`,
        );
      }
      const entry = {
        directory: child.isDirectory() && !child.isSymbolicLink(),
        path: childPath,
        relativePath: relativeToWorkflow(root, childPath),
      };
      if (
        directoryPath === path.join(root, "artifacts") &&
        !entry.directory &&
        (await sourceExpectsResources(root, child.name))
      )
        throw new Error(
          `unsafe marked task artifact is not a real directory: ${entry.relativePath}`,
        );
      if (
        childPath === path.join(root, "tmp", "task-resources.lock") ||
        (entry.directory && (await visit(childPath)))
      ) {
        preserved.push(entry);
      } else {
        entries.push(entry);
      }
    }
    return false;
  };

  await visit(rootPath);
  return { entries, preserved };
};

// A plan link can alias a managed root, even through an external directory.
// Resolve each path component so an intermediate managed link is protected too.
const verifyPlanIsolation = async (root) => {
  const canonicalRoot = await realpath(root);
  const managedRoots = await Promise.all(
    LOCAL_RECORD_ROOTS.map(async (name) => {
      const managed = path.join(canonicalRoot, name);
      try {
        return await realpath(managed);
      } catch (error) {
        if (error.code === "ENOENT") return managed;
        throw error;
      }
    }),
  );
  const caseFoldedRoots = managedRoots.map((managed) => managed.toLowerCase());
  const visited = new Set();
  const overlapsManagedRoot = (target, candidates = managedRoots) =>
    candidates.some(
      (managed) => target === managed || isContained(managed, target),
    );
  const failOverlap = () => {
    throw new Error(
      "managed cleanup overlaps a living plan target; preserve plans and resolve the alias before cleanup",
    );
  };
  const visit = async (target, linkDepth = 0) => {
    const parsed = path.parse(target);
    const components = target
      .slice(parsed.root.length)
      .split(path.sep)
      .filter(Boolean);
    let current = parsed.root;
    let metadata;
    for (const [index, component] of components.entries()) {
      current = path.join(current, component);
      if (overlapsManagedRoot(current)) failOverlap();
      try {
        metadata = await lstat(current);
      } catch (error) {
        if (error.code === "ENOENT" || error.code === "ENOTDIR") {
          // An absent case variant may become reachable when apply creates roots.
          // Conservatively reject that ambiguity on case-sensitive volumes too.
          if (overlapsManagedRoot(current.toLowerCase(), caseFoldedRoots))
            failOverlap();
          return;
        }
        throw error;
      }
      if (metadata.isSymbolicLink()) {
        // Fail closed on cycles, including links that grow the unresolved path.
        if (linkDepth >= 40) {
          throw new Error(
            "cannot prove living plan isolation: too many symbolic links",
          );
        }
        const destination = await readlink(current);
        // Keep '..' until after earlier symlink components have been resolved.
        const linkTarget = path.isAbsolute(destination)
          ? destination
          : `${path.dirname(current)}${path.sep}${destination}`;
        await visit(
          `${linkTarget}${path.sep}${components.slice(index + 1).join(path.sep)}`,
          linkDepth + 1,
        );
        return;
      }
      // Use filesystem casing, while resolving links separately so intermediate
      // managed links cannot disappear behind their final real path.
      current = await realpath(current);
      if (overlapsManagedRoot(current)) failOverlap();
    }
    if (managedRoots.some((managed) => isContained(current, managed)))
      failOverlap();
    if (!metadata?.isDirectory() || visited.has(current)) return;
    visited.add(current);
    for (const child of await readdir(current)) {
      await visit(path.join(current, child));
    }
  };
  await visit(path.join(canonicalRoot, "plans"));
};

export const preflightCleanup = async ({
  workflowDirectory = workflowRoot,
} = {}) => {
  const root = path.resolve(workflowDirectory);
  const rootMetadata = await lstat(root);
  if (!rootMetadata.isDirectory() || rootMetadata.isSymbolicLink()) {
    throw new Error(`workflow directory is not a safe directory: ${root}`);
  }

  const roots = LOCAL_RECORD_ROOTS.map((relativePath) =>
    path.join(root, relativePath),
  );
  await verifyPlanIsolation(root);
  const collected = await Promise.all(
    roots.map((rootPath) => collectRootEntries({ root, rootPath })),
  );
  const sortedEntries = (key) =>
    collected
      .flatMap((result) => result[key])
      .sort((left, right) =>
        left.relativePath.localeCompare(right.relativePath),
      );
  const entries = sortedEntries("entries");
  const preserved = sortedEntries("preserved");
  return { entries, preserved, root, roots };
};

const removeEntry = async (entry) => {
  if (entry.directory) {
    await rmdir(entry.path);
  } else {
    await unlink(entry.path);
  }
};

export const verifyManagedRoots = async (roots, preserved = []) => {
  for (const rootPath of roots) {
    const metadata = await lstat(rootPath);
    if (metadata.isSymbolicLink() || !metadata.isDirectory()) {
      throw new Error(`managed root is not an empty directory: ${rootPath}`);
    }
    const entries = await readdir(rootPath);
    const expected = preserved
      .filter((entry) => path.dirname(entry.path) === rootPath)
      .map((entry) => path.basename(entry.path));
    if (
      entries.length !== expected.length ||
      entries.some((entry) => !expected.includes(entry))
    ) {
      throw new Error(
        expected.length
          ? `managed root does not match preserved entries: ${rootPath}`
          : `managed root is not empty: ${rootPath}`,
      );
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
    output("Usage: pnpm cleanup:local [--apply]");
    output("Without --apply, inspect legacy local records without mutation.");
    output(
      "--apply removes every legacy entry under artifacts/, logs/, specs/, state/, and tmp/.",
    );
    output(
      "The entire plans/ tree is excluded. Use $worktree-cleanup for selected plan cleanup.",
    );
    output(
      "Task artifact directories containing resources.json or identified by source-plan resource markers, and tmp/task-resources.lock, are preserved without following links or operating resource providers.",
    );
    output(
      "Preflight rejects managed roots reachable through plan links before any mutation.",
    );
    return { ok: true };
  }
  if (options.error) {
    output(`FAIL cleanup:local: ${options.error}`);
    return { ok: false };
  }
  output("The entire plans/ tree is excluded from legacy cleanup.");

  let preflight;
  try {
    preflight = await preflightCleanup({ workflowDirectory });
  } catch (error) {
    output(`FAIL cleanup:local preflight: ${error.message}`);
    return { ok: false };
  }

  printTargets({ entries: preflight.preserved, output, verb: "Preserved" });
  output(`Cleanup preserved entry count: ${preflight.preserved.length}`);

  if (!options.apply) {
    printTargets({ entries: preflight.entries, output, verb: "Would remove" });
    output(`Cleanup preview target count: ${preflight.entries.length}`);
    output("No mutation occurred.");
    output("WARNING: --apply permanently removes legacy local records.");
    return {
      entries: preflight.entries,
      ok: true,
      preserved: preflight.preserved,
    };
  }

  output("WARNING: --apply permanently removes legacy local records.");
  const deletionOrder = [...preflight.entries].sort((left, right) => {
    const depthDifference =
      right.relativePath.split("/").length -
      left.relativePath.split("/").length;
    return (
      depthDifference || left.relativePath.localeCompare(right.relativePath)
    );
  });
  const removed = [];
  for (const entry of deletionOrder) {
    try {
      await remove(entry);
      removed.push(entry);
      output(`Removed ${entry.relativePath}`);
    } catch (error) {
      output(
        `FAIL cleanup:local deletion: ${entry.relativePath}: ${error.message}`,
      );
      output(`Cleanup removed count before failure: ${removed.length}`);
      return {
        entries: preflight.entries,
        ok: false,
        preserved: preflight.preserved,
        removed,
      };
    }
  }

  try {
    await Promise.all(
      preflight.roots.map((rootPath) => mkdir(rootPath, { recursive: true })),
    );
    await verifyManagedRoots(preflight.roots, preflight.preserved);
  } catch (error) {
    output(`FAIL cleanup:local root postcondition: ${error.message}`);
    return {
      entries: preflight.entries,
      ok: false,
      preserved: preflight.preserved,
      removed,
    };
  }

  output(`Cleanup removed count: ${removed.length}`);
  output(
    preflight.preserved.length
      ? "All managed local-record roots are present and contain only preserved task evidence."
      : "All managed local-record roots are present and empty.",
  );
  return {
    entries: preflight.entries,
    ok: true,
    preserved: preflight.preserved,
    removed,
  };
};

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const result = await runCleanup();
  process.exitCode = result.ok ? 0 : 1;
}
