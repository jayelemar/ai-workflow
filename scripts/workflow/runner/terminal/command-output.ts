import { commandTerminalSummary } from "./command-summary.ts";
import type { TerminalOutputStats } from "../types.ts";
import { ANSI_RESET, terminalLabelStyles } from "./ansi.ts";

const TERMINAL_FAILED_COMMAND_OUTPUT_LINE_LIMIT = 4;
const TERMINAL_FAILED_COMMAND_OUTPUT_CHAR_LIMIT = 1000;
const TERMINAL_FILE_DETAIL_LIMIT = 3;
export const terminalOutputStats = (text: string): TerminalOutputStats | null => {
  const trimmed = text.trimEnd();
  if (!trimmed) {
    return null;
  }
  return {
    output: trimmed,
  };
};

export const compactCapturedOutputForLog = (text: string): string => {
  if (!text) {
    return "";
  }
  const byteCount = Buffer.byteLength(text, "utf8");
  const lineCount = text.split(/\r?\n/).length;
  return `omitted ${byteCount} bytes, ${lineCount} lines`;
};

type FailureDebugOutputSummary = {
  byteCount: number;
  lineCount: number;
  excerpt?: string;
  truncated: boolean;
};

export const failureDebugOutputSummary = (
  text: string,
): FailureDebugOutputSummary | undefined => {
  if (!text) {
    return undefined;
  }

  const byteCount = Buffer.byteLength(text, "utf8");
  const lineCount = text.split(/\r?\n/).length;
  const stats = terminalOutputStats(text);
  if (!stats) {
    return {
      byteCount,
      lineCount,
      truncated: false,
    };
  }

  let output = stats.output.slice(0, TERMINAL_FAILED_COMMAND_OUTPUT_CHAR_LIMIT);
  let truncated =
    stats.output.length > TERMINAL_FAILED_COMMAND_OUTPUT_CHAR_LIMIT;
  const lines = output.split(/\r?\n/);
  if (lines.length > TERMINAL_FAILED_COMMAND_OUTPUT_LINE_LIMIT) {
    output = lines
      .slice(0, TERMINAL_FAILED_COMMAND_OUTPUT_LINE_LIMIT)
      .join("\n");
    truncated = true;
  }

  return {
    byteCount,
    lineCount,
    excerpt: output || undefined,
    truncated,
  };
};

export const formatTerminalAction = (action: string, color = false): string =>
  color ? `${terminalLabelStyles.action}${action}${ANSI_RESET}` : action;

export const formatActionDescription = (description: string, color = false): string =>
  description.replace(/^[^\s\n]+/, (action) =>
    formatTerminalAction(action, color),
  );

export const formatTerminalFileDetails = (files: string[]): string => {
  const visibleFiles = files.slice(0, TERMINAL_FILE_DETAIL_LIMIT);
  const remainingCount = files.length - visibleFiles.length;
  return [
    ...visibleFiles.map((file) => `- ${file}`),
    ...(remainingCount > 0 ? [`  +${remainingCount} more`] : []),
  ].join("\n");
};

export const formatCommandStartedDescription = (
  command: string,
  color = false,
): string => {
  const summary = commandTerminalSummary(command);
  if (summary.group === "Ran" && summary.files && summary.files.length > 0) {
    const filesBlock = formatTerminalFileDetails(summary.files);
    const detailsBlock =
      summary.details && summary.details.length > 0
        ? `\n${summary.details.join("\n")}`
        : "";
    return `${formatTerminalAction("Ran", color)} ${summary.description}\n${filesBlock}${detailsBlock}`;
  }
  if (summary.group === "Explored") {
    return "";
  }
  return summary.group === "Ran"
    ? `${formatTerminalAction("Ran", color)} ${summary.description}`
    : formatActionDescription(summary.description, color);
};

export const formatExploredTerminalBlock = (
  description: string,
  color = false,
): string => {
  const [firstLine = "", ...restLines] = description.split("\n");
  const firstItemLine = formatActionDescription(firstLine, color);
  if (restLines.length === 0) {
    return firstItemLine;
  }
  return `${firstItemLine}\n${restLines
    .map((line) =>
      line === "" ||
      line.startsWith("- ") ||
      /^\s+\+\s?\d+ more$/.test(line) ||
      /^(files|terms):$/.test(line) ||
      /^(Read|Search|Explore)(?:\s|$)/.test(line)
        ? line
        : `  ${line}`,
    )
    .join("\n")}`;
};

export const formatPassedCommandTerminalBlock = (
  command: string,
  _stats: TerminalOutputStats | null,
  color = false,
): string => {
  const summary = commandTerminalSummary(command);
  if (summary.group === "Ran" || summary.silent) {
    return "";
  }

  return `${formatExploredTerminalBlock(summary.description, color)}\n`;
};

export const formatFailedCommandTerminalBlockForCommand = (
  command: string,
  text: string,
): string => {
  const summary = commandTerminalSummary(command);
  if (summary.failureCommand) {
    return `\n  command: ${summary.failureCommand}\n`;
  }

  const stats = terminalOutputStats(text);
  if (!stats) {
    return "";
  }

  const byteCount = Buffer.byteLength(stats.output, "utf8");
  const lineCount = stats.output.split(/\r?\n/).length;
  return `\n  output: ${byteCount} bytes, ${lineCount} lines omitted\n  command output omitted from workflow log\n`;
};
