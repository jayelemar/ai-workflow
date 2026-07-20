import { boundedInlineExcerpt, isFiniteNumber, type WorkflowContextSnapshotTokenUsage } from "../types.ts";
import {
  extractFieldValue,
  extractNestedListItems,
  extractSectionValue,
  extractVersionedSectionEntries,
  planSectionLines as sectionLines,
  summarizeMeaningfulLines,
} from "./parser.ts";

export const extractCurrentPhaseSummary = (planContent: string): string[] => {
  for (const heading of ["## Current Phase", "## Current Implementation Status", "## Summary", "## Verification Status"]) {
    const lines = sectionLines(planContent, heading);
    if (lines === null) continue;
    const summary = summarizeMeaningfulLines(lines);
    if (summary.length > 0) return summary;
  }
  const latest = extractVersionedSectionEntries(planContent, "## Execution Log").at(-1);
  return latest ? summarizeMeaningfulLines(latest.lines) : [];
};

export const extractLatestExecutionSummary = (planContent: string): string[] => {
  const latest = extractVersionedSectionEntries(planContent, "## Execution Log").at(-1);
  return latest ? summarizeMeaningfulLines(latest.lines) : [];
};

export const extractLatestValidationSummary = (planContent: string): { result?: string; details: string[] } => {
  const latest = extractVersionedSectionEntries(planContent, "## Validation History").at(-1);
  if (!latest) return { details: [] };
  const details = [
    ...extractNestedListItems(latest.lines, "Critical Issues"),
    ...extractNestedListItems(latest.lines, "Warnings"),
    ...extractNestedListItems(latest.lines, "Notes"),
  ];
  if (details.length === 0) details.push(...summarizeMeaningfulLines(latest.lines.filter((line) => !/^\*\s*(Result|Recommendation):/i.test(line.trim()))));
  return { result: extractFieldValue(latest.lines, "Result"), details: details.slice(0, 5) };
};

export const extractLatestReviewSummary = (planContent: string): { heading?: string; summary?: string; decision?: string; evidence?: string; unresolvedFindings: string[] } => {
  const latest = extractVersionedSectionEntries(planContent, "## Review History").at(-1);
  if (!latest) return { unresolvedFindings: [] };
  return {
    heading: latest.heading.startsWith("### ") ? latest.heading.replace(/^###\s+/, "") : undefined,
    summary: extractFieldValue(latest.lines, "Summary"),
    decision: extractFieldValue(latest.lines, "Decision"),
    evidence: extractFieldValue(latest.lines, "Evidence"),
    unresolvedFindings: extractNestedListItems(latest.lines, "Issues").filter((value) => !/^resolved:/i.test(value)).slice(0, 5),
  };
};

export const extractLatestReviewRemediationContext = (planContent: string): string[] => {
  if (extractSectionValue(planContent, "## Workflow State") !== "active") return [];
  const review = extractLatestReviewSummary(planContent);
  if (review.unresolvedFindings.length === 0 && !review.evidence) return [];
  const context: string[] = [];
  if (review.heading) context.push(`Source Review: ${review.heading}`);
  if (review.summary) context.push(`Summary: ${review.summary}`);
  if (review.decision) context.push(`Decision: ${review.decision}`);
  if (review.evidence) context.push(`Evidence: ${review.evidence}`);
  return [...context, ...review.unresolvedFindings];
};

const extractActiveBlockers = (planContent: string): string[] => {
  const lines = sectionLines(planContent, "## Blockers");
  if (lines === null) return [];
  const blockers: Array<{ heading: string; lines: string[] }> = [];
  const explicit = lines.some((line) => /^###\s+Blocker\b/i.test(line.trim()));
  let current: { heading: string; lines: string[] } | undefined;
  for (const line of lines) {
    const trimmed = line.trim();
    if (/^###\s+Blocker\b/i.test(trimmed)) { current = { heading: trimmed, lines: [] }; blockers.push(current); continue; }
    if (explicit) { current?.lines.push(line); continue; }
    current ??= { heading: "## Blockers", lines: [] };
    if (!blockers.includes(current)) blockers.push(current);
    current.lines.push(line);
  }
  return blockers.filter((blocker) => !/^resolved$/i.test(extractFieldValue(blocker.lines, "Status") ?? ""))
    .map((blocker) => boundedInlineExcerpt([blocker.heading.replace(/^###\s+/, ""), extractFieldValue(blocker.lines, "Description"), extractFieldValue(blocker.lines, "Required Action"), extractFieldValue(blocker.lines, "Next Step")].filter((value): value is string => typeof value === "string").join(" | ")))
    .filter((value): value is string => typeof value === "string").slice(0, 5);
};

export const extractSnapshotActiveBlockers = (planContent: string): string[] =>
  extractActiveBlockers(planContent).filter((blocker) => blocker !== "## Blockers");

export const summarizeLatestTokenUsage = (latest?: WorkflowContextSnapshotTokenUsage): string[] => {
  if (!latest) return [];
  const lines: string[] = [];
  if (isFiniteNumber(latest.iteration)) lines.push(`Iteration: ${latest.iteration}`);
  if (typeof latest.promptPath === "string" && latest.promptPath.length > 0) lines.push(`Prompt: ${latest.promptPath}`);
  if (isFiniteNumber(latest.stageInputTokens)) lines.push(`Stage Input Tokens: ${latest.stageInputTokens}`);
  if (isFiniteNumber(latest.stageUncachedInputTokens)) lines.push(`Stage Uncached Input Tokens: ${latest.stageUncachedInputTokens}`);
  if (isFiniteNumber(latest.stageOutputTokens)) lines.push(`Stage Output Tokens: ${latest.stageOutputTokens}`);
  if (isFiniteNumber(latest.stageTotalTokens)) lines.push(`Stage Total Tokens: ${latest.stageTotalTokens}`);
  if (isFiniteNumber(latest.totalTokens)) lines.push(`Cumulative Total Tokens: ${latest.totalTokens}`);
  return lines.slice(0, 6);
};

export const formatSnapshotSection = (heading: string, items: string[], empty = "(none)"): string =>
  `${heading}\n${items.length > 0 ? items.map((item) => `* ${item}`).join("\n") : empty}`;
