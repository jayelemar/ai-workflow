import { mkdir, readFile, writeFile } from "node:fs/promises";
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
import {
  latestRecord,
  latestString,
  selectRelevantWorkflowEvent,
} from "./state-synthesis.ts";
import {
  extractCurrentPhaseSummary,
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
  eventRemediation,
}: {
  planName: string;
  planPath: string;
  planContent: string;
  latestTokenUsage?: WorkflowContextSnapshotTokenUsage;
  workflowState?: ThinPlanWorkflowState;
  eventRemediation?: string[];
}): string => {
  const validation = workflowState ? latestRecord(workflowState, "validation") : undefined;
  const review = workflowState ? latestRecord(workflowState, "review") : undefined;
  const relevantEvent = selectRelevantWorkflowEvent(planContent, workflowState);
  const reviewFindings = Array.isArray(review?.unresolvedFindings)
    ? review.unresolvedFindings.filter((item): item is string => typeof item === "string")
    : [];
  const remediationContext = eventRemediation && eventRemediation.length > 0
    ? eventRemediation
    : reviewFindings;
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

${formatSnapshotSection("## Key Details", relevantEvent?.summary ? [relevantEvent.summary] : [])}

## Generated Latest Validation Context

* Outcome: ${latestString(validation, "outcome") ?? "(none recorded)"}
* Summary: ${latestString(validation, "summary") ?? "(none recorded)"}
* Evidence: ${latestString(validation, "evidence") ?? "(none recorded)"}

## Generated Latest Review Context

* Outcome: ${latestString(review, "outcome") ?? "(none recorded)"}
* Summary: ${latestString(review, "summary") ?? "(none recorded)"}
* Evidence: ${latestString(review, "evidence") ?? "(none recorded)"}
${formatSnapshotSection("### Generated Unresolved Findings", reviewFindings)}

## Generated Latest Event Context

${relevantEvent ? `* Kind: ${relevantEvent.label}
* Why: ${relevantEvent.reason}
* Summary: ${relevantEvent.summary ?? "(none recorded)"}
* ${relevantEvent.stateField}: ${relevantEvent.stateValue ?? "(none recorded)"}
* Evidence: ${relevantEvent.evidence ?? "(none recorded)"}` : "(none)"}

${formatSnapshotSection("## Generated Remediation Context", remediationContext)}

${formatSnapshotSection("## Generated Active Blockers", workflowState?.unresolvedBlockers ?? [])}

${formatSnapshotSection("## Latest Token Usage Summary", tokenSummary)}
`;
};

const readEventRemediation = async (
  rootDir: string,
  evidencePath: string | undefined,
): Promise<string[]> => {
  if (!evidencePath) return [];
  try {
    const content = await readFile(path.join(rootDir, evidencePath), "utf8");
    const lines = content.split(/\r?\n/);
    const start = lines.findIndex((line) => line.trim() === "## Remediation");
    if (start < 0) return [];
    const remediation: string[] = [];
    for (const line of lines.slice(start + 1)) {
      if (line.trim().startsWith("## ")) break;
      const value = line.trim().replace(/^[*-]\s*/, "");
      if (value) remediation.push(value);
    }
    return remediation;
  } catch {
    return [];
  }
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
  const relevantEvent = selectRelevantWorkflowEvent(plan.content, workflowState);
  const snapshot = generateWorkflowContextSnapshot({
    planName: plan.planName,
    planPath: plan.planPath,
    planContent: plan.content,
    latestTokenUsage,
    workflowState,
    eventRemediation: await readEventRemediation(rootDir, relevantEvent?.evidence),
  });
  try {
    await mkdir(path.dirname(workflowContextSnapshotAbsolutePath(rootDir, plan.planName)), { recursive: true });
    await writeFile(workflowContextSnapshotAbsolutePath(rootDir, plan.planName), snapshot, "utf8");
    return { ok: true, snapshotPath };
  } catch (error) {
    return { ok: false, reason: `workflow context snapshot cannot be written: ${String(error)}` };
  }
};
