import type { PlanTask, TaskStage } from "../../types.ts";

const TERMINAL_PROGRESS_DETAIL_LIMIT = 200;

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
