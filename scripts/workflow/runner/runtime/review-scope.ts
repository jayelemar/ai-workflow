import { decideWorkflowAutoNarrow } from "../../telemetry/token-warnings.ts";
import {
  buildReviewScopeMetadata,
  runScopeCleanupForPathBatches,
  runScopeCleanupForPaths,
} from "../review/scope.ts";
import type {
  Failure,
  ProcessRunner,
  ReviewScopeMetadata,
  WorkflowRunnerCodexRuntime,
} from "../types.ts";

export const prepareReviewScopeForPaths = async ({
  codexRuntime,
  rootDir,
  planPath,
  planContent,
  paths,
  processRunner,
  narrowPass,
  autoNarrowReason,
}: {
  codexRuntime: WorkflowRunnerCodexRuntime;
  rootDir: string;
  planPath: string;
  planContent: string;
  paths: string[];
  processRunner: ProcessRunner;
  narrowPass: number;
  autoNarrowReason?: string;
}): Promise<{ ok: true; scope: ReviewScopeMetadata } | Failure> => {
  let cleanup = await runScopeCleanupForPaths({
    codexRuntime,
    rootDir,
    planPath,
    planContent,
    paths,
    processRunner,
    mode: "review",
  });
  const skippedCleanupDiffBytes = cleanup.skippedLargeDiff
    ? cleanup.diffBytes
    : undefined;
  if (cleanup.skippedLargeDiff) {
    cleanup = await runScopeCleanupForPathBatches({
      codexRuntime,
      rootDir,
      planPath,
      planContent,
      paths,
      processRunner,
      mode: "review",
    });
  }
  const unresolvedCleanupDiffBytes = cleanup.skippedLargeDiff
    ? cleanup.diffBytes
    : skippedCleanupDiffBytes;
  let effectiveNarrowPass = narrowPass;
  let effectiveAutoNarrowReason = autoNarrowReason;
  if (unresolvedCleanupDiffBytes) {
    const decision = decideWorkflowAutoNarrow({
      currentPass: effectiveNarrowPass,
      cleanupDiffBytes: unresolvedCleanupDiffBytes,
    });
    if (decision.shouldNarrow) {
      effectiveNarrowPass = decision.nextPass;
    }
    effectiveAutoNarrowReason = [effectiveAutoNarrowReason, decision.reason]
      .filter(Boolean)
      .join("; ");
  }
  return await buildReviewScopeMetadata({
    rootDir,
    paths,
    planContent,
    processRunner,
    narrowPass: effectiveNarrowPass,
    autoNarrowReason: effectiveAutoNarrowReason,
  });
};
