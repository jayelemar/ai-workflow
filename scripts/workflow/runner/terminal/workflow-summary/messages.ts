import { asRecord } from "../../types.ts";
import { formatCodePreviewLines, highlightTsxCodePreviewLine } from "../code-preview.ts";
import { parseWorkflowSections, trimBlankLines, workflowSummarySectionHeading } from "./sections.ts";

const TERMINAL_FILE_DETAIL_LIMIT = 3;
type WorkflowSummarySection = [heading: string, lines: string[]];
const hasWorkflowSummaryLines = (section: WorkflowSummarySection): boolean => section[1].length > 0;

const compactWorkflowValidationLine = (line: string): string => {
  const knownLimitationPrefix = "* Known limitation: ";
  if (line.startsWith(knownLimitationPrefix)) return `* Deferred: ${line.slice(knownLimitationPrefix.length)}`;
  const commandMatch = line.match(/^\* `([^`]+)`: (.+)$/);
  if (!commandMatch) return line;
  const [, command, result] = commandMatch;
  const label = command.includes("@gondoor/backend test") && command.includes("test/onboarding/") ? "Backend onboarding spec"
    : command.includes("@gondoor/backend test") && command.includes("test/documents/") ? "Backend document spec"
    : command.includes("@gondoor/backend build") ? "Backend build"
    : command.includes("@gondoor/web exec vitest run") ? "Web docs tests" : null;
  return label ? `* ${label}: ${result}` : line;
};

const boundedSectionLines = (lines: string[], limit: number): string[] => {
  const visibleLines = trimBlankLines(lines).filter((line) => line.trim().length > 0);
  const shownLines = visibleLines.slice(0, limit);
  const hiddenLines = visibleLines.length - shownLines.length;
  return hiddenLines > 0 ? [...shownLines, `  +${hiddenLines} more`] : shownLines;
};

const sentenceWithPeriod = (text: string): string => {
  const trimmed = text.trim().replace(/[;,]$/, "");
  return /[.!?]$/.test(trimmed) ? trimmed : `${trimmed}.`;
};

const compactReviewIssueText = (severity: string, text: string): string => {
  const withoutExample = text.split(/\s+Example:/)[0]?.trim() ?? text.trim();
  if (severity === "Warning" && withoutExample.includes(":")) return sentenceWithPeriod(withoutExample.split(":")[0] ?? withoutExample);
  if (severity === "Suggestion") return sentenceWithPeriod(withoutExample.replace(/\s+around\s+.*$/i, ""));
  return sentenceWithPeriod(withoutExample);
};

const formatReviewIssueBullet = (severity: string, bulletLine: string): string[] => {
  const rawText = bulletLine.replace(/^[-*]\s+/, "").trim();
  const linkedIssueMatch = rawText.match(/^\[[^\]]+\]\((.+):(\d+)\):\s*(.+)$/);
  const issueText = linkedIssueMatch?.[3] ?? rawText.replace(/\[[^\]]+\]\([^)]+\)/g, "").trim();
  return [`* ${severity}: ${compactReviewIssueText(severity, issueText)}`];
};

const formatReviewIssues = (lines: string[]): string[] => {
  const formattedLines: string[] = [];
  let severity = "Issue";
  for (const line of lines) {
    const trimmed = line.trim();
    const severityMatch = trimmed.match(/^####\s+(.+)$/);
    if (severityMatch?.[1]) {
      severity = severityMatch[1].toLowerCase().replace(/^\w/, (char) => char.toUpperCase());
      continue;
    }
    const prefixedSeverityMatch = trimmed.match(/^[-*]\s*(Critical|Warning|Suggestion|Issue)\s*:\s*(.+)$/i);
    if (prefixedSeverityMatch) {
      const explicitSeverity = prefixedSeverityMatch[1].replace(/^\w/, (char) => char.toUpperCase());
      formattedLines.push(...formatReviewIssueBullet(explicitSeverity, `* ${prefixedSeverityMatch[2]}`));
    } else if (/^[-*]\s+/.test(trimmed)) {
      formattedLines.push(...formatReviewIssueBullet(severity, trimmed));
    }
  }
  return formattedLines;
};

const reviewPlanLine = (lines: string[]): string[] => {
  const planLine = trimBlankLines(lines)[0]?.replace(/^`+|`+$/g, "");
  if (!planLine) return [];
  const linkMatch = planLine.match(/^\[([^\]]+)\]\([^)]+\)$/);
  return [`\`${linkMatch?.[1] ?? planLine}\``];
};

