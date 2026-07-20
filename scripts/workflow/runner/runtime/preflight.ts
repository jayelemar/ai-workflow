import { existsSync } from "node:fs";
import path from "node:path";

import type { ProcessResult, ProcessRunner } from "../types.ts";

const gitMetadataExists = (rootDir: string): boolean =>
  existsSync(path.join(rootDir, ".git"));

export const workflowBranch = async (
  rootDir: string,
  processRunner: ProcessRunner,
): Promise<string | undefined> => {
  if (!gitMetadataExists(rootDir)) {
    return undefined;
  }

  const result = await processRunner({
    command: "git",
    args: ["rev-parse", "--abbrev-ref", "HEAD"],
    cwd: rootDir,
    input: "",
    promptPath: "git-workflow-branch",
  }).catch(
    (error): ProcessResult => ({
      launched: false,
      stdout: "",
      stderr: "",
      error: String(error),
    }),
  );

  if (!result.launched) {
    return undefined;
  }
  if (result.exitCode !== 0) {
    return undefined;
  }

  return result.stdout.trim().split(/\s+/)[0] || undefined;
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
