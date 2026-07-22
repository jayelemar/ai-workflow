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

const asStringArray = (value: unknown): string[] =>
  Array.isArray(value) && value.every((item) => typeof item === "string")
    ? value
    : [];

const demoteMarkdownHeadings = (content: string): string =>
  content
    .replace(/^### /gm, "##### ")
    .replace(/^## /gm, "#### ")
    .replace(/^# /gm, "### ");

const fileSectionBullets = (paths: string[]): string =>
  (paths.length > 0 ? paths : ["None"])
    .map((filePath) => `* ${filePath}`)
    .join("\n");

const synthesizedEvent = ({
  label,
  latest,
  unresolvedFindings,
}: {
  label: string;
  latest: Record<string, unknown> | undefined;
  unresolvedFindings?: string[];
}): string => {
  const version = latestNumber(latest);
  if (!version) return "";
  const lines = [
    `### Latest ${label} Event (generated) v${version}`,
    "",
    `* Summary: ${latestString(latest, "summary") ?? "(none recorded)"}`,
    `* Outcome: ${latestString(latest, "outcome") ?? "(legacy event; migrate before finalization)"}`,
  ];
  const evidence = latestString(latest, "evidence");
  if (evidence) lines.push(`* Evidence: ${evidence}`);
  if (unresolvedFindings && unresolvedFindings.length > 0) {
    lines.push("* Remediation:", ...unresolvedFindings.map((finding) => `  * ${finding}`));
  }
  return `${lines.join("\n")}\n\n`;
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
  const content = replaceManifestWorkflowValue(
    manifestContent,
    "## Workflow State",
    workflow.workflowState,
  );
  const validation = latestRecord(workflow, "validation");
  const review = latestRecord(workflow, "review");
  const execution = latestRecord(workflow, "execution");
  const unblock = latestRecord(workflow, "unblock");
  const reopen = latestRecord(workflow, "reopen");
  const reviewFindings = asStringArray(review?.unresolvedFindings);
  const generatedEvents = [
    synthesizedEvent({ label: "Execution", latest: execution }),
    synthesizedEvent({ label: "Validation", latest: validation }),
    synthesizedEvent({ label: "Review", latest: review, unresolvedFindings: reviewFindings }),
    synthesizedEvent({ label: "Unblock", latest: unblock }),
    synthesizedEvent({ label: "Reopen", latest: reopen }),
  ].join("");
  const blockers = workflow.unresolvedBlockers.length > 0
    ? workflow.unresolvedBlockers
        .map((blocker, index) => `### Generated Blocker ${index + 1}\n\n* Description: ${blocker}`)
        .join("\n\n")
    : "(empty)";
  const releases = fileOwnership.released.length > 0
    ? `## File Ownership Releases\n\n${fileOwnership.released.map((filePath, index) => `### Release v${index + 1}\n\n* File: ${filePath}\n* Status: transferred`).join("\n\n")}\n\n`
    : "";
  return `${content.trimEnd()}\n\n## Implementation Map\n\n${demoteMarkdownHeadings(implementationMap).trim()}\n\n## Ownership Scope\n\n${fileSectionBullets(fileOwnership.owns)}\n\n${releases}## Files (MANDATORY)\n\n### Created files\n\n${fileSectionBullets(files.created)}\n\n### Modified files\n\n${fileSectionBullets(files.modified)}\n\n### Deleted files\n\n${fileSectionBullets(files.deleted)}\n\n## Generated Latest Event Context\n\n${generatedEvents || "(empty)\n"}\n## Generated Active Blockers\n\n${blockers}\n`;
};
