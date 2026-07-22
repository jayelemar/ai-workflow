import { shellPathspecs } from "../plan/prompt.ts";
import type { ProcessResult, ProcessRunner, ReviewStagingProcess } from "../types.ts";

const uniquePaths = (paths: string[]): string[] => [...new Set(paths)];
const processFailure = (error: unknown): ProcessResult => ({ launched: false, stdout: "", stderr: "", error: String(error) });
const details = (result: ProcessResult): string => [result.stderr.trim(), result.stdout.trim()].filter(Boolean).join("\n");
const gitStatusPathFromPorcelainLine = (line: string): string | undefined => {
  const body = line.slice(3).trim();
  if (!body) return undefined;
  return body.includes(" -> ") ? body.split(" -> ").at(-1)?.trim() : body;
};

export const stagedStatusHasMixedReviewPath = (statusOutput: string): boolean => statusOutput.split(/\r?\n/).map((line) => line.trimEnd()).filter((line) => line.length >= 3 && line[2] === " ").some((line) => {
  const pathValue = gitStatusPathFromPorcelainLine(line);
  return Boolean(pathValue) && line[0] !== " " && line[0] !== "?" && line[0] !== "!" && line[1] !== " ";
});

export const checkReviewStagingWorktreeClean = async (rootDir: string, paths: string[], processRunner: ProcessRunner): Promise<{ ok: true } | { ok: false; reason: string }> => {
  if (paths.length === 0) return { ok: true };
  const result = await processRunner({ command: "git", args: ["diff", "--quiet", "--", ...paths], cwd: rootDir, input: "", promptPath: "git-review-staging-worktree-check" }).catch(processFailure);
  if (!result.launched) {
    return { ok: false, reason: `could not launch review staging worktree check: ${result.error}` };
  }
  if (result.exitCode === 0) return { ok: true };
  if (result.exitCode === 1) {
    return { ok: false, reason: "review scope changed after staging; rerun review so every changed file is restaged" };
  }
  return { ok: false, reason: `review staging worktree check exited with code ${result.exitCode}${details(result) ? `: ${details(result)}` : ""}` };
};

