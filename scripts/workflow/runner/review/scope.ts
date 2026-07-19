import { readFile, stat } from "node:fs/promises";
import path from "node:path";

import {
  CODEX_BINARY_COMMAND,
  codexExecArgs,
  codexWorkEnvironment,
} from "../process.ts";
import { extractSpecPaths } from "../plan/parser.ts";
import {
  generateScopeCleanupPrompt,
  readPrompt,
} from "../plan/prompt.ts";
import { workflowContextSnapshotRelativePath } from "../plan/context-snapshot.ts";
import { thinPlanV2ArtifactPath } from "../plan/state.ts";
import {
  codexAgentMessageTexts,
} from "../terminal/codex-events.ts";
import {
  WORKFLOW_AUTO_NARROW_PASS_LIMIT,
  WORKFLOW_REVIEW_FULL_DIFF_BYTE_LIMIT,
  WORKFLOW_REVIEW_PRIMARY_PATH_LIMIT,
  decideWorkflowAutoNarrow,
} from "../../telemetry/token-warnings.ts";
import { codexExecutionConfig } from "../../config/codex.ts";
import { REVIEW_CHANGES_PROMPT_PATH, SCOPE_CLEANUP_PROMPT_PATH } from "../../contracts/stage.ts";
import type {
  Failure,
  ProcessResult,
  ProcessRunner,
  ReviewScopeMetadata,
  WorkflowFailureDebugRecord,
  WorkflowRunnerCodexRuntime,
} from "../types.ts";
import { asRecord, boundedInlineExcerpt } from "../types.ts";

type ScopeCleanupDecision = {
  action: "keep" | "unstage";
  patch?: string;
};

type ScopeCleanupOptions = {
  codexRuntime: WorkflowRunnerCodexRuntime;
  rootDir: string;
  planPath: string;
  planContent: string;
  paths: string[];
  processRunner: ProcessRunner;
  mode: "review" | "commit-summary";
};

type ScopeCleanupResult = {
  ok: true;
  skippedLargeDiff?: boolean;
  diffBytes?: number;
};

const uniquePaths = (paths: string[]): string[] => [...new Set(paths)];

const parseScopeCleanupDecision = (
  stdout: string,
): ScopeCleanupDecision | undefined => {
  for (const message of codexAgentMessageTexts(stdout)) {
    const trimmed = message.trim();
    if (!trimmed) {
      continue;
    }
    try {
      const parsed = JSON.parse(trimmed);
      const record = asRecord(parsed);
      if (!record) {
        continue;
      }
      const action = record.action;
      if (action !== "keep" && action !== "unstage") {
        continue;
      }
      const patch =
        typeof record.patch === "string" && record.patch.trim().length > 0
          ? record.patch
          : undefined;
      return { action, patch };
    } catch {
      continue;
    }
  }
  return undefined;
};

const failureDebugLedgerRelativePath = (planName: string): string =>
  [".ai", "artifacts", planName, "logs", "failure.jsonl"].join("/");

const failureDebugLedgerAbsolutePath = (
  rootDir: string,
  planName: string,
): string => path.join(rootDir, failureDebugLedgerRelativePath(planName));

const latestExecutionEvidenceMtimeMs = async (
  rootDir: string,
  planName: string,
): Promise<number | undefined> => {
  let workflowRaw: unknown;
  try {
    workflowRaw = JSON.parse(
      await readFile(
        path.join(
          rootDir,
          thinPlanV2ArtifactPath(planName, "state", "workflow.json"),
        ),
        "utf8",
      ),
    ) as unknown;
  } catch {
    return undefined;
  }

  const workflow = asRecord(workflowRaw);
  const latest = asRecord(workflow?.latest);
  const execution = asRecord(latest?.execution);
  const evidence = execution?.evidence;
  if (typeof evidence !== "string" || path.isAbsolute(evidence)) {
    return undefined;
  }

  try {
    return (await stat(path.join(rootDir, evidence))).mtimeMs;
  } catch {
    return undefined;
  }
};

const NON_PLAN_SCOPED_REVIEW_STOP_TEXT = "non plan-scoped changes detected";

