import { mkdir, readFile, readdir, writeFile } from "node:fs/promises";
import path from "node:path";

import {
  parseThinPlanV2FilesState,
  readJsonArtifact,
  thinPlanV2ArtifactPath,
} from "../plan/state.ts";
import type {
  Failure,
  ParsedPlan,
  PlanTask,
  ProcessResult,
  ProcessRunner,
  TaskStage,
  WorkflowTaskContext,
} from "../types.ts";
import { isFailure } from "../types.ts";

const TERMINAL_PROGRESS_DETAIL_LIMIT = 200;

const rel = (...segments: string[]): string => segments.join("/");

const escapeRegExp = (value: string): string =>
  value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

const compactTerminalProgressDetail = (detail: string): string => {
  const normalized = detail.replace(/\s+/g, " ").trim();
  if (normalized.length <= TERMINAL_PROGRESS_DETAIL_LIMIT) {
    return normalized;
  }

  const shortened = normalized
    .slice(0, TERMINAL_PROGRESS_DETAIL_LIMIT - 3)
    .replace(/\s+\S*$/, "")
    .trimEnd();
  return `${shortened || normalized.slice(0, TERMINAL_PROGRESS_DETAIL_LIMIT - 3)}...`;
};

export const taskArtifactsRelativeDir = (planName: string): string =>
  rel(".ai", "artifacts", planName, "tasks");

const currentTaskRelativePath = (planName: string): string =>
  rel(".ai", "artifacts", planName, "state", "current-task.md");

const taskArtifactFilePrefix = (task: PlanTask): string => {
  const suffix =
    task.artifactWords && task.artifactWords !== task.words
      ? `-${task.artifactWords}`
      : "";
  return `${task.id}${suffix}-v`;
};

const existingTaskArtifactEntries = async (
  rootDir: string,
  planName: string,
  task: PlanTask,
): Promise<{ entry: string; version: number }[]> => {
  const taskDir = path.join(rootDir, taskArtifactsRelativeDir(planName));
  let entries: string[];
  try {
    entries = await readdir(taskDir);
  } catch (error) {
    const code = (error as NodeJS.ErrnoException).code;
    if (code === "ENOENT") {
      return [];
    }
    throw error;
  }
  const artifactPattern = new RegExp(
    `^${escapeRegExp(task.id)}(?:-.+)?-v([1-9][0-9]*)\\.md$`,
  );
  return entries
    .map((entry) => {
      const match = entry.match(artifactPattern);
      if (!match) {
        return undefined;
      }
      const version = Number(match[1]);
      return Number.isInteger(version) && version > 0
        ? { entry, version }
        : undefined;
    })
    .filter(
      (artifact): artifact is { entry: string; version: number } =>
        artifact !== undefined,
    )
    .sort((a, b) => a.version - b.version);
};

const existingTaskArtifactVersions = async (
  rootDir: string,
  planName: string,
  task: PlanTask,
): Promise<number[]> => {
  const artifacts = await existingTaskArtifactEntries(rootDir, planName, task);
  return artifacts.map((artifact) => artifact.version);
};

export const taskArtifactCommitSha = (content: string): string | undefined => {
  const lines = content.split(/\r?\n/);
  const headingIndex = lines.findIndex(
    (line) => line.trim() === "## Commit SHA",
  );
  if (headingIndex === -1) {
    return undefined;
  }

  const valueLines: string[] = [];
  for (const line of lines.slice(headingIndex + 1)) {
    if (line.trim().startsWith("## ")) {
      break;
    }
    const trimmed = line.trim();
    if (trimmed.length > 0) {
      valueLines.push(trimmed);
    }
  }

  const sha = valueLines.join(" ").trim();
  if (!sha || sha === "(pending)" || sha === "(unknown)") {
    return undefined;
  }
  return /^[a-f0-9]{7,40}$/i.test(sha) ? sha : undefined;
};

const taskArtifactCompletedWithoutCommit = (content: string): boolean =>
  /^## Commit SHA\s*\n\s*no-commit\s*$/im.test(content);

export const taskCompleted = async (
  rootDir: string,
  planName: string,
  task: PlanTask,
): Promise<boolean> => {
  const artifactEntries = await existingTaskArtifactEntries(
    rootDir,
    planName,
    task,
  );
  for (const artifact of artifactEntries) {
    const artifactPath = path.join(
      rootDir,
      taskArtifactsRelativeDir(planName),
      artifact.entry,
    );
    const content = await readFile(artifactPath, "utf8");
    if (
      taskArtifactCommitSha(content) ||
      taskArtifactCompletedWithoutCommit(content)
    ) {
      return true;
    }
  }
  return false;
};

