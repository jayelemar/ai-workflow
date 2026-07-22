import { readFile } from "node:fs/promises";
import path from "node:path";

import type { Failure } from "../types.ts";

export const readTextArtifact = async (
  rootDir: string,
  relativePath: string,
): Promise<{ ok: true; content: string } | Failure> => {
  try {
    return { ok: true, content: await readFile(path.join(rootDir, relativePath), "utf8") };
  } catch (error) {
    return {
      ok: false,
      reason: `thin-plan artifact cannot be read: ${relativePath}: ${String(error)}`,
    };
  }
};

export const replaceManifestWorkflowValue = (
  content: string,
  heading: string,
  value: string,
): string => {
  const lines = content.split(/\r?\n/);
  const headingIndex = lines.findIndex((line) => line.trim() === heading);
  if (headingIndex < 0) return content;
  for (let index = headingIndex + 1; index < lines.length; index += 1) {
    if (lines[index].trim().startsWith("##")) return content;
    if (lines[index].trim().length > 0) {
      lines[index] = value;
      return lines.join("\n");
    }
  }
  lines.splice(headingIndex + 1, 0, "", value);
  return lines.join("\n");
};
