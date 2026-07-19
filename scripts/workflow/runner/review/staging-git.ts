import { existsSync } from "node:fs";
import path from "node:path";

import { defaultProcessRunner } from "../process.ts";
import { shellPathspecs } from "../plan/prompt.ts";
import { REVIEW_ENTRY_STAGED_WORK_REASON_PREFIX } from "../terminal/codex-events.ts";
import type {
  Failure,
  ProcessResult,
  ProcessRunner,
  ReviewCleanupProcess,
  ReviewStagingProcess,
} from "../types.ts";

const uniquePaths = (paths: string[]): string[] => [...new Set(paths)];

export {
  isNoReviewStagingPathPlaceholder,
  parseReviewStagingBulletValue,
  parseReviewStagingPaths,
  parseTransferredFileOwnershipReleasePaths,
  validateConcretePlanFilePath,
} from "./staging-paths.ts";

export const defaultIsIgnored = async (
  rootDir: string,
  relativePath: string,
): Promise<boolean> => {
  if (!existsSync(path.join(rootDir, ".git"))) {
    return false;
  }
  const result = await defaultProcessRunner({
    command: "git",
    args: ["check-ignore", "-q", "--", relativePath],
    cwd: rootDir,
    input: "",
    promptPath: "git-check-ignore",
  });
  return result.launched && result.exitCode === 0;
};

const reviewNameStatusPath = (line: string): string | undefined => {
  const parts = line.split("\t").filter(Boolean);
  return parts.at(-1)?.trim();
};

const formatPreReviewStagedWorkReason = (
  output: string,
  allowedPaths?: string[],
): string => {
  const allowed = allowedPaths ? new Set(allowedPaths) : undefined;
  const stagedEntries = output
    .split(/\r?\n/)
    .map((line) => line.trimEnd())
    .filter((line) => /^(?:[ACDMRTUXB]|\?\?|!!)[0-9]*\t.+/.test(line))
    .filter((line) => {
      if (!allowed) {
        return true;
      }
      const pathValue = reviewNameStatusPath(line);
      return !pathValue || !allowed.has(pathValue);
    })
    .map((line) => line.replace(/\t/g, "  "));
  return stagedEntries.length > 0
    ? `${REVIEW_ENTRY_STAGED_WORK_REASON_PREFIX}:\n\n${stagedEntries.join(";\n")}`
    : REVIEW_ENTRY_STAGED_WORK_REASON_PREFIX;
};

export const checkForPreReviewStagedWork = async (
  rootDir: string,
  processRunner: ProcessRunner,
  allowedPaths?: string[],
): Promise<{ ok: true } | Failure> => {
  const result = await processRunner({
    command: "git",
    args: ["diff", "--staged", "--name-status", "--"],
    cwd: rootDir,
    input: "",
    promptPath: "git-pre-review-staged-check",
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
      reason: `could not launch review preflight staged file check: ${result.error}`,
    };
  }

  if (result.exitCode !== 0) {
    const details = [result.stderr.trim(), result.stdout.trim()]
      .filter(Boolean)
      .join("\n");
    return {
      ok: false,
      reason: `review preflight staged file check exited with code ${result.exitCode}${details ? `: ${details}` : ""}`,
    };
  }

  const stagedOutput = [result.stdout.trim(), result.stderr.trim()]
    .filter(Boolean)
    .join("\n");
  const reason = formatPreReviewStagedWorkReason(stagedOutput, allowedPaths);
  if (reason !== REVIEW_ENTRY_STAGED_WORK_REASON_PREFIX) {
    return { ok: false, reason };
  }

  return { ok: true };
};

const gitStatusPathFromPorcelainLine = (line: string): string | undefined => {
  const body = line.slice(3).trim();
  if (!body) {
    return undefined;
  }
  const renameSeparator = " -> ";
  if (body.includes(renameSeparator)) {
    return body.split(renameSeparator).at(-1)?.trim();
  }
  return body;
};

export const runReviewStagingForPaths = async (
  rootDir: string,
  paths: string[],
  processRunner: ProcessRunner,
): Promise<
  | {
      ok: true;
      staging: ReviewStagingProcess;
      paths: string[];
    }
  | {
      ok: false;
      reason: string;
      staging?: ReviewStagingProcess;
    }
