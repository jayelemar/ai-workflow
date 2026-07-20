import path from "node:path";
import { commandTerminalSummary, summarizeFailedTestCommand } from "./command-summary.ts";
import type { CommandExitCode, EditedFileSummary } from "../types.ts";
import { asRecord } from "../types.ts";
import {
  ANSI_RESET,
  formatTerminalLabel,
  terminalLabelStyles,
} from "./ansi.ts";
import {
  formatFailedCommandTerminalBlockForCommand,
  formatPassedCommandTerminalBlock,
  formatTerminalAction,
  terminalOutputStats,
} from "./command-output.ts";
import {
  formatCodePreviewLines,
  highlightTsxCodePreviewLine,
} from "./code-preview.ts";
import {
  parseWorkflowSections,
  trimBlankLines,
  workflowSummarySectionHeading,
} from "./workflow-summary/sections.ts";

const TERMINAL_FILE_DETAIL_LIMIT = 3;

export {
  formatTerminalLabel,
  stripAnsiSequences,
  stripNonSgrAnsiSequences,
} from "./ansi.ts";

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

const compactWorkflowValidationLine = (line: string): string => {
  const knownLimitationPrefix = "* Known limitation: ";
  if (line.startsWith(knownLimitationPrefix)) {
    return `* Deferred: ${line.slice(knownLimitationPrefix.length)}`;
  }

  const commandMatch = line.match(/^\* `([^`]+)`: (.+)$/);
  if (!commandMatch) {
    return line;
  }

  const [, command, result] = commandMatch;
  let label: string | null = null;
  if (
    command.includes("@gondoor/backend test") &&
    command.includes("test/onboarding/")
  ) {
    label = "Backend onboarding spec";
  } else if (
    command.includes("@gondoor/backend test") &&
    command.includes("test/documents/")
  ) {
    label = "Backend document spec";
  } else if (command.includes("@gondoor/backend build")) {
    label = "Backend build";
  } else if (command.includes("@gondoor/web exec vitest run")) {
    label = "Web docs tests";
  }

  return label ? `* ${label}: ${result}` : line;
};

const boundedSectionLines = (lines: string[], limit: number): string[] => {
  const visibleLines = trimBlankLines(lines).filter(
    (line) => line.trim().length > 0,
  );
  const shownLines = visibleLines.slice(0, limit);
  const hiddenLines = visibleLines.length - shownLines.length;
  return hiddenLines > 0
    ? [...shownLines, `  +${hiddenLines} more`]
    : shownLines;
};

const sentenceWithPeriod = (text: string): string => {
  const trimmed = text.trim().replace(/[;,]$/, "");
  return /[.!?]$/.test(trimmed) ? trimmed : `${trimmed}.`;
};

const compactReviewIssueText = (severity: string, text: string): string => {
  const withoutExample = text.split(/\s+Example:/)[0]?.trim() ?? text.trim();
  if (severity === "Warning" && withoutExample.includes(":")) {
    return sentenceWithPeriod(withoutExample.split(":")[0] ?? withoutExample);
  }
  if (severity === "Suggestion") {
    return sentenceWithPeriod(withoutExample.replace(/\s+around\s+.*$/i, ""));
  }
  return sentenceWithPeriod(withoutExample);
};

const formatReviewIssueBullet = (
  severity: string,
  bulletLine: string,
): string[] => {
  const rawText = bulletLine.replace(/^[-*]\s+/, "").trim();
  const linkedIssueMatch = rawText.match(/^\[[^\]]+\]\((.+):(\d+)\):\s*(.+)$/);
  const issueText =
    linkedIssueMatch?.[3] ?? rawText.replace(/\[[^\]]+\]\([^)]+\)/g, "").trim();
  return [`* ${severity}: ${compactReviewIssueText(severity, issueText)}`];
};

const formatReviewIssues = (lines: string[]): string[] => {
  const formattedLines: string[] = [];
  let severity = "Issue";
  for (const line of lines) {
    const trimmed = line.trim();
    const severityMatch = trimmed.match(/^####\s+(.+)$/);
    if (severityMatch?.[1]) {
      severity = severityMatch[1]
        .toLowerCase()
        .replace(/^\w/, (char) => char.toUpperCase());
      continue;
    }
    const prefixedSeverityMatch = trimmed.match(
      /^[-*]\s*(Critical|Warning|Suggestion|Issue)\s*:\s*(.+)$/i,
    );
    if (prefixedSeverityMatch) {
      const explicitSeverity = prefixedSeverityMatch[1].replace(/^\w/, (char) =>
        char.toUpperCase(),
      );
      formattedLines.push(
        ...formatReviewIssueBullet(
          explicitSeverity,
          `* ${prefixedSeverityMatch[2]}`,
        ),
      );
      continue;
    }
    if (/^[-*]\s+/.test(trimmed)) {
      formattedLines.push(...formatReviewIssueBullet(severity, trimmed));
    }
  }
  return formattedLines;
};

const reviewPlanLine = (lines: string[]): string[] => {
  const planLine = trimBlankLines(lines)[0]?.replace(/^`+|`+$/g, "");
  if (!planLine) {
    return [];
  }
  const linkMatch = planLine.match(/^\[([^\]]+)\]\([^)]+\)$/);
  return [`\`${linkMatch?.[1] ?? planLine}\``];
};

