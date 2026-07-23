import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";

import { parsePlanTasks, uniquePaths } from "../runner/plan/parser.ts";
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
  parseThinPlanFilesState,
  readJsonArtifact,
  thinPlanArtifactPath,
} from "../runner/plan/thin-plan-sidecars.ts";
import { DOCUMENT_FORMATS } from "../document-formats.ts";
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
    documentFormat: DOCUMENT_FORMATS.fileOwnership,
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

export const readThinPlanFileOwnershipPreflight = async ({
  rootDir,
  plan,
  processRunner,
  isIgnored,
}: {
  rootDir: string;
  plan: ParsedPlan;
  processRunner: ProcessRunner;
  isIgnored?: (relativePath: string) => Promise<boolean>;
}): Promise<FileOwnershipPreflight | Failure> => {
  const fileOwnershipPath = thinPlanArtifactPath(
    plan.planName,
    "state",
    "file-ownership.json",
  );
  const filesPath = thinPlanArtifactPath(
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
  const files = parseThinPlanFilesState(filesRaw, filesPath);
  if (isFailure(files)) {
    return files;
  }
  const activeChangedFiles = files.changedFiles.filter(
    (filePath) => !files.released.includes(filePath),
  );
  const releasedFiles = new Set([...artifact.released, ...files.released]);
  const taskDeclaredFiles = uniquePaths(
    parsePlanTasks(plan.content)
      .flatMap((task) => task.files)
      .filter((filePath) => !releasedFiles.has(filePath)),
  );
  let repaired = false;
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
    repaired = true;
  }
  const reconciledOwns = uniquePaths([...artifact.owns, ...taskDeclaredFiles]);
  const reconciledResolvedFiles = uniquePaths([
    ...artifact.resolvedFiles,
    ...taskDeclaredFiles,
  ]);
  if (
    reconciledOwns.length !== artifact.owns.length ||
    reconciledResolvedFiles.length !== artifact.resolvedFiles.length
  ) {
    artifact = {
      ...artifact,
      owns: reconciledOwns,
      resolvedFiles: reconciledResolvedFiles,
      updatedAt: new Date().toISOString(),
    };
    repaired = true;
  }
  if (repaired) {
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
