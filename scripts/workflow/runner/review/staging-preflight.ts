import { existsSync } from "node:fs";
import path from "node:path";
import { defaultProcessRunner } from "../process.ts";
import type { Failure, ProcessResult, ProcessRunner } from "../types.ts";
import { runReviewUnstageForPaths } from "./staging-cleanup.ts";

export const defaultIsIgnored = async (rootDir: string, relativePath: string): Promise<boolean> => {
  if (!existsSync(path.join(rootDir, ".git"))) return false;
  const result = await defaultProcessRunner({ command: "git", args: ["check-ignore", "-q", "--", relativePath], cwd: rootDir, input: "", promptPath: "git-check-ignore" });
  return result.launched && result.exitCode === 0;
};

const reviewNameStatusPaths = (line: string): string[] =>
  line
    .split("\t")
    .slice(1)
    .map((pathValue) => pathValue.trim())
    .filter(Boolean);

const stagedPathsOutsideReviewScope = (
  output: string,
  allowedPaths?: string[],
): string[] => {
  const allowed = allowedPaths ? new Set(allowedPaths) : undefined;
  const paths = output
    .split(/\r?\n/)
    .map((line) => line.trimEnd())
    .filter((line) => /^(?:[ACDMRTUXB]|\?\?|!!)[0-9]*\t.+/.test(line))
    .flatMap(reviewNameStatusPaths);
  return [...new Set(paths.filter((pathValue) => !allowed?.has(pathValue)))];
};

export const checkForPreReviewStagedWork = async (rootDir: string, processRunner: ProcessRunner, allowedPaths?: string[]): Promise<{ ok: true } | Failure> => {
  const result = await processRunner({ command: "git", args: ["diff", "--staged", "--name-status", "--"], cwd: rootDir, input: "", promptPath: "git-pre-review-staged-check" }).catch((error): ProcessResult => ({ launched: false, stdout: "", stderr: "", error: String(error) }));
  if (!result.launched) return { ok: false, reason: `could not launch review preflight staged file check: ${result.error}` };
  if (result.exitCode !== 0) {
    const details = [result.stderr.trim(), result.stdout.trim()].filter(Boolean).join("\n");
    return { ok: false, reason: `review preflight staged file check exited with code ${result.exitCode}${details ? `: ${details}` : ""}` };
  }
  const stagedOutput = [result.stdout.trim(), result.stderr.trim()].filter(Boolean).join("\n");
  const stalePaths = stagedPathsOutsideReviewScope(stagedOutput, allowedPaths);
  if (stalePaths.length === 0) return { ok: true };

  // The runner owns the review index. Resetting only out-of-scope paths keeps
  // their working-tree content intact while preventing stale workflow residue
  // from blocking the plan-owned review staging that follows.
  const resetResult = await processRunner({
    command: "git",
    args: ["reset", "--quiet", "--", ...stalePaths],
    cwd: rootDir,
    input: "",
    promptPath: "git-pre-review-unstage-out-of-scope",
  }).catch((error): ProcessResult => ({
    launched: false,
    stdout: "",
    stderr: "",
    error: String(error),
  }));
  if (!resetResult.launched) {
    return {
      ok: false,
      reason: `could not launch review preflight unstage git reset: ${resetResult.error}`,
    };
  }
  if (resetResult.exitCode !== 0) {
    const details = [resetResult.stderr.trim(), resetResult.stdout.trim()]
      .filter(Boolean)
      .join("\n");
    return {
      ok: false,
      reason: `review preflight unstage git reset exited with code ${resetResult.exitCode}${details ? `: ${details}` : ""}`,
    };
  }
  return { ok: true };
};

export const clearStagedWorkForExecution = async (
  rootDir: string,
  processRunner: ProcessRunner,
): Promise<{ ok: true } | Failure> => {
  const result = await processRunner({
    command: "git",
    args: ["diff", "--staged", "--name-only", "--"],
    cwd: rootDir,
    input: "",
    promptPath: "git-execute-staged-check",
  }).catch((error): ProcessResult => ({
    launched: false,
    stdout: "",
    stderr: "",
    error: String(error),
  }));
  if (!result.launched) {
    return {
      ok: false,
      reason: `could not launch execute entry staged file check: ${result.error}`,
    };
  }
  if (result.exitCode !== 0) {
    const details = [result.stderr.trim(), result.stdout.trim()]
      .filter(Boolean)
      .join("\n");
    return {
      ok: false,
      reason: `execute entry staged file check exited with code ${result.exitCode}${details ? `: ${details}` : ""}`,
    };
  }
  const stagedPaths = [...new Set(
    [result.stdout, result.stderr]
      .flatMap((output) => output.split(/\r?\n/))
      .map((pathValue) => pathValue.trim())
      .filter(Boolean),
  )];
  if (stagedPaths.length === 0) return { ok: true };

  // Execute stages must begin with an empty index. The reset preserves every
  // working-tree change; review is the only stage that stages plan-owned work.
  const cleanup = await runReviewUnstageForPaths(
    rootDir,
    stagedPaths,
    processRunner,
    {
      operationLabel: "execute entry cleanup",
      promptPath: "git-execute-unstage",
    },
  );
  return cleanup.ok ? { ok: true } : { ok: false, reason: cleanup.reason };
};
