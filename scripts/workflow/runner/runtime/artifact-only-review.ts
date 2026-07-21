import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";

import { uniquePaths } from "../plan/parser.ts";
import {
  normalizeWorkflowEventHistory,
  parseThinPlanWorkflowState,
  readJsonArtifact,
  thinPlanArtifactPath,
  writeManifestWorkflowState,
} from "../plan/state.ts";
import type { Failure, FileOwnershipArtifact, ParsedPlan } from "../types.ts";
import { asRecord, isFailure } from "../types.ts";
import {
  canonicalWorkflowRecord,
  nextWorkflowEventVersion,
  workflowEventBody,
} from "./workflow-events.ts";

export const declaresNoCommitBoundary = (content: string): boolean =>
  /^## Commit Boundaries\s*\n\s*N\/A\b/im.test(content);

export const isArtifactOnlyNoCommitReview = ({
  plan,
  artifact,
}: {
  plan: ParsedPlan;
  artifact: FileOwnershipArtifact | undefined;
}): boolean =>
  plan.thinPlanContract === "thin-plan" &&
  declaresNoCommitBoundary(plan.manifestContent) &&
  (artifact?.changedFiles.length ?? 0) > 0 &&
  artifact!.changedFiles.every((filePath) => filePath.startsWith(".ai/"));

export const completeArtifactOnlyNoCommitReview = async ({
  rootDir,
  plan,
  timestamp,
  continueExecution = false,
}: {
  rootDir: string;
  plan: ParsedPlan;
  timestamp: () => string;
  continueExecution?: boolean;
}): Promise<{ ok: true } | Failure> => {
  const workflowPath = thinPlanArtifactPath(
    plan.planName,
    "state",
    "workflow.json",
  );
  const workflowRaw = await readJsonArtifact(rootDir, workflowPath);
  if (isFailure(workflowRaw)) {
    return workflowRaw;
  }
  const workflow = parseThinPlanWorkflowState(
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
      reason: `thin-plan workflow state is malformed: ${workflowPath}`,
    };
  }

  let reviewVersion: number;
  try {
    reviewVersion = await nextWorkflowEventVersion({
      rootDir,
      planName: plan.planName,
      kind: "review",
    });
  } catch (error) {
    return {
      ok: false,
      reason: `workflow review event version cannot be selected: ${String(error)}`,
    };
  }

  const reviewPath = thinPlanArtifactPath(
    plan.planName,
    "events",
    `review-v${reviewVersion}.md`,
  );
  const latest = {
    ...(asRecord(workflowRecord.latest) ?? {}),
    review: {
      version: reviewVersion,
      summary:
        continueExecution
          ? "Runner accepted artifact-only task review; continuing to the next task."
          : "Runner accepted declared artifact-only review; no committable paths exist.",
      decision: continueExecution ? "active" : "completed",
      result: "PASS",
      evidence: reviewPath,
      noCommit: true,
      unresolvedFindings: [],
    },
  };
  const history = uniquePaths([
    ...(normalizeWorkflowEventHistory(workflowRecord.history) ?? []),
    reviewPath,
  ]);
  const now = timestamp();

  try {
    await mkdir(path.join(rootDir, path.dirname(reviewPath)), {
      recursive: true,
    });
    await writeFile(
      path.join(rootDir, reviewPath),
      workflowEventBody({
        title: `# Review v${reviewVersion}`,
        summary:
          continueExecution
            ? "Declared artifact-only task review passed; remaining tasks continue without a commit."
            : "Declared read-only plan has only .ai artifact changes and no commit boundary.",
        evidenceLines: [
          "All active plan-owned changed paths are under .ai/.",
          "Plan Commit Boundaries explicitly declares N/A.",
          "Runner skipped git staging, review Codex execution, and commit-summary Codex execution.",
        ],
      }),
      "utf8",
    );
    await writeFile(
      path.join(rootDir, workflowPath),
      `${JSON.stringify(
        {
          ...canonicalWorkflowRecord(workflowRecord, continueExecution ? "active" : "completed"),
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
      writeManifestWorkflowState(
        plan.manifestContent,
        continueExecution ? "active" : "completed",
      ),
      "utf8",
    );
  } catch (error) {
    return {
      ok: false,
      reason: `artifact-only no-commit review completion failed: ${String(error)}`,
    };
  }

  return { ok: true };
};

export const hasArtifactOnlyNoCommitReview = async ({
  rootDir,
  plan,
}: {
  rootDir: string;
  plan: ParsedPlan;
}): Promise<{ ok: true; noCommit: boolean } | Failure> => {
  if (
    plan.thinPlanContract !== "thin-plan" ||
    !declaresNoCommitBoundary(plan.manifestContent)
  ) {
    return { ok: true, noCommit: false };
  }
  const workflowPath = thinPlanArtifactPath(
    plan.planName,
    "state",
    "workflow.json",
  );
  const workflowRaw = await readJsonArtifact(rootDir, workflowPath);
  if (isFailure(workflowRaw)) {
    return workflowRaw;
  }
  const review = asRecord(asRecord(workflowRaw)?.latest)?.review;
  return { ok: true, noCommit: asRecord(review)?.noCommit === true };
};


