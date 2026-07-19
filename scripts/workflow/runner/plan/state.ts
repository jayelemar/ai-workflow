import { existsSync } from 'node:fs';
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { normalizePlanArgument } from '../cli.ts';
import { parseFileOwnershipArtifact } from '../../ownership/file-ownership.ts';
import { validateThinPlanContract } from '../thin-plan.ts';
import {
  isFailure,
  type Failure,
  type NextAction,
  type ParsedPlan,
  type ParsePlanOptions,
  type Status,
} from '../types.ts';
import {
  extractPlanInstructionPaths,
  extractSectionValue,
  isNextAction,
  isStatus,
  normalizeWorkflowStateValue,
} from './parser.ts';

import {
  parseThinPlanV2FilesState,
  parseThinPlanV2WorkflowState,
  readJsonArtifact,
  thinPlanV2ArtifactPath,
} from "./thin-plan-sidecars.ts";

export {
  normalizeWorkflowEventHistory,
  parseThinPlanV2FilesState,
  parseThinPlanV2WorkflowState,
  readJsonArtifact,
  thinPlanV2ArtifactPath,
  workflowReviewSupersededByProgress,
} from "./thin-plan-sidecars.ts";
import {
  readTextArtifact,
  recoverThinPlanV2FailedReviewState,
} from "./state-recovery.ts";

export {
  readTextArtifact,
  recoverThinPlanV2BlockedValidationHandoff,
  recoverThinPlanV2FailedReviewState,
  recoverThinPlanV2PartialExecuteReviewHandoff,
  repairThinPlanV2ManifestStateFromWorkflow,
  replaceManifestWorkflowValue,
} from "./state-recovery.ts";

import {
  synthesizeThinPlanV2Content,
} from "./state-synthesis.ts";

export {
  latestNumber,
  latestRecord,
  latestString,
  selectRelevantWorkflowEvent,
  synthesizeThinPlanV2Content,
} from "./state-synthesis.ts";

export const loadThinPlanV2WorkingContent = async ({
  rootDir,
  planName,
  planPath,
  manifestContent,
}: {
  rootDir: string;
  planName: string;
  planPath: string;
  manifestContent: string;
}): Promise<
  | {
      ok: true;
      content: string;
      status: Status;
      nextAction: NextAction;
    }
  | Failure
> => {
  const workflowPath = thinPlanV2ArtifactPath(
    planName,
    "state",
    "workflow.json",
  );
  const filesPath = thinPlanV2ArtifactPath(planName, "state", "files.json");
  const fileOwnershipPath = thinPlanV2ArtifactPath(
    planName,
    "state",
    "file-ownership.json",
  );
  const implementationMapPath = thinPlanV2ArtifactPath(
    planName,
    "implementation-map.md",
  );

  const workflowJson = await readJsonArtifact(rootDir, workflowPath);
  if (isFailure(workflowJson)) {
    return workflowJson;
  }
  const workflow = parseThinPlanV2WorkflowState(
    workflowJson,
    planPath,
    workflowPath,
  );
  if (isFailure(workflow)) {
    return workflow;
  }

  const filesJson = await readJsonArtifact(rootDir, filesPath);
  if (isFailure(filesJson)) {
    return filesJson;
  }
  const files = parseThinPlanV2FilesState(filesJson, filesPath);
  if (isFailure(files)) {
    return files;
  }

  const ownershipRaw = await readJsonArtifact(rootDir, fileOwnershipPath);
  if (isFailure(ownershipRaw)) {
    return ownershipRaw;
  }
  const fileOwnership = parseFileOwnershipArtifact(
    JSON.stringify(ownershipRaw),
    fileOwnershipPath,
  );
  if (isFailure(fileOwnership)) {
    return fileOwnership;
  }

  const implementationMap = await readTextArtifact(
    rootDir,
    implementationMapPath,
  );
  if (isFailure(implementationMap)) {
    return implementationMap;
  }

  return {
    ok: true,
    status: workflow.status,
    nextAction: workflow.nextAction,
    content: synthesizeThinPlanV2Content({
      manifestContent,
      workflow,
      files,
      fileOwnership,
      implementationMap: implementationMap.content,
    }),
  };
};

