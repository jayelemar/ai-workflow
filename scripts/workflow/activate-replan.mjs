#!/usr/bin/env node

import { lstat, mkdir, readdir, readFile, rename } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

export const workflowRoot = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  "../..",
);

const SAFE_NAME = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;
const ARCHIVE_PATTERN =
  /^\.ai\/artifacts\/([a-z0-9]+(?:-[a-z0-9]+)*)\/superseded-plan\.md$/;

const pathExists = async (targetPath) => {
  try {
    await lstat(targetPath);
    return true;
  } catch (error) {
    if (error.code === "ENOENT") return false;
    throw error;
  }
};

const requireRegularFile = async (targetPath, label) => {
  const metadata = await lstat(targetPath);
  if (!metadata.isFile() || metadata.isSymbolicLink()) {
    throw new Error(`${label} is not a safe regular file: ${targetPath}`);
  }
};

const requireSafeDirectory = async (targetPath, label) => {
  const metadata = await lstat(targetPath);
  if (!metadata.isDirectory() || metadata.isSymbolicLink()) {
    throw new Error(`${label} is not a safe directory: ${targetPath}`);
  }
};

const stripCode = (value) => {
  const trimmed = value.trim();
  if (trimmed.startsWith("`") && trimmed.endsWith("`")) {
    return trimmed.slice(1, -1);
  }
  return trimmed;
};

const sectionSource = (source, heading) => {
  const marker = `## ${heading}`;
  const start = source.indexOf(marker);
  if (start === -1) return undefined;
  const bodyStart = start + marker.length;
  const next = source.indexOf("\n## ", bodyStart);
  return source.slice(bodyStart, next === -1 ? source.length : next);
};

const fieldValue = (section, field, { strip = true } = {}) => {
  const match = section.match(new RegExp(`^- ${field}: (.+)$`, "m"));
  if (!match) throw new Error(`plan lineage is missing ${field}`);
  return strip ? stripCode(match[1]) : match[1].trim();
};

const parseArchiveHistory = (value) => {
  if (stripCode(value) === "None") return [];
  const paths = [...value.matchAll(/`([^`]+)`/g)].map((match) => match[1]);
  if (
    paths.length === 0 ||
    value
      .replace(/`[^`]+`/g, "")
      .replaceAll(",", "")
      .trim()
  ) {
    throw new Error(
      "Archived revisions must be None or comma-separated code paths",
    );
  }
  for (const archivePath of paths) {
    if (!ARCHIVE_PATTERN.test(archivePath)) {
      throw new Error(`unsafe archived revision path: ${archivePath}`);
    }
  }
  if (new Set(paths).size !== paths.length) {
    throw new Error("Archived revisions contain a duplicate path");
  }
  return paths;
};