export const runReviewStagingForPaths = async (rootDir: string, paths: string[], processRunner: ProcessRunner): Promise<{ ok: true; staging: ReviewStagingProcess; paths: string[] } | { ok: false; reason: string; staging?: ReviewStagingProcess }> => {
  const changedPathResult = await processRunner({ command: "git", args: ["status", "--porcelain=v1", "--untracked-files=all", "--", ...paths], cwd: rootDir, input: "", promptPath: "git-review-staging-changed-paths" }).catch(processFailure);
  if (!changedPathResult.launched) return { ok: false, reason: `could not launch review staging changed-path check: ${changedPathResult.error}` };
  if (changedPathResult.exitCode !== 0) return { ok: false, reason: `review staging changed-path check exited with code ${changedPathResult.exitCode}${details(changedPathResult) ? `: ${details(changedPathResult)}` : ""}` };
  const requestedPaths = new Set(paths);
  const changedPaths = uniquePaths([changedPathResult.stdout, changedPathResult.stderr].flatMap((output) => output.split(/\r?\n/)).map(gitStatusPathFromPorcelainLine).filter((pathValue): pathValue is string => pathValue !== undefined && requestedPaths.has(pathValue)));
  const stagingPaths = changedPaths.length > 0 ? changedPaths : paths;
  const stagedPathResult = await processRunner({ command: "git", args: ["diff", "--cached", "--name-only", "--", ...stagingPaths], cwd: rootDir, input: "", promptPath: "git-review-staging-staged-paths" }).catch(processFailure);
  const stagingCommandForPaths = (candidatePaths: string[], restorePaths: string[]) => restorePaths.length > 0 ? `git restore --staged -- ${shellPathspecs(restorePaths)} && git add --all -- ${shellPathspecs(candidatePaths)}` : `git add --all -- ${shellPathspecs(candidatePaths)}`;
  const stagingFrom = (result: ProcessResult, restorePaths: string[], args: string[]): ReviewStagingProcess => ({ command: stagingCommandForPaths(stagingPaths, restorePaths), args, paths: result.launched && result.exitCode === 0 ? [...stagingPaths] : undefined, stdout: result.stdout, stderr: result.stderr, exitCode: result.launched ? result.exitCode : undefined });
  if (!stagedPathResult.launched) {
    const reason = `could not launch review staging staged-path check: ${stagedPathResult.error}`;
    return { ok: false, reason, staging: { command: `git diff --cached --name-only -- ${shellPathspecs(stagingPaths)}`, args: ["diff", "--cached", "--name-only", "--", ...stagingPaths], stdout: stagedPathResult.stdout, stderr: stagedPathResult.stderr, exitCode: undefined, stopReason: reason } };
  }
  if (stagedPathResult.exitCode !== 0) {
    const reason = `review staging staged-path check exited with code ${stagedPathResult.exitCode}${details(stagedPathResult) ? `: ${details(stagedPathResult)}` : ""}`;
    return { ok: false, reason, staging: { command: `git diff --cached --name-only -- ${shellPathspecs(stagingPaths)}`, args: ["diff", "--cached", "--name-only", "--", ...stagingPaths], stdout: stagedPathResult.stdout, stderr: stagedPathResult.stderr, exitCode: stagedPathResult.exitCode, stopReason: reason } };
  }
  const stagedPathSet = new Set(stagingPaths);
  const restorePaths = uniquePaths(stagedPathResult.stdout.split(/\r?\n/).map((line) => line.trim()).filter((line) => line.length > 0 && stagedPathSet.has(line)));
  const restoreArgs = ["restore", "--staged", "--", ...restorePaths];
  const addArgs = ["add", "--all", "--", ...stagingPaths];
  if (restorePaths.length > 0) {
    const restoreResult = await processRunner({ command: "git", args: restoreArgs, cwd: rootDir, input: "", promptPath: "git-review-staging-restore" }).catch(processFailure);
    if (!restoreResult.launched || restoreResult.exitCode !== 0) {
      const reason = !restoreResult.launched ? `could not launch review staging git restore: ${restoreResult.error}` : `review staging git restore exited with code ${restoreResult.exitCode}${details(restoreResult) ? `: ${details(restoreResult)}` : ""}`;
      return { ok: false, reason, staging: { ...stagingFrom(restoreResult, restorePaths, restoreArgs), stopReason: reason } };
    }
  }
  const result = await processRunner({ command: "git", args: addArgs, cwd: rootDir, input: "", promptPath: "git-staging" }).catch(processFailure);
  const staging = stagingFrom(result, restorePaths, addArgs);
  if (!result.launched || result.exitCode !== 0) {
    const reason = !result.launched ? `could not launch review staging git add: ${result.error}` : `review staging git add exited with code ${result.exitCode}${details(result) ? `: ${details(result)}` : ""}`;
    return { ok: false, reason, staging: { ...staging, stopReason: reason } };
  }
  const statusResult = await processRunner({ command: "git", args: ["status", "--porcelain=v1", "--", ...stagingPaths], cwd: rootDir, input: "", promptPath: "git-review-staging-status" }).catch(processFailure);
  if (!statusResult.launched || statusResult.exitCode !== 0) {
    const reason = !statusResult.launched ? `could not launch review staging git status: ${statusResult.error}` : `review staging git status exited with code ${statusResult.exitCode}${details(statusResult) ? `: ${details(statusResult)}` : ""}`;
    return { ok: false, reason, staging: { ...staging, stopReason: reason } };
  }
  if (stagedStatusHasMixedReviewPath(statusResult.stdout)) {
    const reason = "review staging path has mixed staged/unstaged state after staging";
    return { ok: false, reason, staging: { ...staging, stopReason: reason } };
  }
  return { ok: true, staging, paths: stagingPaths };
};