> => {
  const changedPathResult = await processRunner({
    command: "git",
    args: ["status", "--porcelain=v1", "--untracked-files=all", "--", ...paths],
    cwd: rootDir,
    input: "",
    promptPath: "git-review-staging-changed-paths",
  }).catch(
    (error): ProcessResult => ({
      launched: false,
      stdout: "",
      stderr: "",
      error: String(error),
    }),
  );
  if (!changedPathResult.launched) {
    return {
      ok: false,
      reason: `could not launch review staging changed-path check: ${changedPathResult.error}`,
    };
  }
  if (changedPathResult.exitCode !== 0) {
    const details = [
      changedPathResult.stderr.trim(),
      changedPathResult.stdout.trim(),
    ]
      .filter(Boolean)
      .join("\n");
    return {
      ok: false,
      reason: `review staging changed-path check exited with code ${changedPathResult.exitCode}${details ? `: ${details}` : ""}`,
    };
  }
  const requestedPaths = new Set(paths);
  const changedPaths = uniquePaths(
    [changedPathResult.stdout, changedPathResult.stderr]
      .flatMap((output) => output.split(/\r?\n/))
      .map(gitStatusPathFromPorcelainLine)
      .filter(
        (pathValue): pathValue is string =>
          pathValue !== undefined && requestedPaths.has(pathValue),
      ),
  );
  const stagingPaths = changedPaths.length > 0 ? changedPaths : paths;

  const stagedPathResult = await processRunner({
    command: "git",
    args: ["diff", "--cached", "--name-only", "--", ...stagingPaths],
    cwd: rootDir,
    input: "",
    promptPath: "git-review-staging-staged-paths",
  }).catch(
    (error): ProcessResult => ({
      launched: false,
      stdout: "",
      stderr: "",
      error: String(error),
    }),
  );
  if (!stagedPathResult.launched) {
    const reason = `could not launch review staging staged-path check: ${stagedPathResult.error}`;
    const staging: ReviewStagingProcess = {
      command: `git diff --cached --name-only -- ${shellPathspecs(stagingPaths)}`,
      args: ["diff", "--cached", "--name-only", "--", ...stagingPaths],
      stdout: stagedPathResult.stdout,
      stderr: stagedPathResult.stderr,
      exitCode: undefined,
      stopReason: reason,
    };
    return {
      ok: false,
      reason,
      staging,
    };
  }
  if (stagedPathResult.exitCode !== 0) {
    const details = [
      stagedPathResult.stderr.trim(),
      stagedPathResult.stdout.trim(),
    ]
      .filter(Boolean)
      .join("\n");
    const reason = `review staging staged-path check exited with code ${stagedPathResult.exitCode}${details ? `: ${details}` : ""}`;
    return {
      ok: false,
      reason,
      staging: {
        command: `git diff --cached --name-only -- ${shellPathspecs(stagingPaths)}`,
        args: ["diff", "--cached", "--name-only", "--", ...stagingPaths],
        stdout: stagedPathResult.stdout,
        stderr: stagedPathResult.stderr,
        exitCode: stagedPathResult.exitCode,
        stopReason: reason,
      },
    };
  }
  const stagedPathSet = new Set(stagingPaths);
  const restorePaths = uniquePaths(
    stagedPathResult.stdout
      .split(/\r?\n/)
      .map((line) => line.trim())
      .filter((line) => line.length > 0 && stagedPathSet.has(line)),
  );
  const restoreArgs = ["restore", "--staged", "--", ...restorePaths];
  const addArgsForPaths = (candidatePaths: string[]) => [
    "add",
    "--all",
    "--",
    ...candidatePaths,
  ];
  const stagingCommandForPaths = (candidatePaths: string[]) =>
    restorePaths.length > 0
      ? `git restore --staged -- ${shellPathspecs(restorePaths)} && git add --all -- ${shellPathspecs(candidatePaths)}`
      : `git add --all -- ${shellPathspecs(candidatePaths)}`;
  const stagingFrom = (
    result: ProcessResult,
    args: string[] = addArgsForPaths(stagingPaths),
  ): ReviewStagingProcess => ({
    command: stagingCommandForPaths(stagingPaths),
    args,
    paths:
      result.launched && result.exitCode === 0 ? [...stagingPaths] : undefined,
    stdout: result.stdout,
    stderr: result.stderr,
    exitCode: result.launched ? result.exitCode : undefined,
  });

  if (restorePaths.length > 0) {
    const restoreResult = await processRunner({
      command: "git",
      args: restoreArgs,
      cwd: rootDir,
      input: "",
      promptPath: "git-review-staging-restore",
    }).catch(
      (error): ProcessResult => ({
        launched: false,
        stdout: "",
        stderr: "",
        error: String(error),
      }),
    );

    if (!restoreResult.launched) {
      return {
        ok: false,
        reason: `could not launch review staging git restore: ${restoreResult.error}`,
        staging: {
          ...stagingFrom(restoreResult, restoreArgs),
          stopReason: `could not launch review staging git restore: ${restoreResult.error}`,
        },
      };
    }
    if (restoreResult.exitCode !== 0) {
      const details = [restoreResult.stderr.trim(), restoreResult.stdout.trim()]
        .filter(Boolean)
        .join("\n");
      const reason = `review staging git restore exited with code ${restoreResult.exitCode}${details ? `: ${details}` : ""}`;
      return {
        ok: false,
        reason,
        staging: {
          ...stagingFrom(restoreResult, restoreArgs),
          stopReason: reason,
        },
      };
    }
  }

  const result = await processRunner({
    command: "git",
    args: addArgsForPaths(stagingPaths),
    cwd: rootDir,
    input: "",
    promptPath: "git-staging",
  }).catch(
    (error): ProcessResult => ({
      launched: false,
      stdout: "",
      stderr: "",
      error: String(error),
    }),
  );
  const staging = stagingFrom(result);
  if (!result.launched) {
    return {
      ok: false,
      reason: `could not launch review staging git add: ${result.error}`,
      staging: {
        ...staging,
        stopReason: `could not launch review staging git add: ${result.error}`,
      },
    };
  }
  if (result.exitCode !== 0) {
    const details = [result.stderr.trim(), result.stdout.trim()]
      .filter(Boolean)
      .join("\n");
    const reason = `review staging git add exited with code ${result.exitCode}${details ? `: ${details}` : ""}`;
    return {
      ok: false,
      reason,
      staging: { ...staging, stopReason: reason },
    };
  }
  const statusResult = await processRunner({
    command: "git",
    args: ["status", "--porcelain=v1", "--", ...stagingPaths],
    cwd: rootDir,
    input: "",
    promptPath: "git-review-staging-status",
  }).catch(
    (error): ProcessResult => ({
      launched: false,
      stdout: "",
      stderr: "",
      error: String(error),
    }),
  );
  if (!statusResult.launched) {
    return {
      ok: false,
      reason: `could not launch review staging git status: ${statusResult.error}`,
      staging: {
        ...staging,
        stopReason: `could not launch review staging git status: ${statusResult.error}`,
      },
    };
  }
  if (statusResult.exitCode !== 0) {
    const details = [statusResult.stderr.trim(), statusResult.stdout.trim()]
      .filter(Boolean)
      .join("\n");
    const reason = `review staging git status exited with code ${statusResult.exitCode}${details ? `: ${details}` : ""}`;
    return {
      ok: false,
      reason,
      staging: { ...staging, stopReason: reason },
    };
  }
  if (stagedStatusHasMixedReviewPath(statusResult.stdout)) {
    const reason =
      "review staging path has mixed staged/unstaged state after staging";
    return {
      ok: false,
      reason,
      staging: { ...staging, stopReason: reason },
    };
  }
  return { ok: true, staging, paths: stagingPaths };
};

