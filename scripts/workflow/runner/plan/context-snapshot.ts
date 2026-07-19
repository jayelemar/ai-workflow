import path from 'node:path';
import { mkdir, writeFile } from 'node:fs/promises';
import { boundedInlineExcerpt, isFailure, isFiniteNumber, type Failure, type ParsedPlan, type ThinPlanV2WorkflowState, type WorkflowContextSnapshotResult, type WorkflowContextSnapshotTokenUsage } from '../types.ts';
import { selectInstructionPaths } from '../instruction-router.ts';
import { workflowStagePromptPaths } from '../../contracts/stage.ts';
import {
  extractFieldValue,
  extractNestedListItems,
  extractPlanOwnedFileSection,
  extractPlanOwnedPaths,
  extractSectionValue,
  extractSpecPaths,
  extractVersionedSectionEntries,
  planSectionLines as sectionLines,
  summarizeMeaningfulLines,
  uniquePaths,
} from './parser.ts';
import {
  parseThinPlanV2WorkflowState,
  readJsonArtifact,
  thinPlanV2ArtifactPath,
} from './thin-plan-sidecars.ts';
import { selectRelevantWorkflowEvent } from './state-synthesis.ts';

const rel = (...segments: string[]) => segments.join('/');
const stateMachinePromptPaths = new Set<string>([...workflowStagePromptPaths]);
const extractCurrentPhaseSummary = (planContent: string): string[] => {
  for (const heading of [
    "## Current Phase",
    "## Current Implementation Status",
    "## Summary",
    "## Verification Status",
  ]) {
    const lines = sectionLines(planContent, heading);
    if (lines === null) {
      continue;
    }
    const summary = summarizeMeaningfulLines(lines);
    if (summary.length > 0) {
      return summary;
    }
  }

  const latestExecution = extractVersionedSectionEntries(
    planContent,
    "## Execution Log",
  ).at(-1);
  return latestExecution ? summarizeMeaningfulLines(latestExecution.lines) : [];
};

const extractLatestExecutionSummary = (planContent: string): string[] => {
  const latestExecution = extractVersionedSectionEntries(
    planContent,
    "## Execution Log",
  ).at(-1);
  return latestExecution ? summarizeMeaningfulLines(latestExecution.lines) : [];
};

const extractLatestValidationSummary = (
  planContent: string,
): { result?: string; details: string[] } => {
  const latestValidation = extractVersionedSectionEntries(
    planContent,
    "## Validation History",
  ).at(-1);
  if (!latestValidation) {
    return { details: [] };
  }

  const details = [
    ...extractNestedListItems(latestValidation.lines, "Critical Issues"),
    ...extractNestedListItems(latestValidation.lines, "Warnings"),
    ...extractNestedListItems(latestValidation.lines, "Notes"),
  ];

  if (details.length === 0) {
    details.push(
      ...summarizeMeaningfulLines(
        latestValidation.lines.filter(
          (line) => !/^\*\s*(Result|Recommendation):/i.test(line.trim()),
        ),
      ),
    );
  }

  return {
    result: extractFieldValue(latestValidation.lines, "Result"),
    details: details.slice(0, 5),
  };
};

