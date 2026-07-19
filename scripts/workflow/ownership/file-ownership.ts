import { mkdir, readFile, readdir, writeFile } from "node:fs/promises";
import path from "node:path";

import {
  extractSectionValue,
  isNextAction,
  isStatus,
  normalizeWorkflowStateValue,
  uniquePaths,
} from "../runner/plan/parser.ts";
import {
  defaultIsIgnored,
  isNoReviewStagingPathPlaceholder,
  parseReviewStagingBulletValue,
  parseReviewStagingPaths,
  parseTransferredFileOwnershipReleasePaths,
  validateConcretePlanFilePath,
} from "../runner/review/staging.ts";
import {
  asRecord,
  isFailure,
  type Failure,
  type FileOwnershipArtifact,
  type FileOwnershipPreflight,
  type ParsedPlan,
  type ProcessResult,
  type ProcessRunner,
  type ReviewStagingResult,
  type Status,
  type ThinPlanV2FilesState,
  type ThinPlanV2WorkflowState,
} from "../runner/types.ts";

const rel = (...segments: string[]) => segments.join("/");

const sectionLines = (content: string, heading: string): string[] | null => {
  const lines = content.split(/\r?\n/);
  const start = lines.findIndex((line) => line.trim() === heading);
  if (start === -1) {
    return null;
  }
  const collected: string[] = [];
  for (const line of lines.slice(start + 1)) {
    if (line.trim().startsWith("## ")) {
      break;
    }
    collected.push(line);
  }
  return collected;
};

const asStringArray = (value: unknown): string[] | undefined =>
  Array.isArray(value) && value.every((item) => typeof item === "string")
    ? (value as string[])
    : undefined;

const thinPlanV2ArtifactPath = (
  planName: string,
  ...segments: string[]
): string => rel(".ai", "artifacts", planName, ...segments);

const readJsonArtifact = async (
  rootDir: string,
  relativePath: string,
): Promise<unknown | Failure> => {
  let raw: string;
  try {
    raw = await readFile(path.join(rootDir, relativePath), "utf8");
  } catch (error) {
    return {
      ok: false,
      reason: `thin-plan-v2 artifact cannot be read: ${relativePath}: ${String(error)}`,
    };
  }
  try {
    return JSON.parse(raw) as unknown;
  } catch {
    return {
      ok: false,
      reason: `thin-plan-v2 artifact is malformed JSON: ${relativePath}`,
    };
  }
};

const workflowEventHistoryIndex = (
  history: string[] | undefined,
  event: Record<string, unknown> | undefined,
): number => {
  if (!history || history.length === 0 || !event) {
    return -1;
  }
  const candidates = [event.path, event.evidence].filter(
    (value): value is string => typeof value === "string" && value.length > 0,
  );
  const indexes = candidates
    .map((candidate) => history.indexOf(candidate))
    .filter((index) => index >= 0);
  return indexes.length > 0 ? Math.min(...indexes) : -1;
};

const normalizeWorkflowEventHistory = (
  value: unknown,
): string[] | undefined => {
  if (!Array.isArray(value)) {
    return undefined;
  }
  const history = value.map((entry) => {
    if (typeof entry === "string") {
      return entry;
    }
    const event = asRecord(entry);
    const pointer = event?.path ?? event?.evidence;
    return typeof pointer === "string" && pointer.length > 0
      ? pointer
      : undefined;
  });
  return history.every((entry): entry is string => typeof entry === "string")
    ? history
    : undefined;
};

const workflowReviewSupersededByProgress = (
  latest: Record<string, unknown> | undefined,
  history: string[] | undefined,
): boolean => {
  const reviewIndex = workflowEventHistoryIndex(
    history,
    asRecord(latest?.review) ?? undefined,
  );
  if (reviewIndex < 0) {
    return false;
  }
  return ["execution", "validation"].some((kind) => {
    const eventIndex = workflowEventHistoryIndex(
      history,
      asRecord(latest?.[kind]) ?? undefined,
    );
    return eventIndex > reviewIndex;
  });
};

