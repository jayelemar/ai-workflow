import { boundedInlineExcerpt, type Failure, type PlanTask } from '../types.ts';
import type { WorkflowState } from "../../contracts/stage.ts";

export const uniquePaths = (paths: string[]): string[] => [...new Set(paths)];

const targetSubheadings = new Set([
  '### Created files',
  '### Modified files',
  '### Deleted files',
]);
const noReviewStagingPathPlaceholders = new Set([
  'none',
  'n/a',
  'na',
  'no file',
  'no files',
  'not applicable',
]);

const parsePlanFileBulletValue = (trimmedLine: string): string | null => {
  if (trimmedLine === '*') return '';
  if (trimmedLine.startsWith('*')) return trimmedLine.replace(/^\*\s?/, '').trim();
  if (trimmedLine === '-') return '';
  const hyphenBulletMatch = trimmedLine.match(/^-\s+(.+)$/);
  return hyphenBulletMatch ? hyphenBulletMatch[1].trim() : null;
};

const unwrapParenthesizedValue = (value: string): string => {
  let unwrapped = value.trim();
  while (unwrapped.length >= 2 && unwrapped.startsWith('(') && unwrapped.endsWith(')')) {
    unwrapped = unwrapped.slice(1, -1).trim();
  }
  return unwrapped;
};

const isNoPlanFilePathPlaceholder = (value: string): boolean =>
  noReviewStagingPathPlaceholders.has(unwrapParenthesizedValue(value).toLowerCase());
export const planSectionLines = (content: string, heading: string): string[] => {
  const lines = content.split(/\r?\n/);
  const start = lines.findIndex((line) => line.trim() === heading);
  if (start === -1) {
    return [];
  }
  const collected: string[] = [];
  for (const line of lines.slice(start + 1)) {
    if (line.trim().startsWith("## ")) {
      break;
    }
    collected.push(line);
  }
  return collected;
};

export const parsePlanTasks = (content: string): PlanTask[] => {
  const tasks: PlanTask[] = [];
  const seen = new Set<string>();
  const taskPattern =
    /^\s*\d+\.\s+\[task:([0-9]{2}-[a-z0-9]+(?:-[a-z0-9]+)*)\]\s+(.+?)\s*$/;

  for (const line of content.split(/\r?\n/)) {
    const match = line.match(taskPattern);
    if (!match) {
      continue;
    }
    const id = match[1];
    if (seen.has(id)) {
      continue;
    }
    seen.add(id);
    const name = match[2].trim();
    const words = id.replace(/^[0-9]{2}-/, "");
    tasks.push({
      id,
      words,
      name,
      artifactWords: words,
    });
  }

  return tasks;
};

type ParsedTaskCommitBoundaries = {
  declared: boolean;
  boundaries: Array<{
    number: number;
    patterns: string[];
  }>;
};

export const parseTaskCommitBoundaries = (
  planContent: string,
  taskId: string,
): ParsedTaskCommitBoundaries => {
  const lines = planSectionLines(planContent, "## Commit Boundaries");
  const taskHeading = `### [task:${taskId}]`;
  const taskStart = lines.findIndex((line) => line.trim() === taskHeading);
  if (taskStart === -1) {
    return { declared: false, boundaries: [] };
  }

  const boundaries: ParsedTaskCommitBoundaries["boundaries"] = [];
  let currentBoundary: (typeof boundaries)[number] | undefined;
  for (const line of lines.slice(taskStart + 1)) {
    if (line.trim().startsWith("### ")) {
      break;
    }
    const boundary = line.match(/^\s*(\d+)\.\s+\S/);
    if (boundary) {
      currentBoundary = {
        number: Number(boundary[1]),
        patterns: [...line.matchAll(/`([^`]+)`/g)].map((match) => match[1]),
      };
      boundaries.push(currentBoundary);
      continue;
    }
    if (currentBoundary) {
      currentBoundary.patterns.push(
        ...[...line.matchAll(/`([^`]+)`/g)].map((match) => match[1]),
      );
    }
  }

  return { declared: true, boundaries };
};

export const taskCommitBoundaryCount = (
  planContent: string,
  taskId: string,
): number | undefined => {
  const { boundaries } = parseTaskCommitBoundaries(planContent, taskId);
  return boundaries.length >= 2 ? boundaries.length : undefined;
};

const expandCommitBoundaryPattern = (pattern: string): string[] => {
  const brace = pattern.match(/\{([^{}]+)\}/);
  if (!brace || brace.index === undefined) {
    return [pattern];
  }
  return brace[1]
    .split(",")
    .flatMap((value) =>
      expandCommitBoundaryPattern(
        `${pattern.slice(0, brace.index)}${value}${pattern.slice(brace.index + brace[0].length)}`,
      ),
    );
};

