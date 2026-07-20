import { existsSync } from "node:fs";
import path from "node:path";
import { defaultProcessRunner } from "../process.ts";
import { REVIEW_ENTRY_STAGED_WORK_REASON_PREFIX } from "../terminal/codex-events.ts";
import type { Failure, ProcessResult, ProcessRunner } from "../types.ts";

export const defaultIsIgnored = async (rootDir: string, relativePath: string): Promise<boolean> => {
  if (!existsSync(path.join(rootDir, ".git"))) return false;
  const result = await defaultProcessRunner({ command: "git", args: ["check-ignore", "-q", "--", relativePath], cwd: rootDir, input: "", promptPath: "git-check-ignore" });
  return result.launched && result.exitCode === 0;
};

const reviewNameStatusPath = (line: string): string | undefined => line.split("\t").filter(Boolean).at(-1)?.trim();

const formatPreReviewStagedWorkReason = (output: string, allowedPaths?: string[]): string => {
  const allowed = allowedPaths ? new Set(allowedPaths) : undefined;
  const stagedEntries = output.split(/\r?\n/).map((line) => line.trimEnd())
    .filter((line) => /^(?:[ACDMRTUXB]|\?\?|!!)[0-9]*\t.+/.test(line))
    .filter((line) => {
      if (!allowed) return true;
      const pathValue = reviewNameStatusPath(line);
      return !pathValue || !allowed.has(pathValue);
    }).map((line) => line.replace(/\t/g, "  "));
  return stagedEntries.length > 0 ? `${REVIEW_ENTRY_STAGED_WORK_REASON_PREFIX}:\n\n${stagedEntries.join(";\n")}` : REVIEW_ENTRY_STAGED_WORK_REASON_PREFIX;
};

export const checkForPreReviewStagedWork = async (rootDir: string, processRunner: ProcessRunner, allowedPaths?: string[]): Promise<{ ok: true } | Failure> => {
  const result = await processRunner({ command: "git", args: ["diff", "--staged", "--name-status", "--"], cwd: rootDir, input: "", promptPath: "git-pre-review-staged-check" }).catch((error): ProcessResult => ({ launched: false, stdout: "", stderr: "", error: String(error) }));
  if (!result.launched) return { ok: false, reason: `could not launch review preflight staged file check: ${result.error}` };
  if (result.exitCode !== 0) {
    const details = [result.stderr.trim(), result.stdout.trim()].filter(Boolean).join("\n");
    return { ok: false, reason: `review preflight staged file check exited with code ${result.exitCode}${details ? `: ${details}` : ""}` };
  }
  const stagedOutput = [result.stdout.trim(), result.stderr.trim()].filter(Boolean).join("\n");
  const reason = formatPreReviewStagedWorkReason(stagedOutput, allowedPaths);
  return reason === REVIEW_ENTRY_STAGED_WORK_REASON_PREFIX ? { ok: true } : { ok: false, reason };
};
