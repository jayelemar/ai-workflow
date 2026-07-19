import {
  failureDebugOutputSummary,
} from "../command-output.ts";
import type { WorkflowFailureDebugCommandRecord } from "../../types.ts";
import { asRecord, isFiniteNumber, toDisplayString } from "../../types.ts";

const commandRecordFromCodexEvent = (
  command: string,
  exitCode: number | "unknown",
  output: string,
): WorkflowFailureDebugCommandRecord => {
  const summary = failureDebugOutputSummary(output);
  return {
    source: "codex-command",
    command,
    exitCode,
    outputByteCount: summary?.byteCount ?? 0,
    outputLineCount: summary?.lineCount ?? 0,
    outputExcerpt: summary?.excerpt,
    outputTruncated: summary?.truncated ?? false,
  };
};

export const commandRecordFromProcessCapture = (
  source: "review-staging" | "review-cleanup",
  command: string,
  exitCode: number | "unknown",
  stdout: string,
  stderr: string,
): WorkflowFailureDebugCommandRecord => {
  const stdoutSummary = failureDebugOutputSummary(stdout);
  const stderrSummary = failureDebugOutputSummary(stderr);
  return {
    source,
    command,
    exitCode,
    stdoutByteCount: stdoutSummary?.byteCount ?? 0,
    stdoutLineCount: stdoutSummary?.lineCount ?? 0,
    stdoutExcerpt: stdoutSummary?.excerpt,
    stdoutTruncated: stdoutSummary?.truncated ?? false,
    stderrByteCount: stderrSummary?.byteCount ?? 0,
    stderrLineCount: stderrSummary?.lineCount ?? 0,
    stderrExcerpt: stderrSummary?.excerpt,
    stderrTruncated: stderrSummary?.truncated ?? false,
  };
};

export const codexRecentCommandRecords = (
  stdout: string,
): WorkflowFailureDebugCommandRecord[] => {
  const commands: WorkflowFailureDebugCommandRecord[] = [];
  for (const line of stdout.split(/\r?\n/)) {
    const trimmed = line.trim();
    if (!trimmed) {
      continue;
    }

    let parsed: unknown;
    try {
      parsed = JSON.parse(trimmed);
    } catch {
      continue;
    }

    const event = asRecord(parsed);
    const item = asRecord(event?.item);
    if (item?.type !== "command_execution") {
      continue;
    }

    const command = toDisplayString(item.command);
    if (!command) {
      continue;
    }
    const status = toDisplayString(item.status);
    if (event?.type === "item.started" || status === "in_progress") {
      continue;
    }
    const rawExitCode = item.exit_code;
    const exitCode: number | "unknown" = isFiniteNumber(rawExitCode)
      ? rawExitCode
      : "unknown";
    const output = toDisplayString(item.aggregated_output) ?? "";
    commands.push(commandRecordFromCodexEvent(command, exitCode, output));
  }

  return commands.slice(-3);
};
