import { mkdir, readFile, readdir, writeFile } from "node:fs/promises";
import path from "node:path";

import type {
  Failure,
  PlanTask,
  WorkflowTaskContext,
} from "../../types.ts";

export {
  formatTaskProgressLine,
  readableTaskLabel,
  readableTaskProgressDescription,
} from "./task-progress.ts";
export {
  readHeadTaskCommit,
  readTaskCommitRecoveryParent,
} from "./commit-recovery.ts";

const rel = (...segments: string[]): string => segments.join("/");

const escapeRegExp = (value: string): string =>
  value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

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