const parseThinPlanV2WorkflowState = (
  raw: unknown,
  expectedPlanPath: string,
  artifactPath: string,
): ThinPlanV2WorkflowState | Failure => {
  const record = asRecord(raw);
  const planPath = record?.planPath;
  const status = record?.status;
  const nextAction = record?.nextAction;
  const updatedAt = record?.updatedAt;
  const unresolvedBlockers = asStringArray(record?.unresolvedBlockers) ?? [];
  const history = normalizeWorkflowEventHistory(record?.history);

  if (
    typeof planPath !== "string" ||
    planPath !== expectedPlanPath ||
    typeof status !== "string" ||
    !isStatus(status) ||
    typeof nextAction !== "string" ||
    !isNextAction(nextAction) ||
    typeof updatedAt !== "string"
  ) {
    return {
      ok: false,
      reason: `thin-plan-v2 workflow state is malformed: ${artifactPath}`,
    };
  }

  const latest = asRecord(record?.latest) ?? undefined;
  const latestReview = asRecord(latest?.review);
  const reviewSummary =
    typeof latestReview?.summary === "string"
      ? latestReview.summary.toUpperCase()
      : "";
  const reviewDecision =
    typeof latestReview?.decision === "string"
      ? latestReview.decision.toLowerCase()
      : "";
  if (
    unresolvedBlockers.length === 0 &&
    reviewDecision === "active" &&
    /\b(?:NEEDS FIX|HIGH RISK)\b/.test(reviewSummary) &&
    !workflowReviewSupersededByProgress(latest, history)
  ) {
    return {
      ok: false,
      reason: `thin-plan-v2 workflow state is inconsistent: latest review requires fixes but unresolvedBlockers is empty in ${artifactPath}`,
    };
  }

  return {
    planPath,
    status,
    nextAction,
    latest,
    history,
    unresolvedBlockers,
    updatedAt,
  };
};

const parseThinPlanV2FilesState = (
  raw: unknown,
  artifactPath: string,
): ThinPlanV2FilesState | Failure => {
  const record = asRecord(raw);
  const created = asStringArray(record?.created);
  const modified = asStringArray(record?.modified);
  const deleted = asStringArray(record?.deleted);
  const changedFiles = asStringArray(record?.changedFiles);
  const released = asStringArray(record?.released);
  const headSha = record?.headSha;
  if (
    !created ||
    !modified ||
    !deleted ||
    !changedFiles ||
    !released ||
    typeof headSha !== "string"
  ) {
    return {
      ok: false,
      reason: `thin-plan-v2 files state is malformed: ${artifactPath}`,
    };
  }
  return {
    created,
    modified,
    deleted,
    changedFiles,
    released,
    headSha,
  };
};

const fileOwnershipArtifactRelativePath = (planName: string): string =>
  rel(".ai", "artifacts", planName, "state", "file-ownership.json");

export const fileOwnershipArtifactAbsolutePath = (
  rootDir: string,
  planName: string,
): string => path.join(rootDir, fileOwnershipArtifactRelativePath(planName));

export type GitChangedFileEntry = {
  path: string;
  change: "created" | "modified" | "deleted";
};

export const parseGitStatusChangedFileEntries = (
  output: string,
): GitChangedFileEntry[] => {
  const entries: GitChangedFileEntry[] = [];
  for (const rawLine of output.split(/\r?\n/)) {
    const line = rawLine.trimEnd();
    if (line.length < 4) {
      continue;
    }
    const status = line.slice(0, 2);
    let filePath = line.slice(3).trim();
    const renameTarget = filePath.match(/\s+->\s+(.+)$/)?.[1];
    if (renameTarget) {
      filePath = renameTarget;
    }
    if (filePath.length > 0) {
      entries.push({
        path: filePath,
        change: status.includes("D")
          ? "deleted"
          : status.includes("A") || status === "??"
            ? "created"
            : "modified",
      });
    }
  }
  const seen = new Set<string>();
  return entries.filter((entry) => {
    if (seen.has(entry.path)) {
      return false;
    }
    seen.add(entry.path);
    return true;
  });
};

export const readGitChangedFileEntries = async (
  rootDir: string,
  processRunner: ProcessRunner,
): Promise<{ ok: true; entries: GitChangedFileEntry[] } | Failure> => {
  const result = await processRunner({
    command: "git",
    args: ["status", "--short", "--untracked-files=all", "--"],
    cwd: rootDir,
    input: "",
    promptPath: "git-file-ownership-status",
  }).catch(
    (error): ProcessResult => ({
      launched: false,
      stdout: "",
      stderr: "",
      error: String(error),
    }),
  );

  if (!result.launched) {
    return {
      ok: false,
      reason: `could not launch file ownership git status: ${result.error}`,
    };
  }
  if (result.exitCode !== 0) {
    const details = [result.stderr.trim(), result.stdout.trim()]
      .filter(Boolean)
      .join("\n");
    return {
      ok: false,
      reason: `file ownership git status exited with code ${result.exitCode}${details ? `: ${details}` : ""}`,
    };
  }
  return { ok: true, entries: parseGitStatusChangedFileEntries(result.stdout) };
};

