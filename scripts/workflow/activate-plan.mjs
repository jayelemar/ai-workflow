#!/usr/bin/env node

import {
  lstat,
  mkdir,
  readdir,
  readFile,
  rename,
  unlink,
} from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

export const workflowRoot = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  "../..",
);

const SAFE_NAME = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;
const TASK_ID = /^T-[0-9]{3,}$/;
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

const fieldValue = (section, field, owner, { strip = true } = {}) => {
  const match = section?.match(new RegExp(`^- ${field}: (.+)$`, "m"));
  if (!match) throw new Error(`${owner} is missing ${field}`);
  return strip ? stripCode(match[1]) : match[1].trim();
};

const scalarValue = (source, heading) => {
  const section = sectionSource(source, heading);
  const value = section
    ?.split("\n")
    .map((line) => line.trim())
    .find(Boolean);
  if (!value) throw new Error(`plan is missing ${heading}`);
  return stripCode(value);
};

const parseTaskIds = (source, owner) => {
  const ids = [...source.matchAll(/^### (?:Task )?(T-[0-9]{3,}):/gm)].map(
    (match) => match[1],
  );
  if (ids.length === 0) throw new Error(`${owner} has no stable task IDs`);
  if (ids.some((id) => !TASK_ID.test(id)) || new Set(ids).size !== ids.length) {
    throw new Error(`${owner} has invalid or duplicate task IDs`);
  }
  return ids;
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
  if (!/^plan-manifest@5$/m.test(source)) {
    throw new Error("plan is not plan-manifest@5");
  }

  const name = nameMatch[1];
  const lineage = sectionSource(source, "Plan Lineage");
  if (!lineage) throw new Error("plan is missing Plan Lineage");
  const workItem = fieldValue(lineage, "Work item", "plan lineage");
  const revisionSource = fieldValue(lineage, "Revision", "plan lineage");
  const supersedes = fieldValue(lineage, "Supersedes", "plan lineage");
  const archivedRevisions = parseArchiveHistory(
    fieldValue(lineage, "Archived revisions", "plan lineage", {
      strip: false,
    }),
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

  const tracking = sectionSource(source, "Work Tracking");
  const status = fieldValue(tracking, "Status", "work tracking");
  const expectedStatus = `.ai/artifacts/${workItem}/work-status.md`;
  if (status !== expectedStatus) {
    throw new Error(`plan status must be ${expectedStatus}`);
  }

  return {
    archivedRevisions,
    classification: scalarValue(source, "Classification"),
    name,
    revision,
    spec: scalarValue(source, "Spec"),
    status,
    supersedes,
    taskIds: parseTaskIds(
      sectionSource(source, "Implementation") ?? "",
      "plan",
    ),
    workItem,
  };
};

export const parseWorkStatus = (source) => {
  const nameMatch = source.match(/^# Work Status: ([^\r\n]+)$/m);
  if (!nameMatch || !SAFE_NAME.test(nameMatch[1])) {
    throw new Error("status has a missing or unsafe work-item title");
  }
  if (!/^work-status@1$/m.test(source)) {
    throw new Error("status is not work-status@1");
  }
  const current = sectionSource(source, "Current Work");
  const workItem = fieldValue(current, "Work item", "current work");
  if (nameMatch[1] !== workItem || !SAFE_NAME.test(workItem)) {
    throw new Error("status title and work item do not match");
  }
  return {
    activePlan: fieldValue(current, "Active plan", "current work"),
    classification: fieldValue(current, "Classification", "current work"),
    spec: fieldValue(current, "Spec", "current work"),
    taskIds: parseTaskIds(
      sectionSource(source, "Current Tasks") ?? "",
      "status",
    ),
    workItem,
  };
};

export const parseActivateArgs = (args) => {
  if (args.length === 1 && ["-h", "--help"].includes(args[0])) {
    return { help: true };
  }
  const allowed = new Set([
    "--candidate-plan",
    "--candidate-status",
    "--predecessor",
  ]);
  const values = {};
  for (let index = 0; index < args.length; index += 2) {
    const option = args[index];
    const value = args[index + 1];
    if (!allowed.has(option) || !value) {
      return {
        error: `Unknown or incomplete options: ${args.slice(index).join(" ")}`,
      };
    }
    if (values[option]) return { error: `Duplicate option: ${option}` };
    values[option] = value;
  }
  if (!values["--candidate-plan"] || !values["--candidate-status"]) {
    return { error: "Candidate plan and candidate status are required" };
  }
  return {
    candidatePlan: values["--candidate-plan"],
    candidateStatus: values["--candidate-status"],
    predecessor: values["--predecessor"],
  };
};

const resolveInput = ({ input, kind, root }) => {
  const normalized = input.replaceAll("\\", "/").replace(/^\.ai\//, "");
  const patterns = {
    candidatePlan: /^tmp\/([a-z0-9]+(?:-[a-z0-9]+)*)\.md$/,
    candidateStatus: /^tmp\/([a-z0-9]+(?:-[a-z0-9]+)*)\.work-status\.md$/,
    predecessor: /^plans\/([a-z0-9]+(?:-[a-z0-9]+)*)\.md$/,
  };
  const match = normalized.match(patterns[kind]);
  if (!match) throw new Error(`unsafe ${kind} path: ${input}`);
  return { name: match[1], path: path.join(root, normalized) };
};

const ensureArtifactDirectory = async ({ root, name, label }) => {
  const artifacts = path.join(root, "artifacts");
  await requireSafeDirectory(artifacts, "artifacts root");
  const target = path.join(artifacts, name);
  if (await pathExists(target)) await requireSafeDirectory(target, label);
  else await mkdir(target);
  return target;
};

const assertStatusMatchesPlan = ({ plan, status }) => {
  if (
    status.workItem !== plan.workItem ||
    status.activePlan !== `.ai/plans/${plan.name}.md` ||
    status.classification !== plan.classification ||
    status.spec !== plan.spec ||
    JSON.stringify(status.taskIds) !== JSON.stringify(plan.taskIds)
  ) {
    throw new Error("candidate status does not exactly match candidate plan");
  }
};

export const activatePlan = async ({
  args = process.argv.slice(2),
  output = console.log,
  renameFile = rename,
  unlinkFile = unlink,
  workflowDirectory = workflowRoot,
} = {}) => {
  const options = parseActivateArgs(args);
  if (options.help) {
    output(
      "Usage: activate-plan.mjs --candidate-plan .ai/tmp/<plan>.md --candidate-status .ai/tmp/<work-item>.work-status.md [--predecessor .ai/plans/<name>.md]",
    );
    return { ok: true };
  }
  if (options.error) {
    output(`FAIL activate-plan: ${options.error}`);
    return { ok: false };
  }

  const root = path.resolve(workflowDirectory);
  const moves = [];
  try {
    await requireSafeDirectory(root, "workflow root");
    await requireSafeDirectory(path.join(root, "plans"), "plans root");
    await requireSafeDirectory(path.join(root, "tmp"), "tmp root");

    const candidatePlan = resolveInput({
      input: options.candidatePlan,
      kind: "candidatePlan",
      root,
    });
    const candidateStatus = resolveInput({
      input: options.candidateStatus,
      kind: "candidateStatus",
      root,
    });
    await requireRegularFile(candidatePlan.path, "candidate plan");
    await requireRegularFile(candidateStatus.path, "candidate status");

    const candidateManifest = parsePlanManifest(
      await readFile(candidatePlan.path, "utf8"),
    );
    const candidateStatusRecord = parseWorkStatus(
      await readFile(candidateStatus.path, "utf8"),
    );
    if (candidateManifest.name !== candidatePlan.name) {
      throw new Error("candidate filename does not match its # Plan name");
    }
    if (candidateStatusRecord.workItem !== candidateStatus.name) {
      throw new Error("candidate status filename does not match its work item");
    }
    assertStatusMatchesPlan({
      plan: candidateManifest,
      status: candidateStatusRecord,
    });

    let predecessor;
    let predecessorManifest;
    let archivePath;
    let archiveRelative;
    const statusPath = path.join(
      root,
      "artifacts",
      candidateManifest.workItem,
      "work-status.md",
    );
    const statusBackup = path.join(
      root,
      "tmp",
      `${candidateManifest.workItem}.previous-work-status.md`,
    );

    if (options.predecessor) {
      predecessor = resolveInput({
        input: options.predecessor,
        kind: "predecessor",
        root,
      });
      await requireRegularFile(predecessor.path, "predecessor");
      predecessorManifest = parsePlanManifest(
        await readFile(predecessor.path, "utf8"),
      );
      if (predecessorManifest.name !== predecessor.name) {
        throw new Error("predecessor filename does not match its # Plan name");
      }
      const nextRevision = predecessorManifest.revision + 1;
      const expectedName = `${predecessorManifest.workItem}-r${nextRevision}`;
      archiveRelative = `.ai/artifacts/${predecessor.name}/superseded-plan.md`;
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
          "candidate lineage does not exactly extend predecessor",
        );
      }
      await requireRegularFile(statusPath, "current work status");
      const currentStatus = parseWorkStatus(await readFile(statusPath, "utf8"));
      assertStatusMatchesPlan({
        plan: predecessorManifest,
        status: currentStatus,
      });
      if (await pathExists(statusBackup)) {
        throw new Error(`status backup already exists: ${statusBackup}`);
      }
      const archiveDirectory = await ensureArtifactDirectory({
        label: "predecessor artifact directory",
        name: predecessor.name,
        root,
      });
      archivePath = path.join(archiveDirectory, "superseded-plan.md");
      if (await pathExists(archivePath)) {
        throw new Error(`predecessor archive already exists: ${archivePath}`);
      }
    } else if (candidateManifest.revision !== 1) {
      throw new Error("a revision plan requires --predecessor");
    } else if (await pathExists(statusPath)) {
      throw new Error(`work status already exists: ${statusPath}`);
    }

    for (const filename of await readdir(path.join(root, "plans"))) {
      if (!filename.endsWith(".md")) continue;
      const activePath = path.join(root, "plans", filename);
      await requireRegularFile(activePath, "active plan");
      const activeSource = await readFile(activePath, "utf8");
      if (!/^plan-manifest@5$/m.test(activeSource)) continue;
      const activeManifest = parsePlanManifest(activeSource);
      if (
        activeManifest.workItem === candidateManifest.workItem &&
        activePath !== predecessor?.path
      ) {
        throw new Error(
          `multiple active plans exist for work item ${candidateManifest.workItem}`,
        );
      }
    }

    const activePlanPath = path.join(
      root,
      "plans",
      `${candidateManifest.name}.md`,
    );
    if (await pathExists(activePlanPath)) {
      throw new Error(`active plan already exists: ${activePlanPath}`);
    }
    await ensureArtifactDirectory({
      label: "work-item artifact directory",
      name: candidateManifest.workItem,
      root,
    });

    const move = async (source, destination) => {
      await renameFile(source, destination);
      moves.push({ destination, source });
    };
    if (predecessor) {
      await move(statusPath, statusBackup);
      await move(predecessor.path, archivePath);
    }
    await move(candidateStatus.path, statusPath);
    await move(candidatePlan.path, activePlanPath);
    if (predecessor) await unlinkFile(statusBackup);

    output(`Plan activated: .ai/plans/${candidateManifest.name}.md`);
    output(
      `Work status: .ai/artifacts/${candidateManifest.workItem}/work-status.md`,
    );
    if (archiveRelative) output(`Archived predecessor: ${archiveRelative}`);
    return {
      activePlan: activePlanPath,
      archivePath,
      ok: true,
      status: statusPath,
    };
  } catch (error) {
    const rollbackErrors = [];
    for (const move of moves.reverse()) {
      try {
        if (await pathExists(move.destination)) {
          await renameFile(move.destination, move.source);
        }
      } catch (rollbackError) {
        rollbackErrors.push(rollbackError.message);
      }
    }
    const suffix = rollbackErrors.length
      ? `; rollback also failed (${rollbackErrors.join("; ")})`
      : moves.length
        ? "; activation changes were rolled back"
        : "";
    output(`FAIL activate-plan: ${error.message}${suffix}`);
    return { error, ok: false, rollbackErrors };
  }
};

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const result = await activatePlan();
  process.exitCode = result.ok ? 0 : 1;
}
