import { existsSync } from "node:fs";
import { readFile } from "node:fs/promises";
import path from "node:path";

import type { WorkflowState } from "../../contracts/stage.ts";
import { parseFileOwnershipArtifact } from "../../ownership/file-ownership.ts";
import { normalizePlanArgument } from "../cli.ts";
import { validateThinPlanContract } from "../thin-plan.ts";
import { isFailure, type Failure, type ParsedPlan, type ParsePlanOptions } from "../types.ts";
import { extractPlanInstructionPaths, extractSectionValue, isWorkflowState, normalizeWorkflowStateValue } from "./parser.ts";
import { readTextArtifact } from "./state-recovery.ts";
import { synthesizeThinPlanContent } from "./state-synthesis.ts";
import { parseThinPlanFilesState, parseThinPlanWorkflowState, readJsonArtifact, thinPlanArtifactPath } from "./thin-plan-sidecars.ts";

export { normalizeWorkflowEventHistory, parseThinPlanFilesState, parseThinPlanWorkflowState, readJsonArtifact, thinPlanArtifactPath, workflowReviewSupersededByProgress } from "./thin-plan-sidecars.ts";
export { readTextArtifact, replaceManifestWorkflowValue } from "./state-recovery.ts";
export { latestNumber, latestRecord, latestString, selectRelevantWorkflowEvent, synthesizeThinPlanContent } from "./state-synthesis.ts";

type ManifestWorkflowState = { workflowState: WorkflowState };

const sectionRange = (content: string, heading: string): [number, number] | undefined => {
  const lines = content.split(/\r?\n/);
  const start = lines.findIndex((line) => line.trim() === heading);
  if (start < 0) return undefined;
  let end = start + 1;
  while (end < lines.length && !lines[end].trim().startsWith("## ")) end += 1;
  return [start, end];
};

export const writeManifestWorkflowState = (content: string, workflowState: WorkflowState): string => {
  const lines = content.split(/\r?\n/);
  const legacyStart = sectionRange(content, "## Workflow State")?.[0] ?? -1;
  for (const heading of ["## Workflow State"]) {
    const range = sectionRange(lines.join("\n"), heading);
    if (range) lines.splice(range[0], range[1] - range[0]);
  }
  const insertion = legacyStart >= 0 ? Math.min(legacyStart, lines.length) : (() => {
    const index = lines.findIndex((line) => line.trim() === "## Spec");
    return index >= 0 ? index : lines.length;
  })();
  lines.splice(insertion, 0, "## Workflow State", "", workflowState, "");
  return lines.join("\n").replace(/\n{3,}/g, "\n\n");
};

const parseManifestWorkflowState = (content: string): ManifestWorkflowState | Failure => {
  const canonical = extractSectionValue(content, "## Workflow State");
  if (
    extractSectionValue(content, "## Status") !== null ||
    extractSectionValue(content, "## Next Action") !== null
  ) {
    return { ok: false, reason: "plan must use only ## Workflow State" };
  }
  if (canonical === null) return { ok: false, reason: "plan is missing ## Workflow State" };
  const value = normalizeWorkflowStateValue(canonical);
  if (!value) return { ok: false, reason: "plan workflow state value is empty" };
  if (!isWorkflowState(value)) return { ok: false, reason: `unknown workflowState value: ${value}` };
  return { workflowState: value };
};

export const loadThinPlanWorkingContent = async ({ rootDir, planName, planPath, manifestContent }: { rootDir: string; planName: string; planPath: string; manifestContent: string }): Promise<{ ok: true; content: string; workflowState: WorkflowState } | Failure> => {
  const workflowPath = thinPlanArtifactPath(planName, "state", "workflow.json");
  const filesPath = thinPlanArtifactPath(planName, "state", "files.json");
  const fileOwnershipPath = thinPlanArtifactPath(planName, "state", "file-ownership.json");
  const implementationMapPath = thinPlanArtifactPath(planName, "implementation-map.md");
  const workflowJson = await readJsonArtifact(rootDir, workflowPath);
  if (isFailure(workflowJson)) return workflowJson;
  const workflow = parseThinPlanWorkflowState(workflowJson, planPath, workflowPath);
  if (isFailure(workflow)) return workflow;
  const filesJson = await readJsonArtifact(rootDir, filesPath);
  if (isFailure(filesJson)) return filesJson;
  const files = parseThinPlanFilesState(filesJson, filesPath);
  if (isFailure(files)) return files;
  const ownershipRaw = await readJsonArtifact(rootDir, fileOwnershipPath);
  if (isFailure(ownershipRaw)) return ownershipRaw;
  const fileOwnership = parseFileOwnershipArtifact(JSON.stringify(ownershipRaw), fileOwnershipPath);
  if (isFailure(fileOwnership)) return fileOwnership;
  const implementationMap = await readTextArtifact(rootDir, implementationMapPath);
  if (isFailure(implementationMap)) return implementationMap;
  return { ok: true, workflowState: workflow.workflowState, content: synthesizeThinPlanContent({ manifestContent, workflow, files, fileOwnership, implementationMap: implementationMap.content }) };
};