export const readGitChangedFiles = async (
  rootDir: string,
  processRunner: ProcessRunner,
): Promise<{ ok: true; paths: string[] } | Failure> => {
  const changed = await readGitChangedFileEntries(rootDir, processRunner);
  if (!changed.ok) {
    return changed;
  }
  return { ok: true, paths: changed.entries.map((entry) => entry.path) };
};

export const readGitHeadSha = async (
  rootDir: string,
  processRunner: ProcessRunner,
): Promise<{ ok: true; sha: string } | Failure> => {
  const result = await processRunner({
    command: "git",
    args: ["rev-parse", "HEAD"],
    cwd: rootDir,
    input: "",
    promptPath: "git-file-ownership-head",
  }).catch(
    (error): ProcessResult => ({
      launched: false,
      stdout: "",
      stderr: "",
      error: String(error),
    }),
  );

  if (!result.launched) {
    return {
      ok: false,
      reason: `could not launch file ownership head check: ${result.error}`,
    };
  }
  if (result.exitCode !== 0) {
    const details = [result.stderr.trim(), result.stdout.trim()]
      .filter(Boolean)
      .join("\n");
    return {
      ok: false,
      reason: `file ownership head check exited with code ${result.exitCode}${details ? `: ${details}` : ""}`,
    };
  }
  return { ok: true, sha: result.stdout.trim() };
};

export const parseOwnershipScopeEntries = async (
  content: string,
  rootDir: string,
): Promise<{ ok: true; entries: string[]; present: boolean } | Failure> => {
  const lines = sectionLines(content, "## Ownership Scope");
  if (lines === null) {
    return { ok: true, entries: [], present: false };
  }

  const entries: string[] = [];
  for (const line of lines) {
    const trimmed = line.trim();
    if (trimmed.length === 0) {
      continue;
    }
    const bulletValue = parseReviewStagingBulletValue(trimmed);
    if (bulletValue === null) {
      continue;
    }
    const value = bulletValue.trim();
    if (isNoReviewStagingPathPlaceholder(value)) {
      continue;
    }
    if (path.isAbsolute(value)) {
      return {
        ok: false,
        reason: `ownership scope path is absolute: ${value}`,
      };
    }
    if (value.includes("..")) {
      return {
        ok: false,
        reason: `ownership scope path contains ..: ${value}`,
      };
    }
    if (value.includes("*") && !value.endsWith("/**")) {
      return {
        ok: false,
        reason: `ownership scope path has unsupported glob: ${value}`,
      };
    }
    if (value.endsWith("/**")) {
      const prefix = value.slice(0, -3);
      if (prefix.length === 0) {
        return { ok: false, reason: `ownership scope path is empty: ${value}` };
      }
      entries.push(value);
      continue;
    }
    const validated = await validateConcretePlanFilePath({
      value,
      rootDir,
      reasonPrefix: "ownership scope path",
    });
    if (!validated.ok) {
      return validated;
    }
    entries.push(validated.path);
  }

  if (entries.length === 0) {
    return {
      ok: false,
      reason: "plan has no concrete ownership scope entries",
    };
  }

  return { ok: true, entries: uniquePaths(entries), present: true };
};

export const resolveOwnershipScopeEntries = (
  entries: string[],
  changedFiles: string[],
  releasedFiles: string[] = [],
): string[] => {
  const released = new Set(releasedFiles);
  const resolved: string[] = [];
  for (const entry of entries) {
    if (entry.endsWith("/**")) {
      const prefix = entry.slice(0, -3);
      for (const changedFile of changedFiles) {
        if (changedFile === prefix || changedFile.startsWith(`${prefix}/`)) {
          resolved.push(changedFile);
        }
      }
      continue;
    }
    resolved.push(entry);
  }
  return uniquePaths(resolved).filter((filePath) => !released.has(filePath));
};

