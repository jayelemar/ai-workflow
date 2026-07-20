import { shellPathspecs } from "../plan/prompt.ts";
import type { ProcessResult, ProcessRunner, ReviewCleanupProcess } from "../types.ts";

export const runReviewUnstageForPaths = async (rootDir: string, paths: string[], processRunner: ProcessRunner, options: { operationLabel?: string; promptPath?: string } = {}): Promise<{ ok: true; cleanup: ReviewCleanupProcess } | { ok: false; reason: string; cleanup?: ReviewCleanupProcess }> => {
  const args = ["reset", "--quiet", "--", ...paths];
  const result = await processRunner({ command: "git", args, cwd: rootDir, input: "", promptPath: options.promptPath ?? "git-review-unstage" }).catch((error): ProcessResult => ({ launched: false, stdout: "", stderr: "", error: String(error) }));
  const cleanup: ReviewCleanupProcess = { command: `git reset --quiet -- ${shellPathspecs(paths)}`, args, stdout: result.stdout, stderr: result.stderr, exitCode: result.launched ? result.exitCode : undefined };
  const operationLabel = options.operationLabel ?? "review cleanup";
  if (!result.launched) {
    const reason = `could not launch ${operationLabel} git reset: ${result.error}`;
    return { ok: false, reason, cleanup: { ...cleanup, stopReason: reason } };
  }
  if (result.exitCode !== 0) {
    const details = [result.stderr.trim(), result.stdout.trim()].filter(Boolean).join("\n");
    const reason = `${operationLabel} git reset exited with code ${result.exitCode}${details ? `: ${details}` : ""}`;
    return { ok: false, reason, cleanup: { ...cleanup, stopReason: reason } };
  }
  return { ok: true, cleanup };
};
