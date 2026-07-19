import { mkdir, readFile, readdir, writeFile } from "node:fs/promises";
import path from "node:path";

import {
  extractSectionValue,
  isStatus,
  normalizeWorkflowStateValue,
  uniquePaths,
} from "../runner/plan/parser.ts";
import {
  defaultIsIgnored,
  parseReviewStagingPaths,
  parseTransferredFileOwnershipReleasePaths,
} from "../runner/review/staging.ts";
import {
  isFailure,
  type Failure,
  type FileOwnershipArtifact,
  type FileOwnershipPreflight,
  type ParsedPlan,
  type ProcessRunner,
  type ReviewStagingResult,
  type Status,
} from "../runner/types.ts";
import { readGitChangedFiles, readGitHeadSha } from "./git-changes.ts";
import {
  canonicalFileOwnershipArtifact,
  fileOwnershipArtifactAbsolutePath,
  parseFileOwnershipArtifact,
} from "./ownership-artifact.ts";
import {
  filterChangedOwnershipFiles,
  parseOwnershipScopeEntries,
  resolveOwnershipScopeEntries,
} from "./ownership-scope.ts";

const rel = (...segments: string[]) => segments.join("/");

import {
  parseThinPlanV2FilesState,
  parseThinPlanV2WorkflowState,
  readJsonArtifact,
  thinPlanV2ArtifactPath,
} from "../runner/plan/thin-plan-sidecars.ts";
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
