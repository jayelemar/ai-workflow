import type { CodexTerminalFormatOptions, CommandExitCode } from "../../types.ts";
import { asRecord, isFiniteNumber, toDisplayString } from "../../types.ts";
import {
  formatCommandFailureHeadline,
  formatCommandStartedDescription,
  formatCommandTerminalOutput,
  formatSubagentApprovalPreviewMessages,
  formatTerminalEventBlock,
  formatTerminalLabel,
  formatWorkflowAgentSummary,
  stripAnsiSequences,
  stripNonSgrAnsiSequences,
} from "../formatters.ts";

export const formatCodexJsonlEventForTerminal = (
  line: string,
  { color = false }: CodexTerminalFormatOptions = {},
): string => {
  const parseLine = stripAnsiSequences(line);
  const trimmed = parseLine.trim();
  if (!trimmed) return "";

  let parsed: unknown;
  try {
    parsed = JSON.parse(trimmed);
  } catch {
    const passthroughLine = stripNonSgrAnsiSequences(line);
    return passthroughLine
      ? `${passthroughLine.endsWith("\n") ? passthroughLine : `${passthroughLine}\n`}`
      : "";
  }

  const event = asRecord(parsed);
  const eventType = toDisplayString(event?.type);
  const codexLabel = formatTerminalLabel("[codex]", "codex", color);
  if (eventType === "thread.started") {
    const threadId = toDisplayString(event?.thread_id);
    return formatTerminalEventBlock(
      `${codexLabel} thread started${threadId ? ` ${threadId}` : ""}`,
    );
  }
  if (eventType === "turn.started") return formatTerminalEventBlock(`${codexLabel} turn started`);
  if (eventType === "turn.completed") return formatTerminalEventBlock(`${codexLabel} turn completed`);
  if (eventType === "turn.failed") {
    const error = asRecord(event?.error);
    const message = toDisplayString(error?.message) ?? "unknown error";
    return formatTerminalEventBlock(`${codexLabel} turn failed: ${message}`);
  }
  if (eventType === "error") {
    const message = toDisplayString(event?.message) ?? "unknown error";
    return formatTerminalEventBlock(`${codexLabel} error: ${message}`);
  }

  const payload = asRecord(event?.payload);
  if (payload?.type === "token_count") {
    const info = asRecord(payload.info);
    const lastTokenUsage = asRecord(info?.last_token_usage);
    const usedTokens = lastTokenUsage?.total_tokens;
    const contextWindowTokens = info?.model_context_window;
    if (isFiniteNumber(usedTokens) && isFiniteNumber(contextWindowTokens) && contextWindowTokens > 0) {
      const percent = ((usedTokens / contextWindowTokens) * 100).toFixed(2);
      const contextLabel = formatTerminalLabel("[context]", "context", color);
      return formatTerminalEventBlock(`${contextLabel} ${usedTokens}/${contextWindowTokens} tokens (${percent}%)`);
    }
    return "";
  }

  const item = asRecord(event?.item);
  const itemType = toDisplayString(item?.type);
  if (itemType === "command_execution") {
    const command = toDisplayString(item?.command) ?? "(unknown command)";
    const status = toDisplayString(item?.status);
    if (eventType === "item.started" || status === "in_progress") return formatTerminalEventBlock(formatCommandStartedDescription(command, color));
    const rawExitCode = item?.exit_code;
    const exitCode: CommandExitCode = isFiniteNumber(rawExitCode) ? rawExitCode : "unknown";
    const output = toDisplayString(item?.aggregated_output) ?? "";
    return formatTerminalEventBlock(exitCode === 0
      ? formatCommandTerminalOutput(command, output, exitCode, color)
      : `${formatCommandFailureHeadline(command, exitCode, color)}${formatCommandTerminalOutput(command, output, exitCode, color)}`);
  }
  if (itemType === "agent_message") {
    const text = toDisplayString(item?.text);
    return text ? formatTerminalEventBlock(`${formatTerminalLabel("[agent]", "agent", color)}\n${formatWorkflowAgentSummary(text, color)}`) : "";
  }
  if (itemType === "collab_tool_call") {
    const previewMessages = item ? formatSubagentApprovalPreviewMessages(item, color) : [];
    return previewMessages.length > 0
      ? formatTerminalEventBlock(`${formatTerminalLabel("[agent]", "agent", color)}\n${previewMessages.join("\n\n")}`)
      : "";
  }
  return "";
};
