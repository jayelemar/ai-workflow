import path from "node:path";
import { uniquePaths } from "../runner/plan/parser.ts";
import {
  isNoReviewStagingPathPlaceholder,
  parseReviewStagingBulletValue,
  validateConcretePlanFilePath,
} from "../runner/review/staging.ts";
import type { Failure } from "../runner/types.ts";

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

export const parseOwnershipScopeEntries = async (
  content: string,
  rootDir: string,
): Promise<{ ok: true; entries: string[]; present: boolean } | Failure> => {
  const lines = sectionLines(content, "## Ownership Scope");
  if (lines === null) {
    return { ok: true, entries: [], present: false };
  }

  const entries: string[] = [];
  for (const line of lines) {
    const trimmed = line.trim();
    if (trimmed.length === 0) {
      continue;
    }
    const bulletValue = parseReviewStagingBulletValue(trimmed);
    if (bulletValue === null) {
      continue;
    }
    const value = bulletValue.trim();
    if (isNoReviewStagingPathPlaceholder(value)) {
      continue;
    }
    if (path.isAbsolute(value)) {
      return {
        ok: false,
        reason: `ownership scope path is absolute: ${value}`,
      };
    }
    if (value.includes("..")) {
      return {
        ok: false,
        reason: `ownership scope path contains ..: ${value}`,
      };
    }
    if (value.includes("*") && !value.endsWith("/**")) {
      return {
        ok: false,
        reason: `ownership scope path has unsupported glob: ${value}`,
      };
    }
    if (value.endsWith("/**")) {
      const prefix = value.slice(0, -3);
      if (prefix.length === 0) {
        return { ok: false, reason: `ownership scope path is empty: ${value}` };
      }
      entries.push(value);
      continue;
    }
    const validated = await validateConcretePlanFilePath({
      value,
      rootDir,
      reasonPrefix: "ownership scope path",
    });
    if (!validated.ok) {
      return validated;
    }
    entries.push(validated.path);
  }

  if (entries.length === 0) {
    return {
      ok: false,
      reason: "plan has no concrete ownership scope entries",
    };
  }

  return { ok: true, entries: uniquePaths(entries), present: true };
};

export const resolveOwnershipScopeEntries = (
  entries: string[],
  changedFiles: string[],
  releasedFiles: string[] = [],
): string[] => {
  const released = new Set(releasedFiles);
  const resolved: string[] = [];
  for (const entry of entries) {
    if (entry.endsWith("/**")) {
      const prefix = entry.slice(0, -3);
      for (const changedFile of changedFiles) {
        if (changedFile === prefix || changedFile.startsWith(`${prefix}/`)) {
          resolved.push(changedFile);
        }
      }
      continue;
    }
    resolved.push(entry);
  }
  return uniquePaths(resolved).filter((filePath) => !released.has(filePath));
};

export const filterChangedOwnershipFiles = (
  resolvedFiles: string[],
  changedFiles: string[],
  releasedFiles: string[] = [],
): string[] => {
  const resolved = new Set(resolvedFiles);
  const released = new Set(releasedFiles);
  return uniquePaths(changedFiles).filter(
    (filePath) => resolved.has(filePath) && !released.has(filePath),
  );
};
