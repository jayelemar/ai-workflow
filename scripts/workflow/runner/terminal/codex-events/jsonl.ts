import { WORKFLOW_RUNNER_CODEX_PROFILE } from "../../../config/codex.ts";
import type { CodexLiveOutputFlushOptions, CodexTerminalFormatOptions, CommandExitCode, FailureMetadataLogFields, OutputStream, WorkflowFailureDebugCommandRecord, WorkflowFailureDebugRecord } from "../../types.ts";
import { asRecord, boundedInlineExcerpt, isFiniteNumber, toDisplayString } from "../../types.ts";
import {
  failureDebugOutputSummary,
  formatCodexStderrForTerminal,
  formatCommandFailureHeadline,
  formatCommandStartedDescription,
  formatCommandTerminalOutput,
  formatSubagentApprovalPreviewMessages,
  formatTaskCommitBoundaryProgressLine,
  formatTerminalEventBlock,
  formatTerminalLabel,
  formatWorkflowAgentSummary,
  stripAnsiSequences,
  stripNonSgrAnsiSequences,
} from "../formatters.ts";

const workflowRunnerCodexExecLabel = (codexProfile: string): string => `${codexProfile} exec`;
export const formatCodexJsonlEventForTerminal = (
  line: string,
  { color = false }: CodexTerminalFormatOptions = {},
): string => {
  const parseLine = stripAnsiSequences(line);
  const trimmed = parseLine.trim();
  if (!trimmed) {
    return "";
  }

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
  if (eventType === "turn.started") {
    return formatTerminalEventBlock(`${codexLabel} turn started`);
  }
  if (eventType === "turn.completed") {
    return formatTerminalEventBlock(`${codexLabel} turn completed`);
  }
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
    if (
      isFiniteNumber(usedTokens) &&
      isFiniteNumber(contextWindowTokens) &&
      contextWindowTokens > 0
    ) {
      const percent = ((usedTokens / contextWindowTokens) * 100).toFixed(2);
      const contextLabel = formatTerminalLabel("[context]", "context", color);
      return formatTerminalEventBlock(
        `${contextLabel} ${usedTokens}/${contextWindowTokens} tokens (${percent}%)`,
      );
    }
    return "";
  }

  const item = asRecord(event?.item);
  const itemType = toDisplayString(item?.type);
  if (itemType === "command_execution") {
    const command = toDisplayString(item?.command) ?? "(unknown command)";
    const status = toDisplayString(item?.status);
    if (eventType === "item.started" || status === "in_progress") {
      return formatTerminalEventBlock(
        formatCommandStartedDescription(command, color),
      );
    }

    const rawExitCode = item?.exit_code;
    const exitCode: CommandExitCode = isFiniteNumber(rawExitCode)
      ? rawExitCode
      : "unknown";
    const output = toDisplayString(item?.aggregated_output) ?? "";
    return formatTerminalEventBlock(
      exitCode === 0
        ? formatCommandTerminalOutput(command, output, exitCode, color)
        : `${formatCommandFailureHeadline(command, exitCode, color)}${formatCommandTerminalOutput(
            command,
            output,
            exitCode,
            color,
          )}`,
    );
  }
  if (itemType === "agent_message") {
    const text = toDisplayString(item?.text);
    return text
      ? formatTerminalEventBlock(
          `${formatTerminalLabel("[agent]", "agent", color)}\n${formatWorkflowAgentSummary(text, color)}`,
        )
      : "";
  }
  if (itemType === "collab_tool_call") {
    const previewMessages = item
      ? formatSubagentApprovalPreviewMessages(item, color)
      : [];
    return previewMessages.length > 0
      ? formatTerminalEventBlock(
          `${formatTerminalLabel("[agent]", "agent", color)}\n${previewMessages.join("\n\n")}`,
        )
      : "";
  }

  return "";
};

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

  const boundaryCommitEvent = (
    line: string,
  ): "started" | "completed" | undefined => {
    if (!options.commitBoundaryProgress) {
      return undefined;
    }
    let parsed: unknown;
    try {
      parsed = JSON.parse(line.trim());
    } catch {
      return undefined;
    }
    const event = asRecord(parsed);
    const item = asRecord(event?.item);
    if (toDisplayString(item?.type) !== "command_execution") {
      return undefined;
    }
    const command = toDisplayString(item?.command) ?? "";
    if (!/\bgit\s+commit(?:\s|$)/.test(command)) {
      return undefined;
    }
    const eventType = toDisplayString(event?.type);
    const status = toDisplayString(item?.status);
    if (eventType === "item.started" || status === "in_progress") {
      return "started";
    }
    const exitCode = item?.exit_code;
    return isFiniteNumber(exitCode) && exitCode === 0 ? "completed" : undefined;
  };

  const isExploredBlock = (formatted: string): boolean => {
    const firstLine = formatted.split(/\r?\n/, 1)[0] ?? "";
    return /^(?:\x1B\[[0-9;]*m)?(?:Read|Search|Explore)(?:\x1B\[0m)?(?:\s|$)/.test(
      firstLine,
    );
  };

  const isReadBlock = (formatted: string): boolean => {
    const firstLine = formatted.split(/\r?\n/, 1)[0] ?? "";
    return /^(?:\x1B\[[0-9;]*m)?Read(?:\x1B\[0m)?(?:\s|$)/.test(firstLine);
  };

  const isTurnCompletedBlock = (formatted: string): boolean =>
    /^(?:\x1B\[[0-9;]*m)?\[codex\](?:\x1B\[0m)? turn completed(?:\r?\n|$)/.test(
      formatted,
    );

  const isCommandBlock = (formatted: string): boolean => {
    const firstLine = formatted.split(/\r?\n/, 1)[0] ?? "";
    return /^(?:\x1B\[[0-9;]*m)?(?:Ran|\[failed\])(?:\x1B\[0m)?(?:\s|$)/.test(
      firstLine,
    );
  };

  const flushPendingReadBlock = () => {
    if (!pendingReadBlock) {
      return;
    }
    outputStream.stdout(`${pendingReadBlock}\n\n`);
    pendingReadBlock = "";
  };

  const flushPendingTurnCompleted = () => {
    if (!pendingTurnCompletedBlock) {
      return;
    }
    outputStream.stdout(pendingTurnCompletedBlock);
    pendingTurnCompletedBlock = "";
  };

  const writeFormattedOutput = (formatted: string) => {
    if (!formatted) {
      return;
    }

    if (isTurnCompletedBlock(formatted)) {
      pendingTurnCompletedBlock = formatted;
      return;
    }

    flushPendingTurnCompleted();

    if (isReadBlock(formatted)) {
      if (formatted === lastExploredBlock) {
        return;
      }
      lastCommandBlock = "";
      lastExploredBlock = formatted;
      const trimmedBlock = formatted.replace(/\r?\n+$/, "");
      pendingReadBlock = pendingReadBlock
        ? `${pendingReadBlock}\n${trimmedBlock}`
        : trimmedBlock;
      return;
    }

    flushPendingReadBlock();

    if (isExploredBlock(formatted)) {
      if (formatted === lastExploredBlock) {
        return;
      }
      lastCommandBlock = "";
      lastExploredBlock = formatted;
      outputStream.stdout(formatted);
      return;
    }

    lastExploredBlock = "";
    if (isCommandBlock(formatted)) {
      if (formatted === lastCommandBlock) {
        return;
      }
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
          if (boundaryCommitInProgress) {
            continue;
          }
          boundaryCommitInProgress = true;
          const progress = options.commitBoundaryProgress;
          if (progress && completedBoundaryCommits < progress.boundaryTotal) {
            writeFormattedOutput(
              formatTerminalEventBlock(
                formatTaskCommitBoundaryProgressLine({
                  ...progress,
                  boundaryPosition: completedBoundaryCommits + 1,
                  state: "creating",
                }),
              ),
            );
          }
          continue;
        }
        if (commitEvent === "completed") {
          boundaryCommitInProgress = false;
          completedBoundaryCommits += 1;
          const progress = options.commitBoundaryProgress;
          if (progress && completedBoundaryCommits <= progress.boundaryTotal) {
            writeFormattedOutput(
              formatTerminalEventBlock(
                formatTaskCommitBoundaryProgressLine({
                  ...progress,
                  boundaryPosition: completedBoundaryCommits,
                  state: "created",
                }),
              ),
            );
          }
          continue;
        }
        const formatted = formatCodexJsonlEventForTerminal(line, options);
        writeFormattedOutput(formatted);
      }
    },
    stderr: (chunk: string) => {
      outputStream.stderr(formatCodexStderrForTerminal(chunk, options.color));
    },
    flush: ({
      includePendingTurnCompleted = true,
    }: CodexLiveOutputFlushOptions = {}) => {
      if (stdoutBuffer) {
        const formatted = formatCodexJsonlEventForTerminal(
          stdoutBuffer,
          options,
        );
        stdoutBuffer = "";
        writeFormattedOutput(formatted);
      }
      flushPendingReadBlock();
      if (includePendingTurnCompleted) {
        flushPendingTurnCompleted();
      }
    },
  };
};

export const codexAgentMessageTexts = (stdout: string): string[] => {
  const messages: string[] = [];
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
    if (item?.type === "agent_message" && typeof item.text === "string") {
      messages.push(item.text);
    }
  }
  return messages;
};

export const stdoutContainsJsonEvents = (stdout: string): boolean => {
  for (const line of stdout.split(/\r?\n/)) {
    const trimmed = line.trim();
    if (!trimmed) {
      continue;
    }
    try {
      JSON.parse(trimmed);
      return true;
    } catch {
      continue;
    }
  }
  return false;
};

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

const failureStopExcerpt = (stopReason: string): string | undefined => {
  const match =
    /^(?<label>[A-Za-z0-9][A-Za-z0-9_-]* exec) output contained STOP:?\s*/.exec(
      stopReason,
    );
  if (!match) {
    return undefined;
  }

  const excerpt = stopReason.slice(match[0].length).trim() || "STOP";
  return boundedInlineExcerpt(excerpt);
};

export const createWorkflowFailureDebugRecord = ({
  timestamp,
  iteration,
  planPath,
  status,
  nextAction,
  promptPath,
  result,
  exitCode,
  stopReason,
  failureMetadata,
  stdout,
  stderr,
  staging,
  cleanup,
}: {
  timestamp: string;
  iteration: number;
  planPath: string;
  status: Status;
  nextAction: NextAction;
  promptPath: string;
  result: string;
  exitCode?: number;
  stopReason: string;
  failureMetadata: FailureMetadataLogFields;
  stdout: string;
  stderr: string;
  staging?: ReviewStagingProcess;
  cleanup?: ReviewCleanupProcess;
}): WorkflowFailureDebugRecord => {
  const stdoutSummary = !stdoutContainsJsonEvents(stdout)
    ? failureDebugOutputSummary(stdout)
    : undefined;
  const stderrSummary = failureDebugOutputSummary(stderr);
  const agentMessages = codexAgentMessageTexts(stdout);
  const recentCommands = [
    ...codexRecentCommandRecords(stdout),
    ...(staging
      ? [
          commandRecordFromProcessCapture(
            "review-staging",
            staging.command,
            staging.exitCode ?? "unknown",
            staging.stdout,
            staging.stderr,
          ),
        ]
      : []),
    ...(cleanup
      ? [
          commandRecordFromProcessCapture(
            "review-cleanup",
            cleanup.command,
            cleanup.exitCode ?? "unknown",
            cleanup.stdout,
            cleanup.stderr,
          ),
        ]
      : []),
  ];

  return {
    timestamp,
    iteration,
    planPath,
    status,
    nextAction,
    promptPath,
    result,
    exitCode: exitCode ?? null,
    stopReason,
    failureKind: failureMetadata.failureKind,
    failureReason: failureMetadata.failureReason,
    stdoutByteCount: Buffer.byteLength(stdout, "utf8"),
    stdoutLineCount: stdout ? stdout.split(/\r?\n/).length : 0,
    stderrByteCount: Buffer.byteLength(stderr, "utf8"),
    stderrLineCount: stderr ? stderr.split(/\r?\n/).length : 0,
    stdoutExcerpt: stdoutSummary?.excerpt,
    stdoutTruncated: stdoutSummary?.truncated,
    stderrExcerpt: stderrSummary?.excerpt,
    stderrTruncated: stderrSummary?.truncated,
    stopExcerpt: failureStopExcerpt(stopReason),
    lastAgentMessageExcerpt:
      agentMessages.length > 0
        ? boundedInlineExcerpt(agentMessages.at(-1) ?? "")
        : undefined,
    recentCommands,
  };
};

const normalizeStopDirectiveLine = (line: string): string => {
  const trimmed = line.trim().replace(/ΓÇö/g, "—");
  const inlineCodeMatch = /^`([^`]+)`(.*)$/.exec(trimmed);
  if (!inlineCodeMatch) {
    return trimmed;
  }

  const [, inlineCodeText, suffix] = inlineCodeMatch;
  const normalizedInlineCodeText = inlineCodeText.trim();
  return `${normalizedInlineCodeText}${suffix}`.trim();
};

const containsStopDirective = (text: string): boolean =>
  text.split(/\r?\n/).some((line) => {
    const trimmed = normalizeStopDirectiveLine(line);
    return (
      trimmed === "STOP" ||
      trimmed.startsWith("STOP:") ||
      trimmed.startsWith("STOP (") ||
      trimmed.startsWith("STOP `") ||
      trimmed.startsWith("STOP -") ||
      trimmed.startsWith("STOP –") ||
      trimmed.startsWith("STOP —")
    );
  });

