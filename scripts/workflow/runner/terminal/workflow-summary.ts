import path from "node:path";
import {
  commandTerminalSummary,
  summarizeFailedTestCommand,
} from "./command-summary.ts";
import type { CommandExitCode, EditedFileSummary } from "../types.ts";
import { ANSI_RESET, formatTerminalLabel, terminalLabelStyles } from "./ansi.ts";
import {
  formatFailedCommandTerminalBlockForCommand,
  formatPassedCommandTerminalBlock,
  formatTerminalAction,
  terminalOutputStats,
} from "./command-output.ts";

export { formatTerminalLabel, stripAnsiSequences, stripNonSgrAnsiSequences } from "./ansi.ts";
export {
  compactCapturedOutputForLog,
  failureDebugOutputSummary,
  formatCommandStartedDescription,
  terminalOutputStats,
} from "./command-output.ts";
export {
  parseWorkflowSections,
  trimBlankLines,
  workflowSummarySectionHeading,
} from "./workflow-summary/sections.ts";
export {
  formatSubagentApprovalPreviewMessages,
  formatWorkflowAgentSummary,
  formatWorkflowSharedSummary,
} from "./workflow-summary/messages.ts";

export const formatCommandTerminalOutput = (
  command: string,
  text: string,
  exitCode: CommandExitCode,
  color = false,
): string => {
  const stats = terminalOutputStats(text);
  if (exitCode === 0) return formatPassedCommandTerminalBlock(command, stats, color);
  return stats ? formatFailedCommandTerminalBlockForCommand(command, stats.output) : "";
};

export const formatTerminalEventBlock = (body: string): string =>
  body ? `${body.trimEnd()}\n\n` : "";

export const formatWorkflowElapsedTime = (durationMs: number): string => {
  const totalSeconds = Math.max(0, Math.floor(durationMs / 1000));
  const seconds = totalSeconds % 60;
  const totalMinutes = Math.floor(totalSeconds / 60);
  const minutes = totalMinutes % 60;
  const hours = Math.floor(totalMinutes / 60);
  if (hours > 0) return `${hours}h ${String(minutes).padStart(2, "0")}m ${String(seconds).padStart(2, "0")}s`;
  if (totalMinutes > 0) return `${totalMinutes}m ${String(seconds).padStart(2, "0")}s`;
  return `${seconds}s`;
};

const formatEditedFileSummaryLine = (summary: EditedFileSummary, color = false): string => {
  const formattedAction = formatTerminalAction(summary.action, color);
  const additions = `+${summary.additions}`;
  const deletions = `-${summary.deletions}`;
  const formattedAdditions = color ? `${terminalLabelStyles.diffAdded}${additions}${ANSI_RESET}` : additions;
  const formattedDeletions = color ? `${terminalLabelStyles.diffDeleted}${deletions}${ANSI_RESET}` : deletions;
  return `* ${formattedAction} ${summary.path} (${formattedAdditions} ${formattedDeletions})`;
};

export const formatEditedFilesForTerminal = (summaries: EditedFileSummary[], color = false): string =>
  summaries.map((summary) => formatEditedFileSummaryLine(summary, color)).join("\n");

export const formatEditedFilesForLog = (summaries: EditedFileSummary[]): string | undefined => {
  if (summaries.length === 0) return undefined;
  return summaries.map((summary, index) => {
    const line = `${summary.action} ${summary.path} (+${summary.additions} -${summary.deletions})`;
    return index === 0 ? line : `    ${line}`;
  }).join("\n");
};

export const formatCommandFailureHeadline = (command: string, exitCode: CommandExitCode, color = false): string => {
  const exitDescription = exitCode === "unknown" ? "unknown" : String(exitCode);
  const failedTestSummary = summarizeFailedTestCommand(command);
  const commandSummary = commandTerminalSummary(command);
  const commandLabel = failedTestSummary?.label ?? commandSummary.failureLabel ?? command;
  return `${formatTerminalLabel("[failed]", "commandFailed", color)} ${commandLabel} (exit ${exitDescription})`;
};

const terminalPathMarkers = ["/.ai/", "/apps/", "/packages/", "/src/", "/docs/", "/supabase/", "/scripts/", "/tests/", "/e2e/"];
const displayPathForTerminal = (filePath: string): string => {
  const slashPath = filePath.replace(/\\/g, "/");
  const relativePath = path.isAbsolute(filePath) ? path.relative(process.cwd(), filePath).replace(/\\/g, "/") : slashPath;
  if (!relativePath.startsWith("../") && relativePath !== "..") return relativePath;
  for (const marker of terminalPathMarkers) {
    const markerIndex = slashPath.lastIndexOf(marker);
    if (markerIndex >= 0) return slashPath.slice(markerIndex + 1);
  }
  return relativePath;
};

const applyPatchVerificationFailureSummary = (text: string, color = false): string | null => {
  const match = text.match(/ERROR codex_core::tools::router: error=apply_patch verification failed: Failed to find expected lines in (.+?):/);
  if (!match) return null;
  const file = displayPathForTerminal(match[1] ?? "");
  const contextStart = match.index === undefined ? 0 : match.index + match[0].length;
  const missingContextLine = text.slice(contextStart).split(/\r?\n/).map((line) => line.trim()).find(Boolean);
  const contextLines = missingContextLine ? ["", "Patch context not found:", missingContextLine] : [];
  return [
    `${formatTerminalLabel("[failed]", "commandFailed", color)} apply_patch (verification failed)`,
    `- ${file}`,
    ...contextLines,
    "",
    "Re-read the target section and apply a fresh patch.",
    "",
    "command output omitted from workflow log",
    "",
    "",
  ].join("\n");
};

export const formatCodexStderrForTerminal = (text: string, color = false): string =>
  applyPatchVerificationFailureSummary(text, color) ?? text.replace(/(^|\n)(Reading additional input from stdin\.\.\.)(\r?\n|$)/g, "$1$2\n\n");

export {
  WORKFLOW_WAIT_NOTICE_INTERVAL_MS,
  createWorkflowWaitNotice,
  formatCommitProgressLine,
  formatTaskCommitBoundaryProgressLine,
  formatTaskCompletedProgressLine,
  formatWorkflowProgressLine,
  formatWorkflowWaitLine,
  supportsWorkflowAnsiColor,
} from "./progress.ts";
