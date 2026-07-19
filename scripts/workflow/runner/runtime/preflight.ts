import { existsSync } from "node:fs";
import path from "node:path";

import type { Failure, ProcessResult, ProcessRunner } from "../types.ts";
import { boundedInlineExcerpt } from "../types.ts";
const PROTECTED_WORKFLOW_BRANCHES = new Set([
  "main",
  "master",
  "dev",
  "staging",
]);

const gitMetadataExists = (rootDir: string): boolean =>
  existsSync(path.join(rootDir, ".git"));

export const protectedBranchPreflight = async (
  rootDir: string,
  processRunner: ProcessRunner,
): Promise<{ ok: true; branch?: string } | Failure> => {
  if (!gitMetadataExists(rootDir)) {
    return { ok: true };
  }

  const result = await processRunner({
    command: "git",
    args: ["rev-parse", "--abbrev-ref", "HEAD"],
    cwd: rootDir,
    input: "",
    promptPath: "git-protected-branch-preflight",
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
      reason: `could not determine current git branch before starting workflow: ${result.error}`,
    };
  }
  if (result.exitCode !== 0) {
    const details = [result.stderr.trim(), result.stdout.trim()]
      .filter(Boolean)
      .join("\n");
    return {
      ok: false,
      reason: `could not determine current git branch before starting workflow${details ? `: ${boundedInlineExcerpt(details)}` : ""}`,
    };
  }

  const branch = result.stdout.trim().split(/\s+/)[0] ?? "";
  if (!branch) {
    return {
      ok: false,
      reason:
        "could not determine current git branch before starting workflow: branch lookup returned empty output",
    };
  }
  if (PROTECTED_WORKFLOW_BRANCHES.has(branch)) {
    return {
      ok: false,
      reason: `workflow runner refuses to start on protected branch ${branch}`,
    };
  }
  return { ok: true, branch };
};

export const workflowHeadSha = async (
  rootDir: string,
  processRunner: ProcessRunner,
): Promise<string | undefined> => {
  if (!gitMetadataExists(rootDir)) {
    return undefined;
  }

  const result = await processRunner({
    command: "git",
    args: ["rev-parse", "HEAD"],
    cwd: rootDir,
    input: "",
    promptPath: "git-workflow-head",
  }).catch(
    (): ProcessResult => ({
      launched: false,
      stdout: "",
      stderr: "",
      error: "workflow head lookup failed",
    }),
  );
  if (!result.launched || result.exitCode !== 0) {
    return undefined;
  }
  return result.stdout.trim().split(/\s+/)[0] || undefined;
};

