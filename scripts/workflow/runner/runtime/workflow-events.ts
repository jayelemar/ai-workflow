import { readdir } from "node:fs/promises";
import path from "node:path";

import { thinPlanV2ArtifactPath } from "../plan/state.ts";

export const canonicalWorkflowRecord = (
  record: Record<string, unknown>,
  workflowState: import("../../contracts/stage.ts").WorkflowState,
): Record<string, unknown> => {
  return { ...record, workflowState };
};

export const nextWorkflowEventVersion = async ({
  rootDir,
  planName,
  kind,
}: {
  rootDir: string;
  planName: string;
  kind: "execution" | "validation" | "review";
}): Promise<number> => {
  const eventsDir = path.join(
    rootDir,
    thinPlanV2ArtifactPath(planName, "events"),
  );
  let entries: string[] = [];
  try {
    entries = await readdir(eventsDir);
  } catch (error) {
    const code = (error as NodeJS.ErrnoException).code;
    if (code !== "ENOENT") {
      throw error;
    }
  }
  const pattern = new RegExp(`^${kind}-v(\\d+)\\.md$`);
  const latest = entries.reduce((max, entry) => {
    const version = Number(pattern.exec(entry)?.[1] ?? 0);
    return Number.isInteger(version) ? Math.max(max, version) : max;
  }, 0);
  return latest + 1;
};

export const workflowEventBody = ({
  title,
  summary,
  evidenceLines,
}: {
  title: string;
  summary: string;
  evidenceLines: string[];
}): string => `${title}

## Summary

${summary}

## Evidence

${evidenceLines.length > 0 ? evidenceLines.map((line) => `* ${line}`).join("\n") : "* No evidence recorded."}
`;

