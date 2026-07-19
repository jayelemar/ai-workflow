import {
  asRecord,
  type FileOwnershipArtifact,
  type ThinPlanV2FilesState,
  type ThinPlanV2WorkflowState,
} from "../types.ts";
import { extractSectionValue } from "./parser.ts";
import { replaceManifestWorkflowValue } from "./state-recovery.ts";
import { workflowReviewSupersededByProgress } from "./thin-plan-sidecars.ts";

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

export const latestRecord = (
  workflow: ThinPlanV2WorkflowState,
  kind: string,
): Record<string, unknown> | undefined => asRecord(workflow.latest?.[kind]);

export const latestNumber = (
  record: Record<string, unknown> | undefined,
): number | undefined =>
  typeof record?.version === "number" &&
  Number.isInteger(record.version) &&
  record.version > 0
    ? record.version
    : undefined;

export const latestString = (
  record: Record<string, unknown> | undefined,
  key: string,
): string | undefined =>
  typeof record?.[key] === "string" ? record[key] : undefined;

type RelevantWorkflowEvent = {
  kind: "execution" | "validation" | "review" | "unblock" | "reopen";
  label: "Execution" | "Validation" | "Review" | "Unblock" | "Reopen";
  stateField: "Result" | "Decision" | "Status";
  stateValue?: string;
  summary?: string;
  evidence?: string;
  reason: string;
};

const relevantWorkflowEventDetails = (
  kind: RelevantWorkflowEvent["kind"],
  latest: Record<string, unknown> | undefined,
  reason: string,
): RelevantWorkflowEvent | undefined => {
  if (!latestNumber(latest)) {
    return undefined;
  }

  if (kind === "execution") {
    return {
      kind,
      label: "Execution",
      stateField: "Result",
      stateValue: latestString(latest, "result"),
      summary: latestString(latest, "summary"),
      evidence: latestString(latest, "evidence"),
      reason,
    };
  }

  if (kind === "validation") {
    return {
      kind,
      label: "Validation",
      stateField: "Result",
      stateValue: latestString(latest, "result"),
      summary: latestString(latest, "summary"),
      evidence: latestString(latest, "evidence"),
      reason,
    };
  }

  if (kind === "review") {
    return {
      kind,
      label: "Review",
      stateField: "Decision",
      stateValue: latestString(latest, "decision"),
      summary: latestString(latest, "summary"),
      evidence: latestString(latest, "evidence"),
      reason,
    };
  }

  return {
    kind,
    label: kind === "unblock" ? "Unblock" : "Reopen",
    stateField: "Status",
    stateValue: latestString(latest, "status"),
    summary: latestString(latest, "summary"),
    evidence: latestString(latest, "evidence"),
    reason,
  };
};

export const selectRelevantWorkflowEvent = (
  planContent: string,
  workflow: ThinPlanV2WorkflowState | undefined,
): RelevantWorkflowEvent | undefined => {
  if (!workflow) {
    return undefined;
  }

  const execution = latestRecord(workflow, "execution");
  const validation = latestRecord(workflow, "validation");
  const review = latestRecord(workflow, "review");
  const unblock = latestRecord(workflow, "unblock");
  const reopen = latestRecord(workflow, "reopen");
  const reviewFindings = asStringArray(review?.unresolvedFindings) ?? [];
  const status =
    workflow.status || extractSectionValue(planContent, "## Status");
  const nextAction =
    workflow.nextAction || extractSectionValue(planContent, "## Next Action");

  if (nextAction === "execute-plan") {
    if (
      status === "active" &&
      review &&
      !workflowReviewSupersededByProgress(workflow.latest, workflow.history) &&
      (reviewFindings.length > 0 ||
        latestString(review, "decision") === "active")
    ) {
      return relevantWorkflowEventDetails(
        "review",
        review,
        "latest review remediation for the next execute-plan run",
      );
    }
    if (status === "approved" && validation) {
      return relevantWorkflowEventDetails(
        "validation",
        validation,
        "latest approval evidence before execution starts",
      );
    }
    if (execution) {
      return relevantWorkflowEventDetails(
        "execution",
        execution,
        "latest execution checkpoint for the active implementation loop",
      );
    }
    if (validation) {
      return relevantWorkflowEventDetails(
        "validation",
        validation,
        "latest validation evidence still relevant to execution",
      );
    }
  }

  if (nextAction === "review-plan") {
    if (validation) {
      return relevantWorkflowEventDetails(
        "validation",
        validation,
        "latest validation evidence for the current review pass",
      );
    }
    if (execution) {
      return relevantWorkflowEventDetails(
        "execution",
        execution,
        "latest execution evidence behind the current review pass",
      );
    }
  }

  if (nextAction === "unblock-plan") {
    if (execution) {
      return relevantWorkflowEventDetails(
        "execution",
        execution,
        "latest blocking execution evidence to resolve before unblocking",
      );
    }
    if (unblock) {
      return relevantWorkflowEventDetails(
        "unblock",
        unblock,
        "latest unblock attempt for the current blocked state",
      );
    }
  }

  if (nextAction === "reopen-plan") {
    if (review) {
      return relevantWorkflowEventDetails(
        "review",
        review,
        "latest completion review evidence behind the reopen request",
      );
    }
    if (reopen) {
      return relevantWorkflowEventDetails(
        "reopen",
        reopen,
        "latest reopen attempt for the current request",
      );
    }
  }

  if (nextAction === "commit-summary") {
    if (review) {
      return relevantWorkflowEventDetails(
        "review",
        review,
        "latest approval evidence before commit summary",
      );
    }
    if (execution) {
      return relevantWorkflowEventDetails(
        "execution",
        execution,
        "latest execution checkpoint before commit summary",
      );
    }
  }

  if (nextAction === "plan-validator" && validation) {
    return relevantWorkflowEventDetails(
      "validation",
      validation,
      "latest validation evidence for the current draft plan",
    );
  }

  return (
    relevantWorkflowEventDetails("review", review, "latest review evidence") ??
    relevantWorkflowEventDetails(
      "validation",
      validation,
      "latest validation evidence",
    ) ??
    relevantWorkflowEventDetails(
      "execution",
      execution,
      "latest execution evidence",
    ) ??
    relevantWorkflowEventDetails(
      "unblock",
      unblock,
      "latest unblock evidence",
    ) ??
    relevantWorkflowEventDetails("reopen", reopen, "latest reopen evidence")
  );
};

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
  if (!version) {
    return `## ${heading}\n\n(empty)\n`;
  }
  const lines = [
    `## ${heading}`,
    "",
    `### ${label} v${version}`,
    "",
    `* Summary: ${latestString(latest, "summary") ?? "(none recorded)"}`,
    `* ${stateField}: ${stateValue ?? "(none recorded)"}`,
  ];
  const evidence = latestString(latest, "evidence");
  if (evidence) {
    lines.push(`* Evidence: ${evidence}`);
  }
  if (unresolvedFindings && unresolvedFindings.length > 0) {
    lines.push(
      "* Issues:",
      ...unresolvedFindings.map((finding) => `  * ${finding}`),
    );
  }
  return `${lines.join("\n")}\n`;
};