export const filterChangedOwnershipFiles = (
  resolvedFiles: string[],
  changedFiles: string[],
  releasedFiles: string[] = [],
): string[] => {
  const resolved = new Set(resolvedFiles);
  const released = new Set(releasedFiles);
  return uniquePaths(changedFiles).filter(
    (filePath) => resolved.has(filePath) && !released.has(filePath),
  );
};

export const canonicalFileOwnershipArtifact = (
  artifact: FileOwnershipArtifact,
): FileOwnershipArtifact => ({
  planPath: artifact.planPath,
  owns: artifact.owns,
  released: artifact.released,
  resolvedFiles: artifact.resolvedFiles,
  changedFiles: artifact.changedFiles,
  headSha: artifact.headSha,
  updatedAt: artifact.updatedAt,
});

export const parseFileOwnershipArtifact = (
  raw: string,
  artifactPath: string,
): FileOwnershipArtifact | Failure => {
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    return {
      ok: false,
      reason: `file ownership artifact is malformed: ${artifactPath}`,
    };
  }

  const record = asRecord(parsed);
  const planPath = record?.planPath;
  const status = record?.status;
  const nextAction = record?.nextAction;
  const owns = asStringArray(record?.owns);
  const released = asStringArray(record?.released);
  const resolvedFiles = asStringArray(record?.resolvedFiles);
  const changedFiles = asStringArray(record?.changedFiles);
  const legacyOwnedFiles = asStringArray(record?.ownedFiles);
  const legacyReleasedFiles = asStringArray(record?.releasedFiles);
  const headSha = record?.headSha;
  const updatedAt = record?.updatedAt;
  const hasLegacyShape = !owns && !!legacyOwnedFiles;
  if (typeof planPath === "string" && hasLegacyShape) {
    const hasLegacyWorkflowState =
      status !== undefined || nextAction !== undefined;
    if (
      (hasLegacyWorkflowState &&
        (typeof status !== "string" ||
          !isStatus(status) ||
          typeof nextAction !== "string" ||
          !isNextAction(nextAction))) ||
      (record?.releasedFiles !== undefined && !legacyReleasedFiles)
    ) {
      return {
        ok: false,
        reason: `file ownership artifact is malformed: ${artifactPath}`,
      };
    }

    return {
      planPath,
      status: hasLegacyWorkflowState ? status : undefined,
      nextAction: hasLegacyWorkflowState ? nextAction : undefined,
      owns: legacyOwnedFiles,
      released: legacyReleasedFiles ?? [],
      resolvedFiles: resolvedFiles ?? [],
      changedFiles: changedFiles ?? [],
      headSha: typeof headSha === "string" ? headSha : "",
      updatedAt: typeof updatedAt === "string" ? updatedAt : "",
      migratedFromLegacy: true,
    };
  }
  if (
    typeof planPath !== "string" ||
    !owns ||
    !released ||
    !resolvedFiles ||
    !changedFiles ||
    typeof headSha !== "string" ||
    typeof updatedAt !== "string"
  ) {
    return {
      ok: false,
      reason: `file ownership artifact is malformed: ${artifactPath}`,
    };
  }
  const hasLegacyWorkflowState =
    status !== undefined || nextAction !== undefined;
  if (
    hasLegacyWorkflowState &&
    (typeof status !== "string" ||
      !isStatus(status) ||
      typeof nextAction !== "string" ||
      !isNextAction(nextAction))
  ) {
    return {
      ok: false,
      reason: `file ownership artifact is malformed: ${artifactPath}`,
    };
  }

  return {
    planPath,
    status: hasLegacyWorkflowState ? status : undefined,
    nextAction: hasLegacyWorkflowState ? nextAction : undefined,
    owns,
    released,
    resolvedFiles,
    changedFiles,
    headSha,
    updatedAt,
  };
};

export const refreshCurrentFileOwnershipArtifact = async ({
  rootDir,
  plan,
  processRunner,
  timestamp,
}: {
  rootDir: string;
  plan: ParsedPlan;
  processRunner: ProcessRunner;
  timestamp: () => string;
}): Promise<
  | { ok: true; present: false; changedFiles: string[] }
  | {
      ok: true;
      present: true;
      artifact: FileOwnershipArtifact;
      changedFiles: string[];
    }
  | Failure
