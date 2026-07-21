import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";

import { planSectionLines as sectionLines } from "../plan/parser.ts";
import {
  formatWorkflowSharedSummary,
  parseWorkflowSections,
  trimBlankLines,
  workflowSummarySectionHeading,
} from "../terminal/formatters.ts";
import type {
  CompletedTaskSavepoint,
  Failure,
  PlanTask,
} from "../types.ts";
import {
  latestTaskArtifactRelativePath,
  taskArtifactCommitSha,
} from "./savepoints.ts";

const rel = (...segments: string[]): string => segments.join("/");

const executionSummaryRelativePath = (planName: string): string =>
  rel(".ai", "artifacts", planName, "execution-summary.md");

const bossSummaryRelativePath = (planName: string): string =>
  rel(".ai", "artifacts", planName, "boss-summary.md");

export const hasCompletedTaskAggregateSummary = async ({
  rootDir,
  planName,
  taskCount,
}: {
  rootDir: string;
  planName: string;
  taskCount: number;
}): Promise<{ ok: true; completed: boolean } | Failure> => {
  const artifactPath = path.join(rootDir, executionSummaryRelativePath(planName));
  let content: string;
  try {
    content = await readFile(artifactPath, "utf8");
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") {
      return { ok: true, completed: false };
    }
    return {
      ok: false,
      reason: `execution summary cannot be read: ${String(error)}`,
    };
  }
  return {
    ok: true,
    completed:
      content.includes("## Overall Status\nCompleted") &&
      content.includes(`Completed savepoints: ${taskCount}/${taskCount}`) &&
      content.includes("## Final Rollup\n- Status: completed"),
  };
};

const normalizeSummaryLine = (line: string): string =>
  line.replace(/^(?:--|[*-])\s+/, "").trim();

export const extractCommitSummarySubject = (
  text: string,
  fallback: string,
): string => {
  const sharedSummary = formatWorkflowSharedSummary(text.trim());
  if (sharedSummary) {
    const sections = parseWorkflowSections(
      sharedSummary,
      workflowSummarySectionHeading,
    );
    const keyDetails = trimBlankLines(sections.get("Key Details") ?? []);
    for (const line of keyDetails) {
      const trimmed = line.trim();
      if (trimmed.length === 0 || trimmed.startsWith("--")) {
        continue;
      }
      return normalizeSummaryLine(trimmed);
    }
  }
  return fallback;
};

export const extractSummaryLines = (text: string, fallback: string): string[] => {
  const sharedSummary = formatWorkflowSharedSummary(text.trim());
  if (sharedSummary) {
    const sections = parseWorkflowSections(
      sharedSummary,
      workflowSummarySectionHeading,
    );
    const keyDetailLines = trimBlankLines(sections.get("Key Details") ?? [])
      .map((line) => line.trim())
      .filter((line) => line.startsWith("--"))
      .map(normalizeSummaryLine)
      .filter((line) => line.length > 0);
    if (keyDetailLines.length > 0) {
      return keyDetailLines;
    }
    const summaryLines = trimBlankLines(sections.get("Summary") ?? [])
      .map((line) => line.replace(/^[*-]\s+/, "").trim())
      .filter((line) => line.length > 0);
    if (summaryLines.length > 0) {
      return summaryLines;
    }
  }
  const bulletLines = text
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter((line) => /^[*-]\s+/.test(line))
    .map((line) => line.replace(/^[*-]\s+/, "").trim())
    .filter((line) => line.length > 0);
  if (bulletLines.length > 0) {
    return bulletLines.slice(0, 5);
  }
  return [fallback];
};

const markdownSectionText = (content: string, heading: string): string =>
  trimBlankLines(sectionLines(content, heading) ?? [])
    .join("\n")
    .trim();

const markdownSectionBulletLines = (
  content: string,
  heading: string,
  fallback: string,
): string[] => {
  const lines = trimBlankLines(sectionLines(content, heading) ?? [])
    .map((line) => line.trim())
    .filter((line) => line.length > 0)
    .map((line) => line.replace(/^[*-]\s+/, "").trim())
    .filter((line) => line.length > 0);
  return lines.length > 0 ? lines : [fallback];
};

export const readCompletedTaskSavepoints = async ({
  rootDir,
  planName,
  tasks,
}: {
  rootDir: string;
  planName: string;
  tasks: PlanTask[];
}): Promise<
  { ok: true; completedTasks: CompletedTaskSavepoint[] } | Failure
> => {
  const completedTasks: CompletedTaskSavepoint[] = [];
  for (const task of tasks) {
    const artifactPath = await latestTaskArtifactRelativePath(
      rootDir,
      planName,
      task,
    );
    if (!artifactPath) {
      continue;
    }
    const absoluteArtifactPath = path.join(rootDir, artifactPath);
    let content: string;
    try {
      content = await readFile(absoluteArtifactPath, "utf8");
    } catch (error) {
      return {
        ok: false,
        reason: `task artifact cannot be read: ${artifactPath}: ${String(error)}`,
      };
    }
    const commitSha = taskArtifactCommitSha(content);
    if (!commitSha) {
      continue;
    }
    completedTasks.push({
      task,
      artifactPath,
      commitSha,
      commitMessage:
        markdownSectionText(content, "## Commit Message") || task.name,
      summaryLines: markdownSectionBulletLines(
        content,
        "## Summary",
        task.name,
      ),
      reviewResult:
        markdownSectionText(content, "## Review Result") || "pending",
      validationSummary:
        markdownSectionText(content, "## Validation Evidence") || "pending",
    });
  }
  return { ok: true, completedTasks };
};