const commitBoundaryPatternMatchesPath = (
  pattern: string,
  filePath: string,
): boolean => {
  let expression = "^";
  for (let index = 0; index < pattern.length; index += 1) {
    const character = pattern[index];
    if (character === "*") {
      if (pattern[index + 1] === "*") {
        expression += ".*";
        index += 1;
      } else {
        expression += "[^/]*";
      }
      continue;
    }
    expression += character.replace(/[|\\{}()[\]^$+?.]/g, "\\$&");
  }
  expression += "$";
  return new RegExp(expression).test(filePath);
};

export const validateTaskCommitBoundaries = ({
  planContent,
  taskId,
  planOwnedDirtyPaths,
}: {
  planContent: string;
  taskId: string;
  planOwnedDirtyPaths: string[];
}): { ok: true } | Failure => {
  const parsed = parseTaskCommitBoundaries(planContent, taskId);
  if (!parsed.declared) {
    return { ok: true };
  }
  if (parsed.boundaries.length < 2 || parsed.boundaries.length > 12) {
    return {
      ok: false,
      reason: `invalid commit boundaries for task ${taskId}: expected two to twelve boundaries, found ${parsed.boundaries.length}`,
    };
  }
  const emptyBoundaries = parsed.boundaries
    .filter((boundary) => boundary.patterns.length === 0)
    .map((boundary) => boundary.number);
  if (emptyBoundaries.length > 0) {
    return {
      ok: false,
      reason: `invalid commit boundaries for task ${taskId}: boundaries without paths: ${emptyBoundaries.join(", ")}`,
    };
  }

  const assignments = new Map<string, number[]>();
  for (const filePath of uniquePaths(planOwnedDirtyPaths)) {
    const matchingBoundaries = parsed.boundaries
      .filter((boundary) =>
        boundary.patterns
          .flatMap(expandCommitBoundaryPattern)
          .some((pattern) => commitBoundaryPatternMatchesPath(pattern, filePath)),
      )
      .map((boundary) => boundary.number);
    assignments.set(filePath, matchingBoundaries);
  }

  const unassigned = [...assignments.entries()]
    .filter(([, boundaries]) => boundaries.length === 0)
    .map(([filePath]) => filePath);
  const duplicated = [...assignments.entries()]
    .filter(([, boundaries]) => boundaries.length > 1)
    .map(([filePath, boundaries]) => `${filePath} (boundaries ${boundaries.join(", ")})`);
  if (unassigned.length === 0 && duplicated.length === 0) {
    return { ok: true };
  }

  const details = [
    unassigned.length > 0
      ? `unassigned plan-owned paths: ${boundedInlineExcerpt(unassigned.join(", "))}`
      : "",
    duplicated.length > 0
      ? `paths assigned more than once: ${boundedInlineExcerpt(duplicated.join(", "))}`
      : "",
  ].filter(Boolean);
  return {
    ok: false,
    reason: `invalid commit boundaries for task ${taskId}: ${details.join("; ")}`,
  };
};

const repoRelativeSpecPathPattern =
  /(^|[`(\s*-])((?!\/)(?!\.\.?\/)(?:[A-Za-z0-9._-]+\/)*[A-Za-z0-9._-]+\.spec\.md)(?=$|[`)\s])/g;

export const extractSpecPaths = (planContent: string): string[] => {
  const paths: string[] = [];
  for (const line of planSectionLines(planContent, "## Spec")) {
    for (const match of line.matchAll(repoRelativeSpecPathPattern)) {
      paths.push(match[2]);
    }
  }
  return uniquePaths(paths);
};

const planInstructionPathPattern =
  /\.ai\/instructions\/(?:[A-Za-z0-9_-]+\/)*[A-Za-z0-9_-]+\.md/g;

export const extractPlanInstructionPaths = (planContent: string): string[] =>
  uniquePaths([...planContent.matchAll(planInstructionPathPattern)].map((match) => match[0]));

export const extractPlanOwnedPaths = (planContent: string): string[] => {
  const paths: string[] = [];
  let activeSection = "";
  for (const line of planSectionLines(planContent, "## Files (MANDATORY)")) {
    const trimmed = line.trim();
    if (trimmed.startsWith("### ")) {
      activeSection = targetSubheadings.has(trimmed) ? trimmed : "";
      continue;
    }
    if (!activeSection || trimmed.length === 0) {
      continue;
    }
    const bulletValue = parsePlanFileBulletValue(trimmed);
    if (bulletValue === null) {
      activeSection = "";
      continue;
    }
    let value = bulletValue;
    if (isNoPlanFilePathPlaceholder(value)) {
      continue;
    }
    if (value.endsWith(" (assumed)")) {
      value = value.slice(0, -" (assumed)".length);
    }
    paths.push(value);
  }
  return uniquePaths(paths);
};

