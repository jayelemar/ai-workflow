import {
  parseThinPlanV2FilesState,
  readJsonArtifact,
  thinPlanV2ArtifactPath,
} from "../../plan/state.ts";
import type {
  Failure,
  ParsedPlan,
  PlanTask,
  ProcessResult,
  ProcessRunner,
} from "../../types.ts";
import { isFailure } from "../../types.ts";

export const readHeadTaskCommit = async ({
  rootDir,
  planName,
  planPath,
  task,
  expectedParentSha,
  processRunner,
}: {
  rootDir: string;
  planName: string;
  planPath: string;
  task: PlanTask;
  expectedParentSha?: string;
  processRunner: ProcessRunner;
}): Promise<
  { ok: true; commit?: { sha: string; message: string } } | Failure
> => {
  const result = await processRunner({
    command: "git",
    args: ["log", "-1", "--format=%H%n%P%n%B"],
    cwd: rootDir,
    input: "",
    promptPath: "git-head-task-commit",
  }).catch(
    (error): ProcessResult => ({
      launched: false,
      stdout: "",
      stderr: "",
      error: String(error),
    }),
  );

  if (!result.launched || result.exitCode !== 0) {
    return { ok: true };
  }

  const lines = result.stdout.split(/\r?\n/);
  const sha = lines.shift()?.trim();
  const parents =
    lines[0] && /^[0-9a-f]+(?:\s+[0-9a-f]+)*$/i.test(lines[0].trim())
      ? (lines.shift()?.trim().split(/\s+/) ?? [])
      : [];
  const message = lines.join("\n").trim();
  const hasTaskMetadata =
    message.includes(task.id) &&
    (message.includes(planName) || message.includes(planPath));
  const matchesExpectedParent =
    !!expectedParentSha && parents.includes(expectedParentSha);
  if (!sha || (!hasTaskMetadata && !matchesExpectedParent)) {
    return { ok: true };
  }

  return {
    ok: true,
    commit: {
      sha,
      message,
    },
  };
};

export const readTaskCommitRecoveryParent = async ({
  rootDir,
  plan,
}: {
  rootDir: string;
  plan: ParsedPlan;
}): Promise<{ ok: true; headSha?: string } | Failure> => {
  if (plan.thinPlanContract !== "thin-plan-v2") {
    return { ok: true };
  }
  const filesPath = thinPlanV2ArtifactPath(
    plan.planName,
    "state",
    "files.json",
  );
  const filesRaw = await readJsonArtifact(rootDir, filesPath);
  if (isFailure(filesRaw)) {
    return filesRaw;
  }
  const files = parseThinPlanV2FilesState(filesRaw, filesPath);
  if (isFailure(files)) {
    return files;
  }
  return { ok: true, headSha: files.headSha || undefined };
};
