import type {
  CodexLiveOutputFlushOptions,
  CodexTerminalFormatOptions,
  OutputStream,
} from "../../types.ts";
import { asRecord, isFiniteNumber, toDisplayString } from "../../types.ts";
import {
  formatCodexStderrForTerminal,
  formatTaskCommitBoundaryProgressLine,
  formatTerminalEventBlock,
} from "../formatters.ts";
import { formatCodexJsonlEventForTerminal } from "./event-format.ts";

export const createCodexLiveOutputFormatter = (
  outputStream: OutputStream,
  options: CodexTerminalFormatOptions = {},
) => {
  let stdoutBuffer = "";
  let lastExploredBlock = "";
  let lastCommandBlock = "";
  let pendingReadBlock = "";
  let pendingTurnCompletedBlock = "";
  let completedBoundaryCommits = 0;
  let boundaryCommitInProgress = false;

  const boundaryCommitEvent = (line: string): "started" | "completed" | undefined => {
    if (!options.commitBoundaryProgress) return undefined;
    let parsed: unknown;
    try {
      parsed = JSON.parse(line.trim());
    } catch {
      return undefined;
    }
    const event = asRecord(parsed);
    const item = asRecord(event?.item);
    if (toDisplayString(item?.type) !== "command_execution") return undefined;
    const command = toDisplayString(item?.command) ?? "";
    if (!/\bgit\s+commit(?:\s|$)/.test(command)) return undefined;
    const eventType = toDisplayString(event?.type);
    const status = toDisplayString(item?.status);
    if (eventType === "item.started" || status === "in_progress") return "started";
    const exitCode = item?.exit_code;
    return isFiniteNumber(exitCode) && exitCode === 0 ? "completed" : undefined;
  };

  const firstLine = (formatted: string): string => formatted.split(/\r?\n/, 1)[0] ?? "";
  const isExploredBlock = (formatted: string): boolean => /^(?:\x1B\[[0-9;]*m)?(?:Read|Search|Explore)(?:\x1B\[0m)?(?:\s|$)/.test(firstLine(formatted));
  const isReadBlock = (formatted: string): boolean => /^(?:\x1B\[[0-9;]*m)?Read(?:\x1B\[0m)?(?:\s|$)/.test(firstLine(formatted));
  const isTurnCompletedBlock = (formatted: string): boolean => /^(?:\x1B\[[0-9;]*m)?\[codex\](?:\x1B\[0m)? turn completed(?:\r?\n|$)/.test(formatted);
  const isCommandBlock = (formatted: string): boolean => /^(?:\x1B\[[0-9;]*m)?(?:Ran|\[failed\])(?:\x1B\[0m)?(?:\s|$)/.test(firstLine(formatted));
  const flushPendingReadBlock = () => {
    if (!pendingReadBlock) return;
    outputStream.stdout(`${pendingReadBlock}\n\n`);
    pendingReadBlock = "";
  };
  const flushPendingTurnCompleted = () => {
    if (!pendingTurnCompletedBlock) return;
    outputStream.stdout(pendingTurnCompletedBlock);
    pendingTurnCompletedBlock = "";
  };
  const writeFormattedOutput = (formatted: string) => {
    if (!formatted) return;
    if (isTurnCompletedBlock(formatted)) {
      pendingTurnCompletedBlock = formatted;
      return;
    }
    flushPendingTurnCompleted();
    if (isReadBlock(formatted)) {
      if (formatted === lastExploredBlock) return;
      lastCommandBlock = "";
      lastExploredBlock = formatted;
      const trimmedBlock = formatted.replace(/\r?\n+$/, "");
      pendingReadBlock = pendingReadBlock ? `${pendingReadBlock}\n${trimmedBlock}` : trimmedBlock;
      return;
    }
    flushPendingReadBlock();
    if (isExploredBlock(formatted)) {
      if (formatted === lastExploredBlock) return;
      lastCommandBlock = "";
      lastExploredBlock = formatted;
      outputStream.stdout(formatted);
      return;
    }
    lastExploredBlock = "";
    if (isCommandBlock(formatted)) {
      if (formatted === lastCommandBlock) return;
      lastCommandBlock = formatted;
      outputStream.stdout(formatted);
      return;
    }
    lastCommandBlock = "";
    outputStream.stdout(formatted);
  };

  return {
    stdout: (chunk: string) => {
      stdoutBuffer += chunk;
      const lines = stdoutBuffer.split(/\r?\n/);
      stdoutBuffer = lines.pop() ?? "";
      for (const line of lines) {
        const commitEvent = boundaryCommitEvent(line);
        if (commitEvent === "started") {
          if (boundaryCommitInProgress) continue;
          boundaryCommitInProgress = true;
          const progress = options.commitBoundaryProgress;
          if (progress && completedBoundaryCommits < progress.boundaryTotal) {
            writeFormattedOutput(formatTerminalEventBlock(formatTaskCommitBoundaryProgressLine({ ...progress, boundaryPosition: completedBoundaryCommits + 1, state: "creating" })));
          }
          continue;
        }
        if (commitEvent === "completed") {
          boundaryCommitInProgress = false;
          completedBoundaryCommits += 1;
          const progress = options.commitBoundaryProgress;
          if (progress && completedBoundaryCommits <= progress.boundaryTotal) {
            writeFormattedOutput(formatTerminalEventBlock(formatTaskCommitBoundaryProgressLine({ ...progress, boundaryPosition: completedBoundaryCommits, state: "created" })));
          }
          continue;
        }
        writeFormattedOutput(formatCodexJsonlEventForTerminal(line, options));
      }
    },
    stderr: (chunk: string) => outputStream.stderr(formatCodexStderrForTerminal(chunk, options.color)),
    flush: ({ includePendingTurnCompleted = true }: CodexLiveOutputFlushOptions = {}) => {
      if (stdoutBuffer) {
        writeFormattedOutput(formatCodexJsonlEventForTerminal(stdoutBuffer, options));
        stdoutBuffer = "";
      }
      flushPendingReadBlock();
      if (includePendingTurnCompleted) flushPendingTurnCompleted();
    },
  };
};
