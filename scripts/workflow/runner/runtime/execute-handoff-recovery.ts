import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";

import {
  canonicalFileOwnershipArtifact,
  parseFileOwnershipArtifact,
  readGitChangedFileEntries,
  readGitHeadSha,
} from "../../ownership/file-ownership.ts";
import { uniquePaths } from "../plan/parser.ts";
import {
  normalizeWorkflowEventHistory,
  parseThinPlanV2WorkflowState,
  readJsonArtifact,
  thinPlanV2ArtifactPath,
  writeManifestWorkflowState,
} from "../plan/state.ts";
import type { Failure, ParsedPlan, ProcessRunner } from "../types.ts";
import { asRecord, isFailure } from "../types.ts";
import {
  canonicalWorkflowRecord,
  nextWorkflowEventVersion,
  workflowEventBody,
} from "./workflow-events.ts";

export const workflowOutputHasValidationPass = (stdout: string): boolean =>
  /\bvalidation\s+passed\b/i.test(stdout) ||
  /\bvalidation\s*:\s*(?:pass|passed|ok|success)\b/i.test(stdout);

export const recoverThinPlanV2ExecuteHandoff = async ({
  rootDir,
  plan,
  processRunner,
  stdout,
  timestamp,
}: {
  rootDir: string;
  plan: ParsedPlan;
  processRunner: ProcessRunner;
  stdout: string;
  timestamp: () => string;
}): Promise<{ ok: true; recovered: boolean } | Failure> => {
  if (
    plan.thinPlanContract !== "thin-plan-v2" ||
    plan.workflowState !== "active" ||
    !workflowOutputHasValidationPass(stdout)
  ) {
    return { ok: true, recovered: false };
  }

  const changed = await readGitChangedFileEntries(rootDir, processRunner);
  if (!changed.ok) {
    return changed;
  }
  const entries = changed.entries.filter(
    (entry) => !entry.path.startsWith(".ai/"),
  );
  if (entries.length === 0) {
    return { ok: true, recovered: false };
  }

  const head = await readGitHeadSha(rootDir, processRunner);
  if (!head.ok) {
    return head;
  }

  const workflowPath = thinPlanV2ArtifactPath(
    plan.planName,
    "state",
    "workflow.json",
  );
  const workflowRaw = await readJsonArtifact(rootDir, workflowPath);
  if (isFailure(workflowRaw)) {
    return workflowRaw;
  }
  const workflow = parseThinPlanV2WorkflowState(
    workflowRaw,
    plan.planPath,
    workflowPath,
  );
  if (isFailure(workflow)) {
    return workflow;
  }
  const workflowRecord = asRecord(workflowRaw);
  if (!workflowRecord) {
    return {
      ok: false,
      reason: `thin-plan-v2 workflow state is malformed: ${workflowPath}`,
    };
  }

  let executionVersion: number;
  let validationVersion: number;
  try {
    executionVersion = await nextWorkflowEventVersion({
      rootDir,
      planName: plan.planName,
      kind: "execution",
    });
    validationVersion = await nextWorkflowEventVersion({
      rootDir,
      planName: plan.planName,
      kind: "validation",
    });
  } catch (error) {
    return {
      ok: false,
      reason: `workflow event version cannot be selected: ${String(error)}`,
    };
  }

  const executionPath = thinPlanV2ArtifactPath(
    plan.planName,
    "events",
    `execution-v${executionVersion}.md`,
  );
  const validationPath = thinPlanV2ArtifactPath(
    plan.planName,
    "events",
    `validation-v${validationVersion}.md`,
  );
  const changedPaths = entries.map((entry) => entry.path);
  const created = entries
    .filter((entry) => entry.change === "created")
    .map((entry) => entry.path);
  const modified = entries
    .filter((entry) => entry.change === "modified")
    .map((entry) => entry.path);
  const deleted = entries
    .filter((entry) => entry.change === "deleted")
    .map((entry) => entry.path);
  const now = timestamp();

  const filesPath = thinPlanV2ArtifactPath(
    plan.planName,
    "state",
    "files.json",
  );
  const ownershipPath = thinPlanV2ArtifactPath(
    plan.planName,
    "state",
    "file-ownership.json",
  );
  const ownershipRaw = await readJsonArtifact(rootDir, ownershipPath);
  if (isFailure(ownershipRaw)) {
    return ownershipRaw;
  }
  const ownership = parseFileOwnershipArtifact(
    JSON.stringify(ownershipRaw),
    ownershipPath,
  );
  if (isFailure(ownership)) {
    return ownership;
  }

  const latest = {
    ...(asRecord(workflowRecord.latest) ?? {}),
    execution: {
      version: executionVersion,
      path: executionPath,
      evidence: executionPath,
      summary:
        "Runner recovered the execute-plan review handoff after successful implementation left thin-plan state unchanged.",
      state: "review-ready",
      result: "review-ready",
    },
    validation: {
      version: validationVersion,
      path: validationPath,
      evidence: validationPath,
      summary:
        "Agent output reported validation passed during execute-plan recovery.",
      result: "passed",
    },
  };
  const history = uniquePaths([
    ...(normalizeWorkflowEventHistory(workflowRecord.history) ?? []),
    executionPath,
    validationPath,
  ]);

  try {
    await mkdir(path.join(rootDir, path.dirname(executionPath)), {
      recursive: true,
    });
    await writeFile(
      path.join(rootDir, executionPath),
      workflowEventBody({
        title: `# Execution v${executionVersion}`,
        summary:
          "Runner recovered the execute-plan review handoff after successful implementation left thin-plan state unchanged.",
        evidenceLines: [
          "execute-plan exited successfully.",
          "Plan manifest and workflow state were unchanged, so the runner advanced the thin-plan state.",
          ...changedPaths.map((filePath) => `Changed file: ${filePath}`),
        ],
      }),
      "utf8",
    );
    await writeFile(
      path.join(rootDir, validationPath),
      workflowEventBody({
        title: `# Validation v${validationVersion}`,
        summary:
          "Agent output reported validation passed during execute-plan recovery.",
        evidenceLines: [
          "execute-plan stdout contained a validation passed signal.",
          "Review remains required before commit-summary.",
        ],
      }),
      "utf8",
    );
    await writeFile(
      path.join(rootDir, filesPath),
      `${JSON.stringify(
        {
          created,
          modified,
          deleted,
          changedFiles: changedPaths,
          released: [],
          headSha: head.sha,
        },
        null,
        2,
      )}\n`,
      "utf8",
    );
    await writeFile(
      path.join(rootDir, ownershipPath),
      `${JSON.stringify(
        canonicalFileOwnershipArtifact({
          ...ownership,
          resolvedFiles: changedPaths,
          changedFiles: changedPaths,
          headSha: head.sha,
          updatedAt: now,
        }),
        null,
        2,
      )}\n`,
      "utf8",
    );
    await writeFile(
      path.join(rootDir, workflowPath),
      `${JSON.stringify(
        {
          ...canonicalWorkflowRecord(workflowRecord, "review"),
          latest,
          history,
          unresolvedBlockers: [],
          updatedAt: now,
        },
        null,
        2,
      )}\n`,
      "utf8",
    );
    await writeFile(
      plan.absolutePlanPath,
      writeManifestWorkflowState(plan.manifestContent, "review"),
      "utf8",
    );
  } catch (error) {
    return {
      ok: false,
      reason: `thin-plan-v2 execute handoff recovery failed: ${String(error)}`,
    };
  }

  return { ok: true, recovered: true };
};

