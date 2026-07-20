import type { WorkflowState } from "../contracts/stage.ts";
export type { WorkflowState };

export type ProcessCall = {
  command: string;
  binaryCommand?: string;
  args: string[];
  cwd: string;
  input: string;
  promptPath: string;
  env?: NodeJS.ProcessEnv;
  abortSignal?: AbortSignal;
  onStdout?: (chunk: string) => void;
  onStderr?: (chunk: string) => void;
};

export type ProcessResult =
  | { launched: true; stdout: string; stderr: string; exitCode: number; exitSignal?: NodeJS.Signals | string | null }
  | { launched: false; stdout: string; stderr: string; error: string };
export type ProcessRunner = (call: ProcessCall) => Promise<ProcessResult>;

export type OutputStream = { stdout: (chunk: string) => void; stderr: (chunk: string) => void; isTTY?: boolean };
export type WorkflowProcessStdio = ["ignore" | "pipe", "pipe", "pipe"];
export type CommitProgress = { completed: number; total: number; description: string };
export type WorkflowRunnerCodexRuntime = { profile: string; command: string; execLabel: string };
export type TokenUsageTotals = { inputTokens: number; cachedInputTokens: number; uncachedInputTokens: number; outputTokens: number; reasoningOutputTokens: number; totalTokens: number };
export type FailureMetadataLogFields = { failureKind: string; failureReason: string; nextSuggestedAction: string };
export type Failure = { ok: false; reason: string };
export type RunnerResult = {
  success: boolean;
  reason: string;
  iterations: number;
  exitCode: number;
};
export type ConsoleLike = Pick<Console, "log" | "error">;
export type ParsePlanOptions = { planName: string; rootDir?: string };
export type ParsedPlan = {
  ok: true;
  planName: string;
  planPath: string;
  absolutePlanPath: string;
  manifestContent: string;
  content: string;
  thinPlanContract: string;
  workflowState: WorkflowState;
  warnings: string[];
};
export type PlanTask = {
  id: string;
  words: string;
  name: string;
  artifactWords: string;
};
export type WorkflowTaskContext = {
  task: PlanTask;
  stage: string;
  artifactPath: string;
  commitSha?: string;
};
export type TaskStage =
  | "implementing"
  | "validating"
  | "reviewing"
  | "commit-message"
  | "committed";
export type CompletedTaskSavepoint = {
  task: PlanTask;
  artifactPath: string;
  commitSha: string;
  commitMessage: string;
  summaryLines: string[];
  reviewResult: string;
  validationSummary: string;
};
export type WorkflowContextSnapshotTokenUsage = {
  iteration?: number;
  promptPath?: string;
  model?: string;
  reasoning?: string;
  stageInputTokens: number | null;
  stageCachedInputTokens: number | null;
  stageUncachedInputTokens: number | null;
  stageOutputTokens: number | null;
  stageReasoningOutputTokens: number | null;
  stageTotalTokens: number | null;
  totalTokens: number | null;
};
export type WorkflowContextSnapshotResult = { ok: true; snapshotPath: string };
export type WorkflowTokenGuardrail = {
  stageInputTokens: number | null | undefined;
  stageUncachedInputTokens: number | null | undefined;
};
export type ThinPlanV2WorkflowState = {
  planPath: string;
  workflowState: WorkflowState;
  latest?: Record<string, unknown>;
  history?: string[];
  unresolvedBlockers: string[];
  updatedAt: string;
};
export type ThinPlanV2FilesState = {
  created: string[];
  modified: string[];
  deleted: string[];
  changedFiles: string[];
  released: string[];
  headSha: string;
};
export type FileOwnershipArtifact = {
  planPath: string;
  workflowState?: WorkflowState;
  owns: string[];
  released: string[];
  resolvedFiles: string[];
  changedFiles: string[];
  headSha: string;
  updatedAt: string;
  migratedFromLegacy?: boolean;
};
export type ReviewScopeMetadata = {
  narrowPass: number;
  reviewAllPaths: string[];
  reviewPrimaryPaths: string[];
  summaryOnlyPaths?: string[];
  diffBytes?: number;
  autoNarrowReason?: string;
};
export type ReviewStagingOptions = {
  content: string;
  rootDir?: string;
  isIgnored?: (relativePath: string) => Promise<boolean>;
};
export type ReviewStagingResult = { ok: true; paths: string[] } | Failure;
export type ReviewStagingProcess = {
  command: string;
  args: string[];
  paths?: string[];
  stdout: string;
  stderr: string;
  exitCode?: number;
  stopReason?: string;
};
export type ReviewCleanupProcess = {
  command: string;
  args: string[];
  stdout: string;
  stderr: string;
  exitCode?: number;
  stopReason?: string;
};
export type FileOwnershipPreflight =
  | { hasOwnershipScope: false }
  | {
      hasOwnershipScope: true;
      artifact: FileOwnershipArtifact;
      reviewStagingPaths: string[];
    };