const nextSectionLines = (lines: string[]): string[] => {
  const trimmedLines = trimBlankLines(lines).filter((line) => line.trim().length > 0);
  for (let index = 0; index < trimmedLines.length; index += 1) {
    const labelMatch = trimmedLines[index].trim().match(/^Workflow State:\s*(.*)$/i);
    if (!labelMatch) continue;
    const inlineValue = labelMatch[1].trim();
    const nextValue = inlineValue.length > 0 ? inlineValue : trimmedLines[index + 1]?.trim();
    if (!nextValue || /^Workflow State:\s*/i.test(nextValue)) continue;
    const workflowState = nextValue.replace(/^[-*]\s+/, "").replace(/^`+|`+$/g, "");
    return [`Workflow State: \`${workflowState}\``];
  }
  const workflowState = trimmedLines[0]?.match(/(?:->|=)\s*([a-z-]+)\s*$/)?.[1];
  return workflowState ? [`Workflow State: \`${workflowState}\``] : [];
};

const formatSections = (sections: WorkflowSummarySection[]): string => sections.filter(hasWorkflowSummaryLines).flatMap(([heading, lines], index) => [...(index > 0 ? [""] : []), `**${heading}**`, ...lines]).join("\n").trimEnd();

const formatWorkflowReviewSummary = (trimmedText: string): string | null => {
  if (!["**Plan**", "**Summary**", "**Issues**", "**Final Verdict**"].every((heading) => trimmedText.includes(heading))) return null;
  const sections = parseWorkflowSections(trimmedText, workflowSummarySectionHeading);
  return formatSections([
    ["Plan", reviewPlanLine(sections.get("Plan") ?? [])],
    ["Summary", boundedSectionLines(sections.get("Summary") ?? [], TERMINAL_FILE_DETAIL_LIMIT)],
    ["Issues", formatReviewIssues(sections.get("Issues") ?? [])],
    ["Final Verdict", trimBlankLines(sections.get("Final Verdict") ?? [])],
    ["Next", nextSectionLines(sections.get("Next") ?? [])],
  ]);
};

const approvalPreviewSectionHeadings = ["Plan", "Summary", "Key Details", "Code Preview", "Next", "Waiting for Approval"] as const;
const formatWorkflowApprovalPreviewSummary = (trimmedText: string, color = false): string | null => {
  if (!["**Summary**", "APPROVAL REQUIRED", "**Code Preview**"].every((heading) => trimmedText.includes(heading))) return null;
  const sections = parseWorkflowSections(trimmedText, workflowSummarySectionHeading);
  const summaryLines = trimBlankLines(sections.get("Summary") ?? []);
  if (!summaryLines.some((line) => line.includes("APPROVAL REQUIRED"))) return null;
  const sectionLines = (heading: (typeof approvalPreviewSectionHeadings)[number]): string[] => heading === "Next"
    ? nextSectionLines(sections.get("Next") ?? [])
    : heading === "Code Preview" ? formatCodePreviewLines({ lines: sections.get("Code Preview") ?? [], color, highlightTsxLine: highlightTsxCodePreviewLine })
    : trimBlankLines(sections.get(heading) ?? []);
  return formatSections(approvalPreviewSectionHeadings.map((heading): WorkflowSummarySection => [heading, sectionLines(heading)]));
};

const formatSharedKeyDetails = (lines: string[]): string[] => trimBlankLines(lines).filter((line) => {
  const trimmed = line.trim();
  return trimmed.length > 0 && !/\bsub-agents?\b/i.test(trimmed) && !/^\*?\s*Branch:/i.test(trimmed);
}).slice(0, 5);

export const formatWorkflowSharedSummary = (trimmedText: string): string | null => {
  if (!["**Plan**", "**Summary**", "**Key Details**", "**Next**"].every((heading) => trimmedText.includes(heading))) return null;
  const sections = parseWorkflowSections(trimmedText, workflowSummarySectionHeading);
  return formatSections([
    ["Plan", trimBlankLines(sections.get("Plan") ?? [])],
    ["Summary", boundedSectionLines(sections.get("Summary") ?? [], TERMINAL_FILE_DETAIL_LIMIT + 1)],
    ["Key Details", formatSharedKeyDetails(sections.get("Key Details") ?? [])],
    ["Validation", trimBlankLines(sections.get("Validation") ?? []).map(compactWorkflowValidationLine)],
    ["Next", nextSectionLines(sections.get("Next") ?? [])],
  ]);
};

export const formatWorkflowAgentSummary = (text: string, color = false): string => {
  const trimmedText = text.trimEnd();
  return formatWorkflowApprovalPreviewSummary(trimmedText, color) ?? formatWorkflowReviewSummary(trimmedText) ?? formatWorkflowSharedSummary(trimmedText) ?? trimmedText;
};

export const formatSubagentApprovalPreviewMessages = (item: Record<string, unknown>, color = false): string[] => {
  const agentsStates = Array.isArray(item.agents_states) ? item.agents_states : [];
  return agentsStates.map((state) => {
    const message = asRecord(state)?.message;
    return typeof message === "string" ? formatWorkflowApprovalPreviewSummary(message.trimEnd(), color) : null;
  }).filter((message): message is string => Boolean(message));
};
