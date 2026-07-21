import {
  type FileOwnershipArtifact,
  type ThinPlanFilesState,
  type ThinPlanWorkflowState,
} from "../types.ts";
import { replaceManifestWorkflowValue } from "./state-recovery.ts";
import { latestNumber, latestRecord, latestString } from "./state-events.ts";

export {
  latestNumber,
  latestRecord,
  latestString,
  selectRelevantWorkflowEvent,
} from "./state-events.ts";

const asStringArray = (value: unknown): string[] | undefined =>
  Array.isArray(value) && value.every((item) => typeof item === "string")
    ? (value as string[])
    : undefined;

const demoteMarkdownHeadings = (content: string): string =>
  content
    .replace(/^### /gm, "##### ")
    .replace(/^## /gm, "#### ")
    .replace(/^# /gm, "### ");

const fileSectionBullets = (paths: string[]): string =>
  (paths.length > 0 ? paths : ["None"])
    .map((filePath) => `* ${filePath}`)
    .join("\n");

const synthesizeLatestEventSection = ({
  heading,
  label,
  stateField,
  stateValue,
  latest,
  unresolvedFindings,
}: {
  heading: string;
  label: string;
  stateField: "Result" | "Decision" | "Status";
  stateValue?: string;
  latest: Record<string, unknown> | undefined;
  unresolvedFindings?: string[];
}): string => {
  const version = latestNumber(latest);
  if (!version) return `## ${heading}\n\n(empty)\n`;
  const lines = [
    `## ${heading}`,
    "",
    `### ${label} v${version}`,
    "",
    `* Summary: ${latestString(latest, "summary") ?? "(none recorded)"}`,
    `* ${stateField}: ${stateValue ?? "(none recorded)"}`,
  ];
  const evidence = latestString(latest, "evidence");
  if (evidence) lines.push(`* Evidence: ${evidence}`);
  if (unresolvedFindings && unresolvedFindings.length > 0) {
    lines.push("* Issues:", ...unresolvedFindings.map((finding) => `  * ${finding}`));
  }
  return `${lines.join("\n")}\n`;
};

export const synthesizeThinPlanContent = ({
  manifestContent,
  workflow,
  files,
  fileOwnership,
  implementationMap,
}: {
  manifestContent: string;
  workflow: ThinPlanWorkflowState;
  files: ThinPlanFilesState;
  fileOwnership: FileOwnershipArtifact;
  implementationMap: string;
}): string => {
  const content = replaceManifestWorkflowValue(manifestContent, "## Workflow State", workflow.workflowState);
  const validation = latestRecord(workflow, "validation");
  const review = latestRecord(workflow, "review");
  const execution = latestRecord(workflow, "execution");
  const unblock = latestRecord(workflow, "unblock");
  const reopen = latestRecord(workflow, "reopen");
  const reviewFindings = asStringArray(review?.unresolvedFindings) ?? [];
  const blockerLines = workflow.unresolvedBlockers.length > 0
    ? ["## Blockers", "", ...workflow.unresolvedBlockers.flatMap((blocker, index) => [`### Blocker v${index + 1}`, "", `* Description: ${blocker}`, "* Status: active", ""])].join("\n")
    : "## Blockers\n\n(empty)\n";
  const releases = fileOwnership.released.length > 0
    ? `## File Ownership Releases\n\n${fileOwnership.released.map((filePath, index) => `### Release v${index + 1}\n\n* File: ${filePath}\n* Status: transferred`).join("\n\n")}\n`
    : "";
  return `${content.trimEnd()}\n\n## Implementation Map\n\n${demoteMarkdownHeadings(implementationMap).trim()}\n\n## Ownership Scope\n\n${fileSectionBullets(fileOwnership.owns)}\n\n${releases}## Files (MANDATORY)\n\n### Created files\n\n${fileSectionBullets(files.created)}\n\n### Modified files\n\n${fileSectionBullets(files.modified)}\n\n### Deleted files\n\n${fileSectionBullets(files.deleted)}\n\n${synthesizeLatestEventSection({ heading: "Execution Log", label: "Execution", stateField: "Result", stateValue: latestString(execution, "result"), latest: execution })}${synthesizeLatestEventSection({ heading: "Validation History", label: "Validation", stateField: "Result", stateValue: latestString(validation, "result"), latest: validation })}${synthesizeLatestEventSection({ heading: "Review History", label: "Review", stateField: "Decision", stateValue: latestString(review, "decision"), latest: review, unresolvedFindings: reviewFindings })}${synthesizeLatestEventSection({ heading: "Unblock History", label: "Unblock", stateField: "Status", stateValue: latestString(unblock, "status"), latest: unblock })}${synthesizeLatestEventSection({ heading: "Reopen History", label: "Reopen", stateField: "Status", stateValue: latestString(reopen, "status"), latest: reopen })}${blockerLines}`;
};