> => {
  const ownershipScope = await parseOwnershipScopeEntries(
    plan.content,
    rootDir,
  );
  if (!ownershipScope.ok) {
    return ownershipScope;
  }
  if (!ownershipScope.present) {
    return { ok: true, present: false, changedFiles: [] };
  }

  const changedFiles = await readGitChangedFiles(rootDir, processRunner);
  if (!changedFiles.ok) {
    return changedFiles;
  }

  const headSha = await readGitHeadSha(rootDir, processRunner);
  if (!headSha.ok) {
    return headSha;
  }
  const released = await parseTransferredFileOwnershipReleasePaths(
    plan.content,
    rootDir,
  );
  if (!released.ok) {
    return released;
  }
  const resolvedFiles = resolveOwnershipScopeEntries(
    ownershipScope.entries,
    changedFiles.paths,
    released.paths,
  );
  const artifact: FileOwnershipArtifact = {
    planPath: plan.planPath,
    owns: ownershipScope.entries,
    released: released.paths,
    resolvedFiles,
    changedFiles: filterChangedOwnershipFiles(
      resolvedFiles,
      changedFiles.paths,
      released.paths,
    ),
    headSha: headSha.sha,
    updatedAt: timestamp(),
  };
  const artifactPath = fileOwnershipArtifactAbsolutePath(
    rootDir,
    plan.planName,
  );
  await mkdir(path.dirname(artifactPath), { recursive: true });
  await writeFile(
    artifactPath,
    `${JSON.stringify(artifact, null, 2)}\n`,
    "utf8",
  );

  return {
    ok: true,
    present: true,
    artifact,
    changedFiles: changedFiles.paths,
  };
};

const blockingOwnershipStatuses = new Set<Status>([
  "active",
  "review",
  "blocked",
  "reopening",
]);

export const readOtherFileOwnershipArtifacts = async (
  rootDir: string,
  currentPlanPath: string,
): Promise<{ ok: true; artifacts: FileOwnershipArtifact[] } | Failure> => {
  const artifactsRoot = path.join(rootDir, ".ai", "artifacts");
  let entries: string[];
  try {
    entries = await readdir(artifactsRoot);
  } catch (error) {
    const code = (error as NodeJS.ErrnoException).code;
    if (code === "ENOENT") {
      return { ok: true, artifacts: [] };
    }
    return {
      ok: false,
      reason: `file ownership artifacts cannot be listed: ${String(error)}`,
    };
  }

  const artifacts: FileOwnershipArtifact[] = [];
  for (const entry of entries) {
    const otherPlanPath = rel(".ai", "plans", `${entry}.md`);
    try {
      const otherPlanContent = await readFile(
        path.join(rootDir, otherPlanPath),
        "utf8",
      );
      const extractedStatus = extractSectionValue(
        otherPlanContent,
        "## Status",
      );
      if (extractedStatus !== null) {
        const rawStatus = normalizeWorkflowStateValue(extractedStatus);
        if (isStatus(rawStatus) && rawStatus === "draft") {
          continue;
        }
      }
    } catch (error) {
      const code = (error as NodeJS.ErrnoException).code;
      if (code !== "ENOENT") {
        return {
          ok: false,
          reason: `plan file cannot be read: ${otherPlanPath}: ${String(error)}`,
        };
      }
    }

    const artifactPath = path.join(
      artifactsRoot,
      entry,
      "state",
      "file-ownership.json",
    );
    let raw: string;
    try {
      raw = await readFile(artifactPath, "utf8");
    } catch (error) {
      const code = (error as NodeJS.ErrnoException).code;
      if (code === "ENOENT" || code === "EISDIR") {
        continue;
      }
      return {
        ok: false,
        reason: `file ownership artifact cannot be read: ${artifactPath}: ${String(error)}`,
      };
    }
    const parsed = parseFileOwnershipArtifact(raw, artifactPath);
    if (isFailure(parsed)) {
      return parsed;
    }
    if (parsed.planPath !== currentPlanPath) {
      const workflowPath = path.join(
        artifactsRoot,
        entry,
        "state",
        "workflow.json",
      );
      let artifact = parsed;
      try {
        const workflowRaw = await readFile(workflowPath, "utf8");
        const workflow = parseThinPlanV2WorkflowState(
          JSON.parse(workflowRaw) as unknown,
          parsed.planPath,
          path.relative(rootDir, workflowPath),
        );
        if (isFailure(workflow)) {
          return workflow;
        }
        artifact = {
          ...parsed,
          status: workflow.status,
          nextAction: workflow.nextAction,
          updatedAt: parsed.updatedAt || workflow.updatedAt,
        };
      } catch (error) {
        const code = (error as NodeJS.ErrnoException).code;
        if (code !== "ENOENT") {
          return {
            ok: false,
            reason: `file ownership workflow artifact cannot be read: ${workflowPath}: ${String(error)}`,
          };
        }
        if (!artifact.status || !artifact.nextAction) {
          return {
            ok: false,
            reason: `file ownership workflow artifact cannot be read: ${workflowPath}: missing canonical workflow state`,
          };
        }
      }
      if (artifact.migratedFromLegacy) {
        await writeFile(
          artifactPath,
          `${JSON.stringify(canonicalFileOwnershipArtifact(artifact), null, 2)}\n`,
          "utf8",
        );
      }
      artifacts.push(artifact);
    }
  }

  return { ok: true, artifacts };
};