export const parsePlanManifest = (source) => {
  const nameMatch = source.match(/^# Plan: ([^\r\n]+)$/m);
  if (!nameMatch || !SAFE_NAME.test(nameMatch[1])) {
    throw new Error("plan has a missing or unsafe # Plan name");
  }
  if (!/^plan-manifest@3$/m.test(source)) {
    throw new Error("plan is not plan-manifest@3");
  }

  const name = nameMatch[1];
  const lineage = sectionSource(source, "Plan Lineage");
  if (!lineage) {
    return { archivedRevisions: [], name, revision: 1, workItem: name };
  }

  const workItem = fieldValue(lineage, "Work item");
  const revisionSource = fieldValue(lineage, "Revision");
  const supersedes = fieldValue(lineage, "Supersedes");
  const archivedRevisions = parseArchiveHistory(
    fieldValue(lineage, "Archived revisions", { strip: false }),
  );
  if (!SAFE_NAME.test(workItem)) {
    throw new Error(`unsafe work-item name: ${workItem}`);
  }
  if (!/^[1-9][0-9]*$/.test(revisionSource)) {
    throw new Error(`invalid lineage revision: ${revisionSource}`);
  }
  const revision = Number(revisionSource);
  if (!Number.isSafeInteger(revision)) {
    throw new Error(`lineage revision is too large: ${revisionSource}`);
  }
  if (revision === 1) {
    if (
      name !== workItem ||
      supersedes !== "N/A: initial plan" ||
      archivedRevisions.length
    ) {
      throw new Error("initial plan lineage is inconsistent");
    }
  } else {
    const expectedName = `${workItem}-r${revision}`;
    if (name !== expectedName) {
      throw new Error(`revision plan name must be ${expectedName}`);
    }
    if (!ARCHIVE_PATTERN.test(supersedes)) {
      throw new Error(`invalid immediate predecessor archive: ${supersedes}`);
    }
    if (archivedRevisions.at(-1) !== supersedes) {
      throw new Error(
        "immediate predecessor must be last in Archived revisions",
      );
    }
  }
  return { archivedRevisions, name, revision, supersedes, workItem };
};

export const parseActivateArgs = (args) => {
  if (args.length === 1 && ["-h", "--help"].includes(args[0])) {
    return { help: true };
  }
  const values = {};
  for (let index = 0; index < args.length; index += 2) {
    const option = args[index];
    const value = args[index + 1];
    if (!["--candidate", "--predecessor"].includes(option) || !value) {
      return {
        error: `Unknown or incomplete options: ${args.slice(index).join(" ")}`,
      };
    }
    if (values[option]) return { error: `Duplicate option: ${option}` };
    values[option] = value;
  }
  if (!values["--candidate"] || !values["--predecessor"]) {
    return { error: "Both --predecessor and --candidate are required" };
  }
  return {
    candidate: values["--candidate"],
    predecessor: values["--predecessor"],
  };
};

const resolveInput = ({ input, kind, root }) => {
  const normalized = input.replaceAll("\\", "/").replace(/^\.ai\//, "");
  const match = normalized.match(
    kind === "predecessor"
      ? /^plans\/([a-z0-9]+(?:-[a-z0-9]+)*)\.md$/
      : /^tmp\/([a-z0-9]+(?:-[a-z0-9]+)*)\.md$/,
  );
  if (!match) throw new Error(`unsafe ${kind} path: ${input}`);
  return { name: match[1], path: path.join(root, normalized) };
};

const ensureArtifactDirectory = async ({ root, planName }) => {
  const artifacts = path.join(root, "artifacts");
  await requireSafeDirectory(artifacts, "artifacts root");
  const target = path.join(artifacts, planName);
  if (await pathExists(target)) {
    await requireSafeDirectory(target, "predecessor artifact directory");
  } else {
    await mkdir(target);
  }
  return target;
};

export const activateReplan = async ({
  args = process.argv.slice(2),
  output = console.log,
  renameFile = rename,
  workflowDirectory = workflowRoot,
} = {}) => {
  const options = parseActivateArgs(args);
  if (options.help) {
    output(
      "Usage: activate-replan.mjs --predecessor .ai/plans/<name>.md --candidate .ai/tmp/<successor>.md",
    );
    return { ok: true };
  }
  if (options.error) {
    output(`FAIL activate-replan: ${options.error}`);
    return { ok: false };
  }

  const root = path.resolve(workflowDirectory);
  try {
    await requireSafeDirectory(root, "workflow root");
    await requireSafeDirectory(path.join(root, "plans"), "plans root");
    await requireSafeDirectory(path.join(root, "tmp"), "tmp root");

    const predecessor = resolveInput({
      input: options.predecessor,
      kind: "predecessor",
      root,
    });
    const candidate = resolveInput({
      input: options.candidate,
      kind: "candidate",
      root,
    });
    await requireRegularFile(predecessor.path, "predecessor");
    await requireRegularFile(candidate.path, "candidate");

    const predecessorManifest = parsePlanManifest(
      await readFile(predecessor.path, "utf8"),
    );
    if (predecessorManifest.name !== predecessor.name) {
      throw new Error("predecessor filename does not match its # Plan name");
    }
    const candidateManifest = parsePlanManifest(
      await readFile(candidate.path, "utf8"),
    );
    if (candidateManifest.name !== candidate.name) {
      throw new Error("candidate filename does not match its # Plan name");
    }

    const nextRevision = predecessorManifest.revision + 1;
    const expectedName = `${predecessorManifest.workItem}-r${nextRevision}`;
    const archiveRelative = `.ai/artifacts/${predecessor.name}/superseded-plan.md`;
    const expectedHistory = [
      ...predecessorManifest.archivedRevisions,
      archiveRelative,
    ];
    if (
      candidateManifest.name !== expectedName ||
      candidateManifest.workItem !== predecessorManifest.workItem ||
      candidateManifest.revision !== nextRevision ||
      candidateManifest.supersedes !== archiveRelative ||
      JSON.stringify(candidateManifest.archivedRevisions) !==
        JSON.stringify(expectedHistory)
    ) {
      throw new Error(
        "candidate lineage does not exactly extend the predecessor",
      );
    }

    for (const filename of await readdir(path.join(root, "plans"))) {
      if (!filename.endsWith(".md")) continue;
      const activePath = path.join(root, "plans", filename);
      await requireRegularFile(activePath, "active plan");
      const activeManifest = parsePlanManifest(
        await readFile(activePath, "utf8"),
      );
      if (
        activeManifest.workItem === predecessorManifest.workItem &&
        activePath !== predecessor.path
      ) {
        throw new Error(
          `multiple active plans exist for work item ${predecessorManifest.workItem}`,
        );
      }
    }

    const successorPath = path.join(root, "plans", `${expectedName}.md`);
    if (await pathExists(successorPath)) {
      throw new Error(`successor already exists: ${successorPath}`);
    }
    const artifactDirectory = await ensureArtifactDirectory({
      planName: predecessor.name,
      root,
    });
    const archivePath = path.join(artifactDirectory, "superseded-plan.md");
    if (await pathExists(archivePath)) {
      throw new Error(`predecessor archive already exists: ${archivePath}`);
    }

    await renameFile(predecessor.path, archivePath);
    try {
      await renameFile(candidate.path, successorPath);
    } catch (activationError) {
      try {
        await renameFile(archivePath, predecessor.path);
      } catch (rollbackError) {
        throw new Error(
          `successor activation failed (${activationError.message}); rollback also failed (${rollbackError.message})`,
        );
      }
      throw new Error(
        `successor activation failed and predecessor was restored: ${activationError.message}`,
      );
    }

    output(`Replan activated: .ai/plans/${expectedName}.md`);
    output(`Archived predecessor: ${archiveRelative}`);
    return {
      archivePath,
      ok: true,
      predecessor: predecessor.path,
      successor: successorPath,
    };
  } catch (error) {
    output(`FAIL activate-replan: ${error.message}`);
    return { error, ok: false };
  }
};

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const result = await activateReplan();
  process.exitCode = result.ok ? 0 : 1;
}