export const parsePlan = async ({
  planName,
  rootDir = process.cwd(),
}: ParsePlanOptions): Promise<ParsedPlan | Failure> => {
  const normalized = normalizePlanArgument(planName);
  if (isFailure(normalized)) {
    return normalized;
  }

  const planPath = normalized.planPath;
  const absolutePlanPath = path.join(rootDir, planPath);
  if (!existsSync(absolutePlanPath)) {
    return { ok: false, reason: `plan file does not exist: ${planPath}` };
  }

  let content: string;
  try {
    content = await readFile(absolutePlanPath, "utf8");
  } catch (error) {
    return {
      ok: false,
      reason: `plan file cannot be read: ${planPath}: ${String(error)}`,
    };
  }

  for (const instructionPath of extractPlanInstructionPaths(content)) {
    if (!existsSync(path.join(rootDir, instructionPath))) {
      return {
        ok: false,
        reason: `plan references missing instruction path: ${instructionPath}`,
      };
    }
  }

  const executionMode = extractSectionValue(content, "## Execution Mode");
  if (normalizeWorkflowStateValue(executionMode ?? "") === "manual") {
    return {
      ok: false,
      reason: `manual plan cannot be run by workflow-runner: ${planPath}. Use .ai/prompts/manual-execute-plan.md in the current conversation instead.`,
    };
  }
  if (
    executionMode !== null &&
    normalizeWorkflowStateValue(executionMode) !== "runner-managed"
  ) {
    return {
      ok: false,
      reason: `unknown execution mode in ${planPath}: ${normalizeWorkflowStateValue(executionMode) || "(empty)"}. Expected manual or runner-managed.`,
    };
  }

  const extractedStatus = extractSectionValue(content, "## Status");
  if (extractedStatus === null) {
    return { ok: false, reason: "plan is missing ## Status" };
  }
  let rawStatus = normalizeWorkflowStateValue(extractedStatus);
  if (rawStatus.length === 0) {
    return { ok: false, reason: "plan status value is empty" };
  }
  if (!isStatus(rawStatus)) {
    return { ok: false, reason: `unknown status value: ${rawStatus}` };
  }

  const extractedNextAction = extractSectionValue(content, "## Next Action");
  if (extractedNextAction === null) {
    return { ok: false, reason: "plan is missing ## Next Action" };
  }
  let rawNextAction = normalizeWorkflowStateValue(extractedNextAction);
  if (rawNextAction.length === 0) {
    return { ok: false, reason: "plan next action value is empty" };
  }
  if (!isNextAction(rawNextAction)) {
    return { ok: false, reason: `unknown next action value: ${rawNextAction}` };
  }

  const thinPlan = await validateThinPlanContract({
    rootDir,
    planName: normalized.planName,
    content,
  });
  if (isFailure(thinPlan)) {
    return thinPlan;
  }

  if (thinPlan.contract === "thin-plan-v2") {
    const recovery = await recoverThinPlanV2FailedReviewState({
      rootDir,
      planName: normalized.planName,
      planPath,
      manifestContent: content,
      manifestStatus: rawStatus,
      manifestNextAction: rawNextAction,
    });
    if (isFailure(recovery)) {
      return recovery;
    }
    if (recovery.recovered) {
      content = recovery.manifestContent;
      rawStatus = "active";
      rawNextAction = "execute-plan";
    }
    const loaded = await loadThinPlanV2WorkingContent({
      rootDir,
      planName: normalized.planName,
      planPath,
      manifestContent: content,
    });
    if (isFailure(loaded)) {
      return loaded;
    }
    if (loaded.status !== rawStatus || loaded.nextAction !== rawNextAction) {
      return {
        ok: false,
        reason: `thin-plan-v2 manifest state mismatch: plan manifest has ${rawStatus} + ${rawNextAction}, but .ai/artifacts/${normalized.planName}/state/workflow.json has ${loaded.status} + ${loaded.nextAction}`,
      };
    }

    return {
      ok: true,
      planName: normalized.planName,
      planPath,
      absolutePlanPath,
      manifestContent: content,
      content: loaded.content,
      thinPlanContract: thinPlan.contract,
      status: loaded.status,
      nextAction: loaded.nextAction,
      warnings: thinPlan.warnings,
    };
  }

  return {
    ok: true,
    planName: normalized.planName,
    planPath,
    absolutePlanPath,
    manifestContent: content,
    content,
    thinPlanContract: thinPlan.contract,
    status: rawStatus,
    nextAction: rawNextAction,
    warnings: thinPlan.warnings,
  };
};

export const preflightManualPlanExecutionMode = async ({
  planName,
  rootDir = process.cwd(),
}: ParsePlanOptions): Promise<{ ok: true } | Failure> => {
  const normalized = normalizePlanArgument(planName);
  if (isFailure(normalized)) {
    return normalized;
  }

  const absolutePlanPath = path.join(rootDir, normalized.planPath);
  if (!existsSync(absolutePlanPath)) {
    return { ok: true };
  }

  let content: string;
  try {
    content = await readFile(absolutePlanPath, "utf8");
  } catch (error) {
    return {
      ok: false,
      reason: `plan file cannot be read: ${normalized.planPath}: ${String(error)}`,
    };
  }

  if (
    normalizeWorkflowStateValue(
      extractSectionValue(content, "## Execution Mode") ?? "",
    ) === "manual"
  ) {
    return {
      ok: false,
      reason: `manual plan cannot be run by workflow-runner: ${normalized.planPath}. Use .ai/prompts/manual-execute-plan.md in the current conversation instead.`,
    };
  }

  return { ok: true };
};
