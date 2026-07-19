import type { Failure, ProcessResult, ProcessRunner } from "../runner/types.ts";

export type GitChangedFileEntry = {
  path: string;
  change: "created" | "modified" | "deleted";
};

export const parseGitStatusChangedFileEntries = (
  output: string,
): GitChangedFileEntry[] => {
  const entries: GitChangedFileEntry[] = [];
  for (const rawLine of output.split(/\r?\n/)) {
    const line = rawLine.trimEnd();
    if (line.length < 4) {
      continue;
    }
    const status = line.slice(0, 2);
    let filePath = line.slice(3).trim();
    const renameTarget = filePath.match(/\s+->\s+(.+)$/)?.[1];
    if (renameTarget) {
      filePath = renameTarget;
    }
    if (filePath.length > 0) {
      entries.push({
        path: filePath,
        change: status.includes("D")
          ? "deleted"
          : status.includes("A") || status === "??"
            ? "created"
            : "modified",
      });
    }
  }
  const seen = new Set<string>();
  return entries.filter((entry) => {
    if (seen.has(entry.path)) {
      return false;
    }
    seen.add(entry.path);
    return true;
  });
};

export const readGitChangedFileEntries = async (
  rootDir: string,
  processRunner: ProcessRunner,
): Promise<{ ok: true; entries: GitChangedFileEntry[] } | Failure> => {
  const result = await processRunner({
    command: "git",
    args: ["status", "--short", "--untracked-files=all", "--"],
    cwd: rootDir,
    input: "",
    promptPath: "git-file-ownership-status",
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
      reason: `could not launch file ownership git status: ${result.error}`,
    };
  }
  if (result.exitCode !== 0) {
    const details = [result.stderr.trim(), result.stdout.trim()]
      .filter(Boolean)
      .join("\n");
    return {
      ok: false,
      reason: `file ownership git status exited with code ${result.exitCode}${details ? `: ${details}` : ""}`,
    };
  }
  return { ok: true, entries: parseGitStatusChangedFileEntries(result.stdout) };
};

export const readGitChangedFiles = async (
  rootDir: string,
  processRunner: ProcessRunner,
): Promise<{ ok: true; paths: string[] } | Failure> => {
  const changed = await readGitChangedFileEntries(rootDir, processRunner);
  if (!changed.ok) {
    return changed;
  }
  return { ok: true, paths: changed.entries.map((entry) => entry.path) };
};

export const readGitHeadSha = async (
  rootDir: string,
  processRunner: ProcessRunner,
): Promise<{ ok: true; sha: string } | Failure> => {
  const result = await processRunner({
    command: "git",
    args: ["rev-parse", "HEAD"],
    cwd: rootDir,
    input: "",
    promptPath: "git-file-ownership-head",
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
      reason: `could not launch file ownership head check: ${result.error}`,
    };
  }
  if (result.exitCode !== 0) {
    const details = [result.stderr.trim(), result.stdout.trim()]
      .filter(Boolean)
      .join("\n");
    return {
      ok: false,
      reason: `file ownership head check exited with code ${result.exitCode}${details ? `: ${details}` : ""}`,
    };
  }
  return { ok: true, sha: result.stdout.trim() };
};
