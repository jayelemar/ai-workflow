import path from "node:path";

import {
  WORKFLOW_AUTO_NARROW_PASS_LIMIT,
  WORKFLOW_REVIEW_FULL_DIFF_BYTE_LIMIT,
  WORKFLOW_REVIEW_PRIMARY_PATH_LIMIT,
  decideWorkflowAutoNarrow,
} from "../../telemetry/token-warnings.ts";
import type {
  Failure,
  ProcessResult,
  ProcessRunner,
  ReviewScopeMetadata,
} from "../types.ts";

const uniquePaths = (paths: string[]): string[] => [...new Set(paths)];

const readCachedDiffForPaths = async (
  rootDir: string,
  paths: string[],
  processRunner: ProcessRunner,
  options: {
    unified?: number;
    promptPath?: string;
  } = {},
): Promise<string | undefined> => {
  const result = await processRunner({
    command: "git",
    args: [
      "diff",
      "--cached",
      ...(options.unified === undefined ? [] : [`--unified=${options.unified}`]),
      "--",
      ...paths,
    ],
    cwd: rootDir,
    input: "",
    promptPath: options.promptPath ?? "git-scope-cleanup-diff",
  }).catch(
    (): ProcessResult => ({
      launched: false,
      stdout: "",
      stderr: "",
      error: "failed to read staged diff",
    }),
  );

  if (!result.launched || result.exitCode !== 0) {
    return undefined;
  }

  const diff = result.stdout.trim();
  return diff.length > 0 ? diff : undefined;
};

const readCachedStatForPaths = async (
  rootDir: string,
  paths: string[],
  processRunner: ProcessRunner,
): Promise<string | undefined> => {
  const result = await processRunner({
    command: "git",
    args: ["diff", "--cached", "--stat", "--", ...paths],
    cwd: rootDir,
    input: "",
    promptPath: "git-review-staged-stat",
  }).catch(
    (): ProcessResult => ({
      launched: false,
      stdout: "",
      stderr: "",
      error: "failed to read staged diff stat",
    }),
  );

  if (!result.launched || result.exitCode !== 0) {
    return undefined;
  }

  const statOutput = result.stdout.trim();
  return statOutput.length > 0 ? statOutput : undefined;
};

const statOutputPaths = (statOutput: string | undefined): string[] => {
  if (!statOutput) {
    return [];
  }
  const paths: string[] = [];
  for (const line of statOutput.split(/\r?\n/)) {
    const match = line.match(/^\s*(.+?)\s+\|\s+\d+/);
    if (!match) {
      continue;
    }
    paths.push(match[1].trim());
  }
  return uniquePaths(paths);
};

const pathsMentionedInText = (text: string, candidates: string[]): string[] =>
  uniquePaths(candidates.filter((candidate) => text.includes(candidate)));

const isGeneratedReviewArtifact = (pathValue: string): boolean => {
  const filename = path.posix.basename(pathValue);
  return (
    filename === "generated.ts" ||
    filename === "generated.tsx" ||
    /\.generated\.[cm]?[jt]sx?$/.test(filename)
  );
};

export const selectReviewPrimaryPaths = ({
  allPaths,
  narrowPass,
  latestTaskPaths = [],
  blockerPaths = [],
  suspiciousStatPaths = [],
}: {
  allPaths: string[];
  narrowPass: number;
  latestTaskPaths?: string[];
  blockerPaths?: string[];
  suspiciousStatPaths?: string[];
}): string[] => {
  const all = uniquePaths(allPaths);
  const inAll = (pathValue: string) => all.includes(pathValue);
  const cap = (paths: string[]) =>
    uniquePaths(paths)
      .filter(inAll)
      .slice(0, WORKFLOW_REVIEW_PRIMARY_PATH_LIMIT);

  if (narrowPass === 1 || narrowPass === 2) {
    const focused = cap([
      ...latestTaskPaths,
      ...blockerPaths,
      ...suspiciousStatPaths,
    ]);
    return focused.length > 0
      ? focused
      : all.slice(0, WORKFLOW_REVIEW_PRIMARY_PATH_LIMIT);
  }

  if (narrowPass >= WORKFLOW_AUTO_NARROW_PASS_LIMIT) {
    const focused = cap([
      ...blockerPaths,
      ...latestTaskPaths,
      ...suspiciousStatPaths,
    ]);
    return focused.length > 0
      ? focused
      : all.slice(0, WORKFLOW_REVIEW_PRIMARY_PATH_LIMIT);
  }

  return all.slice(0, WORKFLOW_REVIEW_PRIMARY_PATH_LIMIT);
};