export type WorkflowFailureDebugCommandRecord = {
  source: "codex-command" | "review-staging" | "review-cleanup";
  command: string;
  exitCode: number | "unknown";
  outputByteCount?: number;
  outputLineCount?: number;
  outputExcerpt?: string;
  outputTruncated?: boolean;
  stdoutByteCount?: number;
  stdoutLineCount?: number;
  stdoutExcerpt?: string;
  stdoutTruncated?: boolean;
  stderrByteCount?: number;
  stderrLineCount?: number;
  stderrExcerpt?: string;
  stderrTruncated?: boolean;
};

export type WorkflowFailureDebugRecord = {
  timestamp: string;
  iteration: number;
  planPath: string;
  workflowState: WorkflowState;
  promptPath: string;
  result: string;
  exitCode: number | null;
  stopReason: string | null;
  failureKind: string;
  failureReason: string;
  stdoutByteCount: number;
  stdoutLineCount: number;
  stderrByteCount: number;
  stderrLineCount: number;
  stdoutExcerpt?: string;
  stdoutTruncated?: boolean;
  stderrExcerpt?: string;
  stderrTruncated?: boolean;
  stopExcerpt?: string;
  lastAgentMessageExcerpt?: string;
  recentCommands: WorkflowFailureDebugCommandRecord[];
};

export type CodexTerminalFormatOptions = { color?: boolean; commitBoundaryProgress?: { taskPosition: number; taskTotal: number; taskLabel: string; boundaryTotal: number } };
export type CodexLiveOutputFlushOptions = { includePendingTurnCompleted?: boolean };
export type TerminalLabelStyle = "commandStarted" | "commandFailed" | "action" | "agent" | "codex" | "context" | "diffAdded" | "diffDeleted";
export type CommandExitCode = number | "unknown";
export type TerminalOutputStats = { output: string };
export type CommandTerminalSummary = { group: "Explored" | "Ran"; description: string; files?: string[]; details?: string[]; silent?: boolean; failureLabel?: string; failureCommand?: string };
export type FailedTestCommandSummary = { label: "jest test" | "vitest test"; files: string[]; testName?: string };
export type EditedFileAction = "Added" | "Edited" | "Deleted";
export type EditedFileSummary = { action: EditedFileAction; path: string; additions: number; deletions: number };
export type EditedFileSnapshot = Map<string, string | undefined>;

export const asRecord = (value: unknown): Record<string, unknown> | null =>
  typeof value === "object" && value !== null ? (value as Record<string, unknown>) : null;
export const isFailure = (value: unknown): value is Failure =>
  Boolean(
    value &&
      typeof value === "object" &&
      (value as { ok?: unknown }).ok === false &&
      typeof (value as { reason?: unknown }).reason === "string",
  );
export const isFiniteNumber = (value: unknown): value is number => typeof value === "number" && Number.isFinite(value);
export const toDisplayString = (value: unknown): string | undefined => typeof value === "string" && value.length > 0 ? value : undefined;

const STOP_REASON_EXCERPT_CHAR_LIMIT = 240;
export const boundedInlineExcerpt = (text: string): string | undefined => {
  const normalized = text.replace(/\s+/g, " ").trim();
  if (!normalized) return undefined;
  if (normalized.length <= STOP_REASON_EXCERPT_CHAR_LIMIT) return normalized;
  return normalized.slice(0, STOP_REASON_EXCERPT_CHAR_LIMIT - 3).trimEnd() + "...";
};
