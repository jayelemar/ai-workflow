import { existsSync } from "node:fs";
import path from "node:path";

import {
  parseThinPlanV2FilesState,
  readJsonArtifact,
  thinPlanV2ArtifactPath,
} from "../plan/state.ts";
import {
  defaultIsIgnored,
  parseReviewStagingPaths,
} from "./staging.ts";
import type {
  Failure,
  ParsedPlan,
  ProcessResult,
  ProcessRunner,
  ReviewStagingResult,
} from "../types.ts";
import { boundedInlineExcerpt, isFailure } from "../types.ts";

const uniquePaths = (paths: string[]): string[] => [...new Set(paths)];

const parseCommitSummaryPaths = async (
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
    return parsed;
  }
  return {
    ok: false,
    reason: parsed.reason.replace(/review staging/g, "commit summary"),
  };
};

const parseThinPlanV2CommitSummaryPaths = async (
  rootDir: string,
  planName: string,
  isIgnored?: (relativePath: string) => Promise<boolean>,
): Promise<ReviewStagingResult> => {
  const filesPath = thinPlanV2ArtifactPath(planName, "state", "files.json");
  const filesRaw = await readJsonArtifact(rootDir, filesPath);
  if (isFailure(filesRaw)) {
    return filesRaw;
  }
  const files = parseThinPlanV2FilesState(filesRaw, filesPath);
  if (isFailure(files)) {
    return files;
  }

  const ignored =
    isIgnored ??
    ((relativePath: string) => defaultIsIgnored(rootDir, relativePath));
  const released = new Set(files.released);
  const deleted = new Set(files.deleted);
  const absentNonDeleted = new Set(
    files.changedFiles.filter(
      (changedFile) =>
        !deleted.has(changedFile) &&
        !existsSync(path.join(rootDir, changedFile)),
    ),
  );
  const paths: string[] = [];
  for (const changedFile of files.changedFiles) {
    if (
      changedFile.startsWith(".ai/") ||
      released.has(changedFile) ||
      absentNonDeleted.has(changedFile)
    ) {
      continue;
    }
    if (!(await ignored(changedFile))) {
      paths.push(changedFile);
    }
  }

  const unique = uniquePaths(paths);
  if (unique.length === 0) {
    return {
      ok: false,
      reason: "all commit summary paths are git-ignored",
    };
  }

  return { ok: true, paths: unique };
};

export const parseCommitSummaryPathsForPlan = async (
  rootDir: string,
  plan: ParsedPlan,
  isIgnored?: (relativePath: string) => Promise<boolean>,
): Promise<ReviewStagingResult> => {
  if (plan.thinPlanContract === "thin-plan-v2") {
    return parseThinPlanV2CommitSummaryPaths(rootDir, plan.planName, isIgnored);
  }

  const parsed = await parseCommitSummaryPaths(
    rootDir,
    plan.content,
    isIgnored,
  );
  return parsed;
};

export const readDirtyPlanOwnedPaths = async (
  rootDir: string,
  paths: string[],
  processRunner: ProcessRunner,
): Promise<{ ok: true; paths: string[] } | Failure> => {
  const result = await processRunner({
    command: "git",
    args: ["status", "--short", "--", ...paths],
    cwd: rootDir,
    input: "",
    promptPath: "git-commit-boundary-preflight",
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
      reason: `could not launch commit-boundary git status: ${result.error}`,
    };
  }
  if (result.exitCode !== 0) {
    const details = [result.stderr.trim(), result.stdout.trim()]
      .filter(Boolean)
      .join("\n");
    return {
      ok: false,
      reason: `commit-boundary git status exited with code ${result.exitCode}${details ? `: ${details}` : ""}`,
    };
  }
  const dirtyPaths = [result.stdout, result.stderr]
    .join("\n")
    .split(/\r?\n/)
    .filter((line) => line.length >= 4)
    .map((line) => line.slice(3).trim())
    .filter(Boolean);
  return { ok: true, paths: uniquePaths(dirtyPaths) };
};

export const verifyCommitSummaryPathsClean = async (
  rootDir: string,
  paths: string[],
  processRunner: ProcessRunner,
): Promise<{ ok: true } | Failure> => {
  const args = ["status", "--short", "--", ...paths];
  const result = await processRunner({
    command: "git",
    args,
    cwd: rootDir,
    input: "",
    promptPath: "git-commit-summary-clean-check",
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
      reason: `could not launch commit-summary clean git status: ${result.error}`,
    };
  }
  if (result.exitCode !== 0) {
    const details = [result.stderr.trim(), result.stdout.trim()]
      .filter(Boolean)
      .join("\n");
    return {
      ok: false,
      reason: `commit-summary clean git status exited with code ${result.exitCode}${details ? `: ${details}` : ""}`,
    };
  }

  const dirtyOutput = [result.stdout.trim(), result.stderr.trim()]
    .filter(Boolean)
    .join("\n");
  if (dirtyOutput.length > 0) {
    return {
      ok: false,
      reason: `plan-owned changes remain after commit-summary: ${boundedInlineExcerpt(dirtyOutput)}`,
    };
  }

  return { ok: true };
};