export const splitReviewPrimaryPathsIntoBatches = ({
  paths,
  diffBytesByPath,
}: {
  paths: string[];
  diffBytesByPath: Map<string, number>;
}): string[][] => {
  const batches: string[][] = [];
  let batch: string[] = [];
  let batchBytes = 0;

  for (const reviewPath of paths) {
    const pathBytes = diffBytesByPath.get(reviewPath) ?? 0;
    if (
      batch.length > 0 &&
      batchBytes + pathBytes > WORKFLOW_REVIEW_FULL_DIFF_BYTE_LIMIT
    ) {
      batches.push(batch);
      batch = [];
      batchBytes = 0;
    }
    batch.push(reviewPath);
    batchBytes += pathBytes;
  }

  if (batch.length > 0) {
    batches.push(batch);
  }
  return batches;
};

export const buildReviewScopeMetadata = async ({
  rootDir,
  paths,
  planContent,
  processRunner,
  narrowPass,
  autoNarrowReason,
}: {
  rootDir: string;
  paths: string[];
  planContent: string;
  processRunner: ProcessRunner;
  narrowPass: number;
  autoNarrowReason?: string;
}): Promise<
  | {
      ok: true;
      scope: ReviewScopeMetadata;
    }
  | Failure
> => {
  const reviewAllPaths = uniquePaths(paths);
  const summaryOnlyPaths = reviewAllPaths.filter(isGeneratedReviewArtifact);
  const fullDiffCandidates = reviewAllPaths.filter(
    (reviewPath) => !summaryOnlyPaths.includes(reviewPath),
  );
  let effectivePass = narrowPass;
  let reason = autoNarrowReason;
  const statOutput = await readCachedStatForPaths(
    rootDir,
    reviewAllPaths,
    processRunner,
  );
  const suspiciousStatPaths = statOutputPaths(statOutput);
  const blockerPaths = pathsMentionedInText(planContent, reviewAllPaths);

  while (true) {
    const reviewPrimaryPaths = selectReviewPrimaryPaths({
      allPaths: fullDiffCandidates,
      narrowPass: effectivePass,
      blockerPaths: blockerPaths.filter((reviewPath) =>
        fullDiffCandidates.includes(reviewPath),
      ),
      suspiciousStatPaths: suspiciousStatPaths.filter((reviewPath) =>
        fullDiffCandidates.includes(reviewPath),
      ),
    });
    const fullDiff = reviewPrimaryPaths.length
      ? await readCachedDiffForPaths(
          rootDir,
          reviewPrimaryPaths,
          processRunner,
          {
            promptPath: "git-review-primary-diff-size",
          },
        )
      : undefined;
    const fullDiffBytes = Buffer.byteLength(fullDiff ?? "", "utf8");
    let reviewPrimaryPathBatches = reviewPrimaryPaths.length
      ? [reviewPrimaryPaths]
      : [];
    let diffBytes = fullDiffBytes;

    if (
      fullDiffBytes > WORKFLOW_REVIEW_FULL_DIFF_BYTE_LIMIT &&
      reviewPrimaryPaths.length > 1
    ) {
      const diffBytesByPath = new Map<string, number>();
      for (const reviewPath of reviewPrimaryPaths) {
        const pathDiff = await readCachedDiffForPaths(
          rootDir,
          [reviewPath],
          processRunner,
          { promptPath: "git-review-primary-diff-size" },
        );
        diffBytesByPath.set(
          reviewPath,
          Buffer.byteLength(pathDiff ?? "", "utf8"),
        );
      }
      reviewPrimaryPathBatches = splitReviewPrimaryPathsIntoBatches({
        paths: reviewPrimaryPaths,
        diffBytesByPath,
      });
      diffBytes = Math.max(
        0,
        ...reviewPrimaryPathBatches.map((batch) =>
          batch.reduce(
            (total, reviewPath) =>
              total + (diffBytesByPath.get(reviewPath) ?? 0),
            0,
          ),
        ),
      );
    }
    const decision = decideWorkflowAutoNarrow({
      currentPass: effectivePass,
      diffBytes,
    });

    if (!decision.shouldNarrow) {
      return {
        ok: true,
        scope: {
          narrowPass: effectivePass,
          reviewAllPaths,
          reviewPrimaryPaths,
          reviewPrimaryPathBatches,
          summaryOnlyPaths,
          diffBytes,
          autoNarrowReason: reason ?? decision.reason,
        },
      };
    }

    effectivePass = decision.nextPass;
    reason = [reason, decision.reason].filter(Boolean).join("; ");
  }
};
