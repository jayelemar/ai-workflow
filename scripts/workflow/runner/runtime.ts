import {
  mkdir,
  readFile,
  readdir,
  writeFile,
} from "node:fs/promises";
import { existsSync } from "node:fs";
import path from "node:path";
import {
  parseRunnerCliArgs,
} from "./cli.ts";
import {
  acquireWorkflowFileOwnershipForPaths,
  refreshWorkflowFileLockHeartbeats,
  releaseWorkflowFileLocks,
  WORKFLOW_FILE_LOCK_HEARTBEAT_INTERVAL_MS,
} from "../ownership/file-locks.ts";
import {
  canonicalFileOwnershipArtifact,
  parseFileOwnershipArtifact,
  parseWorkflowFileOwnershipPaths,
  readGitChangedFileEntries,
  readGitHeadSha,
  readThinPlanV2FileOwnershipPreflight,
  refreshAndCheckFileOwnershipArtifact,
} from "../ownership/file-ownership.ts";
import {
  parseContextUsage,
  parseCodexTokenUsage,
  unavailableContextUsage,
  type CodexTokenUsage,
  type ContextUsageLogFields,
} from "../telemetry/token-usage.ts";
export { analyzeTokenUsageLedger } from "../telemetry/token-ledger.ts";
import {
  collectWorkflowThresholdWarnings,
  decideWorkflowAutoNarrow,
  exceedsWorkflowTokenThresholds,
} from "../telemetry/token-warnings.ts";
import {
  CODEX_SELECTED_MODEL_CAPACITY_FALLBACK_ATTEMPTS,
  CODEX_SELECTED_MODEL_CAPACITY_PRIMARY_ATTEMPTS,
  codexCapacityFallbackConfig,
  codexExecutionConfig,
  WORKFLOW_RUNNER_CODEX_PROFILE,
  type CodexExecutionConfig,
} from "../config/codex.ts";
import {
  COMMIT_SUMMARY_PROMPT_PATH,
  EXECUTE_PLAN_PROMPT_PATH,
} from "../contracts/stage.ts";
import { CODEX_BINARY_COMMAND, codexExecArgs, codexResultContainsSelectedModelCapacity, codexWorkEnvironment, createWorkflowRunnerCodexRuntime, defaultProcessRunner, isValidCodexProfile } from "./process.ts";
import { classifyFailureForLog, codexOutputStopReason, createCodexLiveOutputFormatter, createWorkflowFailureDebugRecord } from "./terminal/codex-events.ts";
import { compactCapturedOutputForLog, createWorkflowWaitNotice, formatCommitProgressLine, formatEditedFilesForLog, formatEditedFilesForTerminal, formatTaskCompletedProgressLine, formatWorkflowElapsedTime, formatWorkflowOwnershipResetHint, formatWorkflowProgressLine, supportsWorkflowAnsiColor } from "./terminal/formatters.ts";
import { parsePlanTasks, parseTaskCommitBoundaries, taskCommitBoundaryCount, validateTaskCommitBoundaries } from "./plan/parser.ts";
import { writeWorkflowContextSnapshot } from "./plan/context-snapshot.ts";
import { generateWorkflowPrompt, isReviewPrompt, isWorkflowTokenGuardedPrompt, readPrompt, shellQuote } from "./plan/prompt.ts";
import { normalizeWorkflowEventHistory, parsePlan, parseThinPlanV2WorkflowState, preflightManualPlanExecutionMode, readJsonArtifact, recoverThinPlanV2BlockedValidationHandoff, recoverThinPlanV2PartialExecuteReviewHandoff, repairThinPlanV2ManifestStateFromWorkflow, thinPlanV2ArtifactPath } from "./plan/state.ts";
import { completedTaskCommitCount, currentTaskArtifactRelativePath, formatTaskProgressLine, nextIncompleteTask, nextTaskAfter, nextTaskArtifactRelativePath, readHeadTaskCommit, readableTaskLabel, readableTaskProgressDescription, readTaskArtifactStage, readTaskCommitRecoveryParent, writeCurrentTaskPointer, writeTaskArtifact, writeTaskStageArtifact } from "./tasks/savepoints.ts";
import { extractCommitSummarySubject, extractSummaryLines, readCompletedTaskSavepoints, writeBossSummary, writeExecutionSummary } from "./tasks/summaries.ts";
import { parseCommitSummaryPathsForPlan, readDirtyPlanOwnedPaths, verifyCommitSummaryPathsClean } from "./review/commit.ts";
import { buildReviewScopeMetadata, runScopeCleanupForPathBatches, runScopeCleanupForPaths } from "./review/scope.ts";
import { checkForPreReviewStagedWork, defaultIsIgnored, parseReviewStagingPaths, runReviewStagingForPaths, runReviewUnstageForPaths } from "./review/staging.ts";
import { routeFor, transitionAllowed } from "./transitions.ts";
import type { CommitProgress, ConsoleLike, EditedFileSnapshot, EditedFileSummary, Failure, FileOwnershipArtifact, FileOwnershipPreflight, NextAction, OutputStream, ParsedPlan, ProcessResult, ProcessRunner, ReviewCleanupProcess, ReviewScopeMetadata, ReviewStagingProcess, RunnerResult, Status, TaskStage, TokenUsageTotals, WorkflowContextSnapshotResult, WorkflowContextSnapshotTokenUsage, WorkflowFailureDebugRecord, WorkflowTaskContext, WorkflowTokenGuardrail } from "./types.ts";
import {
  asRecord,
  boundedInlineExcerpt,
  isFailure,
  isFiniteNumber,
  toDisplayString,
} from "./types.ts";

const MAX_ITERATIONS = 100;
const PROTECTED_WORKFLOW_BRANCHES = new Set([
  "main",
  "master",
  "dev",
  "staging",
]);
const WORKFLOW_RUNNER_USAGE = `Usage: pnpm exec tsx .ai/scripts/workflow/runner.ts [options] .ai/plans/<plan-name>.md

Options:
  --profile <name>       Use a Codex profile override
  --unblock-note <text>  Add operator context for unblock-plan
  -h, --help             Show this help message`;

const rel = (...segments: string[]) => segments.join("/");

const workflowFileUnlockPathHint = (planPath: string): string =>
  `run this on the terminal:\npnpm workflow:unlock ${shellQuote(planPath)}`;

const workflowFileOwnershipResetPathHint = (reason: string): string | null => {
  const match =
    /workflow file ownership conflict: .+ is already owned by (?<planPath>\.ai\/plans\/[^\s)]+\.md)/.exec(
      reason,
    );
  const planPath = match?.groups?.planPath;
  return planPath
    ? `- Ownership reset command: rtk node .ai/scripts/workflow/ownership/reset-file-ownership.mjs ${shellQuote(planPath)} --force`
    : null;
};

const zeroTokenUsageTotals: TokenUsageTotals = {
  inputTokens: 0,
  cachedInputTokens: 0,
  uncachedInputTokens: 0,
  outputTokens: 0,
  reasoningOutputTokens: 0,
  totalTokens: 0,
};

type RunWorkflowOptions = {
  argv?: string[];
  planName?: string;
  rootDir?: string;
  console?: ConsoleLike;
  codexProfile?: string;
  unblockNote?: string;
  processRunner?: ProcessRunner;
  now?: () => number;
  timestamp?: () => string;
  streamOutput?: boolean;
  outputStream?: OutputStream;
  abortSignal?: AbortSignal;
  interruptSignal?: () => NodeJS.Signals | undefined;
  isIgnored?: (relativePath: string) => Promise<boolean>;
};

type TokenUsageLedgerResult = "success" | "failed" | "interrupted";

const defaultConsole: ConsoleLike = console;

const failure = (
  reason: string,
  iterations = 0,
  exitCode = 1,
): RunnerResult => ({
  success: false,
  reason,
  iterations,
  exitCode,
});

const success = (reason: string, iterations: number): RunnerResult => ({
  success: true,
  reason,
  iterations,
  exitCode: 0,
});

const appendLog = async (
  rootDir: string,
  planName: string,
  fields: Array<[string, string | number | undefined]>,
): Promise<{ ok: true } | Failure> => {
  const logDir = path.join(rootDir, ".ai", "artifacts", planName, "logs");
  const logPath = path.join(logDir, "runner.log");
  try {
    await mkdir(logDir, { recursive: true });
    const body = [
      "---",
      ...fields.map(([key, value]) => `${key}: ${value ?? ""}`),
      "",
    ].join("\n");
    await writeFile(logPath, body, { flag: "a" });
    return { ok: true };
  } catch (error) {
    return {
      ok: false,
      reason: `workflow log cannot be created or appended: ${String(error)}`,
    };
  }
};

const gitHeadShortSha = async (
  rootDir: string,
  processRunner: ProcessRunner,
): Promise<{ ok: true; sha: string } | Failure> => {
  const result = await processRunner({
    command: "git",
    args: ["rev-parse", "--short", "HEAD"],
    cwd: rootDir,
    input: "",
    promptPath: "git-task-commit-sha",
  });
  if (!result.launched) {
    return {
      ok: false,
      reason: `could not launch task commit sha lookup: ${result.error}`,
    };
  }
  if (result.exitCode !== 0) {
    return {
      ok: false,
      reason: `task commit sha lookup exited with code ${result.exitCode}: ${boundedInlineExcerpt(
        result.stderr || result.stdout,
      )}`,
    };
  }
  const sha = result.stdout.trim().split(/\s+/)[0] ?? "";
  if (!sha) {
    return {
      ok: false,
      reason: "task commit sha lookup returned empty output",
    };
  }
  return { ok: true, sha };
};

const gitMetadataExists = (rootDir: string): boolean =>
  existsSync(path.join(rootDir, ".git"));

const protectedBranchPreflight = async (
  rootDir: string,
  processRunner: ProcessRunner,
): Promise<{ ok: true; branch?: string } | Failure> => {
  if (!gitMetadataExists(rootDir)) {
    return { ok: true };
  }

  const result = await processRunner({
    command: "git",
    args: ["rev-parse", "--abbrev-ref", "HEAD"],
    cwd: rootDir,
    input: "",
    promptPath: "git-protected-branch-preflight",
  }).catch(
    (error): ProcessResult => ({
      launched: false,
      stdout: "",
      stderr: "",
      error: String(error),
    }),
  );

  if (!result.launched) {
    return {
      ok: false,
      reason: `could not determine current git branch before starting workflow: ${result.error}`,
    };
  }
  if (result.exitCode !== 0) {
    const details = [result.stderr.trim(), result.stdout.trim()]
      .filter(Boolean)
      .join("\n");
    return {
      ok: false,
      reason: `could not determine current git branch before starting workflow${details ? `: ${boundedInlineExcerpt(details)}` : ""}`,
    };
  }

  const branch = result.stdout.trim().split(/\s+/)[0] ?? "";
  if (!branch) {
    return {
      ok: false,
      reason:
        "could not determine current git branch before starting workflow: branch lookup returned empty output",
    };
  }
  if (PROTECTED_WORKFLOW_BRANCHES.has(branch)) {
    return {
      ok: false,
      reason: `workflow runner refuses to start on protected branch ${branch}`,
    };
  }
  return { ok: true, branch };
};

const workflowHeadSha = async (
  rootDir: string,
  processRunner: ProcessRunner,
): Promise<string | undefined> => {
  if (!gitMetadataExists(rootDir)) {
    return undefined;
  }

  const result = await processRunner({
    command: "git",
    args: ["rev-parse", "HEAD"],
    cwd: rootDir,
    input: "",
    promptPath: "git-workflow-head",
  }).catch(
    (): ProcessResult => ({
      launched: false,
      stdout: "",
      stderr: "",
      error: "workflow head lookup failed",
    }),
  );
  if (!result.launched || result.exitCode !== 0) {
    return undefined;
  }
  return result.stdout.trim().split(/\s+/)[0] || undefined;
};

const replaceSectionValueInPlan = (
  content: string,
  heading: string,
  value: string,
): string => {
  const lines = content.split(/\r?\n/);
  const headingIndex = lines.findIndex((line) => line.trim() === heading);
  if (headingIndex === -1) {
    return content;
  }
  let valueIndex = -1;
  for (let index = headingIndex + 1; index < lines.length; index += 1) {
    const trimmed = lines[index].trim();
    if (trimmed.startsWith("##")) {
      break;
    }
    if (trimmed.length > 0) {
      valueIndex = index;
      break;
    }
  }
  if (valueIndex === -1) {
    lines.splice(headingIndex + 1, 0, "", value);
  } else {
    lines[valueIndex] = value;
  }
  return lines.join("\n");
};

const reopenPlanForNextTask = async (
  plan: ParsedPlan,
): Promise<{ ok: true } | Failure> => {
  const baseContent =
    plan.thinPlanContract === "thin-plan-v2"
      ? plan.manifestContent
      : plan.content;
  const nextContent = replaceSectionValueInPlan(
    replaceSectionValueInPlan(baseContent, "## Status", "active"),
    "## Next Action",
    "execute-plan",
  );
  let workflowStateUpdate:
    | { absolutePath: string; content: string }
    | undefined;
  if (plan.thinPlanContract === "thin-plan-v2") {
    const rootDir = path.dirname(
      path.dirname(path.dirname(plan.absolutePlanPath)),
    );
    const workflowPath = thinPlanV2ArtifactPath(
      plan.planName,
      "state",
      "workflow.json",
    );
    const workflowJson = await readJsonArtifact(rootDir, workflowPath);
    if (isFailure(workflowJson)) {
      return workflowJson;
    }
    const workflow = parseThinPlanV2WorkflowState(
      workflowJson,
      plan.planPath,
      workflowPath,
    );
    if (isFailure(workflow)) {
      return workflow;
    }
    const workflowRecord = asRecord(workflowJson);
    if (!workflowRecord) {
      return {
        ok: false,
        reason: `thin-plan-v2 workflow state is malformed: ${workflowPath}`,
      };
    }
    workflowStateUpdate = {
      absolutePath: path.join(rootDir, workflowPath),
      content: `${JSON.stringify(
        {
          ...workflowRecord,
          status: "active",
          nextAction: "execute-plan",
          updatedAt: new Date().toISOString(),
        },
        null,
        2,
      )}\n`,
    };
  }
  try {
    await writeFile(plan.absolutePlanPath, nextContent, "utf8");
    if (workflowStateUpdate) {
      await writeFile(
        workflowStateUpdate.absolutePath,
        workflowStateUpdate.content,
        "utf8",
      );
    }
    return { ok: true };
  } catch (error) {
    return {
      ok: false,
      reason: `plan cannot be reopened for next task: ${String(error)}`,
    };
  }
};