const stripStopDirectivePrefix = (line: string): string | undefined => {
  const trimmed = normalizeStopDirectiveLine(line);
  if (!containsStopDirective(trimmed)) {
    return undefined;
  }
  if (trimmed === "STOP") {
    return undefined;
  }

  let excerpt = trimmed.replace(/^STOP\b/, "").trim();
  excerpt = excerpt.replace(/^[:\-–—\s]+/, "").trim();
  if (excerpt.startsWith("(") && excerpt.endsWith(")")) {
    excerpt = excerpt.slice(1, -1).trim();
  }
  if (excerpt.startsWith("`") && excerpt.endsWith("`")) {
    excerpt = excerpt.slice(1, -1).trim();
  }
  if (excerpt.startsWith("`") && excerpt.endsWith("`)")) {
    excerpt = excerpt.slice(1, -2).trim();
  }
  return boundedInlineExcerpt(excerpt);
};

const plainStopExcerpt = (text: string): string | undefined => {
  const stopLine = text.split(/\r?\n/).find((line) => line.includes("STOP"));
  if (!stopLine) {
    return undefined;
  }
  return stripStopDirectivePrefix(stopLine) ?? boundedInlineExcerpt(stopLine);
};

const formatStopReason = (
  excerpt?: string,
  codexExecLabel = workflowRunnerCodexExecLabel(WORKFLOW_RUNNER_CODEX_PROFILE),
): string =>
  `${codexExecLabel} output contained STOP${excerpt ? `: ${excerpt}` : ""}`;

