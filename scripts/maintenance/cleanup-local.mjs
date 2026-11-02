#!/usr/bin/env node

import {
  lstat,
  mkdir,
  readdir,
  readlink,
  realpath,
  rmdir,
  unlink,
} from "node:fs/promises";
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
    if (error.code === "ENOENT") return [];
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
  const visit = async (directoryPath) => {
    const children = await readdir(directoryPath, { withFileTypes: true });
    for (const child of children) {
      const childPath = path.join(directoryPath, child.name);
      if (!isContained(root, childPath)) {
        throw new Error(
          `unsafe cleanup target escapes the workflow directory: ${childPath}`,
        );
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
  const entries = (
    await Promise.all(
      roots.map((rootPath) => collectRootEntries({ root, rootPath })),
    )
  )
    .flat()
    .sort((left, right) => left.relativePath.localeCompare(right.relativePath));
  await verifyPlanIsolation(root);
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
    output("Usage: pnpm cleanup:local [--apply]");
    output("Without --apply, inspect legacy local records without mutation.");
    output(
      "--apply removes every legacy entry under artifacts/, logs/, specs/, state/, and tmp/.",
    );
    output(
      "The entire plans/ tree is excluded. Use worktree-cleanup.md for selected plan cleanup.",
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

  if (!options.apply) {
    printTargets({ entries: preflight.entries, output, verb: "Would remove" });
    output(`Cleanup preview target count: ${preflight.entries.length}`);
    output("No mutation occurred.");
    output("WARNING: --apply permanently removes legacy local records.");
    return { entries: preflight.entries, ok: true };
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
    } catch (error) {
      output(
        `FAIL cleanup:local deletion: ${entry.relativePath}: ${error.message}`,
      );
      output(`Cleanup removed count before failure: ${removed.length}`);
      return { entries: preflight.entries, ok: false, removed };
    }
  }

  try {
    await Promise.all(
      preflight.roots.map((rootPath) => mkdir(rootPath, { recursive: true })),
    );
    await verifyManagedRoots(preflight.roots);
  } catch (error) {
    output(`FAIL cleanup:local root postcondition: ${error.message}`);
    return { entries: preflight.entries, ok: false, removed };
  }

  printTargets({ entries: preflight.entries, output, verb: "Removed" });
  output(`Cleanup removed count: ${removed.length}`);
  output("All managed local-record roots are present and empty.");
  return { entries: preflight.entries, ok: true, removed };
};

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const result = await runCleanup();
  process.exitCode = result.ok ? 0 : 1;
}