const nextSectionLines = (lines: string[]): string[] => {
  const trimmedLines = trimBlankLines(lines).filter(
    (line) => line.trim().length > 0,
  );
  for (let index = 0; index < trimmedLines.length; index += 1) {
    const labelMatch = trimmedLines[index]
      .trim()
      .match(/^Workflow State:\s*(.*)$/i);
    if (!labelMatch) {
      continue;
    }
    const inlineValue = labelMatch[1].trim();
    const nextValue =
      inlineValue.length > 0 ? inlineValue : trimmedLines[index + 1]?.trim();
    if (!nextValue || /^Workflow State:\s*/i.test(nextValue)) {
      continue;
    }
    const workflowState = nextValue
      .replace(/^[-*]\s+/, "")
      .replace(/^`+|`+$/g, "");
    return [`Workflow State: \`${workflowState}\``];
  }

  const transitionLine = trimmedLines[0];
  const workflowState = transitionLine?.match(/(?:->|=)\s*([a-z-]+)\s*$/)?.[1];
  if (!workflowState) {
    return [];
  }
  return [`Workflow State: \`${workflowState}\``];
};

const reviewSummaryLines = (lines: string[]): string[] => {
  return boundedSectionLines(lines, TERMINAL_FILE_DETAIL_LIMIT);
};

type WorkflowSummarySection = [heading: string, lines: string[]];

const hasWorkflowSummaryLines = (section: WorkflowSummarySection): boolean => {
  return section[1].length > 0;
};

const formatWorkflowReviewSummary = (trimmedText: string): string | null => {
  if (
    !trimmedText.includes("**Plan**") ||
    !trimmedText.includes("**Summary**") ||
    !trimmedText.includes("**Issues**") ||
    !trimmedText.includes("**Final Verdict**")
  ) {
    return null;
  }

  const sections = parseWorkflowSections(
    trimmedText,
    workflowSummarySectionHeading,
  );
  const outputSections: WorkflowSummarySection[] = [
    ["Plan", reviewPlanLine(sections.get("Plan") ?? [])],
    ["Summary", reviewSummaryLines(sections.get("Summary") ?? [])],
    ["Issues", formatReviewIssues(sections.get("Issues") ?? [])],
    ["Final Verdict", trimBlankLines(sections.get("Final Verdict") ?? [])],
    ["Next", nextSectionLines(sections.get("Next") ?? [])],
  ];

  return outputSections
    .filter(hasWorkflowSummaryLines)
    .flatMap(([heading, lines], index) => [
      ...(index > 0 ? [""] : []),
      `**${heading}**`,
      ...lines,
    ])
    .join("\n")
    .trimEnd();
};

const approvalPreviewSectionHeadings = [
  "Plan",
  "Summary",
  "Key Details",
  "Code Preview",
  "Next",
  "Waiting for Approval",
] as const;

