import type { Failure, PlanTask, ProcessResult, ProcessRunner } from "../types.ts";

export const checkTaskFileScope = async ({
  task,
  planOwnedPaths,
}: {
  task: PlanTask;
  planOwnedPaths: string[];
}): Promise<{ ok: true } | Failure> => {
  if (task.files.length === 0) {
    return {
      ok: false,
      reason: `task ${task.id} has no declared Files boundary`,
    };
  }
  const planOwned = new Set(planOwnedPaths);
  const outsidePlan = task.files.filter((filePath) => !planOwned.has(filePath));
  if (outsidePlan.length > 0) {
    return {
      ok: false,
      reason: `task ${task.id} declares Files outside the plan-owned scope: ${outsidePlan.join(", ")}`,
    };
  }
  return { ok: true };
};

/**
 * Removes later-task changes from the index without touching their working-tree
 * content. This lets an active task review and commit its own savepoint while
 * preserving already-started work that belongs to a later task.
 */
export const unstagePathsOutsideTaskFileScope = async ({
  rootDir,
  task,
  planOwnedPaths,
  processRunner,
}: {
  rootDir: string;
  task: PlanTask;
  planOwnedPaths: string[];
  processRunner: ProcessRunner;
}): Promise<{ ok: true; unstagedPaths: string[] } | Failure> => {
  const staged = await processRunner({
    command: "git",
    args: ["diff", "--cached", "--name-only", "--", ...planOwnedPaths],
    cwd: rootDir,
    input: "",
    promptPath: "git-task-file-scope-staged-check",
  }).catch(
    (error): ProcessResult => ({
      launched: false,
      stdout: "",
      stderr: "",
      error: String(error),
    }),
  );
  if (!staged.launched) {
    return {
      ok: false,
      reason: `could not launch task-scope staged check: ${staged.error}`,
    };
  }
  if (staged.exitCode !== 0) {
    const details = [staged.stderr.trim(), staged.stdout.trim()]
      .filter(Boolean)
      .join("\n");
    return {
      ok: false,
      reason: `task-scope staged check exited with code ${staged.exitCode}${details ? `: ${details}` : ""}`,
    };
  }
  const taskFiles = new Set(task.files);
  const unstagedPaths = [...new Set(
    staged.stdout
      .split(/\r?\n/)
      .map((line) => line.trim())
      .filter(Boolean)
      .filter((filePath) => !taskFiles.has(filePath)),
  )];
  if (unstagedPaths.length === 0) {
    return { ok: true, unstagedPaths };
  }
  const unstage = await processRunner({
    command: "git",
    args: ["restore", "--staged", "--", ...unstagedPaths],
    cwd: rootDir,
    input: "",
    promptPath: "git-task-file-scope-unstage",
  }).catch(
    (error): ProcessResult => ({
      launched: false,
      stdout: "",
      stderr: "",
      error: String(error),
    }),
  );
  if (!unstage.launched) {
    return {
      ok: false,
      reason: `could not launch task-scope unstage: ${unstage.error}`,
    };
  }
  if (unstage.exitCode !== 0) {
    const details = [unstage.stderr.trim(), unstage.stdout.trim()]
      .filter(Boolean)
      .join("\n");
    return {
      ok: false,
      reason: `task-scope unstage exited with code ${unstage.exitCode}${details ? `: ${details}` : ""}`,
    };
  }
  return { ok: true, unstagedPaths };
};