export const nextIncompleteTask = async (
  rootDir: string,
  planName: string,
  tasks: PlanTask[],
): Promise<PlanTask | undefined> => {
  for (const task of tasks) {
    if (!(await taskCompleted(rootDir, planName, task))) {
      return task;
    }
  }
  return undefined;
};

export const nextTaskArtifactRelativePath = async (
  rootDir: string,
  planName: string,
  task: PlanTask,
): Promise<string> => {
  const versions = await existingTaskArtifactVersions(rootDir, planName, task);
  const nextVersion = (versions.at(-1) ?? 0) + 1;
  return rel(
    taskArtifactsRelativeDir(planName),
    `${taskArtifactFilePrefix(task)}${nextVersion}.md`,
  );
};

export const currentTaskArtifactRelativePath = async (
  rootDir: string,
  planName: string,
  task: PlanTask,
): Promise<string> => {
  const artifacts = await existingTaskArtifactEntries(rootDir, planName, task);
  for (const artifact of artifacts.slice().reverse()) {
    const artifactPath = path.join(
      rootDir,
      taskArtifactsRelativeDir(planName),
      artifact.entry,
    );
    let content: string;
    try {
      content = await readFile(artifactPath, "utf8");
    } catch (error) {
      const code = (error as NodeJS.ErrnoException).code;
      if (code === "ENOENT") {
        continue;
      }
      throw error;
    }
    if (!taskArtifactCommitSha(content)) {
      return rel(taskArtifactsRelativeDir(planName), artifact.entry);
    }
  }
  return await nextTaskArtifactRelativePath(rootDir, planName, task);
};

export const readTaskArtifactStage = async (
  rootDir: string,
  relativePath: string,
): Promise<string | undefined> => {
  let content: string;
  try {
    content = await readFile(path.join(rootDir, relativePath), "utf8");
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") {
      return undefined;
    }
    throw error;
  }

  const lines = content.split(/\r?\n/);
  const stageIndex = lines.findIndex((line) => line.trim() === "## Stage");
  if (stageIndex === -1) {
    return undefined;
  }
  for (const line of lines.slice(stageIndex + 1)) {
    const stage = line.trim();
    if (stage.startsWith("## ")) {
      return undefined;
    }
    if (stage) {
      return stage;
    }
  }
  return undefined;
};

export const latestTaskArtifactRelativePath = async (
  rootDir: string,
  planName: string,
  task: PlanTask,
): Promise<string | undefined> => {
  const artifacts = await existingTaskArtifactEntries(rootDir, planName, task);
  const latestArtifact = artifacts.at(-1);
  if (!latestArtifact) {
    return undefined;
  }
  return rel(taskArtifactsRelativeDir(planName), latestArtifact.entry);
};

const humanizeTaskWords = (words: string): string => words.replace(/-/g, " ");

export const readableTaskLabel = (task: PlanTask): string => {
  const words = humanizeTaskWords(task.words);
  return `${words.charAt(0).toUpperCase()}${words.slice(1)}`;
};

export const formatTaskProgressLine = ({
  task,
  stage,
  detail,
  taskPosition,
  taskTotal,
  completedTasks,
  boundaryTotal,
}: {
  task: PlanTask;
  stage: TaskStage;
  detail: string;
  taskPosition: number;
  taskTotal: number;
  completedTasks: number;
  boundaryTotal?: number;
}): string => {
  const reviewScopeMatch = detail.match(/^staged\s+(\d+)\s+(file|files)$/);
  const label =
    stage === "implementing"
      ? "EXECUTE"
      : stage === "validating"
        ? "VALIDATE"
        : stage === "reviewing"
          ? "REVIEW"
          : stage === "commit-message"
            ? "COMMITTING"
            : "COMMITTED";
  const action =
    stage === "implementing"
      ? "Implementing planned scope"
      : stage === "validating"
        ? `Running ${compactTerminalProgressDetail(detail)}`
        : stage === "reviewing"
          ? `Review scope: ${
              reviewScopeMatch
                ? `${reviewScopeMatch[1]} staged ${reviewScopeMatch[2]}`
                : compactTerminalProgressDetail(detail)
            }`
          : boundaryTotal
            ? `Creating ${boundaryTotal} boundary commits`
            : stage === "commit-message"
              ? "Creating 1 commit"
              : `Created ${compactTerminalProgressDetail(detail)}`;
  return `[${label}] Task ${taskPosition} of ${taskTotal} — ${readableTaskLabel(
    task,
  )}\nProgress: ${completedTasks} tasks committed · ${action}`;
};