const formatWorkflowApprovalPreviewSummary = (
  trimmedText: string,
  color = false,
): string | null => {
  if (
    !trimmedText.includes("**Summary**") ||
    !trimmedText.includes("APPROVAL REQUIRED") ||
    !trimmedText.includes("**Code Preview**")
  ) {
    return null;
  }

  const sections = parseWorkflowSections(
    trimmedText,
    workflowSummarySectionHeading,
  );
  const summaryLines = trimBlankLines(sections.get("Summary") ?? []);
  if (!summaryLines.some((line) => line.includes("APPROVAL REQUIRED"))) {
    return null;
  }

  const sectionLines = (
    heading: (typeof approvalPreviewSectionHeadings)[number],
  ) => {
    if (heading === "Next") {
      return nextSectionLines(sections.get("Next") ?? []);
    }
    if (heading === "Code Preview") {
      return formatCodePreviewLines({
        lines: sections.get("Code Preview") ?? [],
        color,
        highlightTsxLine: highlightTsxCodePreviewLine,
      });
    }
    return trimBlankLines(sections.get(heading) ?? []);
  };

  return approvalPreviewSectionHeadings
    .map((heading): WorkflowSummarySection => [heading, sectionLines(heading)])
    .filter(hasWorkflowSummaryLines)
    .flatMap(([heading, lines], index) => [
      ...(index > 0 ? [""] : []),
      `**${heading}**`,
      ...lines,
    ])
    .join("\n")
    .trimEnd();
};

const formatSharedKeyDetails = (lines: string[]): string[] => {
  const keyDetails = trimBlankLines(lines).filter((line) => {
    const trimmed = line.trim();
    if (trimmed.length === 0) {
      return false;
    }
    if (/\bsub-agents?\b/i.test(trimmed)) {
      return false;
    }
    if (/^\*?\s*Branch:/i.test(trimmed)) {
      return false;
    }
    return true;
  });
  return keyDetails.slice(0, 5);
};

export const formatWorkflowSharedSummary = (
  trimmedText: string,
): string | null => {
  if (
    !trimmedText.includes("**Plan**") ||
    !trimmedText.includes("**Summary**") ||
    !trimmedText.includes("**Key Details**") ||
    !trimmedText.includes("**Next**")
  ) {
    return null;
  }

  const sections = parseWorkflowSections(
    trimmedText,
    workflowSummarySectionHeading,
  );
  const validationLines = trimBlankLines(sections.get("Validation") ?? []).map(
    compactWorkflowValidationLine,
  );
  const outputSections: WorkflowSummarySection[] = [
    ["Plan", trimBlankLines(sections.get("Plan") ?? [])],
    [
      "Summary",
      boundedSectionLines(
        sections.get("Summary") ?? [],
        TERMINAL_FILE_DETAIL_LIMIT + 1,
      ),
    ],
    ["Key Details", formatSharedKeyDetails(sections.get("Key Details") ?? [])],
    ["Validation", validationLines],
    ["Next", nextSectionLines(sections.get("Next") ?? [])],
  ];

  return outputSections
    .filter(hasWorkflowSummaryLines)
    .flatMap(([heading, lines], index) => [
      ...(index > 0 ? [""] : []),
      `**${heading}**`,
      ...lines,
    ])
    .join("\n")
    .trimEnd();
};

export const formatWorkflowAgentSummary = (text: string, color = false): string => {
  const trimmedText = text.trimEnd();
  return (
    formatWorkflowApprovalPreviewSummary(trimmedText, color) ??
    formatWorkflowReviewSummary(trimmedText) ??
    formatWorkflowSharedSummary(trimmedText) ??
    trimmedText
  );
};

const formatWorkflowApprovalPreviewOnly = (
  text: string,
  color = false,
): string | null => formatWorkflowApprovalPreviewSummary(text.trimEnd(), color);

export const formatSubagentApprovalPreviewMessages = (
  item: Record<string, unknown>,
  color = false,
): string[] => {
  const agentsStates = Array.isArray(item.agents_states)
    ? item.agents_states
    : [];
  return agentsStates
    .map((state) => {
      const message = asRecord(state)?.message;
      return typeof message === "string"
        ? formatWorkflowApprovalPreviewOnly(message, color)
        : null;
    })
    .filter((message): message is string => Boolean(message));
};

export const formatCommandTerminalOutput = (
  command: string,
  text: string,
  exitCode: CommandExitCode,
  color = false,
): string => {
  const stats = terminalOutputStats(text);
  if (exitCode === 0) {
    return formatPassedCommandTerminalBlock(command, stats, color);
  }
  if (!stats) {
    return "";
  }
  return formatFailedCommandTerminalBlockForCommand(command, stats.output);
};

export const formatTerminalEventBlock = (body: string): string =>
  body ? `${body.trimEnd()}\n\n` : "";

