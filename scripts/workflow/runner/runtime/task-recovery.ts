import { writeFile } from "node:fs/promises";
import path from "node:path";
import {
  parseThinPlanWorkflowState,
  readJsonArtifact,
  thinPlanArtifactPath,
  writeManifestWorkflowState,
} from "../plan/state.ts";
import type { Failure, ParsedPlan, ProcessRunner } from "../types.ts";
import { asRecord, boundedInlineExcerpt, isFailure } from "../types.ts";
import { DOCUMENT_FORMATS } from "../../document-formats.ts";

const canonicalWorkflowRecord = (
  record: Record<string, unknown>,
  workflowState: import("../../contracts/stage.ts").WorkflowState,
): Record<string, unknown> => ({ documentFormat: DOCUMENT_FORMATS.workflowState, ...record, workflowState });

export const gitHeadShortSha = async (
  rootDir: string,
  processRunner: ProcessRunner,
): Promise<{ ok: true; sha: string } | Failure> => {
  const result = await processRunner({ command: "git", args: ["rev-parse", "--short", "HEAD"], cwd: rootDir, input: "", promptPath: "git-task-commit-sha" });
  if (!result.launched) return { ok: false, reason: `could not launch task commit sha lookup: ${result.error}` };
  if (result.exitCode !== 0) return { ok: false, reason: `task commit sha lookup exited with code ${result.exitCode}: ${boundedInlineExcerpt(result.stderr || result.stdout)}` };
  const sha = result.stdout.trim().split(/\s+/)[0] ?? "";
  return sha ? { ok: true, sha } : { ok: false, reason: "task commit sha lookup returned empty output" };
};

export const reopenPlanForNextTask = async (plan: ParsedPlan): Promise<{ ok: true } | Failure> => {
  const baseContent = plan.thinPlanContract === "thin-plan" ? plan.manifestContent : plan.content;
  const nextContent = writeManifestWorkflowState(baseContent, "active");
  let workflowStateUpdate: { absolutePath: string; content: string } | undefined;
  if (plan.thinPlanContract === "thin-plan") {
    const rootDir = path.dirname(path.dirname(path.dirname(plan.absolutePlanPath)));
    const workflowPath = thinPlanArtifactPath(plan.planName, "state", "workflow.json");
    const workflowJson = await readJsonArtifact(rootDir, workflowPath);
    if (isFailure(workflowJson)) return workflowJson;
    const workflow = parseThinPlanWorkflowState(workflowJson, plan.planPath, workflowPath);
    if (isFailure(workflow)) return workflow;
    const workflowRecord = asRecord(workflowJson);
    if (!workflowRecord) return { ok: false, reason: `thin-plan workflow state is malformed: ${workflowPath}` };
    workflowStateUpdate = {
      absolutePath: path.join(rootDir, workflowPath),
      content: `${JSON.stringify({ ...canonicalWorkflowRecord(workflowRecord, "active"), updatedAt: new Date().toISOString() }, null, 2)}\n`,
    };
  }
  try {
    await writeFile(plan.absolutePlanPath, nextContent, "utf8");
    if (workflowStateUpdate) await writeFile(workflowStateUpdate.absolutePath, workflowStateUpdate.content, "utf8");
    return { ok: true };
  } catch (error) {
    return { ok: false, reason: `plan cannot be reopened for next task: ${String(error)}` };
  }
};
