import type { WorkflowState } from "../contracts/stage.ts";
import { boundedInlineExcerpt } from "../types.ts";

const escapeRegExp = (value: string): string => value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

export const extractFieldValue = (lines: string[], fieldName: string): string | undefined => {
  const pattern = new RegExp(`^\\*\\s*${escapeRegExp(fieldName)}:\\s*(.+)$`, "i");
  for (const line of lines) {
    const match = line.trim().match(pattern);
    if (match) return boundedInlineExcerpt(match[1]);
  }
  return undefined;
};

export const extractNestedListItems = (lines: string[], fieldName: string, limit = 5): string[] => {
  const pattern = new RegExp(`^\\*\\s*${escapeRegExp(fieldName)}:\\s*$`, "i");
  const values: string[] = [];
  let collecting = false;
  for (const line of lines) {
    const trimmed = line.trim();
    if (pattern.test(trimmed)) { collecting = true; continue; }
    if (!collecting) continue;
    if (/^###\s+/.test(trimmed) || (/^\*\s+/.test(trimmed) && !/^\s+/.test(line))) break;
    const bulletMatch = trimmed.match(/^(?:[-*]|\d+\.)\s+(.+)$/);
    if (!bulletMatch) continue;
    const value = boundedInlineExcerpt(bulletMatch[1]);
    if (value) values.push(value);
    if (values.length >= limit) break;
  }
  return values;
};

export const summarizeMeaningfulLines = (lines: string[], limit = 5): string[] => {
  const values: string[] = [];
  let inCodeFence = false;
  for (const line of lines) {
    const trimmed = line.trim();
    if (trimmed.startsWith("```")) { inCodeFence = !inCodeFence; continue; }
    if (inCodeFence || trimmed.length === 0 || /^###\s+/.test(trimmed)) continue;
    const bulletMatch = trimmed.match(/^(?:[-*]|\d+\.)\s+(.+)$/);
    const excerpt = boundedInlineExcerpt(bulletMatch ? bulletMatch[1] : trimmed);
    if (excerpt) values.push(excerpt);
    if (values.length >= limit) break;
  }
  return values;
};

export const extractSectionValue = (content: string, heading: string): string | null => {
  const lines = content.split(/\r?\n/);
  const headingIndex = lines.findIndex((line) => line.trim() === heading);
  if (headingIndex === -1) return null;
  for (const line of lines.slice(headingIndex + 1)) {
    const trimmed = line.trim();
    if (trimmed.startsWith("##")) return "";
    if (trimmed.length > 0) return trimmed;
  }
  return "";
};

export const normalizeWorkflowStateValue = (value: string): string => value.replace(/^`+|`+$/g, "");
export const isWorkflowState = (value: string): value is WorkflowState => ["draft-artifact-sync", "draft-validation", "approved", "active", "blocked", "review", "reopening", "completed"].includes(value);