const workflowOutputHasValidationPass = (stdout: string): boolean =>
  /\bvalidation\s+passed\b/i.test(stdout) ||
  /\bvalidation\s*:\s*(?:pass|passed|ok|success)\b/i.test(stdout);

const nextWorkflowEventVersion = async ({
  rootDir,
  planName,
  kind,
}: {
  rootDir: string;
  planName: string;
  kind: "execution" | "validation" | "review";
}): Promise<number> => {
  const eventsDir = path.join(
    rootDir,
    thinPlanV2ArtifactPath(planName, "events"),
  );
  let entries: string[] = [];
  try {
    entries = await readdir(eventsDir);
  } catch (error) {
    const code = (error as NodeJS.ErrnoException).code;
    if (code !== "ENOENT") {
      throw error;
    }
  }
  const pattern = new RegExp(`^${kind}-v(\\d+)\\.md$`);
  const latest = entries.reduce((max, entry) => {
    const version = Number(pattern.exec(entry)?.[1] ?? 0);
    return Number.isInteger(version) ? Math.max(max, version) : max;
  }, 0);
  return latest + 1;
};

const workflowEventBody = ({
  title,
  summary,
  evidenceLines,
}: {
  title: string;
  summary: string;
  evidenceLines: string[];
}): string => `${title}

## Summary

${summary}

## Evidence

${evidenceLines.length > 0 ? evidenceLines.map((line) => `* ${line}`).join("\n") : "* No evidence recorded."}
`;

const declaresNoCommitBoundary = (content: string): boolean =>
  /^## Commit Boundaries\s*\n\s*N\/A\b/im.test(content);

const isArtifactOnlyNoCommitReview = ({
  plan,
  artifact,
}: {
  plan: ParsedPlan;
  artifact: FileOwnershipArtifact | undefined;
}): boolean =>
  plan.thinPlanContract === "thin-plan-v2" &&
  declaresNoCommitBoundary(plan.manifestContent) &&
  (artifact?.changedFiles.length ?? 0) > 0 &&
  artifact!.changedFiles.every((filePath) => filePath.startsWith(".ai/"));