export const formatWorkflowElapsedTime = (durationMs: number): string => {
  const totalSeconds = Math.max(0, Math.floor(durationMs / 1000));
  const seconds = totalSeconds % 60;
  const totalMinutes = Math.floor(totalSeconds / 60);
  const minutes = totalMinutes % 60;
  const hours = Math.floor(totalMinutes / 60);
  if (hours > 0) {
    return `${hours}h ${String(minutes).padStart(2, "0")}m ${String(seconds).padStart(2, "0")}s`;
  }
  if (totalMinutes > 0) {
    return `${totalMinutes}m ${String(seconds).padStart(2, "0")}s`;
  }
  return `${seconds}s`;
};

const formatEditedFileSummaryLine = (
  summary: EditedFileSummary,
  color = false,
): string => {
  const formattedAction = formatTerminalAction(summary.action, color);
  const additions = `+${summary.additions}`;
  const deletions = `-${summary.deletions}`;
  const formattedAdditions = color
    ? `${terminalLabelStyles.diffAdded}${additions}${ANSI_RESET}`
    : additions;
  const formattedDeletions = color
    ? `${terminalLabelStyles.diffDeleted}${deletions}${ANSI_RESET}`
    : deletions;
  return `* ${formattedAction} ${summary.path} (${formattedAdditions} ${formattedDeletions})`;
};

export const formatEditedFilesForTerminal = (
  summaries: EditedFileSummary[],
  color = false,
): string =>
  summaries
    .map((summary) => formatEditedFileSummaryLine(summary, color))
    .join("\n");

export const formatEditedFilesForLog = (
  summaries: EditedFileSummary[],
): string | undefined => {
  if (summaries.length === 0) {
    return undefined;
  }
  return summaries
    .map((summary, index) => {
      const line = `${summary.action} ${summary.path} (+${summary.additions} -${summary.deletions})`;
      return index === 0 ? line : `    ${line}`;
    })
    .join("\n");
};

export const formatCommandFailureHeadline = (
  command: string,
  exitCode: CommandExitCode,
  color = false,
): string => {
  const exitDescription = exitCode === "unknown" ? "unknown" : String(exitCode);
  const failedTestSummary = summarizeFailedTestCommand(command);
  const commandSummary = commandTerminalSummary(command);
  const commandLabel =
    failedTestSummary?.label ?? commandSummary.failureLabel ?? command;
  return `${formatTerminalLabel("[failed]", "commandFailed", color)} ${commandLabel} (exit ${exitDescription})`;
};

const terminalPathMarkers = [
  "/.ai/",
  "/apps/",
  "/packages/",
  "/src/",
  "/docs/",
  "/supabase/",
  "/scripts/",
  "/tests/",
  "/e2e/",
];

const displayPathForTerminal = (filePath: string): string => {
  const slashPath = filePath.replace(/\\/g, "/");
  const relativePath = path.isAbsolute(filePath)
    ? path.relative(process.cwd(), filePath).replace(/\\/g, "/")
    : slashPath;
  if (!relativePath.startsWith("../") && relativePath !== "..") {
    return relativePath;
  }

  for (const marker of terminalPathMarkers) {
    const markerIndex = slashPath.lastIndexOf(marker);
    if (markerIndex >= 0) {
      return slashPath.slice(markerIndex + 1);
    }
  }

  return relativePath;
};

const applyPatchVerificationFailureSummary = (
  text: string,
  color = false,
): string | null => {
  const match = text.match(
    /ERROR codex_core::tools::router: error=apply_patch verification failed: Failed to find expected lines in (.+?):/,
  );
  if (!match) {
    return null;
  }

  const absoluteOrRelativeFile = match[1] ?? "";
  const file = displayPathForTerminal(absoluteOrRelativeFile);
  const contextStart =
    match.index === undefined ? 0 : match.index + match[0].length;
  const missingContextLine = text
    .slice(contextStart)
    .split(/\r?\n/)
    .map((line) => line.trim())
    .find(Boolean);
  const contextLines = missingContextLine
    ? ["", "Patch context not found:", missingContextLine]
    : [];

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
  applyPatchVerificationFailureSummary(text, color) ??
  text.replace(
    /(^|\n)(Reading additional input from stdin\.\.\.)(\r?\n|$)/g,
    "$1$2\n\n",
  );


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
