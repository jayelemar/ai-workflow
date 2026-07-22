import {
  planSectionLines as sectionLines,
  summarizeMeaningfulLines,
} from "./parser.ts";
import {
  isFiniteNumber,
  type WorkflowContextSnapshotTokenUsage,
} from "../types.ts";

export const extractCurrentPhaseSummary = (planContent: string): string[] => {
  for (const heading of [
    "## Current Phase",
    "## Current Implementation Status",
    "## Summary",
    "## Verification Status",
  ]) {
    const lines = sectionLines(planContent, heading);
    if (lines === null) continue;
    const summary = summarizeMeaningfulLines(lines);
    if (summary.length > 0) return summary;
  }
  return [];
};

export const summarizeLatestTokenUsage = (
  latest?: WorkflowContextSnapshotTokenUsage,
): string[] => {
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

export const formatSnapshotSection = (
  heading: string,
  items: string[],
  empty = "(none)",
): string =>
  `${heading}\n${items.length > 0 ? items.map((item) => `* ${item}`).join("\n") : empty}`;