export const REVIEW_ENTRY_STAGED_WORK_REASON_PREFIX =
  "review blocked before review-plan because staged files already exist; human may manually unstage them, then rerun workflow-runner so it owns review staging";

export const classifyFailureForLog = (reason: string): FailureMetadataLogFields => {
  const stopMatch =
    /^(?<label>[A-Za-z0-9][A-Za-z0-9_-]* exec) output contained STOP:?\s*/.exec(
      reason,
    );
  if (stopMatch) {
    return {
      failureKind: "codex-stop",
      failureReason: reason.slice(stopMatch[0].length).trim() || "STOP",
      nextSuggestedAction:
        "inspect STOP reason, fix code or workflow evidence, then rerun workflow-runner",
    };
  }
  if (/^could not launch [A-Za-z0-9][A-Za-z0-9_-]* exec(?::|$)/.test(reason)) {
    return {
      failureKind: "codex-launch",
      failureReason: reason,
      nextSuggestedAction:
        "fix Codex launch environment, then rerun workflow-runner",
    };
  }
  if (/^[A-Za-z0-9][A-Za-z0-9_-]* exec exited with code\b/.test(reason)) {
    return {
      failureKind: "codex-exit",
      failureReason: reason,
      nextSuggestedAction:
        "inspect workflow log, fix runtime failure, then rerun workflow-runner",
    };
  }
  if (reason.startsWith(REVIEW_ENTRY_STAGED_WORK_REASON_PREFIX)) {
    return {
      failureKind: "review-entry-staged-work",
      failureReason: reason,
      nextSuggestedAction:
        "human may manually unstage existing staged work before starting review-plan, then rerun workflow-runner",
    };
  }
  if (
    reason.startsWith("review staging git add") ||
    reason.startsWith("could not launch review staging git add")
  ) {
    return {
      failureKind: "review-staging",
      failureReason: reason,
      nextSuggestedAction:
        "fix review staging paths or git error, then rerun workflow-runner",
    };
  }
  if (reason.startsWith("review hunk ownership incomplete")) {
    return {
      failureKind: "review-hunk-ownership",
      failureReason: reason,
      nextSuggestedAction:
        "update ## Hunk Ownership for shared-file hunks, then rerun workflow-runner",
    };
  }
  if (
    reason.startsWith("review cleanup git restore") ||
    reason.startsWith("could not launch review cleanup git restore")
  ) {
    return {
      failureKind: "review-unstage",
      failureReason: reason,
      nextSuggestedAction:
        "fix review cleanup git error or manually unstage plan paths, then rerun workflow-runner",
    };
  }
  if (reason.startsWith("plan-owned changes remain after commit-summary")) {
    return {
      failureKind: "dirty-plan-owned-paths",
      failureReason: reason,
      nextSuggestedAction:
        "fix commit preflight errors, then rerun workflow-runner; plan remains completed + commit-summary",
    };
  }
  if (
    reason ===
    "plan content unchanged after successful nonterminal workflow action"
  ) {
    return {
      failureKind: "unchanged-plan",
      failureReason: reason,
      nextSuggestedAction:
        "inspect workflow output and update plan state, then rerun workflow-runner",
    };
  }
  if (reason.includes("may only hand off")) {
    return {
      failureKind: "invalid-transition",
      failureReason: reason,
      nextSuggestedAction:
        "fix plan status and next action, then rerun workflow-runner",
    };
  }
  if (reason.startsWith("maximum iterations ")) {
    return {
      failureKind: "max-iterations",
      failureReason: reason,
      nextSuggestedAction:
        "inspect plan progress, then resume with workflow-runner if still valid",
    };
  }
  return {
    failureKind: "runner-failure",
    failureReason: reason,
    nextSuggestedAction:
      "inspect workflow log, resolve failure, then rerun workflow-runner",
  };
};