export const readableTaskProgressDescription = (task: PlanTask): string => {
  const normalizedName = task.name.replace(/\s+/g, " ").trim();
  if (!normalizedName.endsWith("...")) {
    return normalizedName;
  }

  const taskWords = humanizeTaskWords(task.words);
  const baseName = normalizedName.replace(/\s*\.\.\.$/, "").trimEnd();
  if (!baseName) {
    return taskWords;
  }
  if (new RegExp(`\\b${escapeRegExp(taskWords)}\\b`, "i").test(baseName)) {
    return baseName;
  }
  if (
    /\b(?:in|for|on|with|around|to|into|through|across|from|by)$/i.test(
      baseName,
    )
  ) {
    return `${baseName} ${taskWords}`;
  }
  return `${baseName} for ${taskWords}`;
};

export const writeTaskStageArtifact = async ({
  rootDir,
  planPath,
  context,
}: {
  rootDir: string;
  planPath: string;
  context: WorkflowTaskContext;
}): Promise<{ ok: true } | Failure> => {
  const artifactPath = path.join(rootDir, context.artifactPath);
  const body = `# Task Savepoint: ${context.task.id}

## Task Name

${context.task.name}

## Plan

${planPath}

## Stage

${context.stage}

## Commit SHA

${context.commitSha ?? "(pending)"}

## Task Artifact

${context.artifactPath}
`;
  try {
    await mkdir(path.dirname(artifactPath), { recursive: true });
    await writeFile(artifactPath, body, "utf8");
    return { ok: true };
  } catch (error) {
    return {
      ok: false,
      reason: `task stage artifact cannot be written: ${String(error)}`,
    };
  }
};

export const writeCurrentTaskPointer = async ({
  rootDir,
  planName,
  planPath,
  context,
  timestamp,
}: {
  rootDir: string;
  planName: string;
  planPath: string;
  context: WorkflowTaskContext;
  timestamp: string;
}): Promise<{ ok: true } | Failure> => {
  const pointerPath = path.join(rootDir, currentTaskRelativePath(planName));
  const body = `# Current Task

* Plan: ${planPath}
* Task ID: ${context.task.id}
* Task Words: ${context.task.words}
* Task Name: ${context.task.name}
* Stage: ${context.stage}
* Task Artifact: ${context.artifactPath}
* Commit SHA: ${context.commitSha ?? "(pending)"}
* Updated At: ${timestamp}
`;
  try {
    await mkdir(path.dirname(pointerPath), { recursive: true });
    await writeFile(pointerPath, body, "utf8");
    return { ok: true };
  } catch (error) {
    return {
      ok: false,
      reason: `current task pointer cannot be written: ${String(error)}`,
    };
  }
};

export const writeTaskArtifact = async ({
  rootDir,
  planPath,
  context,
  changedFiles,
  summaryLines,
  validationSummary,
  reviewResult,
  commitMessage,
  nextTask,
}: {
  rootDir: string;
  planPath: string;
  context: WorkflowTaskContext;
  changedFiles: string[];
  summaryLines: string[];
  validationSummary: string;
  reviewResult: string;
  commitMessage: string;
  nextTask?: PlanTask;
}): Promise<{ ok: true } | Failure> => {
  const artifactPath = path.join(rootDir, context.artifactPath);
  const body = `# Task Savepoint: ${context.task.id}

## Task Name

${context.task.name}

## Summary

${summaryLines.map((line) => `* ${line}`).join("\n")}

## Plan

${planPath}

## Changed Files

${changedFiles.length > 0 ? changedFiles.map((file) => `* ${file}`).join("\n") : "* None"}

## Validation Evidence

${validationSummary}

## Review Result

${reviewResult}

## Commit SHA

${context.commitSha ?? "(unknown)"}

## Commit Message

${commitMessage}

## Task Artifact

${context.artifactPath}

## Next Task

${nextTask ? nextTask.id : "(none)"}
`;
  try {
    await mkdir(path.dirname(artifactPath), { recursive: true });
    await writeFile(artifactPath, body, "utf8");
    return { ok: true };
  } catch (error) {
    return {
      ok: false,
      reason: `task artifact cannot be written: ${String(error)}`,
    };
  }
};

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

export const nextTaskAfter = async (
  rootDir: string,
  planName: string,
  tasks: PlanTask[],
  currentTask: PlanTask,
): Promise<PlanTask | undefined> => {
  const currentIndex = tasks.findIndex((task) => task.id === currentTask.id);
  for (const task of tasks.slice(currentIndex + 1)) {
    if (!(await taskCompleted(rootDir, planName, task))) {
      return task;
    }
  }
  return undefined;
};

export const completedTaskCommitCount = async (
  rootDir: string,
  planName: string,
  tasks: PlanTask[],
): Promise<number> => {
  let completed = 0;
  for (const task of tasks) {
    if (await taskCompleted(rootDir, planName, task)) {
      completed += 1;
    }
  }
  return completed;
};
