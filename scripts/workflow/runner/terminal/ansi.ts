import type { TerminalLabelStyle } from "../types.ts";

export const ANSI_RESET = "\u001b[0m";
export const ANSI_SEQUENCE_PATTERN =
  /\u001b(?:\[([0-?]*[ -/]*)([@-~])|\][^\u0007]*(?:\u0007|\u001b\\)|[@-_])/g;

export const terminalLabelStyles = {
  commandStarted: "\u001b[34m",
  commandFailed: "\u001b[31m",
  action: "\u001b[34m",
  agent: "\u001b[38;5;214m",
  codex: "\u001b[35m",
  context: "\u001b[30;43m",
  diffAdded: "\u001b[32m",
  diffDeleted: "\u001b[31m",
} as const;

export const WORKFLOW_WAIT_NOTICE_COLOR = "\u001b[38;2;255;244;143m";

export const stripAnsiSequences = (text: string): string =>
  text.replace(ANSI_SEQUENCE_PATTERN, "");

export const stripNonSgrAnsiSequences = (text: string): string =>
  text.replace(
    ANSI_SEQUENCE_PATTERN,
    (
      sequence,
      _parameters: string | undefined,
      finalByte: string | undefined,
    ) => (finalByte === "m" ? sequence : ""),
  );

export const formatTerminalLabel = (
  label: string,
  style: TerminalLabelStyle,
  color = false,
): string =>
  color ? `${terminalLabelStyles[style]}${label}${ANSI_RESET}` : label;