export const effectiveArtifactResolvedFiles = (
  artifact: FileOwnershipArtifact,
  changedFiles: string[],
): string[] =>
  uniquePaths([
    ...artifact.resolvedFiles,
    ...resolveOwnershipScopeEntries(
      artifact.owns,
      changedFiles,
      artifact.released,
    ),
  ]).filter((filePath) => !artifact.released.includes(filePath));

export const detectFileOwnershipArtifactConflict = async ({
  rootDir,
  current,
  changedFiles,
  dirtyFiles = changedFiles,
}: {
  rootDir: string;
  current: FileOwnershipArtifact;
  changedFiles: string[];
  dirtyFiles?: string[];
}): Promise<{ ok: true } | Failure> => {
  const otherArtifacts = await readOtherFileOwnershipArtifacts(
    rootDir,
    current.planPath,
  );
  if (!otherArtifacts.ok) {
    return otherArtifacts;
  }

  const currentFiles = new Set(current.resolvedFiles);
  const dirtyFileSet = new Set(dirtyFiles);
  for (const other of otherArtifacts.artifacts) {
    if (!other.status || !other.nextAction) {
      return {
        ok: false,
        reason: `file ownership artifact is missing canonical workflow state: ${other.planPath}`,
      };
    }
    const otherFiles = effectiveArtifactResolvedFiles(other, changedFiles);
    const conflictingFiles =
      other.status === "completed" && other.nextAction === "commit-summary"
        ? otherFiles.filter(
            (filePath) =>
              currentFiles.has(filePath) && dirtyFileSet.has(filePath),
          )
        : blockingOwnershipStatuses.has(other.status)
          ? otherFiles.filter((filePath) => currentFiles.has(filePath))
          : [];
    if (conflictingFiles.length === 0) {
      continue;
    }
    return {
      ok: false,
      reason: `workflow file ownership conflict: ${conflictingFiles[0]} is already owned by ${other.planPath}`,
    };
  }

  return { ok: true };
};

export const refreshAndCheckFileOwnershipArtifact = async ({
  rootDir,
  plan,
  processRunner,
  timestamp,
  isIgnored,
}: {
  rootDir: string;
  plan: ParsedPlan;
  processRunner: ProcessRunner;
  timestamp: () => string;
  isIgnored?: (relativePath: string) => Promise<boolean>;
}): Promise<FileOwnershipPreflight | Failure> => {
  const refreshed = await refreshCurrentFileOwnershipArtifact({
    rootDir,
    plan,
    processRunner,
    timestamp,
  });
  if (!refreshed.ok) {
    return refreshed;
  }
  if (!refreshed.present) {
    return { hasOwnershipScope: false };
  }

  const conflict = await detectFileOwnershipArtifactConflict({
    rootDir,
    current: refreshed.artifact,
    changedFiles: refreshed.changedFiles,
  });
  if (!conflict.ok) {
    return conflict;
  }

  const ignored =
    isIgnored ??
    ((relativePath: string) => defaultIsIgnored(rootDir, relativePath));
  const reviewStagingPaths: string[] = [];
  for (const changedFile of refreshed.artifact.changedFiles) {
    if (changedFile.startsWith(".ai/")) {
      continue;
    }
    if (!(await ignored(changedFile))) {
      reviewStagingPaths.push(changedFile);
    }
  }

  return {
    hasOwnershipScope: true,
    artifact: refreshed.artifact,
    reviewStagingPaths,
  };
};