const escapeRegExp = (value: string): string =>
  value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

export const extractPlanOwnedFileSection = (planContent: string): string[] => {
  const lines = planSectionLines(planContent, "## Files (MANDATORY)");
  const trimmed = [...lines];
  while (trimmed[0]?.trim() === "") {
    trimmed.shift();
  }
  while (trimmed.at(-1)?.trim() === "") {
    trimmed.pop();
  }
  return trimmed;
};

export const extractFieldValue = (
  lines: string[],
  fieldName: string,
): string | undefined => {
  const pattern = new RegExp(
    `^\\*\\s*${escapeRegExp(fieldName)}:\\s*(.+)$`,
    "i",
  );
  for (const line of lines) {
    const match = line.trim().match(pattern);
    if (match) {
      return boundedInlineExcerpt(match[1]);
    }
  }
  return undefined;
};

export const extractNestedListItems = (
  lines: string[],
  fieldName: string,
  limit = 5,
): string[] => {
  const pattern = new RegExp(`^\\*\\s*${escapeRegExp(fieldName)}:\\s*$`, "i");
  const values: string[] = [];
  let collecting = false;

  for (const line of lines) {
    const trimmed = line.trim();
    if (pattern.test(trimmed)) {
      collecting = true;
      continue;
    }
    if (!collecting) {
      continue;
    }
    if (/^###\s+/.test(trimmed)) {
      break;
    }
    if (/^\*\s+/.test(trimmed) && !/^\s+/.test(line)) {
      break;
    }
    const bulletMatch = trimmed.match(/^(?:[-*]|\d+\.)\s+(.+)$/);
    if (!bulletMatch) {
      continue;
    }
    const value = boundedInlineExcerpt(bulletMatch[1]);
    if (value) {
      values.push(value);
      if (values.length >= limit) {
        break;
      }
    }
  }

  return values;
};

export const summarizeMeaningfulLines = (lines: string[], limit = 5): string[] => {
  const values: string[] = [];
  let inCodeFence = false;
  for (const line of lines) {
    const trimmed = line.trim();
    if (trimmed.startsWith("```")) {
      inCodeFence = !inCodeFence;
      continue;
    }
    if (inCodeFence || trimmed.length === 0 || /^###\s+/.test(trimmed)) {
      continue;
    }
    const bulletMatch = trimmed.match(/^(?:[-*]|\d+\.)\s+(.+)$/);
    const candidate = bulletMatch ? bulletMatch[1] : trimmed;
    const excerpt = boundedInlineExcerpt(candidate);
    if (!excerpt) {
      continue;
    }
    values.push(excerpt);
    if (values.length >= limit) {
      break;
    }
  }
  return values;
};

export const extractVersionedSectionEntries = (
  content: string,
  heading: string,
): Array<{ heading: string; lines: string[] }> => {
  const lines = planSectionLines(content, heading);
  if (lines === null) {
    return [];
  }

  const entries: Array<{ heading: string; lines: string[] }> = [];
  let current: { heading: string; lines: string[] } | undefined;
  for (const line of lines) {
    const trimmed = line.trim();
    if (
      !current &&
      (trimmed.length === 0 || trimmed === "(empty)" || trimmed === "---")
    ) {
      continue;
    }
    if (trimmed.startsWith("### ")) {
      current = { heading: trimmed, lines: [] };
      entries.push(current);
      continue;
    }
    if (!current) {
      continue;
    }
    current.lines.push(line);
  }

  return entries.filter((entry) =>
    entry.lines.some((line) => line.trim().length > 0),
  );
};
export const extractSectionValue = (
  content: string,
  heading: string,
): string | null => {
  const lines = content.split(/\r?\n/);
  const headingIndex = lines.findIndex((line) => line.trim() === heading);
  if (headingIndex === -1) return null;
  for (const line of lines.slice(headingIndex + 1)) {
    const trimmed = line.trim();
    if (trimmed.startsWith('##')) return '';
    if (trimmed.length > 0) return trimmed;
  }
  return '';
};

export const normalizeWorkflowStateValue = (value: string): string =>
  value.replace(/^`+|`+$/g, '');

export const isWorkflowState = (value: string): value is WorkflowState =>
  ["draft-artifact-sync", "draft-validation", "approved", "active", "blocked", "review", "reopening", "completed"].includes(value);
