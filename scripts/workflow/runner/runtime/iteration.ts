import { readFile } from "node:fs/promises";
import path from "node:path";
import { parseReviewStagingPaths } from "../review/staging.ts";
import type { EditedFileSnapshot, EditedFileSummary } from "../types.ts";

const uniquePaths = (paths: string[]): string[] => [...new Set(paths)];

export const parseEditedFileSummaryPaths = async (
  rootDir: string,
  content: string,
): Promise<string[]> => {
  const parsed = await parseReviewStagingPaths({
    content,
    rootDir,
    isIgnored: async () => false,
  });
  return parsed.ok ? uniquePaths(parsed.paths) : [];
};

export const readEditedFileSnapshot = async (
  rootDir: string,
  paths: string[],
): Promise<EditedFileSnapshot> => {
  const snapshot: EditedFileSnapshot = new Map();
  for (const relativePath of paths) {
    try {
      snapshot.set(
        relativePath,
        await readFile(path.join(rootDir, relativePath), "utf8"),
      );
    } catch {
      snapshot.set(relativePath, undefined);
    }
  }
  return snapshot;
};

const splitDiffLines = (content: string | undefined): string[] => {
  if (content === undefined || content.length === 0) {
    return [];
  }
  return content.replace(/\r\n/g, "\n").replace(/\n$/, "").split("\n");
};

const commonLineCount = (
  beforeLines: string[],
  afterLines: string[],
): number => {
  const previous = new Array(afterLines.length + 1).fill(0);
  const current = new Array(afterLines.length + 1).fill(0);
  for (const beforeLine of beforeLines) {
    for (let index = 0; index < afterLines.length; index += 1) {
      current[index + 1] =
        beforeLine === afterLines[index]
          ? previous[index] + 1
          : Math.max(previous[index + 1], current[index]);
    }
    previous.splice(0, previous.length, ...current);
    current.fill(0);
  }
  return previous[afterLines.length] ?? 0;
};

export const summarizeEditedFiles = async (
  rootDir: string,
  beforeSnapshot: EditedFileSnapshot,
): Promise<EditedFileSummary[]> => {
  const summaries: EditedFileSummary[] = [];
  for (const [relativePath, beforeContent] of beforeSnapshot) {
    let afterContent: string | undefined;
    try {
      afterContent = await readFile(path.join(rootDir, relativePath), "utf8");
    } catch {
      afterContent = undefined;
    }
    if (beforeContent === afterContent) {
      continue;
    }
    const beforeLines = splitDiffLines(beforeContent);
    const afterLines = splitDiffLines(afterContent);
    const commonLines = commonLineCount(beforeLines, afterLines);
    summaries.push({
      action:
        beforeContent === undefined
          ? "Added"
          : afterContent === undefined
            ? "Deleted"
            : "Edited",
      path: relativePath,
      additions: afterLines.length - commonLines,
      deletions: beforeLines.length - commonLines,
    });
  }
  return summaries;
};