export const runReviewUnstageForPaths = async (
  rootDir: string,
  paths: string[],
  processRunner: ProcessRunner,
  options: {
    operationLabel?: string;
    promptPath?: string;
  } = {},
): Promise<
  | {
      ok: true;
      cleanup: ReviewCleanupProcess;
    }
  | {
      ok: false;
      reason: string;
      cleanup?: ReviewCleanupProcess;
    }
> => {
  const args = ["reset", "--quiet", "--", ...paths];
  const result = await processRunner({
    command: "git",
    args,
    cwd: rootDir,
    input: "",
    promptPath: options.promptPath ?? "git-review-unstage",
  }).catch(
    (error): ProcessResult => ({
      launched: false,
      stdout: "",
      stderr: "",
      error: String(error),
    }),
  );
  const cleanup: ReviewCleanupProcess = {
    command: `git reset --quiet -- ${shellPathspecs(paths)}`,
    args,
    stdout: result.stdout,
    stderr: result.stderr,
    exitCode: result.launched ? result.exitCode : undefined,
  };
  if (!result.launched) {
    const operationLabel = options.operationLabel ?? "review cleanup";
    return {
      ok: false,
      reason: `could not launch ${operationLabel} git reset: ${result.error}`,
      cleanup: {
        ...cleanup,
        stopReason: `could not launch ${operationLabel} git reset: ${result.error}`,
      },
    };
  }
  if (result.exitCode !== 0) {
    const details = [result.stderr.trim(), result.stdout.trim()]
      .filter(Boolean)
      .join("\n");
    const operationLabel = options.operationLabel ?? "review cleanup";
    const reason = `${operationLabel} git reset exited with code ${result.exitCode}${details ? `: ${details}` : ""}`;
    return {
      ok: false,
      reason,
      cleanup: { ...cleanup, stopReason: reason },
    };
  }
  return { ok: true, cleanup };
};

export const stagedStatusHasMixedReviewPath = (
  statusOutput: string,
): boolean =>
  statusOutput
    .split(/\r?\n/)
    .map((line) => line.trimEnd())
    .filter((line) => line.length >= 3 && line[2] === " ")
    .some((line) => {
      const indexStatus = line[0];
      const worktreeStatus = line[1];
      const pathValue = gitStatusPathFromPorcelainLine(line);
      return (
        Boolean(pathValue) &&
        indexStatus !== " " &&
        indexStatus !== "?" &&
        indexStatus !== "!" &&
        worktreeStatus !== " "
      );
    });