const completeArtifactOnlyNoCommitReview = async ({
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

  const reviewPath = thinPlanV2ArtifactPath(
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
          ...workflowRecord,
          status: continueExecution ? "active" : "completed",
          nextAction: continueExecution ? "execute-plan" : "commit-summary",
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
      replaceSectionValueInPlan(
        replaceSectionValueInPlan(
          plan.manifestContent,
          "## Status",
          continueExecution ? "active" : "completed",
        ),
        "## Next Action",
        continueExecution ? "execute-plan" : "commit-summary",
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

const hasArtifactOnlyNoCommitReview = async ({
  rootDir,
  plan,
}: {
  rootDir: string;
  plan: ParsedPlan;
}): Promise<{ ok: true; noCommit: boolean } | Failure> => {
  if (
    plan.thinPlanContract !== "thin-plan-v2" ||
    !declaresNoCommitBoundary(plan.manifestContent)
  ) {
    return { ok: true, noCommit: false };
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
  const review = asRecord(asRecord(workflowRaw)?.latest)?.review;
  return { ok: true, noCommit: asRecord(review)?.noCommit === true };
};

const recoverThinPlanV2ExecuteHandoff = async ({
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
    plan.status !== "active" ||
    plan.nextAction !== "execute-plan" ||
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
          ...workflowRecord,
          status: "review",
          nextAction: "review-plan",
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
      replaceSectionValueInPlan(
        replaceSectionValueInPlan(plan.manifestContent, "## Status", "review"),
        "## Next Action",
        "review-plan",
      ),
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

const failureDebugLedgerRelativePath = (planName: string): string =>
  rel(".ai", "artifacts", planName, "logs", "failure.jsonl");

const failureDebugLedgerAbsolutePath = (
  rootDir: string,
  planName: string,
): string => path.join(rootDir, failureDebugLedgerRelativePath(planName));

const appendFailureDebugLedger = async (
  rootDir: string,
  planName: string,
  entry: WorkflowFailureDebugRecord,
): Promise<{ ok: true; pointer: string } | Failure> => {
  const logPath = failureDebugLedgerAbsolutePath(rootDir, planName);
  let existingLineCount = 0;

  try {
    const existing = await readFile(logPath, "utf8");
    existingLineCount = existing.split(/\r?\n/).filter(Boolean).length;
  } catch (error) {
    const code = (error as NodeJS.ErrnoException).code;
    if (code !== "ENOENT") {
      return {
        ok: false,
        reason: `workflow failure debug log cannot be read: ${String(error)}`,
      };
    }
  }

  try {
    await mkdir(path.dirname(logPath), { recursive: true });
    await writeFile(logPath, `${JSON.stringify(entry)}\n`, { flag: "a" });
    return {
      ok: true,
      pointer: `${failureDebugLedgerRelativePath(planName)}#L${existingLineCount + 1}`,
    };
  } catch (error) {
    return {
      ok: false,
      reason: `workflow failure debug log cannot be created or appended: ${String(error)}`,
    };
  }
};

const tokenUsageLedgerRelativePath = (planName: string): string =>
  rel(".ai", "artifacts", planName, "logs", "token-usage.jsonl");

const tokenUsageLedgerAbsolutePath = (
  rootDir: string,
  planName: string,
): string => path.join(rootDir, tokenUsageLedgerRelativePath(planName));

const tokenUsageTotalsFromRecord = (
  record: Record<string, unknown>,
): TokenUsageTotals | undefined => {
  const totals = {
    inputTokens: record.inputTokens,
    cachedInputTokens: record.cachedInputTokens,
    uncachedInputTokens: record.uncachedInputTokens,
    outputTokens: record.outputTokens,
    reasoningOutputTokens: record.reasoningOutputTokens,
    totalTokens: record.totalTokens,
  };
  return Object.values(totals).every(
    (value) => isFiniteNumber(value) && value >= 0,
  )
    ? (totals as TokenUsageTotals)
    : undefined;
};

const readTokenUsageTotals = async (
  rootDir: string,
  planName: string,
): Promise<TokenUsageTotals> => {
  try {
    const content = await readFile(
      tokenUsageLedgerAbsolutePath(rootDir, planName),
      "utf8",
    );
    const lines = content.trim().split(/\r?\n/).filter(Boolean).reverse();
    for (const line of lines) {
      try {
        const parsed = asRecord(JSON.parse(line));
        if (!parsed) {
          continue;
        }
        const totals = tokenUsageTotalsFromRecord(parsed);
        if (totals) {
          return totals;
        }
      } catch {
        continue;
      }
    }
  } catch {
    return { ...zeroTokenUsageTotals };
  }
  return { ...zeroTokenUsageTotals };
};

const toWorkflowContextSnapshotTokenUsage = (
  record: Record<string, unknown>,
): WorkflowContextSnapshotTokenUsage => ({
  iteration: isFiniteNumber(record.iteration) ? record.iteration : undefined,
  promptPath: toDisplayString(record.promptPath),
  model: toDisplayString(record.model),
  reasoning: toDisplayString(record.reasoning),
  stageInputTokens: isFiniteNumber(record.stageInputTokens)
    ? record.stageInputTokens
    : null,
  stageCachedInputTokens: isFiniteNumber(record.stageCachedInputTokens)
    ? record.stageCachedInputTokens
    : null,
  stageUncachedInputTokens: isFiniteNumber(record.stageUncachedInputTokens)
    ? record.stageUncachedInputTokens
    : null,
  stageOutputTokens: isFiniteNumber(record.stageOutputTokens)
    ? record.stageOutputTokens
    : null,
  stageReasoningOutputTokens: isFiniteNumber(record.stageReasoningOutputTokens)
    ? record.stageReasoningOutputTokens
    : null,
  stageTotalTokens: isFiniteNumber(record.stageTotalTokens)
    ? record.stageTotalTokens
    : null,
  totalTokens: isFiniteNumber(record.totalTokens) ? record.totalTokens : null,
});

const readLatestTokenUsage = async (
  rootDir: string,
  planName: string,
): Promise<WorkflowContextSnapshotTokenUsage | undefined> => {
  try {
    const content = await readFile(
      tokenUsageLedgerAbsolutePath(rootDir, planName),
      "utf8",
    );
    const lines = content.trim().split(/\r?\n/).filter(Boolean);
    const latestLine = lines.at(-1);
    if (!latestLine) {
      return undefined;
    }
    try {
      const parsed = asRecord(JSON.parse(latestLine));
      return parsed ? toWorkflowContextSnapshotTokenUsage(parsed) : undefined;
    } catch {
      return undefined;
    }
  } catch {
    return undefined;
  }
};

const readWorkflowTokenGuardrail = async ({
  rootDir,
  planName,
  promptPath,
}: {
  rootDir: string;
  planName: string;
  promptPath: string;
}): Promise<WorkflowTokenGuardrail | undefined> => {
  if (!isWorkflowTokenGuardedPrompt(promptPath)) {
    return undefined;
  }

  const latestTokenUsage = await readLatestTokenUsage(rootDir, planName);
  if (!exceedsWorkflowTokenThresholds(latestTokenUsage)) {
    return undefined;
  }

  return {
    stageInputTokens: latestTokenUsage?.stageInputTokens,
    stageUncachedInputTokens: latestTokenUsage?.stageUncachedInputTokens,
  };
};

const addTokenUsageToTotals = (
  totals: TokenUsageTotals,
  usage: CodexTokenUsage,
): TokenUsageTotals => {
  if (!usage.usageAvailable) {
    return totals;
  }
  return {
    inputTokens: totals.inputTokens + (usage.inputTokens ?? 0),
    cachedInputTokens:
      totals.cachedInputTokens + (usage.cachedInputTokens ?? 0),
    uncachedInputTokens:
      totals.uncachedInputTokens + (usage.uncachedInputTokens ?? 0),
    outputTokens: totals.outputTokens + (usage.outputTokens ?? 0),
    reasoningOutputTokens:
      totals.reasoningOutputTokens + (usage.reasoningOutputTokens ?? 0),
    totalTokens: totals.totalTokens + (usage.totalTokens ?? 0),
  };
};

const appendTokenUsageLedger = async (
  rootDir: string,
  planName: string,
  entry: Record<string, unknown>,
): Promise<{ ok: true } | Failure> => {
  try {
    await mkdir(path.dirname(tokenUsageLedgerAbsolutePath(rootDir, planName)), {
      recursive: true,
    });
    await writeFile(
      tokenUsageLedgerAbsolutePath(rootDir, planName),
      `${JSON.stringify(entry)}\n`,
      {
        flag: "a",
      },
    );
    return { ok: true };
  } catch (error) {
    return {
      ok: false,
      reason: `token usage ledger cannot be created or appended: ${String(error)}`,
    };
  }
};

const sectionLines = (content: string, heading: string): string[] | null => {
  const lines = content.split(/\r?\n/);
  const start = lines.findIndex((line) => line.trim() === heading);
  if (start === -1) {
    return null;
  }
  const collected: string[] = [];
  for (const line of lines.slice(start + 1)) {
    if (line.trim().startsWith("## ")) {
      break;
    }
    collected.push(line);
  }
  return collected;
};

const extractLatestUnresolvedBlockerDetail = (
  content: string,
): string | undefined => {
  const lines = sectionLines(content, "## Blockers");
  if (lines === null) {
    return undefined;
  }

  const blockerSections: Array<{ heading: string; lines: string[] }> = [];
  let current: { heading: string; lines: string[] } | undefined;
  for (const line of lines) {
    const trimmed = line.trim();
    if (/^###\s+Blocker\b/i.test(trimmed)) {
      current = { heading: trimmed, lines: [] };
      blockerSections.push(current);
      continue;
    }
    current?.lines.push(line);
  }

  const sections =
    blockerSections.length > 0
      ? blockerSections
      : [{ heading: "## Blockers", lines }];
  for (const blocker of sections.slice().reverse()) {
    const resolved =
      /\bresolved\b/i.test(blocker.heading) ||
      blocker.lines.some((line) =>
        /^\*\s*Status:\s*resolved\b/i.test(line.trim()),
      );
    if (resolved) {
      continue;
    }

    const values = new Map<string, string>();
    for (const line of blocker.lines) {
      const match = line
        .trim()
        .match(/^\*\s*(Description|Required Action|Next Step):\s*(.+)$/i);
      if (match) {
        values.set(match[1].toLowerCase(), match[2]);
      }
    }
    for (const field of ["description", "required action", "next step"]) {
      const value = values.get(field);
      const excerpt = value ? boundedInlineExcerpt(value) : undefined;
      if (excerpt) {
        return excerpt;
      }
    }
  }

  return undefined;
};

const hasBrowserValidationBlockerSignal = (content: string): boolean => {
  const lines = sectionLines(content, "## Blockers");
  if (lines === null) {
    return false;
  }
  return /\b(browser|manual|viewport|devtools|computed-style|computed style)\b/i.test(
    lines.join("\n"),
  );
};

const simplifyBrowserValidationDetail = (detail: string): string =>
  detail
    .replace(/^mandatory\s+/i, "")
    .replace(/^browser validation cannot be performed because\s+/i, "")
    .replace(/^validation cannot be performed because\s+/i, "")
    .replace(/\.$/, "")
    .trim();

const blockedPlanDetail = (content: string): string => {
  const detail =
    extractLatestUnresolvedBlockerDetail(content) ??
    "Plan needs unblock evidence before execution can continue";
  if (
    !hasBrowserValidationBlockerSignal(content) ||
    /^browser validation:/i.test(detail)
  ) {
    return detail;
  }
  return `Browser validation: ${simplifyBrowserValidationDetail(detail)}`;
};

const blockedReasonSummary = (
  detail: string,
): { category: string; detail: string } => {
  const browserPrefix = "Browser validation:";
  if (detail.toLowerCase().startsWith(browserPrefix.toLowerCase())) {
    return {
      category: "BROWSER VALIDATION",
      detail: detail.slice(browserPrefix.length).trim(),
    };
  }
  return {
    category: "BLOCKED",
    detail,
  };
};
const uniquePaths = (paths: string[]): string[] => [...new Set(paths)];

const parseEditedFileSummaryPaths = async (
  rootDir: string,
  content: string,
): Promise<string[]> => {
  const parsed = await parseReviewStagingPaths({
    content,
    rootDir,
    isIgnored: async () => false,
  });
  return parsed.ok ? uniquePaths(parsed.paths) : [];
};

const readEditedFileSnapshot = async (
  rootDir: string,
  paths: string[],
): Promise<EditedFileSnapshot> => {
  const snapshot: EditedFileSnapshot = new Map();
  for (const relativePath of paths) {
    try {
      snapshot.set(
        relativePath,
        await readFile(path.join(rootDir, relativePath), "utf8"),
      );
    } catch {
      snapshot.set(relativePath, undefined);
    }
  }
  return snapshot;
};

const splitDiffLines = (content: string | undefined): string[] => {
  if (content === undefined || content.length === 0) {
    return [];
  }
  return content.replace(/\r\n/g, "\n").replace(/\n$/, "").split("\n");
};

const commonLineCount = (
  beforeLines: string[],
  afterLines: string[],
): number => {
  const previous = new Array(afterLines.length + 1).fill(0);
  const current = new Array(afterLines.length + 1).fill(0);
  for (const beforeLine of beforeLines) {
    for (let index = 0; index < afterLines.length; index += 1) {
      current[index + 1] =
        beforeLine === afterLines[index]
          ? previous[index] + 1
          : Math.max(previous[index + 1], current[index]);
    }
    previous.splice(0, previous.length, ...current);
    current.fill(0);
  }
  return previous[afterLines.length] ?? 0;
};

const summarizeEditedFiles = async (
  rootDir: string,
  beforeSnapshot: EditedFileSnapshot,
): Promise<EditedFileSummary[]> => {
  const summaries: EditedFileSummary[] = [];
  for (const [relativePath, beforeContent] of beforeSnapshot) {
    let afterContent: string | undefined;
    try {
      afterContent = await readFile(path.join(rootDir, relativePath), "utf8");
    } catch {
      afterContent = undefined;
    }
    if (beforeContent === afterContent) {
      continue;
    }
    const beforeLines = splitDiffLines(beforeContent);
    const afterLines = splitDiffLines(afterContent);
    const commonLines = commonLineCount(beforeLines, afterLines);
    summaries.push({
      action:
        beforeContent === undefined
          ? "Added"
          : afterContent === undefined
            ? "Deleted"
            : "Edited",
      path: relativePath,
      additions: afterLines.length - commonLines,
      deletions: beforeLines.length - commonLines,
    });
  }
  return summaries;
};

const logFields = ({
  timestamp,
  iteration,
  planPath,
  status,
  nextAction,
  promptPath,
  model,
  reasoning,
  contextUsage,
  result,
  exitCode,
  durationMs,
  stopReason,
  failureDebugPath,
  editedFiles,
  stdout,
  stderr,
  staging,
  cleanup,
  taskContext,
  currentBranch,
  startingHeadSha,
  endingHeadSha,
  commitProgress,
  reviewScope,
  latestStageTokenUsage,
  cumulativeTokenUsage,
}: {
  timestamp: string;
  iteration: number;
  planPath: string;
  status: Status;
  nextAction: NextAction;
  promptPath: string;
  model: string;
  reasoning: string;
  contextUsage: ContextUsageLogFields;
  result: string;
  exitCode?: number;
  durationMs: number;
  stopReason?: string;
  failureDebugPath?: string;
  editedFiles?: EditedFileSummary[];
  stdout: string;
  stderr: string;
  staging?: ReviewStagingProcess;
  cleanup?: ReviewCleanupProcess;
  taskContext?: WorkflowTaskContext;
  currentBranch?: string;
  startingHeadSha?: string;
  endingHeadSha?: string;
  commitProgress?: CommitProgress;
  reviewScope?: ReviewScopeMetadata;
  latestStageTokenUsage?: CodexTokenUsage;
  cumulativeTokenUsage?: TokenUsageTotals;
}): Array<[string, string | number | undefined]> => {
  const failureMetadata = stopReason
    ? classifyFailureForLog(stopReason)
    : undefined;
  const editedFilesLog = editedFiles
    ? formatEditedFilesForLog(editedFiles)
    : undefined;
  return [
    ["timestamp", timestamp],
    ["iteration", iteration],
    ["status", status],
    ["nextAction", nextAction],
    ["promptPath", promptPath],
    ["model", model],
    ["reasoning", reasoning],
    ["contextWindowTokens", contextUsage.contextWindowTokens],
    ["contextWindowUsedTokens", contextUsage.contextWindowUsedTokens],
    ["contextWindowUsedPercent", contextUsage.contextWindowUsedPercent],
    ["planPath", planPath],
    ["startingStatus", status],
    ["startingNextAction", nextAction],
    ["currentBranch", currentBranch],
    ["startingHeadSha", startingHeadSha],
    ["endingHeadSha", endingHeadSha],
    ...(commitProgress
      ? ([
          [
            "commitProgress",
            `${commitProgress.completed}/${commitProgress.total}`,
          ],
          ["commitProgressDescription", commitProgress.description],
        ] as Array<[string, string | number | undefined]>)
      : []),
    ["taskId", taskContext?.task.id],
    ["taskName", taskContext?.task.name],
    ["taskStage", taskContext?.stage],
    ["taskArtifact", taskContext?.artifactPath],
    ["commitSha", taskContext?.commitSha],
    ["narrowPass", reviewScope?.narrowPass],
    [
      "reviewAllPaths",
      reviewScope?.reviewAllPaths.length
        ? reviewScope.reviewAllPaths.join(",")
        : undefined,
    ],
    [
      "reviewPrimaryPaths",
      reviewScope?.reviewPrimaryPaths.length
        ? reviewScope.reviewPrimaryPaths.join(",")
        : undefined,
    ],
    ["diffBytes", reviewScope?.diffBytes],
    ["autoNarrowReason", reviewScope?.autoNarrowReason],
    ["latestStageInputTokens", latestStageTokenUsage?.inputTokens],
    [
      "latestStageUncachedInputTokens",
      latestStageTokenUsage?.uncachedInputTokens,
    ],
    ["latestStageTotalTokens", latestStageTokenUsage?.totalTokens],
    ["cumulativeInputTokens", cumulativeTokenUsage?.inputTokens],
    [
      "cumulativeUncachedInputTokens",
      cumulativeTokenUsage?.uncachedInputTokens,
    ],
    ["cumulativeTotalTokens", cumulativeTokenUsage?.totalTokens],
    ["result", result],
    ["exitCode", exitCode],
    ["durationMs", durationMs],
    ["stopReason", stopReason],
    ...(failureDebugPath
      ? ([["failureDebugPath", failureDebugPath]] as Array<
          [string, string | number | undefined]
        >)
      : []),
    ...(failureMetadata
      ? ([
          ["failureKind", failureMetadata.failureKind],
          ["failureReason", failureMetadata.failureReason],
          ["nextSuggestedAction", failureMetadata.nextSuggestedAction],
        ] as Array<[string, string | number | undefined]>)
      : []),
    ...(editedFilesLog
      ? ([["editedFiles", editedFilesLog]] as Array<
          [string, string | number | undefined]
        >)
      : []),
    ["stdout", compactCapturedOutputForLog(stdout)],
    ["stderr", compactCapturedOutputForLog(stderr)],
    ...(staging
      ? ([
          ["reviewStagingCommand", staging.command],
          ["reviewStagingExitCode", staging.exitCode],
          ["reviewStagingStdout", compactCapturedOutputForLog(staging.stdout)],
          ["reviewStagingStderr", compactCapturedOutputForLog(staging.stderr)],
        ] as Array<[string, string | number | undefined]>)
      : []),
    ...(cleanup
      ? ([
          ["reviewCleanupCommand", cleanup.command],
          ["reviewCleanupExitCode", cleanup.exitCode],
          ["reviewCleanupStdout", compactCapturedOutputForLog(cleanup.stdout)],
          ["reviewCleanupStderr", compactCapturedOutputForLog(cleanup.stderr)],
        ] as Array<[string, string | number | undefined]>)
      : []),
  ];
};

export const runWorkflowRunner = async (
  options: RunWorkflowOptions = {},
): Promise<RunnerResult> => {
  const rootDir = options.rootDir ?? process.cwd();
  const logger = options.console ?? defaultConsole;
  const cliArgs = parseRunnerCliArgs(options.argv);
  if (!cliArgs.ok) {
    logger.error(`FAILED: ${cliArgs.reason}`);
    logger.error(`- Worked for ${formatWorkflowElapsedTime(0)}`);
    return failure(cliArgs.reason);
  }
  if (cliArgs.help) {
    logger.log(WORKFLOW_RUNNER_USAGE);
    return success("workflow runner help", 0);
  }
  const planArgument = options.planName ?? cliArgs.planArgument;
  const codexProfile =
    options.codexProfile ??
    cliArgs.codexProfile ??
    WORKFLOW_RUNNER_CODEX_PROFILE;
  if (!isValidCodexProfile(codexProfile)) {
    const reason = `invalid --profile value: ${codexProfile}`;
    logger.error(`FAILED: ${reason}`);
    logger.error(`- Worked for ${formatWorkflowElapsedTime(0)}`);
    return failure(reason);
  }
  const codexRuntime = createWorkflowRunnerCodexRuntime(codexProfile);
  const unblockNote = options.unblockNote ?? cliArgs.unblockNote;
  const processRunner = options.processRunner ?? defaultProcessRunner;
  const now = options.now ?? Date.now;
  const timestamp = options.timestamp ?? (() => new Date().toISOString());
  const streamOutput = options.streamOutput ?? true;
  const outputStream = options.outputStream ?? {
    stdout: (chunk: string) => process.stdout.write(chunk),
    stderr: (chunk: string) => process.stderr.write(chunk),
    isTTY: process.stdout.isTTY,
  };
  const colorOutput = supportsWorkflowAnsiColor();
  const runStartedAt = now();
  let iterations = 0;
  let workflowLogPath: string | undefined;
  let tokenUsageLogPath: string | undefined;
  let tokenUsageTotals = { ...zeroTokenUsageTotals };
  const heldWorkflowFileLockPaths = new Set<string>();
  let workflowFileLockHeartbeat: ReturnType<typeof setInterval> | undefined;
  const emittedWorkflowWarnings = new Set<string>();
  let currentTaskContext: WorkflowTaskContext | undefined;
  let carriedReviewStagingPaths: string[] | undefined;
  let carriedReviewStagingProcess: ReviewStagingProcess | undefined;
  let reviewNarrowPass = 0;
  let latestFailureDebugPath: string | undefined;
  const markWorkflowLogCreated = (planName: string) => {
    workflowLogPath = rel(".ai", "artifacts", planName, "logs", "runner.log");
  };
  const markTokenUsageLogCreated = (planName: string) => {
    tokenUsageLogPath = tokenUsageLedgerRelativePath(planName);
  };
  const emitWorkflowThresholdWarnings = (warnings: string[]) => {
    for (const warning of warnings) {
      if (emittedWorkflowWarnings.has(warning)) {
        continue;
      }
      emittedWorkflowWarnings.add(warning);
      logger.error(`WARNING: ${warning}`);
    }
  };
  const currentInterruptSignal = (): NodeJS.Signals | undefined => {
    const explicitSignal = options.interruptSignal?.();
    if (explicitSignal) {
      return explicitSignal;
    }
    const abortReason = options.abortSignal?.reason;
    return abortReason === "SIGINT" || abortReason === "SIGTERM"
      ? abortReason
      : undefined;
  };
  const elapsedLine = () =>
    `- Worked for ${formatWorkflowElapsedTime(Math.max(0, now() - runStartedAt))}`;
  const logSpacedFailurePath = (label: string, value: string): true => {
    logger.error("");
    logger.error(`- ${label}:`);
    logger.error(`  ${value}`);
    return true;
  };
  const releaseHeldWorkflowFileLocks = async (): Promise<
    string | undefined
  > => {
    if (workflowFileLockHeartbeat) {
      clearInterval(workflowFileLockHeartbeat);
      workflowFileLockHeartbeat = undefined;
    }
    const released = await releaseWorkflowFileLocks(heldWorkflowFileLockPaths);
    return released.ok ? undefined : released.reason;
  };
  const startWorkflowFileLockHeartbeat = () => {
    if (workflowFileLockHeartbeat) {
      return;
    }
    workflowFileLockHeartbeat = setInterval(() => {
      void refreshWorkflowFileLockHeartbeats({
        lockPaths: heldWorkflowFileLockPaths,
      });
    }, WORKFLOW_FILE_LOCK_HEARTBEAT_INTERVAL_MS);
    workflowFileLockHeartbeat.unref();
  };
  const finishFailure = async (
    reason: string,
    completedIterations = iterations,
    exitCode = 1,
  ): Promise<RunnerResult> => {
    const releaseFailure = await releaseHeldWorkflowFileLocks();
    const ownershipResetHint = workflowFileOwnershipResetPathHint(reason);
    const reasonWithHint = ownershipResetHint
      ? `${reason}\n${ownershipResetHint}`
      : reason;
    const finalReason = releaseFailure
      ? `${reasonWithHint}; ${releaseFailure}`
      : reasonWithHint;
    logger.error(`FAILED: ${reason}`);
    if (ownershipResetHint) {
      logger.error(
        formatWorkflowOwnershipResetHint(ownershipResetHint, colorOutput),
      );
    }
    if (releaseFailure) {
      logger.error(`FAILED: ${releaseFailure}`);
    }
    let loggedSpacedFailurePath = false;
    if (workflowLogPath) {
      loggedSpacedFailurePath = logSpacedFailurePath(
        "Workflow log",
        workflowLogPath,
      );
    }
    if (latestFailureDebugPath) {
      loggedSpacedFailurePath = logSpacedFailurePath(
        "Failure details",
        latestFailureDebugPath,
      );
    }
    if (tokenUsageLogPath) {
      loggedSpacedFailurePath = logSpacedFailurePath(
        "Token usage ledger",
        tokenUsageLogPath,
      );
    }
    if (loggedSpacedFailurePath) {
      logger.error("");
    }
    logger.error(elapsedLine());
    return failure(finalReason, completedIterations, exitCode);
  };
  const finishSuccess = async (
    reason: string,
    completedIterations: number,
  ): Promise<RunnerResult> => {
    const releaseFailure = await releaseHeldWorkflowFileLocks();
    if (releaseFailure) {
      return finishFailure(releaseFailure, completedIterations);
    }
    logger.log("SUCCESS");
    if (workflowLogPath) {
      logger.log(`- Workflow log: ${workflowLogPath}`);
    }
    if (tokenUsageLogPath) {
      logger.log(`- Token usage ledger: ${tokenUsageLogPath}`);
    }
    logger.log(elapsedLine());
    return success(reason, completedIterations);
  };
  const finishBlocked = async (
    reason: string,
    detail: string,
    planPath: string,
    completedIterations = iterations,
  ): Promise<RunnerResult> => {
    const releaseFailure = await releaseHeldWorkflowFileLocks();
    const finalReason = releaseFailure
      ? `${reason}; ${releaseFailure}`
      : reason;
    const summary = blockedReasonSummary(detail);
    logger.error("BLOCKED");
    logger.error(`- Reason: ${summary.category}`);
    logger.error(`-> ${summary.detail}`);
    logger.error("-> Next: Run Codex CLI with this:");
    logger.error("`use unblock-plan.md`");
    logger.error("`evidence: ...`");
    logger.error(`\`${planPath}\``);
    logger.error("");
    if (workflowLogPath) {
      logger.error(`- Workflow log: ${workflowLogPath}`);
    }
    if (tokenUsageLogPath) {
      logger.error(`- Token usage ledger: ${tokenUsageLogPath}`);
    }
    if (releaseFailure) {
      logger.error(`FAILED: ${releaseFailure}`);
    }
    logger.error(elapsedLine());
    return failure(finalReason, completedIterations);
  };
  const manualPlanPreflight = await preflightManualPlanExecutionMode({
    planName: planArgument,
    rootDir,
  });
  if (!manualPlanPreflight.ok) {
    return await finishFailure(manualPlanPreflight.reason);
  }
  const branchPreflight = await protectedBranchPreflight(
    rootDir,
    processRunner,
  );
  if (!branchPreflight.ok) {
    return await finishFailure(branchPreflight.reason);
  }
  const currentBranch = branchPreflight.branch;
  const initialParsedPlan = await parsePlan({
    planName: planArgument,
    rootDir,
  });
  if (!initialParsedPlan.ok) {
    return await finishFailure(initialParsedPlan.reason);
  }
  emitWorkflowThresholdWarnings(initialParsedPlan.warnings);
  let parsedPlan: ParsedPlan = initialParsedPlan;
  tokenUsageTotals = await readTokenUsageTotals(rootDir, parsedPlan.planName);
  const syncWorkflowSnapshot = async (
    plan: ParsedPlan,
  ): Promise<WorkflowContextSnapshotResult | Failure> => {
  const snapshotResult = await writeWorkflowContextSnapshot({
    rootDir,
    plan,
    latestTokenUsage: await readLatestTokenUsage(rootDir, plan.planName),
  });
    if (!snapshotResult.ok) {
      return snapshotResult;
    }
    return snapshotResult;
  };

  while (true) {
    const route = routeFor(parsedPlan.status, parsedPlan.nextAction);
    if (!route.executable) {
      return await finishFailure(route.reason);
    }
    const prompt = await readPrompt(rootDir, route.promptPath);
    if (!prompt.ok) {
      return await finishFailure(prompt.reason);
    }
    const nextIteration = iterations + 1;
    const executionConfig = codexExecutionConfig(route.promptPath);
    const planTasks = parsePlanTasks(parsedPlan.content);
    const taskSavepointMode = planTasks.length > 1;
    const selectedTask = taskSavepointMode
      ? await nextIncompleteTask(rootDir, parsedPlan.planName, planTasks)
      : undefined;
    const taskSavepointAggregateSummary =
      taskSavepointMode &&
      !selectedTask &&
      route.promptPath === rel(".ai", "prompts", "commit-summary.md");
    const completedTaskCommits = taskSavepointMode
      ? await completedTaskCommitCount(rootDir, parsedPlan.planName, planTasks)
      : 0;
    const commitProgress: CommitProgress | undefined = taskSavepointMode
      ? {
          completed: completedTaskCommits,
          total: planTasks.length,
          description: selectedTask
            ? readableTaskProgressDescription(selectedTask)
            : "task commits complete",
        }
      : undefined;
    const taskCommitBoundaryTotal =
      selectedTask && route.promptPath === COMMIT_SUMMARY_PROMPT_PATH
        ? taskCommitBoundaryCount(parsedPlan.content, selectedTask.id)
        : undefined;
    const commitBoundaryProgress =
      selectedTask && taskCommitBoundaryTotal
        ? {
            taskPosition: completedTaskCommits + 1,
            taskTotal: planTasks.length,
            taskLabel: readableTaskLabel(selectedTask),
            boundaryTotal: taskCommitBoundaryTotal,
          }
        : undefined;
    const selectedTaskArtifactPath = selectedTask
      ? await currentTaskArtifactRelativePath(
          rootDir,
          parsedPlan.planName,
          selectedTask,
        )
      : undefined;
    const selectedTaskStage = selectedTaskArtifactPath
      ? await readTaskArtifactStage(rootDir, selectedTaskArtifactPath)
      : undefined;
    if (
      taskSavepointMode &&
      parsedPlan.status === "completed" &&
      parsedPlan.nextAction === "commit-summary" &&
      selectedTask &&
      selectedTaskArtifactPath
    ) {
      const noCommit = await hasArtifactOnlyNoCommitReview({
        rootDir,
        plan: parsedPlan,
      });
      if (!noCommit.ok) {
        return await finishFailure(noCommit.reason);
      }
      if (noCommit.noCommit) {
        const nextTask = await nextTaskAfter(
          rootDir,
          parsedPlan.planName,
          planTasks,
          selectedTask,
        );
        const artifact = await writeTaskArtifact({
          rootDir,
          planPath: parsedPlan.planPath,
          context: {
            task: selectedTask,
            stage: "committed",
            artifactPath: selectedTaskArtifactPath,
            commitSha: "no-commit",
          },
          changedFiles: [],
          summaryLines: [
            "Recovered task completion from an artifact-only review handoff.",
          ],
          validationSummary:
            "Artifact-only review was accepted before commit-summary recovery.",
          reviewResult: "Artifact-only review accepted without a local commit.",
          commitMessage: "N/A: declared artifact-only task savepoint.",
          nextTask,
        });
        if (!artifact.ok) {
          return await finishFailure(artifact.reason);
        }
        const reopened = await reopenPlanForNextTask(parsedPlan);
        if (!reopened.ok) {
          return await finishFailure(reopened.reason);
        }
        const nextParsed = await parsePlan({
          planName: planArgument,
          rootDir,
        });
        if (!nextParsed.ok) {
          return await finishFailure(nextParsed.reason);
        }
        parsedPlan = nextParsed;
        continue;
      }
    }
    if (
      taskSavepointMode &&
      route.promptPath === rel(".ai", "prompts", "commit-summary.md") &&
      selectedTask &&
      !currentTaskContext
    ) {
      const recoveryParent = await readTaskCommitRecoveryParent({
        rootDir,
        plan: parsedPlan,
      });
      if (!recoveryParent.ok) {
        return await finishFailure(recoveryParent.reason);
      }
      const recoveredCommit = await readHeadTaskCommit({
        rootDir,
        planName: parsedPlan.planName,
        planPath: parsedPlan.planPath,
        task: selectedTask,
        expectedParentSha: recoveryParent.headSha,
        processRunner,
      });
      if (!recoveredCommit.ok) {
        return await finishFailure(recoveredCommit.reason);
      }
      if (recoveredCommit.commit) {
        const parsedPaths = await parseCommitSummaryPathsForPlan(
          rootDir,
          parsedPlan,
          options.isIgnored,
        );
        if (!parsedPaths.ok) {
          return await finishFailure(
            `commit summary file scope invalid: ${parsedPaths.reason}`,
          );
        }
        const artifactPath = await nextTaskArtifactRelativePath(
          rootDir,
          parsedPlan.planName,
          selectedTask,
        );
        const artifact = await writeTaskArtifact({
          rootDir,
          planPath: parsedPlan.planPath,
          context: {
            task: selectedTask,
            stage: "committed",
            artifactPath,
            commitSha: recoveredCommit.commit.sha.slice(0, 9),
          },
          changedFiles: parsedPaths.paths,
          summaryLines: [
            "Recovered the task savepoint artifact from the existing local commit.",
          ],
          validationSummary: "Recovered from existing task commit metadata.",
          reviewResult: "Recovered after commit-summary artifact interruption.",
          commitMessage: extractCommitSummarySubject(
            recoveredCommit.commit.message,
            selectedTask.name,
          ),
          nextTask: await nextTaskAfter(
            rootDir,
            parsedPlan.planName,
            planTasks,
            selectedTask,
          ),
        });
        if (!artifact.ok) {
          return await finishFailure(artifact.reason);
        }
        continue;
      }
    }
    if (
      taskSavepointMode &&
      route.promptPath === rel(".ai", "prompts", "commit-summary.md") &&
      selectedTask &&
      completedTaskCommits > 0 &&
      !selectedTaskStage &&
      !currentTaskContext
    ) {
      const reopened = await reopenPlanForNextTask(parsedPlan);
      if (!reopened.ok) {
        return await finishFailure(reopened.reason);
      }
      const nextParsed = await parsePlan({
        planName: planArgument,
        rootDir,
      });
      if (!nextParsed.ok) {
        return await finishFailure(nextParsed.reason);
      }
      parsedPlan = nextParsed;
      continue;
    }
    if (!selectedTask) {
      currentTaskContext = undefined;
    }
    let deferredTaskProgress:
      | { stage: TaskStage; detail: string }
      | undefined;
    const emitTaskProgress = ({
      stage,
      detail,
    }: {
      stage: TaskStage;
      detail: string;
    }) => {
      if (!selectedTask) {
        return;
      }
      const taskProgressLine = formatTaskProgressLine({
        task: selectedTask,
        stage,
        detail,
        taskPosition: completedTaskCommits + 1,
        taskTotal: planTasks.length,
        completedTasks: completedTaskCommits,
        boundaryTotal: taskCommitBoundaryTotal,
      });
      logger.log(streamOutput ? `${taskProgressLine}\n` : taskProgressLine);
    };
    const setTaskStage = async ({
      stage,
      detail,
      commitSha,
      logProgress = true,
    }: {
      stage: TaskStage;
      detail: string;
      commitSha?: string;
      logProgress?: boolean;
    }): Promise<{ ok: true } | Failure> => {
      if (!selectedTask || !selectedTaskArtifactPath) {
        currentTaskContext = undefined;
        return { ok: true };
      }
      currentTaskContext = {
        task: selectedTask,
        stage,
        artifactPath: selectedTaskArtifactPath,
        commitSha,
      };
      const artifact = await writeTaskStageArtifact({
        rootDir,
        planPath: parsedPlan.planPath,
        context: currentTaskContext,
      });
      if (!artifact.ok) {
        return artifact;
      }
      const pointer = await writeCurrentTaskPointer({
        rootDir,
        planName: parsedPlan.planName,
        planPath: parsedPlan.planPath,
        context: currentTaskContext,
        timestamp: timestamp(),
      });
      if (!pointer.ok) {
        return pointer;
      }
      if (logProgress) {
        emitTaskProgress({ stage, detail });
      }
      return { ok: true };
    };
    const startingHeadSha = await workflowHeadSha(rootDir, processRunner);
    if (iterations >= MAX_ITERATIONS) {
      const reason = `maximum iterations ${MAX_ITERATIONS} reached`;
      const logTimestamp = timestamp();
      const failureMetadata = classifyFailureForLog(reason);
      const failureDebugResult = await appendFailureDebugLedger(
        rootDir,
        parsedPlan.planName,
        createWorkflowFailureDebugRecord({
          timestamp: logTimestamp,
          iteration: nextIteration,
          planPath: parsedPlan.planPath,
          status: parsedPlan.status,
          nextAction: parsedPlan.nextAction,
          promptPath: route.promptPath,
          result: "not-launched",
          exitCode: undefined,
          stopReason: reason,
          failureMetadata,
          stdout: "",
          stderr: "",
        }),
      );
      if (!failureDebugResult.ok) {
        return await finishFailure(failureDebugResult.reason);
      }
      latestFailureDebugPath = failureDebugResult.pointer;
      const logResult = await appendLog(
        rootDir,
        parsedPlan.planName,
        logFields({
          timestamp: logTimestamp,
          iteration: nextIteration,
          planPath: parsedPlan.planPath,
          status: parsedPlan.status,
          nextAction: parsedPlan.nextAction,
          promptPath: route.promptPath,
          model: executionConfig.model,
          reasoning: executionConfig.reasoning,
          contextUsage: unavailableContextUsage,
          result: "not-launched",
          exitCode: undefined,
          durationMs: 0,
          stopReason: reason,
          failureDebugPath: failureDebugResult.pointer,
          stdout: "",
          stderr: "",
          staging: undefined,
          taskContext: currentTaskContext,
          currentBranch,
          startingHeadSha,
          endingHeadSha: await workflowHeadSha(rootDir, processRunner),
          commitProgress,
        }),
      );
      if (!logResult.ok) {
        return await finishFailure(logResult.reason);
      }
      markWorkflowLogCreated(parsedPlan.planName);
      return await finishFailure(reason);
    }

    const attemptStartedAt = now();
    let staging: ReviewStagingProcess | undefined;
    let reviewCleanup: ReviewCleanupProcess | undefined;
    let reviewStagingPaths: string[] | undefined;
    let reviewScopeMetadata: ReviewScopeMetadata | undefined;
    let commitSummaryPaths: string[] | undefined;
    let fileOwnershipPreflight: FileOwnershipPreflight | undefined;
    let reviewAutoNarrowReason: string | undefined;
    let noCommitReviewCompletion = false;
    let progressLogged = false;
    const logWorkflowProgress = () => {
      if (progressLogged) {
        return;
      }
      iterations = nextIteration;
      logger.log(
        formatWorkflowProgressLine({
          iteration: iterations,
          maxIterations: MAX_ITERATIONS,
          status: parsedPlan.status,
          nextAction: parsedPlan.nextAction,
          promptPath: route.promptPath,
          model: executionConfig.model,
          reasoning: executionConfig.reasoning,
          color: colorOutput,
        }),
      );
      if (commitProgress && !selectedTask) {
        logger.log(
          streamOutput
            ? `${formatCommitProgressLine(commitProgress)}\n`
            : formatCommitProgressLine(commitProgress),
        );
      }
      progressLogged = true;
      if (deferredTaskProgress) {
        emitTaskProgress(deferredTaskProgress);
        deferredTaskProgress = undefined;
      }
    };
    const cleanupReviewStagingPaths = async (
      paths: string[] | undefined,
    ): Promise<{ ok: true } | Failure> => {
      if (
        !isReviewPrompt(route.promptPath) ||
        !paths ||
        paths.length === 0 ||
        reviewCleanup
      ) {
        return { ok: true };
      }
      const cleanup = await runReviewUnstageForPaths(
        rootDir,
        paths,
        processRunner,
      );
      reviewCleanup = cleanup.cleanup;
      if (!cleanup.ok) {
        return { ok: false, reason: cleanup.reason };
      }
      return { ok: true };
    };
    const cleanupCommitSummaryPaths = async (
      paths: string[] | undefined,
    ): Promise<{ ok: true } | Failure> => {
      if (!paths || paths.length === 0 || reviewCleanup) {
        return { ok: true };
      }
      const cleanup = await runReviewUnstageForPaths(
        rootDir,
        paths,
        processRunner,
        {
          operationLabel: "commit-summary cleanup",
          promptPath: "git-commit-summary-unstage",
        },
      );
      reviewCleanup = cleanup.cleanup;
      if (!cleanup.ok) {
        return { ok: false, reason: cleanup.reason };
      }
      return { ok: true };
    };
    const prepareReviewScopeForPaths = async (
      paths: string[],
    ): Promise<{ ok: true } | Failure> => {
      let cleanup = await runScopeCleanupForPaths({
        codexRuntime,
        rootDir,
        planPath: parsedPlan.planPath,
        planContent: parsedPlan.content,
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
          planPath: parsedPlan.planPath,
          planContent: parsedPlan.content,
          paths,
          processRunner,
          mode: "review",
        });
      }
      const unresolvedCleanupDiffBytes = cleanup.skippedLargeDiff
        ? cleanup.diffBytes
        : skippedCleanupDiffBytes;
      if (unresolvedCleanupDiffBytes) {
        const decision = decideWorkflowAutoNarrow({
          currentPass: reviewNarrowPass,
          cleanupDiffBytes: unresolvedCleanupDiffBytes,
        });
        if (decision.shouldNarrow) {
          reviewNarrowPass = decision.nextPass;
        }
        reviewAutoNarrowReason = [reviewAutoNarrowReason, decision.reason]
          .filter(Boolean)
          .join("; ");
      }
      const scope = await buildReviewScopeMetadata({
        rootDir,
        paths,
        planContent: parsedPlan.content,
        processRunner,
        narrowPass: reviewNarrowPass,
        autoNarrowReason: reviewAutoNarrowReason,
      });
      if (!scope.ok) {
        return scope;
      }
      reviewNarrowPass = scope.scope.narrowPass;
      reviewScopeMetadata = scope.scope;
      return { ok: true };
    };
    if (
      route.promptPath === rel(".ai", "prompts", "execute-plan.md") &&
      selectedTask
    ) {
      const taskStage = await setTaskStage({
        stage: "implementing",
        detail: selectedTask.name,
        logProgress: false,
      });
      if (!taskStage.ok) {
        return await finishFailure(taskStage.reason);
      }
      deferredTaskProgress = {
        stage: "implementing",
        detail: selectedTask.name,
      };
    }
    if (
      route.promptPath === rel(".ai", "prompts", "commit-summary.md") &&
      selectedTask
    ) {
      const taskStage = await setTaskStage({
        stage: "commit-message",
        detail: "generating commit",
        logProgress: false,
      });
      if (!taskStage.ok) {
        return await finishFailure(taskStage.reason);
      }
      deferredTaskProgress = {
        stage: "commit-message",
        detail: "generating commit",
      };
    }
    if (
      route.promptPath === rel(".ai", "prompts", "execute-plan.md") ||
      isReviewPrompt(route.promptPath) ||
      route.promptPath === rel(".ai", "prompts", "commit-summary.md")
    ) {
      const preflight =
        parsedPlan.thinPlanContract === "thin-plan-v2"
          ? await readThinPlanV2FileOwnershipPreflight({
              rootDir,
              plan: parsedPlan,
              processRunner,
              checkCompletedDirtyConflicts:
                route.promptPath === rel(".ai", "prompts", "execute-plan.md"),
              isIgnored: options.isIgnored,
            })
          : await refreshAndCheckFileOwnershipArtifact({
              rootDir,
              plan: parsedPlan,
              processRunner,
              timestamp,
              isIgnored: options.isIgnored,
            });
      if ("ok" in preflight && !preflight.ok) {
        return await finishFailure(
          `workflow file ownership scope invalid: ${preflight.reason}`,
        );
      }
      fileOwnershipPreflight = preflight;
    }
    const workflowTokenGuardrail = await readWorkflowTokenGuardrail({
      rootDir,
      planName: parsedPlan.planName,
      promptPath: route.promptPath,
    });
    if (route.promptPath === rel(".ai", "prompts", "execute-plan.md")) {
      const ownershipPaths =
        fileOwnershipPreflight?.hasOwnershipScope &&
        fileOwnershipPreflight.artifact
          ? {
              ok: true as const,
              paths: fileOwnershipPreflight.artifact.resolvedFiles,
            }
          : await parseWorkflowFileOwnershipPaths(
              rootDir,
              parsedPlan.content,
              options.isIgnored,
            );
      if (!ownershipPaths.ok) {
        return await finishFailure(
          `workflow file ownership scope invalid: ${ownershipPaths.reason}`,
        );
      }
      const acquired = await acquireWorkflowFileOwnershipForPaths({
        rootDir,
        planPath: parsedPlan.planPath,
        paths: ownershipPaths.paths,
        heldLockPaths: heldWorkflowFileLockPaths,
        now: timestamp,
        unlockHintForPlanPath: workflowFileUnlockPathHint,
      });
      if (!acquired.ok) {
        return await finishFailure(acquired.reason);
      }
      startWorkflowFileLockHeartbeat();
    }
    if (isReviewPrompt(route.promptPath)) {
      if (isReviewPrompt(route.promptPath)) {
        if (
          isArtifactOnlyNoCommitReview({
            plan: parsedPlan,
            artifact: fileOwnershipPreflight?.artifact,
          })
        ) {
          logWorkflowProgress();
          let continueExecution = false;
          if (taskSavepointMode && selectedTask && selectedTaskArtifactPath) {
            const nextTask = await nextTaskAfter(
              rootDir,
              parsedPlan.planName,
              planTasks,
              selectedTask,
            );
            const artifact = await writeTaskArtifact({
              rootDir,
              planPath: parsedPlan.planPath,
              context: {
                task: selectedTask,
                stage: "committed",
                artifactPath: selectedTaskArtifactPath,
                commitSha: "no-commit",
              },
              changedFiles:
                fileOwnershipPreflight?.artifact?.changedFiles ?? [],
              summaryLines: [
                "Artifact-only review accepted without a local commit.",
              ],
              validationSummary:
                "See plan validation history and artifact-only review evidence.",
              reviewResult: "Artifact-only review accepted without a local commit.",
              commitMessage: "N/A: declared artifact-only task savepoint.",
              nextTask,
            });
            if (!artifact.ok) {
              return await finishFailure(artifact.reason);
            }
            continueExecution =
              (await nextIncompleteTask(
                rootDir,
                parsedPlan.planName,
                planTasks,
              )) !== undefined;
          }
          const completed = await completeArtifactOnlyNoCommitReview({
            rootDir,
            plan: parsedPlan,
            timestamp,
            continueExecution,
          });
          if (!completed.ok) {
            return await finishFailure(completed.reason);
          }
          const updated = await parsePlan({ planName: planArgument, rootDir });
          if (!updated.ok) {
            return await finishFailure(updated.reason);
          }
          parsedPlan = updated;
          continue;
        }
        const parsedPaths =
          fileOwnershipPreflight?.hasOwnershipScope &&
          fileOwnershipPreflight.reviewStagingPaths
            ? fileOwnershipPreflight.reviewStagingPaths.length > 0
              ? {
                  ok: true as const,
                  paths: fileOwnershipPreflight.reviewStagingPaths,
                }
              : {
                  ok: false as const,
                  reason:
                    "plan has no changed ownership files to stage for review",
                }
            : await parseReviewStagingPaths({
                content: parsedPlan.content,
                rootDir,
                isIgnored:
                  options.isIgnored ??
                  ((relativePath) => defaultIsIgnored(rootDir, relativePath)),
              });
        if (!parsedPaths.ok) {
          const durationMs = Math.max(0, now() - attemptStartedAt);
          const logTimestamp = timestamp();
          const failureMetadata = classifyFailureForLog(parsedPaths.reason);
          const failureDebugResult = await appendFailureDebugLedger(
            rootDir,
            parsedPlan.planName,
            createWorkflowFailureDebugRecord({
              timestamp: logTimestamp,
              iteration: nextIteration,
              planPath: parsedPlan.planPath,
              status: parsedPlan.status,
              nextAction: parsedPlan.nextAction,
              promptPath: route.promptPath,
              result: "not-launched",
              exitCode: undefined,
              stopReason: parsedPaths.reason,
              failureMetadata,
              stdout: "",
              stderr: "",
            }),
          );
          if (!failureDebugResult.ok) {
            return await finishFailure(failureDebugResult.reason);
          }
          latestFailureDebugPath = failureDebugResult.pointer;
          const logResult = await appendLog(
            rootDir,
            parsedPlan.planName,
            logFields({
              timestamp: logTimestamp,
              iteration: nextIteration,
              planPath: parsedPlan.planPath,
              status: parsedPlan.status,
              nextAction: parsedPlan.nextAction,
              promptPath: route.promptPath,
              model: executionConfig.model,
              reasoning: executionConfig.reasoning,
              contextUsage: unavailableContextUsage,
              result: "not-launched",
              exitCode: undefined,
              durationMs,
              stopReason: parsedPaths.reason,
              failureDebugPath: failureDebugResult.pointer,
              stdout: "",
              stderr: "",
              staging: undefined,
              taskContext: currentTaskContext,
              currentBranch,
              startingHeadSha,
              endingHeadSha: await workflowHeadSha(rootDir, processRunner),
              commitProgress,
            }),
          );
          if (!logResult.ok) {
            return await finishFailure(logResult.reason);
          }
          markWorkflowLogCreated(parsedPlan.planName);
          return await finishFailure(parsedPaths.reason);
        }
        const preExistingStagedWork = await checkForPreReviewStagedWork(
          rootDir,
          processRunner,
          parsedPaths.paths,
        );
        if (!preExistingStagedWork.ok) {
          logWorkflowProgress();
          const durationMs = Math.max(0, now() - attemptStartedAt);
          const logTimestamp = timestamp();
          const failureMetadata = classifyFailureForLog(
            preExistingStagedWork.reason,
          );
          const failureDebugResult = await appendFailureDebugLedger(
            rootDir,
            parsedPlan.planName,
            createWorkflowFailureDebugRecord({
              timestamp: logTimestamp,
              iteration: nextIteration,
              planPath: parsedPlan.planPath,
              status: parsedPlan.status,
              nextAction: parsedPlan.nextAction,
              promptPath: route.promptPath,
              result: "not-launched",
              exitCode: undefined,
              stopReason: preExistingStagedWork.reason,
              failureMetadata,
              stdout: "",
              stderr: "",
            }),
          );
          if (!failureDebugResult.ok) {
            return await finishFailure(failureDebugResult.reason);
          }
          latestFailureDebugPath = failureDebugResult.pointer;
          const logResult = await appendLog(
            rootDir,
            parsedPlan.planName,
            logFields({
              timestamp: logTimestamp,
              iteration: nextIteration,
              planPath: parsedPlan.planPath,
              status: parsedPlan.status,
              nextAction: parsedPlan.nextAction,
              promptPath: route.promptPath,
              model: executionConfig.model,
              reasoning: executionConfig.reasoning,
              contextUsage: unavailableContextUsage,
              result: "not-launched",
              exitCode: undefined,
              durationMs,
              stopReason: preExistingStagedWork.reason,
              failureDebugPath: failureDebugResult.pointer,
              stdout: "",
              stderr: "",
              staging: undefined,
              taskContext: currentTaskContext,
              currentBranch,
              startingHeadSha,
              endingHeadSha: await workflowHeadSha(rootDir, processRunner),
              commitProgress,
            }),
          );
          if (!logResult.ok) {
            return await finishFailure(logResult.reason);
          }
          markWorkflowLogCreated(parsedPlan.planName);
          return await finishFailure(preExistingStagedWork.reason);
        }
        logWorkflowProgress();
        if (selectedTask) {
          const taskStage = await setTaskStage({
            stage: "reviewing",
            detail: `staged ${parsedPaths.paths.length} ${
              parsedPaths.paths.length === 1 ? "file" : "files"
            }`,
          });
          if (!taskStage.ok) {
            return await finishFailure(taskStage.reason);
          }
        }
        const acquired = await acquireWorkflowFileOwnershipForPaths({
          rootDir,
          planPath: parsedPlan.planPath,
          paths: parsedPaths.paths,
          heldLockPaths: heldWorkflowFileLockPaths,
          now: timestamp,
        unlockHintForPlanPath: workflowFileUnlockPathHint,
        });
        if (!acquired.ok) {
          return await finishFailure(acquired.reason);
        }
        startWorkflowFileLockHeartbeat();
        if (!selectedTask) {
          logger.log(
            `Staging ${parsedPaths.paths.length} plan-owned ${
              parsedPaths.paths.length === 1 ? "file" : "files"
            } for review...`,
          );
        }
        const staged = await runReviewStagingForPaths(
          rootDir,
          parsedPaths.paths,
          processRunner,
        );
        if (!staged.ok) {
          const cleanup = await cleanupReviewStagingPaths(
            staged.staging?.paths,
          );
          const stopReason = cleanup.ok
            ? staged.reason
            : `${staged.reason}; ${cleanup.reason}`;
          const durationMs = Math.max(0, now() - attemptStartedAt);
          const logTimestamp = timestamp();
          const failureMetadata = classifyFailureForLog(stopReason);
          const failureDebugResult = await appendFailureDebugLedger(
            rootDir,
            parsedPlan.planName,
            createWorkflowFailureDebugRecord({
              timestamp: logTimestamp,
              iteration: nextIteration,
              planPath: parsedPlan.planPath,
              status: parsedPlan.status,
              nextAction: parsedPlan.nextAction,
              promptPath: route.promptPath,
              result: staged.staging ? "staging-failed" : "not-launched",
              exitCode: undefined,
              stopReason,
              failureMetadata,
              stdout: "",
              stderr: "",
              staging: staged.staging,
              cleanup: reviewCleanup,
              taskContext: currentTaskContext,
            }),
          );
          if (!failureDebugResult.ok) {
            return await finishFailure(failureDebugResult.reason);
          }
          latestFailureDebugPath = failureDebugResult.pointer;
          const logResult = await appendLog(
            rootDir,
            parsedPlan.planName,
            logFields({
              timestamp: logTimestamp,
              iteration: nextIteration,
              planPath: parsedPlan.planPath,
              status: parsedPlan.status,
              nextAction: parsedPlan.nextAction,
              promptPath: route.promptPath,
              model: executionConfig.model,
              reasoning: executionConfig.reasoning,
              contextUsage: unavailableContextUsage,
              result: staged.staging ? "staging-failed" : "not-launched",
              exitCode: undefined,
              durationMs,
              stopReason,
              failureDebugPath: failureDebugResult.pointer,
              stdout: "",
              stderr: "",
              staging: staged.staging,
              cleanup: reviewCleanup,
              taskContext: currentTaskContext,
              currentBranch,
              startingHeadSha,
              endingHeadSha: await workflowHeadSha(rootDir, processRunner),
              commitProgress,
            }),
          );
          if (!logResult.ok) {
            return await finishFailure(logResult.reason);
          }
          markWorkflowLogCreated(parsedPlan.planName);
          return await finishFailure(stopReason);
        }
        const scope = await prepareReviewScopeForPaths(staged.paths);
        if (!scope.ok) {
          const cleanup = await cleanupReviewStagingPaths(staged.paths);
          const stopReason = cleanup.ok
            ? scope.reason
            : `${scope.reason}; ${cleanup.reason}`;
          return await finishFailure(stopReason);
        }
        staging = staged.staging;
        reviewStagingPaths = staged.paths;
      } else {
        if (
          !carriedReviewStagingPaths ||
          carriedReviewStagingPaths.length === 0
        ) {
          const parsedPaths =
            fileOwnershipPreflight?.hasOwnershipScope &&
            fileOwnershipPreflight.reviewStagingPaths
              ? fileOwnershipPreflight.reviewStagingPaths.length > 0
                ? {
                    ok: true as const,
                    paths: fileOwnershipPreflight.reviewStagingPaths,
                  }
                : {
                    ok: false as const,
                    reason:
                      "plan has no changed ownership files to stage for review",
                  }
              : await parseReviewStagingPaths({
                  content: parsedPlan.content,
                  rootDir,
                  isIgnored:
                    options.isIgnored ??
                    ((relativePath) => defaultIsIgnored(rootDir, relativePath)),
                });
          if (!parsedPaths.ok) {
            return await finishFailure(parsedPaths.reason);
          }
          logWorkflowProgress();
          if (selectedTask) {
            const taskStage = await setTaskStage({
              stage: "reviewing",
              detail: `staged ${parsedPaths.paths.length} ${
                parsedPaths.paths.length === 1 ? "file" : "files"
              }`,
            });
            if (!taskStage.ok) {
              return await finishFailure(taskStage.reason);
            }
          }
          const acquired = await acquireWorkflowFileOwnershipForPaths({
            rootDir,
            planPath: parsedPlan.planPath,
            paths: parsedPaths.paths,
            heldLockPaths: heldWorkflowFileLockPaths,
            now: timestamp,
        unlockHintForPlanPath: workflowFileUnlockPathHint,
          });
          if (!acquired.ok) {
            return await finishFailure(acquired.reason);
          }
          startWorkflowFileLockHeartbeat();
          if (!selectedTask) {
            logger.log(
              `Staging ${parsedPaths.paths.length} plan-owned ${
                parsedPaths.paths.length === 1 ? "file" : "files"
              } for quality review...`,
            );
          }
          const staged = await runReviewStagingForPaths(
            rootDir,
            parsedPaths.paths,
            processRunner,
          );
          if (!staged.ok) {
            const cleanup = await cleanupReviewStagingPaths(
              staged.staging?.paths,
            );
            const stopReason = cleanup.ok
              ? staged.reason
              : `${staged.reason}; ${cleanup.reason}`;
            return await finishFailure(stopReason);
          }
          const scope = await prepareReviewScopeForPaths(staged.paths);
          if (!scope.ok) {
            const cleanup = await cleanupReviewStagingPaths(staged.paths);
            const stopReason = cleanup.ok
              ? scope.reason
              : `${scope.reason}; ${cleanup.reason}`;
            return await finishFailure(stopReason);
          }
          reviewStagingPaths = staged.paths;
          staging = staged.staging;
        } else {
          logWorkflowProgress();
          reviewStagingPaths = carriedReviewStagingPaths;
          staging = carriedReviewStagingProcess;
          const scope = await prepareReviewScopeForPaths(reviewStagingPaths);
          if (!scope.ok) {
            return await finishFailure(scope.reason);
          }
        }
      }
    }
    if (route.promptPath === rel(".ai", "prompts", "commit-summary.md")) {
      const noCommit = await hasArtifactOnlyNoCommitReview({
        rootDir,
        plan: parsedPlan,
      });
      if (!noCommit.ok) {
        return await finishFailure(noCommit.reason);
      }
      noCommitReviewCompletion = noCommit.noCommit;
      if (!noCommitReviewCompletion) {
        const parsedPaths = await parseCommitSummaryPathsForPlan(
          rootDir,
          parsedPlan,
          options.isIgnored,
        );
        if (!parsedPaths.ok) {
          return await finishFailure(
            `commit summary file scope invalid: ${parsedPaths.reason}`,
          );
        }
        commitSummaryPaths = parsedPaths.paths;
        if (
          selectedTask &&
          parseTaskCommitBoundaries(parsedPlan.content, selectedTask.id).declared
        ) {
          const dirtyPaths = await readDirtyPlanOwnedPaths(
            rootDir,
            commitSummaryPaths,
            processRunner,
          );
          if (!dirtyPaths.ok) {
            return await finishFailure(dirtyPaths.reason);
          }
          const boundaries = validateTaskCommitBoundaries({
            planContent: parsedPlan.content,
            taskId: selectedTask.id,
            planOwnedDirtyPaths: dirtyPaths.paths,
          });
          if (!boundaries.ok) {
            return await finishFailure(boundaries.reason);
          }
        }
        const acquired = await acquireWorkflowFileOwnershipForPaths({
          rootDir,
          planPath: parsedPlan.planPath,
          paths: commitSummaryPaths,
          heldLockPaths: heldWorkflowFileLockPaths,
          now: timestamp,
        unlockHintForPlanPath: workflowFileUnlockPathHint,
        });
        if (!acquired.ok) {
          return await finishFailure(acquired.reason);
        }
        startWorkflowFileLockHeartbeat();
      }
    }
    if (route.terminal && noCommitReviewCompletion) {
      logWorkflowProgress();
      const snapshotResult = await syncWorkflowSnapshot(parsedPlan);
      if (!snapshotResult.ok) {
        return await finishFailure(snapshotResult.reason);
      }
      const logResult = await appendLog(
        rootDir,
        parsedPlan.planName,
        logFields({
          timestamp: timestamp(),
          iteration: iterations,
          planPath: parsedPlan.planPath,
          status: parsedPlan.status,
          nextAction: parsedPlan.nextAction,
          promptPath: route.promptPath,
          model: executionConfig.model,
          reasoning: executionConfig.reasoning,
          contextUsage: unavailableContextUsage,
          result: "artifact-only-completed",
          exitCode: 0,
          durationMs: Math.max(0, now() - attemptStartedAt),
          stdout: "",
          stderr: "",
          taskContext: currentTaskContext,
          currentBranch,
          startingHeadSha,
          endingHeadSha: await workflowHeadSha(rootDir, processRunner),
          commitProgress,
        }),
      );
      if (!logResult.ok) {
        return await finishFailure(logResult.reason);
      }
      markWorkflowLogCreated(parsedPlan.planName);
      return await finishSuccess(
        "completed artifact-only no-commit workflow",
        iterations,
      );
    }

    logWorkflowProgress();
    const contextSnapshot = await syncWorkflowSnapshot(parsedPlan);
    if (!contextSnapshot.ok) {
      return await finishFailure(contextSnapshot.reason);
    }
    const generatedPrompt = generateWorkflowPrompt({
      promptPath: route.promptPath,
      planPath: parsedPlan.planPath,
      promptContent: prompt.content,
      planContent: parsedPlan.content,
      contextSnapshotPath: contextSnapshot.snapshotPath,
      reviewStagingPaths,
      reviewPrimaryPaths: reviewScopeMetadata?.reviewPrimaryPaths,
      reviewScopeMetadata,
      commitSummaryPaths,
      unblockNote,
      workflowTokenGuardrail,
      taskContext: currentTaskContext,
      taskSavepointAggregateSummary,
    });
    const editedSummaryPaths = await parseEditedFileSummaryPaths(
      rootDir,
      parsedPlan.content,
    );
    const editedFileSnapshot = await readEditedFileSnapshot(
      rootDir,
      editedSummaryPaths,
    );
    const waitNotice = createWorkflowWaitNotice({
      outputStream,
      enabled: streamOutput,
      promptPath: route.promptPath,
      now,
      startedAt: attemptStartedAt,
      color: colorOutput,
    });
    const liveOutput = streamOutput
      ? createCodexLiveOutputFormatter(
          {
            ...outputStream,
            stdout: (chunk: string) => {
              waitNotice.markActivity();
              outputStream.stdout(chunk);
            },
            stderr: (chunk: string) => {
              waitNotice.markActivity();
              outputStream.stderr(chunk);
            },
          },
          { color: colorOutput, commitBoundaryProgress },
        )
      : undefined;
    waitNotice.start();
    let effectiveExecutionConfig = executionConfig;
    const runCodexAttempt = async (
      attemptExecutionConfig: CodexExecutionConfig,
    ): Promise<ProcessResult> =>
      processRunner({
        command: codexRuntime.command,
        binaryCommand: CODEX_BINARY_COMMAND,
        args: codexExecArgs({
          executionConfig: attemptExecutionConfig,
          promptPath: route.promptPath,
          prompt: generatedPrompt,
          rootDir,
        }),
        cwd: rootDir,
        input: "",
        promptPath: route.promptPath,
        env: codexWorkEnvironment(process.env, codexRuntime.profile),
        abortSignal: options.abortSignal,
        onStdout: liveOutput?.stdout,
        onStderr: liveOutput?.stderr,
      }).catch(
        (error): ProcessResult => ({
          launched: false,
          stdout: "",
          stderr: "",
          error: String(error),
        }),
      );
    let result: ProcessResult;
    try {
      const retryNotices: string[] = [];
      result = await runCodexAttempt(executionConfig);
      for (
        let attempt = 2;
        attempt <= CODEX_SELECTED_MODEL_CAPACITY_PRIMARY_ATTEMPTS &&
        codexResultContainsSelectedModelCapacity(result);
        attempt += 1
      ) {
        const retryNotice = `[workflow-runner] ${executionConfig.model} reported capacity; retrying ${route.promptPath} with the same model (${attempt}/${CODEX_SELECTED_MODEL_CAPACITY_PRIMARY_ATTEMPTS}).`;
        retryNotices.push(retryNotice);
        logger.log(streamOutput ? `${retryNotice}\n` : retryNotice);
        result = await runCodexAttempt(executionConfig);
      }

      const fallbackExecutionConfig = codexResultContainsSelectedModelCapacity(
        result,
      )
        ? codexCapacityFallbackConfig(executionConfig)
        : undefined;
      if (fallbackExecutionConfig) {
        effectiveExecutionConfig = fallbackExecutionConfig;
        for (
          let attempt = 1;
          attempt <= CODEX_SELECTED_MODEL_CAPACITY_FALLBACK_ATTEMPTS &&
          codexResultContainsSelectedModelCapacity(result);
          attempt += 1
        ) {
          const retryNotice = `[workflow-runner] ${executionConfig.model} still reported capacity after ${CODEX_SELECTED_MODEL_CAPACITY_PRIMARY_ATTEMPTS} attempts; retrying ${route.promptPath} with fallback model ${fallbackExecutionConfig.model} (${attempt}/${CODEX_SELECTED_MODEL_CAPACITY_FALLBACK_ATTEMPTS}).`;
          retryNotices.push(retryNotice);
          logger.log(streamOutput ? `${retryNotice}\n` : retryNotice);
          result = await runCodexAttempt(fallbackExecutionConfig);
        }
      }

      if (result.launched && retryNotices.length > 0) {
        result = {
          ...result,
          stderr: [...retryNotices, result.stderr]
            .filter((part) => part.length > 0)
            .join("\n"),
        };
      }
    } finally {
      waitNotice.stop();
    }
    liveOutput?.flush({ includePendingTurnCompleted: false });
    const durationMs = Math.max(0, now() - attemptStartedAt);
    const contextUsage = result.launched
      ? parseContextUsage(result.stdout)
      : unavailableContextUsage;
    const editedFiles = result.launched
      ? await summarizeEditedFiles(rootDir, editedFileSnapshot)
      : [];
    if (streamOutput && editedFiles.length > 0) {
      logger.log(formatEditedFilesForTerminal(editedFiles, colorOutput));
      outputStream.stdout("\n");
    }
    liveOutput?.flush();

    let stopReason: string | undefined;
    const interruptSignal =
      currentInterruptSignal() ??
      (result.launched &&
      (result.exitSignal === "SIGINT" || result.exitSignal === "SIGTERM")
        ? result.exitSignal
        : undefined);
    if (!result.launched) {
      stopReason = `could not launch ${codexRuntime.execLabel}: ${result.error}`;
    } else if (interruptSignal) {
      stopReason = `${codexRuntime.execLabel} interrupted by ${interruptSignal}`;
    } else if (result.exitCode !== 0) {
      stopReason = `${codexRuntime.execLabel} exited with code ${result.exitCode}`;
    } else {
      stopReason = codexOutputStopReason(
        result.stdout,
        result.stderr,
        codexRuntime.execLabel,
      );
    }

    const appendIterationLog = async (
      iterationStopReason?: string,
      endingPlan?: ParsedPlan,
    ): Promise<{ ok: true } | Failure> => {
      const logTimestamp = timestamp();
      const tokenUsage = parseCodexTokenUsage(result.stdout);
      const cumulativeTokenUsage = result.launched
        ? addTokenUsageToTotals(tokenUsageTotals, tokenUsage)
        : tokenUsageTotals;
      const thresholdWarnings = collectWorkflowThresholdWarnings({
        planByteSize: Buffer.byteLength(
          (endingPlan ?? parsedPlan).content,
          "utf8",
        ),
        latestTokenUsage: {
          stageInputTokens: tokenUsage.inputTokens,
          stageUncachedInputTokens: tokenUsage.uncachedInputTokens,
          stageOutputTokens: tokenUsage.outputTokens,
          stageReasoningOutputTokens: tokenUsage.reasoningOutputTokens,
          stageTotalTokens: tokenUsage.totalTokens,
        },
      });
      emitWorkflowThresholdWarnings(thresholdWarnings);
      const failureMetadata = iterationStopReason
        ? classifyFailureForLog(iterationStopReason)
        : undefined;
      let failureDebugPath: string | undefined;

      if (iterationStopReason && failureMetadata) {
        const failureDebugResult = await appendFailureDebugLedger(
          rootDir,
          parsedPlan.planName,
          createWorkflowFailureDebugRecord({
            timestamp: logTimestamp,
            iteration: iterations,
            planPath: parsedPlan.planPath,
            status: parsedPlan.status,
            nextAction: parsedPlan.nextAction,
            promptPath: route.promptPath,
            result: result.launched ? "launched" : "launch-failed",
            exitCode: result.launched ? result.exitCode : undefined,
            stopReason: iterationStopReason,
            failureMetadata,
            stdout: result.stdout,
            stderr: result.stderr,
            staging,
            cleanup: reviewCleanup,
          }),
        );
        if (!failureDebugResult.ok) {
          return failureDebugResult;
        }
        failureDebugPath = failureDebugResult.pointer;
        latestFailureDebugPath = failureDebugPath;
      }

      const logResult = await appendLog(
        rootDir,
        parsedPlan.planName,
        logFields({
          timestamp: logTimestamp,
          iteration: iterations,
          planPath: parsedPlan.planPath,
          status: parsedPlan.status,
          nextAction: parsedPlan.nextAction,
          promptPath: route.promptPath,
          model: effectiveExecutionConfig.model,
          reasoning: effectiveExecutionConfig.reasoning,
          contextUsage,
          result: result.launched ? "launched" : "launch-failed",
          exitCode: result.launched ? result.exitCode : undefined,
          durationMs,
          stopReason: iterationStopReason,
          failureDebugPath,
          editedFiles,
          stdout: result.stdout,
          stderr: result.stderr,
          staging,
          cleanup: reviewCleanup,
          taskContext: currentTaskContext,
          currentBranch,
          startingHeadSha,
          endingHeadSha: await workflowHeadSha(rootDir, processRunner),
          commitProgress,
          reviewScope: reviewScopeMetadata,
          latestStageTokenUsage: tokenUsage,
          cumulativeTokenUsage,
        }),
      );
      if (logResult.ok) {
        markWorkflowLogCreated(parsedPlan.planName);
      }
      if (!logResult.ok || !result.launched) {
        return logResult;
      }

      tokenUsageTotals = cumulativeTokenUsage;
      const ledgerResult: TokenUsageLedgerResult = interruptSignal
        ? "interrupted"
        : iterationStopReason
          ? "failed"
          : "success";
      const ledgerResultValue = await appendTokenUsageLedger(
        rootDir,
        parsedPlan.planName,
        {
          timestamp: timestamp(),
          iteration: iterations,
          planPath: parsedPlan.planPath,
          startingStatus: parsedPlan.status,
          startingNextAction: parsedPlan.nextAction,
          promptPath: route.promptPath,
          endingStatus: endingPlan?.status,
          endingNextAction: endingPlan?.nextAction,
          model: effectiveExecutionConfig.model,
          reasoning: effectiveExecutionConfig.reasoning,
          result: ledgerResult,
          signal: interruptSignal ?? null,
          usageAvailable: tokenUsage.usageAvailable,
          stageInputTokens: tokenUsage.inputTokens,
          stageCachedInputTokens: tokenUsage.cachedInputTokens,
          stageUncachedInputTokens: tokenUsage.uncachedInputTokens,
          stageOutputTokens: tokenUsage.outputTokens,
          stageReasoningOutputTokens: tokenUsage.reasoningOutputTokens,
          stageTotalTokens: tokenUsage.totalTokens,
          contextWindowTokens: tokenUsage.contextWindowTokens,
          contextWindowUsedTokens: tokenUsage.contextWindowUsedTokens,
          contextWindowUsedPercent: tokenUsage.contextWindowUsedPercent,
          narrowPass: reviewScopeMetadata?.narrowPass,
          reviewAllPaths: reviewScopeMetadata?.reviewAllPaths,
          reviewPrimaryPaths: reviewScopeMetadata?.reviewPrimaryPaths,
          diffBytes: reviewScopeMetadata?.diffBytes,
          autoNarrowReason: reviewScopeMetadata?.autoNarrowReason,
          ...tokenUsageTotals,
        },
      );
      if (ledgerResultValue.ok) {
        markTokenUsageLogCreated(parsedPlan.planName);
      }
      return ledgerResultValue;
    };

    if (result.launched && result.exitCode === 0 && !interruptSignal) {
      const manifestRepair = await repairThinPlanV2ManifestStateFromWorkflow({
        rootDir,
        plan: parsedPlan,
      });
      if (!manifestRepair.ok) {
        const cleanup = await cleanupReviewStagingPaths(reviewStagingPaths);
        const reason = cleanup.ok
          ? manifestRepair.reason
          : `${manifestRepair.reason}; ${cleanup.reason}`;
        const logResult = await appendIterationLog(reason);
        if (!logResult.ok) {
          return await finishFailure(logResult.reason);
        }
        const snapshotResult = await syncWorkflowSnapshot(parsedPlan);
        if (!snapshotResult.ok) {
          return await finishFailure(snapshotResult.reason);
        }
        return await finishFailure(reason);
      }
    }

    const nonterminalRouteOutcome = (
      updated: ParsedPlan,
    ):
      | { kind: "blocked"; reason: string; detail: string; planPath: string }
      | undefined => {
      if (
        route.promptPath === rel(".ai", "prompts", "execute-plan.md") &&
        updated.status === "blocked"
      ) {
        const detail = blockedPlanDetail(updated.content);
        const reason = `plan blocked after execute-plan: ${detail}`;
        return { kind: "blocked", reason, detail, planPath: updated.planPath };
      }

      if (
        route.promptPath === rel(".ai", "prompts", "unblock-plan.md") &&
        updated.status === "blocked"
      ) {
        const detail = blockedPlanDetail(updated.content);
        const reason = `plan remains blocked after unblock-plan: ${detail}`;
        return { kind: "blocked", reason, detail, planPath: updated.planPath };
      }

      return undefined;
    };

    const finishNonterminalRouteOutcome = async (
      outcome: NonNullable<ReturnType<typeof nonterminalRouteOutcome>>,
    ): Promise<RunnerResult> => {
      return await finishBlocked(
        outcome.reason,
        outcome.detail,
        outcome.planPath,
      );
    };

    if (stopReason) {
      if (route.promptPath === EXECUTE_PLAN_PROMPT_PATH) {
        const recovered = await recoverThinPlanV2BlockedValidationHandoff({
          rootDir,
          plan: parsedPlan,
        });
        if (!recovered.ok) {
          return await finishFailure(recovered.reason);
        }
      }
      const updated = await parsePlan({ planName: planArgument, rootDir });
      if (updated.ok) {
        emitWorkflowThresholdWarnings(updated.warnings);
        const transition = transitionAllowed(
          route.promptPath,
          parsedPlan,
          updated,
        );
        if (transition.ok) {
          if (
            isReviewPrompt(route.promptPath) &&
            updated.status === "active" &&
            updated.nextAction === "execute-plan"
          ) {
            const cleanup = await cleanupReviewStagingPaths(reviewStagingPaths);
            if (!cleanup.ok) {
              const finalStopReason = `${stopReason}; ${cleanup.reason}`;
              const logResult = await appendIterationLog(finalStopReason);
              if (!logResult.ok) {
                return await finishFailure(logResult.reason);
              }
              const snapshotResult = await syncWorkflowSnapshot(updated);
              if (!snapshotResult.ok) {
                return await finishFailure(snapshotResult.reason);
              }
              return await finishFailure(finalStopReason);
            }
            carriedReviewStagingPaths = undefined;
            carriedReviewStagingProcess = undefined;
            const logResult = await appendIterationLog(undefined, updated);
            if (!logResult.ok) {
              return await finishFailure(logResult.reason);
            }
            const snapshotResult = await syncWorkflowSnapshot(updated);
            if (!snapshotResult.ok) {
              return await finishFailure(snapshotResult.reason);
            }
            parsedPlan = updated;
            continue;
          }
          const nonterminalOutcome = nonterminalRouteOutcome(updated);
          if (nonterminalOutcome) {
            const logResult = await appendIterationLog(undefined, updated);
            if (!logResult.ok) {
              return await finishFailure(logResult.reason);
            }
            const snapshotResult = await syncWorkflowSnapshot(updated);
            if (!snapshotResult.ok) {
              return await finishFailure(snapshotResult.reason);
            }
            return await finishNonterminalRouteOutcome(nonterminalOutcome);
          }
        }
      }
      const cleanup =
        route.promptPath === rel(".ai", "prompts", "commit-summary.md")
          ? await cleanupCommitSummaryPaths(commitSummaryPaths)
          : await cleanupReviewStagingPaths(reviewStagingPaths);
      const finalStopReason = cleanup.ok
        ? stopReason
        : `${stopReason}; ${cleanup.reason}`;
      const logResult = await appendIterationLog(finalStopReason);
      if (!logResult.ok) {
        return await finishFailure(logResult.reason);
      }
      const snapshotResult = await syncWorkflowSnapshot(parsedPlan);
      if (!snapshotResult.ok) {
        return await finishFailure(snapshotResult.reason);
      }
      return await finishFailure(
        finalStopReason,
        iterations,
        interruptSignal === "SIGINT"
          ? 130
          : interruptSignal === "SIGTERM"
            ? 143
            : 1,
      );
    }

    if (route.terminal) {
      const cleanCheck = await verifyCommitSummaryPathsClean(
        rootDir,
        commitSummaryPaths ?? [],
        processRunner,
      );
      if (!cleanCheck.ok) {
        const unstage = await cleanupCommitSummaryPaths(commitSummaryPaths);
        if (!unstage.ok) {
          return await finishFailure(`${cleanCheck.reason}; ${unstage.reason}`);
        }
        const logResult = await appendIterationLog(cleanCheck.reason);
        if (!logResult.ok) {
          return await finishFailure(logResult.reason);
        }
        const snapshotResult = await syncWorkflowSnapshot(parsedPlan);
        if (!snapshotResult.ok) {
          return await finishFailure(snapshotResult.reason);
        }
        return await finishFailure(cleanCheck.reason);
      }
      if (selectedTask && currentTaskContext) {
        const shaResult = await gitHeadShortSha(rootDir, processRunner);
        if (!shaResult.ok) {
          const logResult = await appendIterationLog(shaResult.reason);
          if (!logResult.ok) {
            return await finishFailure(logResult.reason);
          }
          const snapshotResult = await syncWorkflowSnapshot(parsedPlan);
          if (!snapshotResult.ok) {
            return await finishFailure(snapshotResult.reason);
          }
          return await finishFailure(shaResult.reason);
        }
        const taskStage = await setTaskStage({
          stage: "committed",
          detail: shaResult.sha,
          commitSha: shaResult.sha,
          logProgress: false,
        });
        if (!taskStage.ok) {
          return await finishFailure(taskStage.reason);
        }
      }
      const logResult = await appendIterationLog();
      if (!logResult.ok) {
        return await finishFailure(logResult.reason);
      }
      if (selectedTask && currentTaskContext) {
        const nextTask = await nextIncompleteTask(
          rootDir,
          parsedPlan.planName,
          planTasks.filter((task) => task.id !== selectedTask.id),
        );
        const artifact = await writeTaskArtifact({
          rootDir,
          planPath: parsedPlan.planPath,
          context: currentTaskContext,
          changedFiles: commitSummaryPaths ?? [],
          summaryLines: extractSummaryLines(result.stdout, selectedTask.name),
          validationSummary:
            "See plan validation history and commit-summary stage output.",
          reviewResult: "Review accepted task for commit-summary.",
          commitMessage: extractCommitSummarySubject(
            result.stdout,
            selectedTask.name,
          ),
          nextTask,
        });
        if (!artifact.ok) {
          return await finishFailure(artifact.reason);
        }
        const completedTaskArtifacts = await readCompletedTaskSavepoints({
          rootDir,
          planName: parsedPlan.planName,
          tasks: planTasks,
        });
        if (!completedTaskArtifacts.ok) {
          return await finishFailure(completedTaskArtifacts.reason);
        }
        const executionSummary = await writeExecutionSummary({
          rootDir,
          planName: parsedPlan.planName,
          planPath: parsedPlan.planPath,
          tasks: planTasks,
          completedTasks: completedTaskArtifacts.completedTasks,
          finalStatus: "in-progress",
        });
        if (!executionSummary.ok) {
          return await finishFailure(executionSummary.reason);
        }
        const bossSummary = await writeBossSummary({
          rootDir,
          planName: parsedPlan.planName,
          tasks: planTasks,
          completedTasks: completedTaskArtifacts.completedTasks,
          finalStatus: "in-progress",
        });
        if (!bossSummary.ok) {
          return await finishFailure(bossSummary.reason);
        }
        const nextTaskPosition = nextTask
          ? planTasks.findIndex((task) => task.id === nextTask.id) + 1
          : undefined;
        logger.log(
          streamOutput
            ? `${formatTaskCompletedProgressLine({
                taskPosition: completedTaskCommits + 1,
                taskTotal: planTasks.length,
                taskLabel: readableTaskLabel(selectedTask),
                commitTotal: taskCommitBoundaryTotal ?? 1,
                nextTaskPosition,
              })}\n`
            : formatTaskCompletedProgressLine({
                taskPosition: completedTaskCommits + 1,
                taskTotal: planTasks.length,
                taskLabel: readableTaskLabel(selectedTask),
                commitTotal: taskCommitBoundaryTotal ?? 1,
                nextTaskPosition,
              }),
        );
        const remainingTask = await nextIncompleteTask(
          rootDir,
          parsedPlan.planName,
          planTasks,
        );
        if (remainingTask) {
          const reopened = await reopenPlanForNextTask(parsedPlan);
          if (!reopened.ok) {
            return await finishFailure(reopened.reason);
          }
          const nextParsed = await parsePlan({
            planName: planArgument,
            rootDir,
          });
          if (!nextParsed.ok) {
            return await finishFailure(nextParsed.reason);
          }
          parsedPlan = nextParsed;
          continue;
        }
        parsedPlan = {
          ...parsedPlan,
          content: await readFile(parsedPlan.absolutePlanPath, "utf8"),
        };
        continue;
      }
      if (taskSavepointAggregateSummary) {
        const completedTaskArtifacts = await readCompletedTaskSavepoints({
          rootDir,
          planName: parsedPlan.planName,
          tasks: planTasks,
        });
        if (!completedTaskArtifacts.ok) {
          return await finishFailure(completedTaskArtifacts.reason);
        }
        const executionSummary = await writeExecutionSummary({
          rootDir,
          planName: parsedPlan.planName,
          planPath: parsedPlan.planPath,
          tasks: planTasks,
          completedTasks: completedTaskArtifacts.completedTasks,
          finalStatus: "completed",
        });
        if (!executionSummary.ok) {
          return await finishFailure(executionSummary.reason);
        }
        const bossSummary = await writeBossSummary({
          rootDir,
          planName: parsedPlan.planName,
          tasks: planTasks,
          completedTasks: completedTaskArtifacts.completedTasks,
          finalStatus: "completed",
        });
        if (!bossSummary.ok) {
          return await finishFailure(bossSummary.reason);
        }
      }
      const snapshotResult = await syncWorkflowSnapshot(parsedPlan);
      if (!snapshotResult.ok) {
        return await finishFailure(snapshotResult.reason);
      }
      const reason = "completed + commit-summary finished";
      return await finishSuccess(reason, iterations);
    }

    const previousContent = parsedPlan.content;
    const updated = await parsePlan({ planName: planArgument, rootDir });
    if (!updated.ok) {
      const cleanup = await cleanupReviewStagingPaths(reviewStagingPaths);
      const reason = cleanup.ok
        ? updated.reason
        : `${updated.reason}; ${cleanup.reason}`;
      const logResult = await appendIterationLog(reason);
      if (!logResult.ok) {
        return await finishFailure(logResult.reason);
      }
      const snapshotResult = await syncWorkflowSnapshot(parsedPlan);
      if (!snapshotResult.ok) {
        return await finishFailure(snapshotResult.reason);
      }
      return await finishFailure(reason);
    }
    emitWorkflowThresholdWarnings(updated.warnings);

    if (route.promptPath === EXECUTE_PLAN_PROMPT_PATH) {
      const recovered = await recoverThinPlanV2PartialExecuteReviewHandoff({
        rootDir,
        previous: parsedPlan,
        updated,
      });
      if (!recovered.ok) {
        const cleanup = await cleanupReviewStagingPaths(reviewStagingPaths);
        const reason = cleanup.ok
          ? recovered.reason
          : `${recovered.reason}; ${cleanup.reason}`;
        const logResult = await appendIterationLog(reason, updated);
        if (!logResult.ok) {
          return await finishFailure(logResult.reason);
        }
        const snapshotResult = await syncWorkflowSnapshot(updated);
        if (!snapshotResult.ok) {
          return await finishFailure(snapshotResult.reason);
        }
        return await finishFailure(reason);
      }
      if (recovered.recovered) {
        const recoveredPlan = await parsePlan({ planName: planArgument, rootDir });
        if (!recoveredPlan.ok) {
          const logResult = await appendIterationLog(recoveredPlan.reason);
          if (!logResult.ok) {
            return await finishFailure(logResult.reason);
          }
          const snapshotResult = await syncWorkflowSnapshot(parsedPlan);
          if (!snapshotResult.ok) {
            return await finishFailure(snapshotResult.reason);
          }
          return await finishFailure(recoveredPlan.reason);
        }
        const logResult = await appendIterationLog(
          "repaired partial execute-plan review handoff",
          recoveredPlan,
        );
        if (!logResult.ok) {
          return await finishFailure(logResult.reason);
        }
        const snapshotResult = await syncWorkflowSnapshot(recoveredPlan);
        if (!snapshotResult.ok) {
          return await finishFailure(snapshotResult.reason);
        }
        parsedPlan = recoveredPlan;
        continue;
      }
    }

    const nonterminalOutcome = nonterminalRouteOutcome(updated);
    if (nonterminalOutcome) {
      const logResult = await appendIterationLog(undefined, updated);
      if (!logResult.ok) {
        return await finishFailure(logResult.reason);
      }
      const snapshotResult = await syncWorkflowSnapshot(updated);
      if (!snapshotResult.ok) {
        return await finishFailure(snapshotResult.reason);
      }
      return await finishNonterminalRouteOutcome(nonterminalOutcome);
    }

    if (updated.content === previousContent) {
      if (route.promptPath === rel(".ai", "prompts", "execute-plan.md")) {
        const recovered = await recoverThinPlanV2ExecuteHandoff({
          rootDir,
          plan: parsedPlan,
          processRunner,
          stdout: result.stdout,
          timestamp,
        });
        if (!recovered.ok) {
          const logResult = await appendIterationLog(recovered.reason);
          if (!logResult.ok) {
            return await finishFailure(logResult.reason);
          }
          const snapshotResult = await syncWorkflowSnapshot(parsedPlan);
          if (!snapshotResult.ok) {
            return await finishFailure(snapshotResult.reason);
          }
          return await finishFailure(recovered.reason);
        }
        if (recovered.recovered) {
          const recoveredPlan = await parsePlan({
            planName: planArgument,
            rootDir,
          });
          if (!recoveredPlan.ok) {
            const logResult = await appendIterationLog(recoveredPlan.reason);
            if (!logResult.ok) {
              return await finishFailure(logResult.reason);
            }
            const snapshotResult = await syncWorkflowSnapshot(parsedPlan);
            if (!snapshotResult.ok) {
              return await finishFailure(snapshotResult.reason);
            }
            return await finishFailure(recoveredPlan.reason);
          }
          const transition = transitionAllowed(
            route.promptPath,
            parsedPlan,
            recoveredPlan,
          );
          if (!transition.ok) {
            const logResult = await appendIterationLog(
              transition.reason,
              recoveredPlan,
            );
            if (!logResult.ok) {
              return await finishFailure(logResult.reason);
            }
            const snapshotResult = await syncWorkflowSnapshot(recoveredPlan);
            if (!snapshotResult.ok) {
              return await finishFailure(snapshotResult.reason);
            }
            return await finishFailure(transition.reason);
          }
          const logResult = await appendIterationLog(undefined, recoveredPlan);
          if (!logResult.ok) {
            return await finishFailure(logResult.reason);
          }
          const snapshotResult = await syncWorkflowSnapshot(recoveredPlan);
          if (!snapshotResult.ok) {
            return await finishFailure(snapshotResult.reason);
          }
          parsedPlan = recoveredPlan;
          continue;
        }
      }
      const cleanup = await cleanupReviewStagingPaths(reviewStagingPaths);
      const reason = cleanup.ok
        ? "plan content unchanged after successful nonterminal workflow action"
        : `plan content unchanged after successful nonterminal workflow action; ${cleanup.reason}`;
      const logResult = await appendIterationLog(reason);
      if (!logResult.ok) {
        return await finishFailure(logResult.reason);
      }
      const snapshotResult = await syncWorkflowSnapshot(parsedPlan);
      if (!snapshotResult.ok) {
        return await finishFailure(snapshotResult.reason);
      }
      return await finishFailure(reason);
    }

    const transition = transitionAllowed(route.promptPath, parsedPlan, updated);
    if (!transition.ok) {
      const cleanup = await cleanupReviewStagingPaths(reviewStagingPaths);
      const reason = cleanup.ok
        ? transition.reason
        : `${transition.reason}; ${cleanup.reason}`;
      const logResult = await appendIterationLog(reason);
      if (!logResult.ok) {
        return await finishFailure(logResult.reason);
      }
      const snapshotResult = await syncWorkflowSnapshot(updated);
      if (!snapshotResult.ok) {
        return await finishFailure(snapshotResult.reason);
      }
      return await finishFailure(reason);
    }

    if (
      isReviewPrompt(route.promptPath) &&
      updated.status === "active" &&
      updated.nextAction === "execute-plan"
    ) {
      const cleanup = await cleanupReviewStagingPaths(reviewStagingPaths);
      if (!cleanup.ok) {
        const logResult = await appendIterationLog(cleanup.reason);
        if (!logResult.ok) {
          return await finishFailure(logResult.reason);
        }
        const snapshotResult = await syncWorkflowSnapshot(updated);
        if (!snapshotResult.ok) {
          return await finishFailure(snapshotResult.reason);
        }
        return await finishFailure(cleanup.reason);
      }
      carriedReviewStagingPaths = undefined;
      carriedReviewStagingProcess = undefined;
      const logResult = await appendIterationLog(undefined, updated);
      if (!logResult.ok) {
        return await finishFailure(logResult.reason);
      }
      const snapshotResult = await syncWorkflowSnapshot(updated);
      if (!snapshotResult.ok) {
        return await finishFailure(snapshotResult.reason);
      }
      parsedPlan = updated;
      continue;
    }

    const logResult = await appendIterationLog(undefined, updated);
    if (!logResult.ok) {
      return await finishFailure(logResult.reason);
    }
    const snapshotResult = await syncWorkflowSnapshot(updated);
    if (!snapshotResult.ok) {
      return await finishFailure(snapshotResult.reason);
    }

    parsedPlan = updated;
  }
};