export const readThinPlanV2FileOwnershipPreflight = async ({
  rootDir,
  plan,
  processRunner,
  checkCompletedDirtyConflicts,
  isIgnored,
}: {
  rootDir: string;
  plan: ParsedPlan;
  processRunner: ProcessRunner;
  checkCompletedDirtyConflicts: boolean;
  isIgnored?: (relativePath: string) => Promise<boolean>;
}): Promise<FileOwnershipPreflight | Failure> => {
  const fileOwnershipPath = thinPlanV2ArtifactPath(
    plan.planName,
    "state",
    "file-ownership.json",
  );
  const filesPath = thinPlanV2ArtifactPath(
    plan.planName,
    "state",
    "files.json",
  );
  const ownershipRaw = await readJsonArtifact(rootDir, fileOwnershipPath);
  if (isFailure(ownershipRaw)) {
    return ownershipRaw;
  }
  let artifact = parseFileOwnershipArtifact(
    JSON.stringify(ownershipRaw),
    fileOwnershipPath,
  );
  if (isFailure(artifact)) {
    return artifact;
  }
  const filesRaw = await readJsonArtifact(rootDir, filesPath);
  if (isFailure(filesRaw)) {
    return filesRaw;
  }
  const files = parseThinPlanV2FilesState(filesRaw, filesPath);
  if (isFailure(files)) {
    return files;
  }
  const activeChangedFiles = files.changedFiles.filter(
    (filePath) => !files.released.includes(filePath),
  );
  if (
    activeChangedFiles.length > 0 &&
    artifact.owns.length === 0 &&
    artifact.resolvedFiles.length === 0 &&
    artifact.changedFiles.length === 0
  ) {
    const head = await readGitHeadSha(rootDir, processRunner);
    if (!head.ok) {
      return head;
    }
    artifact = {
      ...artifact,
      owns: activeChangedFiles,
      resolvedFiles: activeChangedFiles,
      changedFiles: activeChangedFiles,
      headSha: head.sha,
      updatedAt: new Date().toISOString(),
    };
    try {
      await writeFile(
        path.join(rootDir, fileOwnershipPath),
        `${JSON.stringify(canonicalFileOwnershipArtifact(artifact), null, 2)}\n`,
        "utf8",
      );
    } catch (error) {
      return {
        ok: false,
        reason: `file ownership artifact cannot be repaired: ${fileOwnershipPath}: ${String(error)}`,
      };
    }
  }
  let dirtyFiles: string[] | undefined;
  if (checkCompletedDirtyConflicts) {
    const changed = await readGitChangedFiles(rootDir, processRunner);
    if (!changed.ok) {
      return changed;
    }
    dirtyFiles = changed.paths;
  }

  const conflict = await detectFileOwnershipArtifactConflict({
    rootDir,
    current: artifact,
    changedFiles: files.changedFiles,
    dirtyFiles,
  });
  if (!conflict.ok) {
    return conflict;
  }

  const ignored =
    isIgnored ??
    ((relativePath: string) => defaultIsIgnored(rootDir, relativePath));
  const released = new Set(files.released);
  const reviewStagingPaths: string[] = [];
  for (const changedFile of files.changedFiles) {
    if (changedFile.startsWith(".ai/") || released.has(changedFile)) {
      continue;
    }
    if (!(await ignored(changedFile))) {
      reviewStagingPaths.push(changedFile);
    }
  }

  return {
    hasOwnershipScope: true,
    artifact,
    reviewStagingPaths: uniquePaths(reviewStagingPaths),
  };
};

export const parseWorkflowFileOwnershipPaths = async (
  rootDir: string,
  content: string,
  isIgnored?: (relativePath: string) => Promise<boolean>,
): Promise<ReviewStagingResult> => {
  const parsed = await parseReviewStagingPaths({
    content,
    rootDir,
    isIgnored:
      isIgnored ?? ((relativePath) => defaultIsIgnored(rootDir, relativePath)),
  });
  if (parsed.ok) {
    return { ok: true, paths: uniquePaths(parsed.paths) };
  }
  return {
    ok: false,
    reason: parsed.reason.replace(/review staging/g, "workflow file ownership"),
  };
};