export const parsePlan = async ({ planName, rootDir = process.cwd() }: ParsePlanOptions): Promise<ParsedPlan | Failure> => {
  const normalized = normalizePlanArgument(planName);
  if (isFailure(normalized)) return normalized;
  const { planPath, planName: normalizedPlanName } = normalized;
  const absolutePlanPath = path.join(rootDir, planPath);
  if (!existsSync(absolutePlanPath)) return { ok: false, reason: `plan file does not exist: ${planPath}` };
  let content: string;
  try { content = await readFile(absolutePlanPath, "utf8"); } catch (error) { return { ok: false, reason: `plan file cannot be read: ${planPath}: ${String(error)}` }; }
  for (const instructionPath of extractPlanInstructionPaths(content)) if (!existsSync(path.join(rootDir, instructionPath))) return { ok: false, reason: `plan references missing instruction path: ${instructionPath}` };
  const executionMode = extractSectionValue(content, "## Execution Mode");
  if (normalizeWorkflowStateValue(executionMode ?? "") === "manual") return { ok: false, reason: `manual plan cannot be run by workflow-runner: ${planPath}. Use .ai/prompts/manual-execute-plan.md in the current conversation instead.` };
  if (executionMode !== null && normalizeWorkflowStateValue(executionMode) !== "runner-managed") return { ok: false, reason: `unknown execution mode in ${planPath}: ${normalizeWorkflowStateValue(executionMode) || "(empty)"}. Expected manual or runner-managed.` };
  let manifest = parseManifestWorkflowState(content);
  if (isFailure(manifest)) return manifest;
  const thinPlan = await validateThinPlanContract({ rootDir, planName: normalizedPlanName, content });
  if (isFailure(thinPlan)) return thinPlan;
  if (thinPlan.contract === "thin-plan") {
    const workflowPath = thinPlanArtifactPath(normalizedPlanName, "state", "workflow.json");
    const workflowRaw = await readJsonArtifact(rootDir, workflowPath);
    if (isFailure(workflowRaw)) return workflowRaw;
    const workflow = parseThinPlanWorkflowState(workflowRaw, planPath, workflowPath);
    if (isFailure(workflow)) return workflow;
    if (manifest.workflowState !== workflow.workflowState) return { ok: false, reason: `thin-plan workflow state mismatch: plan manifest has ${manifest.workflowState}, but ${workflowPath} has ${workflow.workflowState}` };
    const loaded = await loadThinPlanWorkingContent({ rootDir, planName: normalizedPlanName, planPath, manifestContent: content });
    if (isFailure(loaded)) return loaded;
    if (loaded.workflowState !== manifest.workflowState) return { ok: false, reason: `thin-plan workflow state mismatch: plan manifest has ${manifest.workflowState}, but ${workflowPath} has ${loaded.workflowState}` };
    return { ok: true, planName: normalizedPlanName, planPath, absolutePlanPath, manifestContent: content, content: loaded.content, thinPlanContract: thinPlan.contract, workflowState: loaded.workflowState, warnings: thinPlan.warnings };
  }
  return { ok: true, planName: normalizedPlanName, planPath, absolutePlanPath, manifestContent: content, content, thinPlanContract: thinPlan.contract, workflowState: manifest.workflowState, warnings: thinPlan.warnings };
};

export const preflightManualPlanExecutionMode = async ({ planName, rootDir = process.cwd() }: ParsePlanOptions): Promise<{ ok: true } | Failure> => {
  const normalized = normalizePlanArgument(planName);
  if (isFailure(normalized)) return normalized;
  const absolutePlanPath = path.join(rootDir, normalized.planPath);
  if (!existsSync(absolutePlanPath)) return { ok: true };
  let content: string;
  try { content = await readFile(absolutePlanPath, "utf8"); } catch (error) { return { ok: false, reason: `plan file cannot be read: ${normalized.planPath}: ${String(error)}` }; }
  if (normalizeWorkflowStateValue(extractSectionValue(content, "## Execution Mode") ?? "") === "manual") return { ok: false, reason: `manual plan cannot be run by workflow-runner: ${normalized.planPath}. Use .ai/prompts/manual-execute-plan.md in the current conversation instead.` };
  return { ok: true };
};
