import path from "node:path";
import type { CodexModel, ReasoningEffort } from "../../config/codex.ts";
import type { WorkflowState } from "../../contracts/stage.ts";
import type { CommitProgress, OutputStream } from "../types.ts";
import { ANSI_RESET, WORKFLOW_WAIT_NOTICE_COLOR } from "./ansi.ts";

const rel = (...segments: string[]) => segments.join("/");
const TERMINAL_PROGRESS_DETAIL_LIMIT = 200;

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

const stageStylesByPromptPath: Record<
  string,
  { label: string; colorCode: string }
> = {
  [rel(".ai", "prompts", "plan-validator.md")]: {
    label: "VALIDATE",
    colorCode: "\u001b[37;45m",
  },
  [rel(".ai", "prompts", "sync-plan-artifacts.md")]: {
    label: "SYNC ARTIFACTS",
    colorCode: "\u001b[37;45m",
  },
  [rel(".ai", "prompts", "execute-plan.md")]: {
    label: "EXECUTE",
    colorCode: "\u001b[37;45m",
  },
  [rel(".ai", "prompts", "unblock-plan.md")]: {
    label: "UNBLOCK",
    colorCode: "\u001b[37;45m",
  },
  [rel(".ai", "prompts", "review-changes.md")]: {
    label: "REVIEW",
    colorCode: "\u001b[37;45m",
  },
  [rel(".ai", "prompts", "reopen-plan.md")]: {
    label: "REOPEN",
    colorCode: "\u001b[37;45m",
  },
  [rel(".ai", "prompts", "commit-summary.md")]: {
    label: "SUMMARY",
    colorCode: "\u001b[37;45m",
  },
};

export const supportsWorkflowAnsiColor = (
  env: NodeJS.ProcessEnv = process.env,
  stream: Pick<NodeJS.WriteStream, "isTTY"> = process.stdout,
): boolean => {
  if (Object.prototype.hasOwnProperty.call(env, "NO_COLOR")) {
    return false;
  }
  if (env.FORCE_COLOR === "0") {
    return false;
  }
  if (env.FORCE_COLOR && env.FORCE_COLOR !== "0") {
    return true;
  }
  return Boolean(stream.isTTY);
};

export const formatWorkflowProgressLine = ({
  iteration,
  maxIterations,
  workflowState,
  promptPath,
  model,
  reasoning,
  color = false,
}: {
  iteration: number;
  maxIterations: number;
  workflowState: WorkflowState;
  promptPath: string;
  model: CodexModel;
  reasoning: ReasoningEffort;
  color?: boolean;
}): string => {
  const stage = stageStylesByPromptPath[promptPath] ?? {
    label: "WORKFLOW",
    colorCode: "\u001b[37;45m",
  };
  const progressPrefix = `[${iteration}/${maxIterations}] STAGE ${stage.label}`;
  const formattedProgressPrefix = color
    ? `${stage.colorCode}${progressPrefix}${ANSI_RESET}`
    : progressPrefix;
  return `\n\n${formattedProgressPrefix}\nworkflowState: ${workflowState}\nmodel: ${model} | reasoning: ${reasoning}\n`;
};

export const formatCommitProgressLine = ({
  completed,
  total,
  description,
}: CommitProgress): string =>
  `[${completed}/${total}] ${compactTerminalProgressDetail(description)}`;

export const formatTaskCommitBoundaryProgressLine = ({
  taskPosition,
  taskTotal,
  taskLabel,
  boundaryPosition,
  boundaryTotal,
  state,
}: {
  taskPosition: number;
  taskTotal: number;
  taskLabel: string;
  boundaryPosition: number;
  boundaryTotal: number;
  state: "creating" | "created";
}): string =>
  `[COMMITTING] Task ${taskPosition} of ${taskTotal} — ${taskLabel}\nProgress: ${
    taskPosition - 1
  } tasks committed · ${state === "creating" ? "Creating" : "Created"} commit ${
    boundaryPosition
  } of ${boundaryTotal}`;

export const formatTaskCompletedProgressLine = ({
  taskPosition,
  taskTotal,
  taskLabel,
  commitTotal,
  nextTaskPosition,
}: {
  taskPosition: number;
  taskTotal: number;
  taskLabel: string;
  commitTotal: number;
  nextTaskPosition?: number;
}): string =>
  `[TASK COMPLETE] Task ${taskPosition} of ${taskTotal} — ${taskLabel}\nProgress: ${taskPosition} tasks committed · Created ${commitTotal} ${
    commitTotal === 1 ? "commit" : "commits"
  }${nextTaskPosition ? ` · Next: Task ${nextTaskPosition} of ${taskTotal}` : ""}`;

export const WORKFLOW_WAIT_NOTICE_INTERVAL_MS = 120_000;

const formatWorkflowWaitElapsedTime = (elapsedMs: number): string => {
  if (elapsedMs < 60_000) {
    return formatWorkflowElapsedTime(elapsedMs);
  }
  return `${Math.floor(elapsedMs / 60_000)}m`;
};

export const formatWorkflowWaitLine = ({
  promptPath,
  elapsedMs,
  color = false,
}: {
  promptPath: string;
  elapsedMs: number;
  color?: boolean;
}): string => {
  const line = `[wait] ${path.basename(promptPath)} running ${formatWorkflowWaitElapsedTime(elapsedMs)}`;
  return color ? `${WORKFLOW_WAIT_NOTICE_COLOR}${line}${ANSI_RESET}` : line;
};

export const createWorkflowWaitNotice = ({
  outputStream,
  enabled,
  promptPath,
  now,
  startedAt,
  color,
  intervalMs = WORKFLOW_WAIT_NOTICE_INTERVAL_MS,
}: {
  outputStream: OutputStream;
  enabled: boolean;
  promptPath: string;
  now: () => number;
  startedAt: number;
  color: boolean;
  intervalMs?: number;
}) => {
  let timeout: ReturnType<typeof setTimeout> | undefined;
  let stopped = true;
  let lastActivityAt = startedAt;

  const clear = () => {
    if (!timeout) {
      return;
    }
    clearTimeout(timeout);
    timeout = undefined;
  };

  const schedule = () => {
    if (!enabled || stopped || timeout) {
      return;
    }
    timeout = setTimeout(() => {
      timeout = undefined;
      if (stopped) {
        return;
      }
      outputStream.stdout(
        `${formatWorkflowWaitLine({
          promptPath,
          elapsedMs: Math.max(0, now() - lastActivityAt),
          color,
        })}\n\n`,
      );
      schedule();
    }, intervalMs);
    timeout.unref?.();
  };

  return {
    start: () => {
      if (!enabled) {
        return;
      }
      stopped = false;
      schedule();
    },
    markActivity: () => {
      if (stopped) {
        return;
      }
      lastActivityAt = now();
      clear();
      schedule();
    },
    stop: () => {
      stopped = true;
      clear();
    },
  };
};