const extractLatestReviewSummary = (
  planContent: string,
): {
  heading?: string;
  summary?: string;
  decision?: string;
  evidence?: string;
  unresolvedFindings: string[];
} => {
  const latestReview = extractVersionedSectionEntries(
    planContent,
    "## Review History",
  ).at(-1);
  if (!latestReview) {
    return { unresolvedFindings: [] };
  }

  const unresolvedFindings = extractNestedListItems(
    latestReview.lines,
    "Issues",
  )
    .filter((value) => !/^resolved:/i.test(value))
    .slice(0, 5);

  return {
    heading: latestReview.heading.startsWith("### ")
      ? latestReview.heading.replace(/^###\s+/, "")
      : undefined,
    summary: extractFieldValue(latestReview.lines, "Summary"),
    decision: extractFieldValue(latestReview.lines, "Decision"),
    evidence: extractFieldValue(latestReview.lines, "Evidence"),
    unresolvedFindings,
  };
};

const extractLatestReviewRemediationContext = (
  planContent: string,
): string[] => {
  const status = extractSectionValue(planContent, "## Status");
  const nextAction = extractSectionValue(planContent, "## Next Action");
  if (status !== "active" || nextAction !== "execute-plan") {
    return [];
  }

  const review = extractLatestReviewSummary(planContent);
  if (review.unresolvedFindings.length === 0 && !review.evidence) {
    return [];
  }

  const context: string[] = [];
  if (review.heading) {
    context.push(`Source Review: ${review.heading}`);
  }
  if (review.summary) {
    context.push(`Summary: ${review.summary}`);
  }
  if (review.decision) {
    context.push(`Decision: ${review.decision}`);
  }
  if (review.evidence) {
    context.push(`Evidence: ${review.evidence}`);
  }
  context.push(...review.unresolvedFindings);
  return context;
};

const extractActiveBlockers = (planContent: string): string[] => {
  const lines = sectionLines(planContent, "## Blockers");
  if (lines === null) {
    return [];
  }

  const blockers: Array<{ heading: string; lines: string[] }> = [];
  const hasExplicitBlockerSections = lines.some((line) =>
    /^###\s+Blocker\b/i.test(line.trim()),
  );
  let current: { heading: string; lines: string[] } | undefined;
  for (const line of lines) {
    const trimmed = line.trim();
    if (/^###\s+Blocker\b/i.test(trimmed)) {
      current = { heading: trimmed, lines: [] };
      blockers.push(current);
      continue;
    }
    if (hasExplicitBlockerSections) {
      current?.lines.push(line);
      continue;
    }
    current ??= { heading: "## Blockers", lines: [] };
    if (!blockers.includes(current)) {
      blockers.push(current);
    }
    current.lines.push(line);
  }

  return blockers
    .filter((blocker) => {
      const status = extractFieldValue(blocker.lines, "Status");
      return !(status && /^resolved$/i.test(status));
    })
    .map((blocker) => {
      const details = [
        extractFieldValue(blocker.lines, "Description"),
        extractFieldValue(blocker.lines, "Required Action"),
        extractFieldValue(blocker.lines, "Next Step"),
      ].filter((value): value is string => typeof value === "string");
      return boundedInlineExcerpt(
        [blocker.heading.replace(/^###\s+/, ""), ...details].join(" | "),
      );
    })
    .filter((value): value is string => typeof value === "string")
    .slice(0, 5);
};

const summarizeLatestTokenUsage = (
  latestTokenUsage?: WorkflowContextSnapshotTokenUsage,
): string[] => {
  if (!latestTokenUsage) {
    return [];
  }

  const lines: string[] = [];
  if (isFiniteNumber(latestTokenUsage.iteration)) {
    lines.push(`Iteration: ${latestTokenUsage.iteration}`);
  }
  if (
    typeof latestTokenUsage.promptPath === "string" &&
    latestTokenUsage.promptPath.length > 0
  ) {
    lines.push(`Prompt: ${latestTokenUsage.promptPath}`);
  }
  if (isFiniteNumber(latestTokenUsage.stageInputTokens)) {
    lines.push(`Stage Input Tokens: ${latestTokenUsage.stageInputTokens}`);
  }
  if (isFiniteNumber(latestTokenUsage.stageUncachedInputTokens)) {
    lines.push(
      `Stage Uncached Input Tokens: ${latestTokenUsage.stageUncachedInputTokens}`,
    );
  }
  if (isFiniteNumber(latestTokenUsage.stageOutputTokens)) {
    lines.push(`Stage Output Tokens: ${latestTokenUsage.stageOutputTokens}`);
  }
  if (isFiniteNumber(latestTokenUsage.stageTotalTokens)) {
    lines.push(`Stage Total Tokens: ${latestTokenUsage.stageTotalTokens}`);
  }
  if (isFiniteNumber(latestTokenUsage.totalTokens)) {
    lines.push(`Cumulative Total Tokens: ${latestTokenUsage.totalTokens}`);
  }
  return lines.slice(0, 6);
};

const formatSnapshotSection = (
  heading: string,
  items: string[],
  empty = "(none)",
): string =>
  `${heading}\n${items.length > 0 ? items.map((item) => `* ${item}`).join("\n") : empty}`;

const extractSnapshotActiveBlockers = (planContent: string): string[] =>
  extractActiveBlockers(planContent).filter(
    (blocker) => blocker !== "## Blockers",
  );

export const workflowContextSnapshotRelativePath = (planName: string): string =>
  rel(".ai", "artifacts", planName, "state", "context.md");

export const workflowContextSnapshotAbsolutePath = (
  rootDir: string,
  planName: string,
): string => path.join(rootDir, workflowContextSnapshotRelativePath(planName));

export const generateWorkflowContextSnapshot = ({
  planName,
  planPath,
  planContent,
  latestTokenUsage,
  workflowState,
}: {
  planName: string;
  planPath: string;
  planContent: string;
  latestTokenUsage?: WorkflowContextSnapshotTokenUsage;
  workflowState?: ThinPlanV2WorkflowState;
}): string => {
  const validation = extractLatestValidationSummary(planContent);
  const review = extractLatestReviewSummary(planContent);
  const relevantEvent = selectRelevantWorkflowEvent(planContent, workflowState);
  const reviewRemediationContext =
    extractLatestReviewRemediationContext(planContent);
  const tokenSummary = summarizeLatestTokenUsage(latestTokenUsage);

  return `# Workflow Context Snapshot: ${planName}

## Plan Path

${planPath}

## Current State

* Status: ${extractSectionValue(planContent, "## Status") ?? "(missing)"}
* Next Action: ${extractSectionValue(planContent, "## Next Action") ?? "(missing)"}

${formatSnapshotSection("## Spec Paths", extractSpecPaths(planContent))}

## Plan-Owned Files

${extractPlanOwnedFileSection(planContent).length > 0 ? extractPlanOwnedFileSection(planContent).join("\n") : "(none)"}

${formatSnapshotSection("## Summary", extractCurrentPhaseSummary(planContent))}

${formatSnapshotSection("## Key Details", extractLatestExecutionSummary(planContent))}

## Validation

* Result: ${validation.result ?? "(none recorded)"}
${validation.details.length > 0 ? validation.details.map((detail) => `* ${detail}`).join("\n") : "(none)"}

## Review

* Summary: ${review.summary ?? "(none recorded)"}
* Decision: ${review.decision ?? "(none recorded)"}
* Evidence: ${review.evidence ?? "(none recorded)"}
${formatSnapshotSection("### Unresolved Findings", review.unresolvedFindings)}

## Latest Relevant Event

${
  relevantEvent
    ? `* Kind: ${relevantEvent.label}
* Why: ${relevantEvent.reason}
* Summary: ${relevantEvent.summary ?? "(none recorded)"}
* ${relevantEvent.stateField}: ${relevantEvent.stateValue ?? "(none recorded)"}
* Evidence: ${relevantEvent.evidence ?? "(none recorded)"}`
    : "(none)"
}

${formatSnapshotSection("## Latest Review Remediation Context", reviewRemediationContext)}

${formatSnapshotSection("## Active Blockers", extractSnapshotActiveBlockers(planContent))}

${formatSnapshotSection("## Latest Token Usage Summary", tokenSummary)}
`;
};

export const activeContextPacket = ({
  promptPath,
  planPath,
  planContent,
  contextSnapshotPath = workflowContextSnapshotRelativePath(
    path.posix.basename(planPath, ".md"),
  ),
}: {
  promptPath: string;
  planPath: string;
  planContent: string;
  contextSnapshotPath?: string;
}): string => {
  const warmPaths = uniquePaths([
    rel(".codex", "AGENTS.md"),
    promptPath,
    contextSnapshotPath,
    rel(".ai", "instructions", "index.md"),
    ...(stateMachinePromptPaths.has(promptPath)
      ? [rel(".ai", "instructions", "shared", "workflow-state.md")]
      : []),
    ...extractSpecPaths(planContent),
    ...selectInstructionPaths({
      planOwnedPaths: extractPlanOwnedPaths(planContent),
      planContent,
    }),
  ]);

  return `Active Context Packet:
Load exactly these warm context files:
${warmPaths.map((warmPath) => `- ${warmPath}`).join("\n")}

Use the Active Context Packet and index-selected instruction files only. Do not broadly load \`.ai/instructions/**\`.

Artifact loading rule:
- Use ${contextSnapshotPath} first.
- Use workflow.json only for current state, latest event pointers, and unresolved blockers.
- Treat workflow.json \`history\` as historical fallback only; do not inspect it during normal runs.
- Open only the latest relevant event artifact referenced by the snapshot or workflow state when exact evidence is needed.
- Do not broadly load \`.ai/artifacts/**\`.
`;
};

export const writeWorkflowContextSnapshot = async ({
  rootDir,
  plan,
  latestTokenUsage,
}: {
  rootDir: string;
  plan: ParsedPlan;
  latestTokenUsage?: WorkflowContextSnapshotTokenUsage;
}): Promise<WorkflowContextSnapshotResult | Failure> => {
  let workflowState: ThinPlanV2WorkflowState | undefined;
  if (plan.thinPlanContract === "thin-plan-v2") {
    const workflowPath = thinPlanV2ArtifactPath(
      plan.planName,
      "state",
      "workflow.json",
    );
    const workflowRaw = await readJsonArtifact(rootDir, workflowPath);
    if (isFailure(workflowRaw)) {
      return workflowRaw;
    }
    const parsedWorkflow = parseThinPlanV2WorkflowState(
      workflowRaw,
      plan.planPath,
      workflowPath,
    );
    if (isFailure(parsedWorkflow)) {
      return parsedWorkflow;
    }
    workflowState = parsedWorkflow;
  }

  const snapshotPath = workflowContextSnapshotRelativePath(plan.planName);
  const snapshot = generateWorkflowContextSnapshot({
    planName: plan.planName,
    planPath: plan.planPath,
    planContent: plan.content,
    latestTokenUsage,
    workflowState,
  });

  try {
    await mkdir(
      path.dirname(workflowContextSnapshotAbsolutePath(rootDir, plan.planName)),
      {
        recursive: true,
      },
    );
    await writeFile(
      workflowContextSnapshotAbsolutePath(rootDir, plan.planName),
      snapshot,
      "utf8",
    );
    return { ok: true, snapshotPath };
  } catch (error) {
    return {
      ok: false,
      reason: `workflow context snapshot cannot be written: ${String(error)}`,
    };
  }
};