export const synthesizeThinPlanV2Content = ({
  manifestContent,
  workflow,
  files,
  fileOwnership,
  implementationMap,
}: {
  manifestContent: string;
  workflow: ThinPlanV2WorkflowState;
  files: ThinPlanV2FilesState;
  fileOwnership: FileOwnershipArtifact;
  implementationMap: string;
}): string => {
  let content = replaceManifestWorkflowValue(
    manifestContent,
    "## Status",
    workflow.status,
  );
  content = replaceManifestWorkflowValue(
    content,
    "## Next Action",
    workflow.nextAction,
  );
  const validation = latestRecord(workflow, "validation");
  const review = latestRecord(workflow, "review");
  const execution = latestRecord(workflow, "execution");
  const unblock = latestRecord(workflow, "unblock");
  const reopen = latestRecord(workflow, "reopen");
  const reviewFindings = asStringArray(review?.unresolvedFindings) ?? [];
  const blockerLines =
    workflow.unresolvedBlockers.length > 0
      ? [
          "## Blockers",
          "",
          ...workflow.unresolvedBlockers.flatMap((blocker, index) => [
            `### Blocker v${index + 1}`,
            "",
            `* Description: ${blocker}`,
            "* Status: active",
            "",
          ]),
        ].join("\n")
      : "## Blockers\n\n(empty)\n";

  const releases =
    fileOwnership.released.length > 0
      ? `## File Ownership Releases

${fileOwnership.released
  .map(
    (filePath, index) => `### Release v${index + 1}

* File: ${filePath}
* Status: transferred`,
  )
  .join("\n\n")}
`
      : "";

  return `${content.trimEnd()}

## Implementation Map

${demoteMarkdownHeadings(implementationMap).trim()}

## Ownership Scope

${fileSectionBullets(fileOwnership.owns)}

${releases}## Files (MANDATORY)

### Created files

${fileSectionBullets(files.created)}

### Modified files

${fileSectionBullets(files.modified)}

### Deleted files

${fileSectionBullets(files.deleted)}

${synthesizeLatestEventSection({
  heading: "Execution Log",
  label: "Execution",
  stateField: "Result",
  stateValue: latestString(execution, "result"),
  latest: execution,
})}
${synthesizeLatestEventSection({
  heading: "Validation History",
  label: "Validation",
  stateField: "Result",
  stateValue: latestString(validation, "result"),
  latest: validation,
})}
${synthesizeLatestEventSection({
  heading: "Review History",
  label: "Review",
  stateField: "Decision",
  stateValue: latestString(review, "decision"),
  latest: review,
  unresolvedFindings: reviewFindings,
})}
${synthesizeLatestEventSection({
  heading: "Unblock History",
  label: "Unblock",
  stateField: "Status",
  stateValue: latestString(unblock, "status"),
  latest: unblock,
})}
${synthesizeLatestEventSection({
  heading: "Reopen History",
  label: "Reopen",
  stateField: "Status",
  stateValue: latestString(reopen, "status"),
  latest: reopen,
})}
${blockerLines}`;
};

