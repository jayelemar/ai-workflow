import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import {
  isFailure,
  type Failure,
  type ParsedPlan,
  type ThinPlanWorkflowState,
  type WorkflowContextSnapshotResult,
  type WorkflowContextSnapshotTokenUsage,
} from "../types.ts";
import { selectInstructionPaths } from "../instruction-router.ts";
import { workflowStagePromptPaths } from "../../contracts/stage.ts";
import {
  extractPlanOwnedFileSection,
  extractPlanOwnedPaths,
  extractSectionValue,
  extractSpecPaths,
  uniquePaths,
} from "./parser.ts";
import {
  parseThinPlanWorkflowState,
  readJsonArtifact,
  thinPlanArtifactPath,
} from "./thin-plan-sidecars.ts";
import { selectRelevantWorkflowEvent } from "./state-synthesis.ts";
import {
  extractCurrentPhaseSummary,
  extractLatestExecutionSummary,
  extractLatestReviewRemediationContext,
  extractLatestReviewSummary,
  extractLatestValidationSummary,
  extractSnapshotActiveBlockers,
  formatSnapshotSection,
  summarizeLatestTokenUsage,
} from "./context-snapshot-extractors.ts";

const rel = (...segments: string[]) => segments.join("/");
const stateMachinePromptPaths = new Set<string>([...workflowStagePromptPaths]);

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
  workflowState?: ThinPlanWorkflowState;
}): string => {
  const validation = extractLatestValidationSummary(planContent);
  const review = extractLatestReviewSummary(planContent);
  const relevantEvent = selectRelevantWorkflowEvent(planContent, workflowState);
  const reviewRemediationContext = extractLatestReviewRemediationContext(planContent);
  const tokenSummary = summarizeLatestTokenUsage(latestTokenUsage);
  const currentWorkflowState = workflowState?.workflowState ?? extractSectionValue(planContent, "## Workflow State") ?? undefined;
  return `# Workflow Context Snapshot: ${planName}

## Plan Path

${planPath}

## Current State

* Workflow State: ${currentWorkflowState ?? "(missing)"}

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

${relevantEvent ? `* Kind: ${relevantEvent.label}
* Why: ${relevantEvent.reason}
* Summary: ${relevantEvent.summary ?? "(none recorded)"}
* ${relevantEvent.stateField}: ${relevantEvent.stateValue ?? "(none recorded)"}
* Evidence: ${relevantEvent.evidence ?? "(none recorded)"}` : "(none)"}

${formatSnapshotSection("## Latest Review Remediation Context", reviewRemediationContext)}

${formatSnapshotSection("## Active Blockers", extractSnapshotActiveBlockers(planContent))}

${formatSnapshotSection("## Latest Token Usage Summary", tokenSummary)}
`;
};

export const activeContextPacket = ({
  promptPath,
  planPath,
  planContent,
  contextSnapshotPath = workflowContextSnapshotRelativePath(path.posix.basename(planPath, ".md")),
}: {
  promptPath: string;
  planPath: string;
  planContent: string;
  contextSnapshotPath?: string;
}): string => {
  const warmPaths = uniquePaths([
    rel(".codex", "AGENTS.md"), promptPath, contextSnapshotPath,
    rel(".ai", "instructions", "index.md"),
    ...(stateMachinePromptPaths.has(promptPath) ? [rel(".ai", "instructions", "shared", "workflow-state.md")] : []),
    ...extractSpecPaths(planContent),
    ...selectInstructionPaths({ planOwnedPaths: extractPlanOwnedPaths(planContent), planContent }),
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

export const writeWorkflowContextSnapshot = async ({ rootDir, plan, latestTokenUsage }: { rootDir: string; plan: ParsedPlan; latestTokenUsage?: WorkflowContextSnapshotTokenUsage }): Promise<WorkflowContextSnapshotResult | Failure> => {
  let workflowState: ThinPlanWorkflowState | undefined;
  if (plan.thinPlanContract === "thin-plan") {
    const workflowPath = thinPlanArtifactPath(plan.planName, "state", "workflow.json");
    const workflowRaw = await readJsonArtifact(rootDir, workflowPath);
    if (isFailure(workflowRaw)) return workflowRaw;
    const parsedWorkflow = parseThinPlanWorkflowState(workflowRaw, plan.planPath, workflowPath);
    if (isFailure(parsedWorkflow)) return parsedWorkflow;
    workflowState = parsedWorkflow;
  }
  const snapshotPath = workflowContextSnapshotRelativePath(plan.planName);
  const snapshot = generateWorkflowContextSnapshot({ planName: plan.planName, planPath: plan.planPath, planContent: plan.content, latestTokenUsage, workflowState });
  try {
    await mkdir(path.dirname(workflowContextSnapshotAbsolutePath(rootDir, plan.planName)), { recursive: true });
    await writeFile(workflowContextSnapshotAbsolutePath(rootDir, plan.planName), snapshot, "utf8");
    return { ok: true, snapshotPath };
  } catch (error) {
    return { ok: false, reason: `workflow context snapshot cannot be written: ${String(error)}` };
  }
};
