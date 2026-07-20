import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import type { Failure, PlanTask, WorkflowTaskContext } from "../../types.ts";

const rel = (...segments: string[]): string => segments.join("/");
const currentTaskRelativePath = (planName: string): string =>
  rel(".ai", "artifacts", planName, "state", "current-task.md");

const writeArtifact = async (artifactPath: string, body: string, reason: string): Promise<{ ok: true } | Failure> => {
  try {
    await mkdir(path.dirname(artifactPath), { recursive: true });
    await writeFile(artifactPath, body, "utf8");
    return { ok: true };
  } catch (error) {
    return { ok: false, reason: `${reason}: ${String(error)}` };
  }
};

export const writeTaskStageArtifact = async ({ rootDir, planPath, context }: { rootDir: string; planPath: string; context: WorkflowTaskContext }): Promise<{ ok: true } | Failure> =>
  writeArtifact(path.join(rootDir, context.artifactPath), `# Task Savepoint: ${context.task.id}\n\n## Task Name\n\n${context.task.name}\n\n## Plan\n\n${planPath}\n\n## Stage\n\n${context.stage}\n\n## Commit SHA\n\n${context.commitSha ?? "(pending)"}\n\n## Task Artifact\n\n${context.artifactPath}\n`, "task stage artifact cannot be written");

export const writeCurrentTaskPointer = async ({ rootDir, planName, planPath, context, timestamp }: { rootDir: string; planName: string; planPath: string; context: WorkflowTaskContext; timestamp: string }): Promise<{ ok: true } | Failure> =>
  writeArtifact(path.join(rootDir, currentTaskRelativePath(planName)), `# Current Task\n\n* Plan: ${planPath}\n* Task ID: ${context.task.id}\n* Task Words: ${context.task.words}\n* Task Name: ${context.task.name}\n* Stage: ${context.stage}\n* Task Artifact: ${context.artifactPath}\n* Commit SHA: ${context.commitSha ?? "(pending)"}\n* Updated At: ${timestamp}\n`, "current task pointer cannot be written");

export const writeTaskArtifact = async ({ rootDir, planPath, context, changedFiles, summaryLines, validationSummary, reviewResult, commitMessage, nextTask }: { rootDir: string; planPath: string; context: WorkflowTaskContext; changedFiles: string[]; summaryLines: string[]; validationSummary: string; reviewResult: string; commitMessage: string; nextTask?: PlanTask }): Promise<{ ok: true } | Failure> =>
  writeArtifact(path.join(rootDir, context.artifactPath), `# Task Savepoint: ${context.task.id}\n\n## Task Name\n\n${context.task.name}\n\n## Summary\n\n${summaryLines.map((line) => `* ${line}`).join("\n")}\n\n## Plan\n\n${planPath}\n\n## Changed Files\n\n${changedFiles.length > 0 ? changedFiles.map((file) => `* ${file}`).join("\n") : "* None"}\n\n## Validation Evidence\n\n${validationSummary}\n\n## Review Result\n\n${reviewResult}\n\n## Commit SHA\n\n${context.commitSha ?? "(unknown)"}\n\n## Commit Message\n\n${commitMessage}\n\n## Task Artifact\n\n${context.artifactPath}\n\n## Next Task\n\n${nextTask ? nextTask.id : "(none)"}\n`, "task artifact cannot be written");
