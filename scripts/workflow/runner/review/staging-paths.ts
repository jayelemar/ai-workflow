import { stat } from "node:fs/promises";
import path from "node:path";
import type {
  Failure,
  ReviewStagingOptions,
  ReviewStagingResult,
} from "../types.ts";

const targetSubheadings = new Set([
  "### Created files",
  "### Modified files",
  "### Deleted files",
]);
const noReviewStagingPathPlaceholders = new Set([
  "none",
  "n/a",
  "na",
  "no file",
  "no files",
  "not applicable",
]);
const trailingPlanPathAnnotationPattern = /\s+\(([^)]+)\)$/;

const uniquePaths = (paths: string[]): string[] => [...new Set(paths)];

const sectionLines = (content: string, heading: string): string[] | null => {
  const lines = content.split(/\r?\n/);
  const start = lines.findIndex((line) => line.trim() === heading);
  if (start === -1) {
    return null;
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

export const validateConcretePlanFilePath = async ({
  value,
  rootDir,
  reasonPrefix,
}: {
  value: string;
  rootDir: string;
  reasonPrefix: string;
}): Promise<{ ok: true; path: string } | Failure> => {
  if (value.length === 0) {
    return { ok: false, reason: `${reasonPrefix} is empty` };
  }
  const trailingAnnotation = value
    .match(trailingPlanPathAnnotationPattern)?.[1]
    ?.trim()
    .toLowerCase();
  if (trailingAnnotation !== undefined && trailingAnnotation !== "assumed") {
    return {
      ok: false,
      reason: `${reasonPrefix} contains annotation; Files (MANDATORY) entries must be exact file paths: ${value}`,
    };
  }
  if (path.isAbsolute(value)) {
    return { ok: false, reason: `${reasonPrefix} is absolute: ${value}` };
  }
  if (value.includes("..")) {
    return { ok: false, reason: `${reasonPrefix} contains ..: ${value}` };
  }
  try {
    const pathStat = await stat(path.join(rootDir, value));
    if (pathStat.isDirectory()) {
      return {
        ok: false,
        reason: `${reasonPrefix} is an existing directory: ${value}`,
      };
    }
  } catch {
    // Deleted paths may not exist, and created paths may be staged before commit.
  }
  return { ok: true, path: value };
};

export const parseReviewStagingBulletValue = (
  trimmedLine: string,
): string | null => {
  if (trimmedLine === "*") {
    return "";
  }
  if (trimmedLine.startsWith("*")) {
    return trimmedLine.replace(/^\*\s?/, "").trim();
  }
  if (trimmedLine === "-") {
    return "";
  }
  const hyphenBulletMatch = trimmedLine.match(/^-\s+(.+)$/);
  return hyphenBulletMatch ? hyphenBulletMatch[1].trim() : null;
};

const unwrapParenthesizedValue = (value: string): string => {
  let unwrapped = value.trim();
  while (
    unwrapped.length >= 2 &&
    unwrapped.startsWith("(") &&
    unwrapped.endsWith(")")
  ) {
    unwrapped = unwrapped.slice(1, -1).trim();
  }
  return unwrapped;
};

export const isNoReviewStagingPathPlaceholder = (value: string): boolean =>
  noReviewStagingPathPlaceholders.has(
    unwrapParenthesizedValue(value).toLowerCase(),
  );

export const parseTransferredFileOwnershipReleasePaths = async (
  content: string,
  rootDir: string,
): Promise<ReviewStagingResult> => {
  const lines = sectionLines(content, "## File Ownership Releases");
  if (lines === null) {
    return { ok: true, paths: [] };
  }

  const releases: Array<{ file?: string; transferred: boolean }> = [];
  let current: { file?: string; transferred: boolean } | undefined;
  const ensureCurrent = () => {
    current ??= { transferred: false };
    if (!releases.includes(current)) {
      releases.push(current);
    }
    return current;
  };

  for (const line of lines) {
    const trimmed = line.trim();
    if (trimmed.startsWith("### ")) {
      current = { transferred: false };
      releases.push(current);
      continue;
    }

    const fileMatch = trimmed.match(/^\*\s*File:\s*(.*)$/i);
    if (fileMatch) {
      ensureCurrent().file = fileMatch[1].trim();
      continue;
    }

    const statusMatch = trimmed.match(/^\*\s*Status:\s*(.+)$/i);
    if (statusMatch && statusMatch[1].trim().toLowerCase() === "transferred") {
      ensureCurrent().transferred = true;
    }
  }

  const paths: string[] = [];
  for (const release of releases) {
    if (release.file === undefined) {
      continue;
    }
    const validated = await validateConcretePlanFilePath({
      value: release.file,
      rootDir,
      reasonPrefix: "file ownership release path",
    });
    if (!validated.ok) {
      return validated;
    }
    if (release.transferred) {
      paths.push(validated.path);
    }
  }

  return { ok: true, paths: uniquePaths(paths) };
};

export const parseReviewStagingPaths = async ({
  content,
  rootDir = process.cwd(),
  isIgnored = async () => false,
}: ReviewStagingOptions): Promise<ReviewStagingResult> => {
  const lines = sectionLines(content, "## Files (MANDATORY)");
  if (lines === null) {
    return { ok: false, reason: "plan is missing ## Files (MANDATORY)" };
  }

  const candidates: string[] = [];
  let activeSection = "";
  for (const line of lines) {
    const trimmed = line.trim();
    if (trimmed.startsWith("### ")) {
      activeSection = targetSubheadings.has(trimmed) ? trimmed : "";
      continue;
    }
    if (!activeSection || trimmed.length === 0) {
      continue;
    }
    const bulletValue = parseReviewStagingBulletValue(trimmed);
    if (bulletValue === null) {
      activeSection = "";
      continue;
    }
    let value = bulletValue;
    if (isNoReviewStagingPathPlaceholder(value)) {
      continue;
    }
    if (value.endsWith(" (assumed)")) {
      value = value.slice(0, -" (assumed)".length);
    }
    const validated = await validateConcretePlanFilePath({
      value,
      rootDir,
      reasonPrefix: "review staging path",
    });
    if (!validated.ok) {
      return validated;
    }
    candidates.push(validated.path);
  }

  if (candidates.length === 0) {
    return {
      ok: false,
      reason: "plan has no concrete review staging file paths",
    };
  }

  const released = await parseTransferredFileOwnershipReleasePaths(
    content,
    rootDir,
  );
  if (!released.ok) {
    return released;
  }
  const releasedPaths = new Set(released.paths);
  const activeCandidates = candidates.filter(
    (candidate) => !releasedPaths.has(candidate),
  );
  if (activeCandidates.length === 0) {
    return {
      ok: false,
      reason:
        "plan has no active review staging file paths after file ownership releases",
    };
  }

  const paths: string[] = [];
  for (const candidate of activeCandidates) {
    if (!(await isIgnored(candidate))) {
      paths.push(candidate);
    }
  }

  if (paths.length === 0) {
    return { ok: false, reason: "all review staging paths are git-ignored" };
  }

  return { ok: true, paths };
};