const nonPlanScopedReviewStopEvidence = (
  entry: Partial<WorkflowFailureDebugRecord>,
): string | undefined => {
  const evidenceText = [
    entry.failureReason,
    entry.stopExcerpt,
    entry.lastAgentMessageExcerpt,
  ]
    .filter((value): value is string => typeof value === "string")
    .join("\n");
  if (!evidenceText.includes(NON_PLAN_SCOPED_REVIEW_STOP_TEXT)) {
    return undefined;
  }
  const excerptSource =
    entry.lastAgentMessageExcerpt ?? entry.stopExcerpt ?? entry.failureReason;
  return excerptSource ? boundedInlineExcerpt(excerptSource) : undefined;
};

const readLatestNonPlanScopedReviewStopEvidence = async (
  rootDir: string,
  planName: string,
): Promise<string | undefined> => {
  let content: string;
  try {
    content = await readFile(
      failureDebugLedgerAbsolutePath(rootDir, planName),
      "utf8",
    );
  } catch {
    return undefined;
  }

  const executionMtimeMs = await latestExecutionEvidenceMtimeMs(
    rootDir,
    planName,
  );
  const lines = content.split(/\r?\n/).filter(Boolean);
  for (const line of lines.reverse()) {
    let entry: Partial<WorkflowFailureDebugRecord>;
    try {
      entry = JSON.parse(line) as Partial<WorkflowFailureDebugRecord>;
    } catch {
      continue;
    }
    if (
      entry.promptPath !== REVIEW_CHANGES_PROMPT_PATH ||
      entry.failureKind !== "codex-stop"
    ) {
      continue;
    }
    const evidence = nonPlanScopedReviewStopEvidence(entry);
    if (!evidence) {
      continue;
    }
    const failureTimestampMs =
      typeof entry.timestamp === "string" ? Date.parse(entry.timestamp) : NaN;
    if (
      typeof executionMtimeMs === "number" &&
      Number.isFinite(failureTimestampMs) &&
      executionMtimeMs > failureTimestampMs
    ) {
      return undefined;
    }
    return evidence;
  }
  return undefined;
};

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
      `--unified=${options.unified ?? 0}`,
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
    const diffBytes = Buffer.byteLength(fullDiff ?? "", "utf8");
    const decision = decideWorkflowAutoNarrow({
      currentPass: effectivePass,
      diffBytes,
    });

    if (!decision.shouldNarrow) {
      if (decision.shouldStop) {
        return {
          ok: false,
          reason: `review scope remains too broad after ${WORKFLOW_AUTO_NARROW_PASS_LIMIT} narrow passes: ${decision.reason}`,
        };
      }
      return {
        ok: true,
        scope: {
          narrowPass: effectivePass,
          reviewAllPaths,
          reviewPrimaryPaths,
          summaryOnlyPaths,
          diffBytes,
          autoNarrowReason: reason,
        },
      };
    }

    effectivePass = decision.nextPass;
    reason = [reason, decision.reason].filter(Boolean).join("; ");
  }
};