export const codexOutputStopReason = (
  stdout: string,
  stderr: string,
  codexExecLabel = workflowRunnerCodexExecLabel(WORKFLOW_RUNNER_CODEX_PROFILE),
): string | undefined => {
  if (stderr.includes("STOP")) {
    return formatStopReason(plainStopExcerpt(stderr), codexExecLabel);
  }

  const agentMessages = codexAgentMessageTexts(stdout);
  if (agentMessages.length > 0) {
    for (const message of agentMessages) {
      if (containsStopDirective(message)) {
        const excerpt = message
          .split(/\r?\n/)
          .map(stripStopDirectivePrefix)
          .find((value): value is string => typeof value === "string");
        return formatStopReason(excerpt, codexExecLabel);
      }
    }
    return undefined;
  }

  let sawJsonLine = false;
  for (const line of stdout.split(/\r?\n/)) {
    const trimmed = line.trim();
    if (!trimmed) {
      continue;
    }
    try {
      JSON.parse(trimmed);
      sawJsonLine = true;
    } catch {
      continue;
    }
  }

  if (sawJsonLine) {
    return undefined;
  }
  if (stdout.includes("STOP")) {
    return formatStopReason(plainStopExcerpt(stdout), codexExecLabel);
  }
  return undefined;
};

export const codexOutputContainsStop = (
  stdout: string,
  stderr: string,
): boolean => codexOutputStopReason(stdout, stderr) !== undefined;