const BOSS_SUMMARY_ACRONYMS = new Set([
  "ai",
  "api",
  "db",
  "id",
  "rls",
  "sse",
  "ui",
]);

const titleCasePlanWord = (word: string): string =>
  BOSS_SUMMARY_ACRONYMS.has(word.toLowerCase())
    ? word.toUpperCase()
    : `${word.charAt(0).toUpperCase()}${word.slice(1)}`;

const planNameToTitle = (planName: string): string =>
  planName.split(/[-_]+/).filter(Boolean).map(titleCasePlanWord).join(" ");

export const estimateBossSummaryPercent = ({
  tasks,
  completedTasks,
  finalStatus,
}: {
  tasks: PlanTask[];
  completedTasks: CompletedTaskSavepoint[];
  finalStatus: "in-progress" | "completed";
}): number => {
  if (finalStatus === "completed" && completedTasks.length === tasks.length) {
    return 100;
  }
  if (tasks.length === 0) {
    return finalStatus === "completed" ? 100 : 25;
  }
  if (completedTasks.length === tasks.length) {
    return 92;
  }
  return Math.min(
    75,
    Math.max(25, 25 + Math.round((completedTasks.length / tasks.length) * 50)),
  );
};

const formatBossSummaryBullet = (line: string): string =>
  `--${line.replace(/^(?:--|[*-])\s+/, "").trim()}`;

export const writeBossSummary = async ({
  rootDir,
  planName,
  tasks,
  completedTasks,
  finalStatus,
}: {
  rootDir: string;
  planName: string;
  tasks: PlanTask[];
  completedTasks: CompletedTaskSavepoint[];
  finalStatus: "in-progress" | "completed";
}): Promise<{ ok: true } | Failure> => {
  const artifactPath = path.join(rootDir, bossSummaryRelativePath(planName));
  const percent = estimateBossSummaryPercent({
    tasks,
    completedTasks,
    finalStatus,
  });
  const body = [
    `${planNameToTitle(planName)} (${percent}%)`,
    "",
    ...completedTasks.flatMap((completedTask) => [
      `Commit ${completedTask.commitSha}`,
      ...completedTask.summaryLines.map(formatBossSummaryBullet),
      "",
    ]),
  ].join("\n");
  try {
    await mkdir(path.dirname(artifactPath), { recursive: true });
    await writeFile(
      artifactPath,
      body.endsWith("\n") ? body : `${body}\n`,
      "utf8",
    );
    return { ok: true };
  } catch (error) {
    return {
      ok: false,
      reason: `boss summary cannot be written: ${String(error)}`,
    };
  }
};

export const writeExecutionSummary = async ({
  rootDir,
  planName,
  planPath,
  tasks,
  completedTasks,
  finalStatus,
}: {
  rootDir: string;
  planName: string;
  planPath: string;
  tasks: PlanTask[];
  completedTasks: CompletedTaskSavepoint[];
  finalStatus: "in-progress" | "completed";
}): Promise<{ ok: true } | Failure> => {
  const artifactPath = path.join(
    rootDir,
    executionSummaryRelativePath(planName),
  );
  const completedByTaskId = new Map(
    completedTasks.map((completedTask) => [
      completedTask.task.id,
      completedTask,
    ]),
  );
  const body = [
    "# Execution Summary",
    "",
    "## Plan",
    planPath,
    "",
    "## Overall Status",
    finalStatus === "completed" ? "Completed" : "In progress",
    `Completed savepoints: ${completedTasks.length}/${tasks.length}`,
    "",
    "## Savepoints",
    "",
    ...tasks.flatMap((task) => {
      const completedTask = completedByTaskId.get(task.id);
      const summaryLines = completedTask?.summaryLines ?? [
        "Pending savepoint.",
      ];
      return [
        `### ${task.id}`,
        `- Commit: ${completedTask ? `\`${completedTask.commitSha}\`` : "pending"}`,
        "- Summary:",
        ...summaryLines.map((line) => `  - ${line}`),
        `- Review: ${completedTask?.reviewResult ?? "pending"}`,
        `- Validation: ${completedTask?.validationSummary ?? "pending"}`,
        "",
      ];
    }),
    "## Final Rollup",
    `- Status: ${finalStatus === "completed" ? "completed" : "pending"}`,
    "- Notes: aggregate summary only, no additional git commit",
    "",
  ].join("\n");
  try {
    await mkdir(path.dirname(artifactPath), { recursive: true });
    await writeFile(artifactPath, body, "utf8");
    return { ok: true };
  } catch (error) {
    return {
      ok: false,
      reason: `execution summary cannot be written: ${String(error)}`,
    };
  }
};