export const runScopeCleanupForPaths = async ({
  codexRuntime,
  rootDir,
  planPath,
  planContent,
  paths,
  processRunner,
  mode,
}: ScopeCleanupOptions): Promise<ScopeCleanupResult> => {
  if (paths.length === 0) {
    return { ok: true };
  }

  const prompt = await readPrompt(rootDir, SCOPE_CLEANUP_PROMPT_PATH);
  if (!prompt.ok) {
    return { ok: true };
  }

  const diff = await readCachedDiffForPaths(rootDir, paths, processRunner);
  if (!diff) {
    return { ok: true };
  }
  const diffBytes = Buffer.byteLength(diff, "utf8");
  if (diffBytes > WORKFLOW_REVIEW_FULL_DIFF_BYTE_LIMIT) {
    return { ok: true, skippedLargeDiff: true, diffBytes };
  }

  const previousNonPlanScopedStopEvidence =
    mode === "review"
      ? await readLatestNonPlanScopedReviewStopEvidence(
          rootDir,
          path.posix.basename(planPath, ".md"),
        )
      : undefined;
  const cleanupPrompt = generateScopeCleanupPrompt({
    promptContent: prompt.content,
    planPath,
    contextSnapshotPath: workflowContextSnapshotRelativePath(
      path.posix.basename(planPath, ".md"),
    ),
    specPaths: extractSpecPaths(planContent),
    paths,
    diff,
    mode,
    previousNonPlanScopedStopEvidence,
  });
  const executionConfig = codexExecutionConfig(SCOPE_CLEANUP_PROMPT_PATH);
  const result = await processRunner({
    command: codexRuntime.command,
    binaryCommand: CODEX_BINARY_COMMAND,
    args: codexExecArgs({
      executionConfig,
      promptPath: SCOPE_CLEANUP_PROMPT_PATH,
      prompt: cleanupPrompt,
      rootDir,
    }),
    cwd: rootDir,
    input: "",
    promptPath: SCOPE_CLEANUP_PROMPT_PATH,
    env: codexWorkEnvironment(process.env, codexRuntime.profile),
  }).catch(
    (): ProcessResult => ({
      launched: false,
      stdout: "",
      stderr: "",
      error: "scope cleanup launch failed",
    }),
  );

  if (!result.launched || result.exitCode !== 0) {
    return { ok: true, diffBytes };
  }

  const decision = parseScopeCleanupDecision(result.stdout);
  if (!decision || decision.action !== "unstage" || !decision.patch) {
    return { ok: true, diffBytes };
  }

  await processRunner({
    command: "git",
    args: ["apply", "--cached", "-R", "--unidiff-zero"],
    cwd: rootDir,
    input: `${decision.patch.trimEnd()}\n`,
    promptPath: "git-scope-cleanup-unstage",
  }).catch(
    (): ProcessResult => ({
      launched: false,
      stdout: "",
      stderr: "",
      error: "scope cleanup apply failed",
    }),
  );
  return { ok: true, diffBytes };
};

export const runScopeCleanupForPathBatches = async (
  options: ScopeCleanupOptions,
): Promise<ScopeCleanupResult> => {
  const { rootDir, paths, processRunner } = options;
  if (paths.length === 0) {
    return { ok: true };
  }

  let totalDiffBytes = 0;
  let batchPaths: string[] = [];
  let batchBytes = 0;
  let skippedLargeDiffBytes: number | undefined;

  const flushBatch = async () => {
    if (batchPaths.length === 0) {
      return;
    }

    const result = await runScopeCleanupForPaths({
      ...options,
      paths: batchPaths,
    });
    if (result.skippedLargeDiff) {
      skippedLargeDiffBytes = Math.max(
        skippedLargeDiffBytes ?? 0,
        result.diffBytes ?? 0,
      );
    }
    batchPaths = [];
    batchBytes = 0;
  };

  for (const scopedPath of paths) {
    const diff = await readCachedDiffForPaths(
      rootDir,
      [scopedPath],
      processRunner,
      {
        promptPath: "git-scope-cleanup-batch-size",
      },
    );
    if (!diff) {
      continue;
    }

    const diffBytes = Buffer.byteLength(diff, "utf8");
    totalDiffBytes += diffBytes;
    if (diffBytes > WORKFLOW_REVIEW_FULL_DIFF_BYTE_LIMIT) {
      await flushBatch();
      skippedLargeDiffBytes = Math.max(skippedLargeDiffBytes ?? 0, diffBytes);
      continue;
    }

    if (
      batchPaths.length > 0 &&
      batchBytes + diffBytes > WORKFLOW_REVIEW_FULL_DIFF_BYTE_LIMIT
    ) {
      await flushBatch();
    }

    batchPaths.push(scopedPath);
    batchBytes += diffBytes;
  }

  await flushBatch();

  if (skippedLargeDiffBytes) {
    return {
      ok: true,
      skippedLargeDiff: true,
      diffBytes: skippedLargeDiffBytes,
    };
  }

  return { ok: true, diffBytes: totalDiffBytes };
};
