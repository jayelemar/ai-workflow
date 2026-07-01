import { spawn } from 'node:child_process';
import type { Writable } from 'node:stream';
import { createHash } from 'node:crypto';
import { mkdir, readFile, readdir, rm, stat, writeFile } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import path from 'node:path';
import { homedir } from 'node:os';
import { fileURLToPath } from 'node:url';

export { parseRunnerCliArgs, normalizePlanArgument } from './workflow-runner/cli.ts';
import { parseRunnerCliArgs, normalizePlanArgument } from './workflow-runner/cli.ts';
export { parseContextUsage, parseCodexTokenUsage } from './workflow-runner/token-usage.ts';
import {
  parseContextUsage,
  parseCodexTokenUsage,
  unavailableContextUsage,
  type CodexTokenUsage,
  type ContextUsageLogFields,
} from './workflow-runner/token-usage.ts';
export { analyzeTokenUsageLedger } from './workflow-runner/token-ledger.ts';
import {
  collectWorkflowThresholdWarnings,
  exceedsWorkflowTokenThresholds,
} from './workflow-runner/token-warnings.ts';
import {
  validateThinPlanContract,
  type ThinPlanContractVersion,
} from './workflow-runner/thin-plan.ts';
type CodexProfile = string;
type CodexModel = 'gpt-5.5' | 'gpt-5.4' | 'gpt-5.4-mini' | 'gpt-5.3-codex-spark';
type ReasoningEffort = 'medium' | 'high' | 'xhigh';
type CodexExecutionConfig = {
  model: CodexModel;
  reasoning: ReasoningEffort;
};

export const WORKFLOW_RUNNER_CODEX_PROFILE: CodexProfile = 'codex-work' as const;
const CODEX_PROFILE_PATTERN = /^[A-Za-z0-9][A-Za-z0-9_-]*$/;

const PLAN_VALIDATOR_PROMPT_PATH = '.ai/prompts/plan-validator.md';
const FIX_PLAN_PROMPT_PATH = '.ai/prompts/fix-plan.md';
const EXECUTE_PLAN_PROMPT_PATH = '.ai/prompts/execute-plan.md';
const UNBLOCK_PLAN_PROMPT_PATH = '.ai/prompts/unblock-plan.md';
const REVIEW_CHANGES_PROMPT_PATH = '.ai/prompts/review-changes.md';
const REOPEN_PLAN_PROMPT_PATH = '.ai/prompts/reopen-plan.md';
const COMMIT_SUMMARY_PROMPT_PATH = '.ai/prompts/commit-summary.md';
const SCOPE_CLEANUP_PROMPT_PATH = '.ai/prompts/scope-cleanup.md';

const PROMPT_CODEX_EXECUTION_OVERRIDES: Record<string, CodexExecutionConfig> = {
  [PLAN_VALIDATOR_PROMPT_PATH]: { model: 'gpt-5.4', reasoning: 'high' },
  [FIX_PLAN_PROMPT_PATH]: { model: 'gpt-5.4', reasoning: 'medium' },
  [EXECUTE_PLAN_PROMPT_PATH]: { model: 'gpt-5.5', reasoning: 'high' },
  [UNBLOCK_PLAN_PROMPT_PATH]: { model: 'gpt-5.4', reasoning: 'medium' },
  [REVIEW_CHANGES_PROMPT_PATH]: { model: 'gpt-5.5', reasoning: 'xhigh' },
  [REOPEN_PLAN_PROMPT_PATH]: { model: 'gpt-5.4', reasoning: 'medium' },
  [COMMIT_SUMMARY_PROMPT_PATH]: { model: 'gpt-5.3-codex-spark', reasoning: 'medium' },
  [SCOPE_CLEANUP_PROMPT_PATH]: { model: 'gpt-5.5', reasoning: 'xhigh' },
};

const VALID_STATUSES = [
  'draft',
  'approved',
  'active',
  'review',
  'reopening',
  'completed',
  'blocked',
] as const;
const VALID_NEXT_ACTIONS = [
  'plan-validator',
  'fix-plan',
  'execute-plan',
  'unblock-plan',
  'review-plan',
  'reopen-plan',
  'commit-summary',
] as const;
const MAX_ITERATIONS = 100;
const CODEX_BINARY_COMMAND = 'codex';
const CODEX_WORK_NODE_VERSION = 'v20.20.2';
const SUPERPOWER_SKILL_ROOT = path.join(homedir(), '.agents', 'skills');
const SHARED_SKILL_ROOT = path.join(homedir(), '.codex-shared', 'skills');
const TERMINAL_FAILED_COMMAND_OUTPUT_LINE_LIMIT = 4;
const TERMINAL_FAILED_COMMAND_OUTPUT_CHAR_LIMIT = 1000;
const TERMINAL_FILE_DETAIL_LIMIT = 3;
const STOP_REASON_EXCERPT_CHAR_LIMIT = 240;
const ANSI_RESET = '\u001b[0m';
const ANSI_SEQUENCE_PATTERN =
  /\u001b(?:\[([0-?]*[ -/]*)([@-~])|\][^\u0007]*(?:\u0007|\u001b\\)|[@-_])/g;
const WORKFLOW_RUNNER_USAGE = `Usage: pnpm exec tsx .ai/scripts/workflow-runner.ts [options] .ai/plans/<plan-name>.md

Options:
  --compact              Reduce terminal output; keep command details in logs
  --profile <name>       Use a Codex profile override
  --unblock-note <text>  Add operator context for unblock-plan
  -h, --help             Show this help message`;

const terminalLabelStyles = {
  commandStarted: '\u001b[34m',
  commandFailed: '\u001b[31m',
  action: '\u001b[34m',
  agent: '\u001b[38;5;214m',
  codex: '\u001b[35m',
  context: '\u001b[30;43m',
  diffAdded: '\u001b[32m',
  diffDeleted: '\u001b[31m',
} as const;
const WORKFLOW_WAIT_NOTICE_COLOR = '\u001b[38;2;255;244;143m';

type Status = (typeof VALID_STATUSES)[number];
type NextAction = (typeof VALID_NEXT_ACTIONS)[number];

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

type LaunchedProcessResult = {
  launched: true;
  stdout: string;
  stderr: string;
  exitCode: number;
  exitSignal?: NodeJS.Signals | string | null;
};

type LaunchFailureResult = {
  launched: false;
  stdout: string;
  stderr: string;
  error: string;
};

export type ProcessResult = LaunchedProcessResult | LaunchFailureResult;
export type ProcessRunner = (call: ProcessCall) => Promise<ProcessResult>;

type ConsoleLike = {
  log: (message: string) => void;
  error: (message: string) => void;
};

type OutputStream = {
  stdout: (chunk: string) => void;
  stderr: (chunk: string) => void;
  isTTY?: boolean;
};

type WorkflowProcessStdio = ['ignore' | 'pipe', 'pipe', 'pipe'];

type ParsePlanOptions = {
  planName: string;
  rootDir?: string;
};

type ParsedPlan = {
  ok: true;
  planName: string;
  planPath: string;
  absolutePlanPath: string;
  content: string;
  manifestContent: string;
  thinPlanContract: ThinPlanContractVersion;
  status: Status;
  nextAction: NextAction;
  warnings: string[];
};

export type PlanTask = {
  id: string;
  words: string;
  name: string;
  artifactWords: string;
};

type Failure = {
  ok: false;
  reason: string;
};

type Route =
  | {
      executable: true;
      promptPath: string;
      terminal: boolean;
    }
  | {
      executable: false;
      reason: string;
    };

export type RunnerResult = {
  success: boolean;
  reason: string;
  iterations: number;
  exitCode: number;
};

type RunWorkflowOptions = {
  planName?: string;
  argv?: string[];
  codexProfile?: string;
  rootDir?: string;
  processRunner?: ProcessRunner;
  console?: ConsoleLike;
  outputStream?: OutputStream;
  streamOutput?: boolean;
  compactOutput?: boolean;
  unblockNote?: string;
  isIgnored?: (relativePath: string) => Promise<boolean>;
  now?: () => number;
  timestamp?: () => string;
  abortSignal?: AbortSignal;
  interruptSignal?: () => NodeJS.Signals | undefined;
};

type ReviewStagingOptions = {
  content: string;
  rootDir?: string;
  isIgnored?: (relativePath: string) => Promise<boolean>;
};

type ReviewStagingResult =
  | {
      ok: true;
      paths: string[];
    }
  | {
      ok: false;
      reason: string;
    };

type ReviewStagingProcess = {
  command: string;
  args: string[];
  stdout: string;
  stderr: string;
  exitCode?: number;
  stopReason?: string;
};

type ReviewCleanupProcess = ReviewStagingProcess;
type ScopeCleanupDecision = {
  action: 'keep' | 'unstage';
  patch?: string;
};
type StagedDiffHunk = {
  filePath: string;
  header: string;
  text: string;
  changedText: string;
  hash: string;
};

type WorkflowFileLockMetadata = {
  planPath: string;
  pid: number;
  createdAt: string;
  path: string;
};

type TaskStage = 'implementing' | 'validating' | 'reviewing' | 'commit-message' | 'committed';

type WorkflowTaskContext = {
  task: PlanTask;
  stage: TaskStage;
  artifactPath: string;
  commitSha?: string;
};

type FileOwnershipArtifact = {
  planPath: string;
  status: Status;
  nextAction: NextAction;
  owns: string[];
  released: string[];
  resolvedFiles: string[];
  changedFiles: string[];
  headSha: string;
  updatedAt: string;
};
type FileOwnershipPreflight = {
  hasOwnershipScope: boolean;
  artifact?: FileOwnershipArtifact;
  reviewStagingPaths?: string[];
};

type WorkflowRunnerCodexRuntime = {
  profile: CodexProfile;
  command: string;
  execLabel: string;
};

export type { CodexTokenUsage, ContextUsageLogFields } from './workflow-runner/token-usage.ts';

type TokenUsageTotals = {
  inputTokens: number;
  cachedInputTokens: number;
  uncachedInputTokens: number;
  outputTokens: number;
  reasoningOutputTokens: number;
  totalTokens: number;
};

type TokenUsageLedgerResult = 'success' | 'failed' | 'interrupted';

type WorkflowContextSnapshotTokenUsage = {
  iteration?: number;
  promptPath?: string;
  model?: string;
  reasoning?: string;
  stageInputTokens?: number | null;
  stageCachedInputTokens?: number | null;
  stageUncachedInputTokens?: number | null;
  stageOutputTokens?: number | null;
  stageReasoningOutputTokens?: number | null;
  stageTotalTokens?: number | null;
  totalTokens?: number | null;
};

type ExecuteTokenGuardrail = {
  stageInputTokens?: number | null;
  stageUncachedInputTokens?: number | null;
};

type WorkflowContextSnapshotResult = {
  ok: true;
  snapshotPath: string;
};

type FailureMetadataLogFields = {
  failureKind: string;
  failureReason: string;
  nextSuggestedAction: string;
};

type WorkflowFailureDebugCommandRecord = {
  source: 'codex-command' | 'review-staging' | 'review-cleanup';
  command: string;
  exitCode: number | 'unknown';
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

type WorkflowFailureDebugRecord = {
  timestamp: string;
  iteration: number;
  planPath: string;
  status: Status;
  nextAction: NextAction;
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

type CodexTerminalFormatOptions = {
  color?: boolean;
};

type CodexLiveOutputFlushOptions = {
  includePendingTurnCompleted?: boolean;
};

type TerminalLabelStyle = keyof typeof terminalLabelStyles;
type CommandExitCode = number | 'unknown';
type TerminalOutputStats = { output: string };
type CommandTerminalSummary = {
  group: 'Explored' | 'Ran';
  description: string;
  files?: string[];
  details?: string[];
  silent?: boolean;
  failureLabel?: string;
};
type FailedTestCommandSummary = {
  label: 'jest test' | 'vitest test';
  files: string[];
  testName?: string;
};
type EditedFileAction = 'Added' | 'Edited' | 'Deleted';
type EditedFileSummary = {
  action: EditedFileAction;
  path: string;
  additions: number;
  deletions: number;
};
type EditedFileSnapshot = Map<string, string | undefined>;

const rel = (...segments: string[]) => segments.join('/');

const shellQuote = (value: string): string => {
  if (/^[A-Za-z0-9_./:@%+=,-]+$/.test(value)) {
    return value;
  }
  return `'${value.replace(/'/g, "'\\''")}'`;
};

const shellPathspecs = (paths: string[]): string => paths.map(shellQuote).join(' ');

const workflowFileLockDir = (rootDir: string): string =>
  path.join(rootDir, '.ai', 'artifacts', 'file-locks');

export const workflowFileLockPath = (rootDir: string, relativePath: string): string => {
  const digest = createHash('sha256').update(relativePath).digest('hex');
  return path.join(workflowFileLockDir(rootDir), `${digest}.json`);
};

const zeroTokenUsageTotals: TokenUsageTotals = {
  inputTokens: 0,
  cachedInputTokens: 0,
  uncachedInputTokens: 0,
  outputTokens: 0,
  reasoningOutputTokens: 0,
  totalTokens: 0,
};

const asRecord = (value: unknown): Record<string, unknown> | null =>
  typeof value === 'object' && value !== null ? (value as Record<string, unknown>) : null;

const isFailure = (value: unknown): value is Failure =>
  typeof value === 'object' &&
  value !== null &&
  (value as { ok?: unknown }).ok === false &&
  typeof (value as { reason?: unknown }).reason === 'string';

const isFiniteNumber = (value: unknown): value is number =>
  typeof value === 'number' && Number.isFinite(value);

const prependPath = (pathValue: string, entry: string): string => {
  const entries = pathValue.split(path.delimiter).filter(Boolean);
  if (entries.includes(entry)) {
    return pathValue;
  }
  return [entry, pathValue].filter(Boolean).join(path.delimiter);
};

const isValidCodexProfile = (value: string): boolean => CODEX_PROFILE_PATTERN.test(value);

const workflowRunnerCodexHomeDirectory = (codexProfile: CodexProfile): string => `.${codexProfile}`;

const workflowRunnerCodexExecLabel = (codexProfile: CodexProfile): string => `${codexProfile} exec`;

const createWorkflowRunnerCodexRuntime = (
  codexProfile: CodexProfile,
): WorkflowRunnerCodexRuntime => ({
  profile: codexProfile,
  command: codexProfile,
  execLabel: workflowRunnerCodexExecLabel(codexProfile),
});

export const codexWorkEnvironment = (
  baseEnv: NodeJS.ProcessEnv = process.env,
  codexProfile: CodexProfile = WORKFLOW_RUNNER_CODEX_PROFILE,
): NodeJS.ProcessEnv => {
  const home = baseEnv.HOME ?? homedir();
  const nodeBinPath = path.join(home, '.nvm', 'versions', 'node', CODEX_WORK_NODE_VERSION, 'bin');

  return {
    ...baseEnv,
    CODEX_HOME: path.join(home, workflowRunnerCodexHomeDirectory(codexProfile)),
    PATH: prependPath(baseEnv.PATH ?? '', nodeBinPath),
  };
};

export const processStdioForInput = (input: string): WorkflowProcessStdio => [
  input.length > 0 ? 'pipe' : 'ignore',
  'pipe',
  'pipe',
];

export const writeProcessInput = (
  stdin: Writable | null | undefined,
  input: string,
  onError: (error: Error) => void = () => {},
): void => {
  if (!stdin || input.length === 0) {
    return;
  }
  stdin.on('error', onError);
  stdin.end(input);
};

const toDisplayString = (value: unknown): string | undefined =>
  typeof value === 'string' && value.length > 0 ? value : undefined;

const terminalOutputStats = (text: string): TerminalOutputStats | null => {
  const trimmed = text.trimEnd();
  if (!trimmed) {
    return null;
  }
  return {
    output: trimmed,
  };
};

const compactCapturedOutputForLog = (text: string): string => {
  if (!text) {
    return '';
  }
  const byteCount = Buffer.byteLength(text, 'utf8');
  const lineCount = text.split(/\r?\n/).length;
  return `omitted ${byteCount} bytes, ${lineCount} lines`;
};

type FailureDebugOutputSummary = {
  byteCount: number;
  lineCount: number;
  excerpt?: string;
  truncated: boolean;
};

const failureDebugOutputSummary = (text: string): FailureDebugOutputSummary | undefined => {
  if (!text) {
    return undefined;
  }

  const byteCount = Buffer.byteLength(text, 'utf8');
  const lineCount = text.split(/\r?\n/).length;
  const stats = terminalOutputStats(text);
  if (!stats) {
    return {
      byteCount,
      lineCount,
      truncated: false,
    };
  }

  let output = stats.output.slice(0, TERMINAL_FAILED_COMMAND_OUTPUT_CHAR_LIMIT);
  let truncated = stats.output.length > TERMINAL_FAILED_COMMAND_OUTPUT_CHAR_LIMIT;
  const lines = output.split(/\r?\n/);
  if (lines.length > TERMINAL_FAILED_COMMAND_OUTPUT_LINE_LIMIT) {
    output = lines.slice(0, TERMINAL_FAILED_COMMAND_OUTPUT_LINE_LIMIT).join('\n');
    truncated = true;
  }

  return {
    byteCount,
    lineCount,
    excerpt: output || undefined,
    truncated,
  };
};

const normalizeCommandWhitespace = (value: string): string => value.replace(/\s+/g, ' ').trim();

const unquoteShellPayload = (payload: string): string => {
  const trimmed = payload.trim();
  if (trimmed.length < 2) {
    return trimmed;
  }
  if (trimmed.startsWith('"') && trimmed.endsWith('"')) {
    return trimmed.slice(1, -1).replace(/\\(["\\$`])/g, '$1');
  }
  if (trimmed.startsWith("'") && trimmed.endsWith("'")) {
    return trimmed.slice(1, -1).replace(/'\\''/g, "'");
  }
  return trimmed;
};

const unwrapShellCommand = (command: string): string => {
  const normalized = normalizeCommandWhitespace(command);
  const shellMatch = normalized.match(/^(?:\/bin\/)?(?:bash|sh)\s+-lc\s+(.+)$/);
  return shellMatch
    ? normalizeCommandWhitespace(unquoteShellPayload(shellMatch[1] ?? ''))
    : normalized;
};

const shellLikeTokens = (command: string): string[] => {
  const tokens: string[] = [];
  let current = '';
  let quote: "'" | '"' | null = null;

  const pushCurrent = () => {
    if (current.length > 0) {
      tokens.push(current);
      current = '';
    }
  };

  for (let index = 0; index < command.length; index += 1) {
    const char = command[index];
    if (quote) {
      if (char === quote) {
        quote = null;
        continue;
      }
      if (quote === '"' && char === '\\' && index + 1 < command.length) {
        index += 1;
        current += command[index] ?? '';
        continue;
      }
      current += char;
      continue;
    }

    if (char === "'" || char === '"') {
      quote = char;
      continue;
    }
    if (char === '\\' && index + 1 < command.length) {
      index += 1;
      current += command[index] ?? '';
      continue;
    }
    if ((char === '&' || char === '|') && command[index + 1] === char) {
      pushCurrent();
      tokens.push(`${char}${char}`);
      index += 1;
      continue;
    }
    if (char === '|' || char === ';') {
      pushCurrent();
      tokens.push(char);
      continue;
    }
    if (/\s/.test(char ?? '')) {
      pushCurrent();
      continue;
    }
    current += char;
  }
  pushCurrent();

  return tokens;
};

const firstCommandSegment = (tokens: string[]): string[] => {
  const separatorIndex = tokens.findIndex(
    (token) => token === '|' || token === '&&' || token === '||' || token === ';',
  );
  const segment = separatorIndex >= 0 ? tokens.slice(0, separatorIndex) : tokens;
  return segment.filter((token) => !/^\d?>/.test(token));
};

const isSedExpression = (token: string): boolean => /^[0-9,$]+(?:,[0-9,$]+)?[a-z]?$/.test(token);

const nonOptionArgs = (tokens: string[]): string[] =>
  tokens.filter((token) => token !== '--' && !token.startsWith('-'));

const summarizeSedCommand = (tokens: string[]): CommandTerminalSummary | null => {
  const args = nonOptionArgs(tokens.slice(1)).filter((token) => !isSedExpression(token));
  return args.length > 0 ? { group: 'Explored', description: `Read ${args.join(' ')}` } : null;
};

const summarizeReadCommand = (tokens: string[]): CommandTerminalSummary | null => {
  const args = nonOptionArgs(tokens.slice(1));
  return args.length > 0 ? { group: 'Explored', description: `Read ${args.join(' ')}` } : null;
};

const splitShellCommandChain = (tokens: string[]): string[][] => {
  const segments: string[][] = [];
  let currentSegment: string[] = [];
  for (const token of tokens) {
    if (token === '&&' || token === ';') {
      if (currentSegment.length > 0) {
        segments.push(currentSegment);
        currentSegment = [];
      }
      continue;
    }
    if (token === '|' || token === '||') {
      return [];
    }
    currentSegment.push(token);
  }
  if (currentSegment.length > 0) {
    segments.push(currentSegment);
  }
  return segments;
};

const summarizeReadCommandChain = (tokens: string[]): CommandTerminalSummary | null => {
  if (!tokens.includes('&&') && !tokens.includes(';')) {
    return null;
  }

  const readLines: string[] = [];
  for (const segment of splitShellCommandChain(tokens)) {
    const executable = segment[0];
    const summary =
      executable === 'sed'
        ? summarizeSedCommand(segment)
        : executable === 'cat' || executable === 'nl'
          ? summarizeReadCommand(segment)
          : null;
    if (!summary) {
      return null;
    }
    readLines.push(summary.description);
  }

  return readLines.length > 1 ? { group: 'Explored', description: readLines.join('\n') } : null;
};

const summarizeFindCommand = (tokens: string[]): CommandTerminalSummary => {
  const pathToken =
    tokens.slice(1).find((token) => token !== '--' && !token.startsWith('-')) ?? '.';
  return { group: 'Explored', description: `Explore ${pathToken}` };
};

const isWorkflowPlanMarkdownPath = (token: string): boolean =>
  /^\.ai\/plans\/[^/]+\.md$/.test(token);

const isPlanSectionHeadingSearchPattern = (pattern: string): boolean => {
  const normalized = pattern.replace(/\\\(/g, '(').replace(/\\\)/g, ')').trim();
  if (/^\^##\s+\(.+\)$/.test(normalized)) {
    return true;
  }

  const terms = normalized
    .split('|')
    .map((term) => term.trim())
    .filter(Boolean);
  return terms.length > 0 && terms.every((term) => /^\^#{2,3}\s+/.test(term));
};

const summarizePlanSectionReadCommand = (tokens: string[]): CommandTerminalSummary | null => {
  const executable = tokens[0];
  if (executable !== 'rg' && executable !== 'awk') {
    return null;
  }
  if (!tokens.some(isWorkflowPlanMarkdownPath)) {
    return null;
  }

  if (executable === 'rg') {
    const pattern = tokens
      .slice(1)
      .find(
        (token) => token !== '--' && !token.startsWith('-') && !isWorkflowPlanMarkdownPath(token),
      );
    if (!pattern || !isPlanSectionHeadingSearchPattern(pattern)) {
      return null;
    }
  } else if (!tokens.some((token) => token.includes('^##'))) {
    return null;
  }

  return {
    group: 'Explored',
    description: 'Read plan sections',
    silent: true,
    failureLabel: 'plan section read',
  };
};

const rgOptionsWithSkippedValue = new Set([
  '-A',
  '-B',
  '-C',
  '-g',
  '-m',
  '-t',
  '--after-context',
  '--before-context',
  '--context',
  '--glob',
  '--iglob',
  '--max-count',
  '--type',
]);

const summarizeSearchTargets = (paths: string[]): string | null => {
  if (paths.length === 0) {
    return null;
  }
  return Array.from(new Set(paths.map((targetPath) => path.basename(targetPath)))).join(', ');
};

const uniqueBasenameTargets = (paths: string[]): string[] =>
  Array.from(new Set(paths.map((targetPath) => path.basename(targetPath))));

const isLikelyFileSearchTarget = (targetPath: string): boolean =>
  path.extname(path.basename(targetPath)) !== '';

const summarizeSearchTargetDetails = (
  paths: string[],
): { headingTarget: string | null; bulletTargets: string[] } => {
  if (paths.length === 0) {
    return { headingTarget: null, bulletTargets: [] };
  }

  if (paths.length > 1 && paths.every(isLikelyFileSearchTarget)) {
    return {
      headingTarget: null,
      bulletTargets: uniqueBasenameTargets(paths),
    };
  }

  const fileTargets = paths
    .filter(isLikelyFileSearchTarget)
    .map((targetPath) => path.basename(targetPath));
  const uniqueFileTargets = Array.from(new Set(fileTargets));
  const directoryTargets = paths.filter((targetPath) => !isLikelyFileSearchTarget(targetPath));
  if (directoryTargets.length === 1 && fileTargets.length > 0) {
    return {
      headingTarget: path.basename(directoryTargets[0] ?? ''),
      bulletTargets: uniqueFileTargets,
    };
  }
  if (paths.length > 2) {
    return {
      headingTarget: null,
      bulletTargets: uniqueBasenameTargets(paths),
    };
  }

  return { headingTarget: summarizeSearchTargets(paths), bulletTargets: [] };
};

const splitAlternationSearchTerms = (pattern: string): string[] | null => {
  if (!pattern.includes('|')) {
    return null;
  }

  const terms = pattern
    .split('|')
    .map((term) =>
      term
        .trim()
        .replace(/^'+/, '')
        .replace(/^\^/, '')
        .replace(/^\(+/, '')
        .replace(/\)+$/, '')
        .trim(),
    )
    .filter(Boolean);
  return terms.length > 1 &&
    terms.every((term) => /^[#A-Za-z0-9_$][#A-Za-z0-9_$\s.,/:=*\-]*$/.test(term))
    ? terms
    : null;
};

const formatLimitedSearchItems = (items: string[]): string[] => {
  const visibleItems = items.slice(0, TERMINAL_FILE_DETAIL_LIMIT);
  const hiddenItems = items.length - visibleItems.length;
  return [
    ...visibleItems.map((item) => `- ${item}`),
    ...(hiddenItems > 0 ? [`  +${hiddenItems} more`] : []),
  ];
};

const formatLimitedSearchFileItems = (items: string[]): string[] => {
  const visibleItems = items.slice(0, TERMINAL_FILE_DETAIL_LIMIT);
  const hiddenItems = items.length - visibleItems.length;
  return [
    ...visibleItems.map((item) => `- ${item}`),
    ...(hiddenItems > 0 ? [`  + ${hiddenItems} more`] : []),
  ];
};

const formatStructuredSearchDescription = (paths: string[], terms: string[]): string => {
  const { headingTarget, bulletTargets } = summarizeSearchTargetDetails(paths);
  if (!headingTarget && bulletTargets.length > 0) {
    return [
      'Search in',
      ...formatLimitedSearchFileItems(bulletTargets),
      '',
      'terms:',
      ...formatLimitedSearchItems(terms),
    ].join('\n');
  }

  const visibleItems = [...bulletTargets, ...terms].slice(0, TERMINAL_FILE_DETAIL_LIMIT);
  const hiddenItems = bulletTargets.length + terms.length - visibleItems.length;
  return [
    headingTarget ? `Search in ${headingTarget}` : 'Search',
    ...visibleItems.map((item) => `- ${item}`),
    ...(hiddenItems > 0 ? [`  +${hiddenItems} more`] : []),
  ].join('\n');
};

const formatSimpleSearchDescription = (pattern: string, paths: string[]): string => {
  if (paths.length > 1 && paths.every(isLikelyFileSearchTarget)) {
    return [
      `Search ${pattern}`,
      ...paths.map((targetPath) => `- ${path.basename(targetPath)}`),
    ].join('\n');
  }

  const summarizedTargets = summarizeSearchTargets(paths);
  return `Search ${pattern}${summarizedTargets ? ` in ${summarizedTargets}` : ''}`;
};

const summarizeRipgrepCommand = (tokens: string[]): CommandTerminalSummary => {
  const args = tokens.slice(1);
  if (args.includes('--files')) {
    const pathToken = args.find((token) => token !== '--files' && !token.startsWith('-')) ?? '.';
    return { group: 'Explored', description: `Explore ${pathToken}` };
  }

  let pattern: string | undefined;
  const paths: string[] = [];
  for (let index = 0; index < args.length; index += 1) {
    const token = args[index] ?? '';
    if (token === '--') {
      continue;
    }
    if (token === '-e' || token === '--regexp') {
      pattern ??= args[index + 1];
      index += 1;
      continue;
    }
    if (rgOptionsWithSkippedValue.has(token)) {
      index += 1;
      continue;
    }
    if (token.startsWith('-')) {
      continue;
    }
    if (!pattern) {
      pattern = token;
      continue;
    }
    paths.push(token);
  }

  const summarizedTargets = summarizeSearchTargets(paths);
  const alternationTerms = pattern ? splitAlternationSearchTerms(pattern) : null;
  const description =
    alternationTerms && alternationTerms.length > 2 && summarizedTargets
      ? formatStructuredSearchDescription(paths, alternationTerms)
      : pattern
        ? formatSimpleSearchDescription(pattern, paths)
        : `Search ${unwrapShellCommand(tokens.join(' '))}`;
  return { group: 'Explored', description };
};

const looksLikeExplicitTestFile = (token: string): boolean =>
  /(?:^|\/)[^/\s]+\.(?:test|spec)\.[cm]?[jt]sx?$/.test(token);

const commandOptionValue = (tokens: string[], names: string[]): string | undefined => {
  for (const name of names) {
    const optionIndex = tokens.indexOf(name);
    if (optionIndex >= 0) {
      return tokens[optionIndex + 1];
    }
    const prefix = `${name}=`;
    const inlineOption = tokens.find((token) => token.startsWith(prefix));
    if (inlineOption) {
      return inlineOption.slice(prefix.length);
    }
  }
  return undefined;
};

const commandTestFiles = (tokens: string[]): string[] =>
  tokens.filter((token) => looksLikeExplicitTestFile(token));

const summarizeVitestRunCommand = (tokens: string[]): CommandTerminalSummary | null => {
  const vitestIndex = tokens.indexOf('vitest');
  if (vitestIndex < 0 || tokens[vitestIndex + 1] !== 'run') {
    return null;
  }

  const files = tokens
    .slice(vitestIndex + 2)
    .filter(
      (token) => token !== '--' && !token.startsWith('-') && looksLikeExplicitTestFile(token),
    );

  if (files.length === 0) {
    return null;
  }

  return {
    group: 'Ran',
    description: 'tests',
    files,
  };
};

const summarizeJestRunCommand = (tokens: string[]): CommandTerminalSummary | null => {
  const jestIndex = tokens.indexOf('jest');
  if (jestIndex < 0) {
    return null;
  }

  const runTestsByPathIndex = tokens.indexOf('--runTestsByPath');
  if (runTestsByPathIndex < 0) {
    return null;
  }

  const files: string[] = [];
  for (let index = runTestsByPathIndex + 1; index < tokens.length; index += 1) {
    const token = tokens[index] ?? '';
    if (token === '--') {
      continue;
    }
    if (token.startsWith('-')) {
      break;
    }
    if (looksLikeExplicitTestFile(token)) {
      files.push(token);
    }
  }

  if (files.length === 0) {
    return null;
  }

  return {
    group: 'Ran',
    description: 'tests',
    files,
  };
};

const summarizeLineCountCommand = (tokens: string[]): CommandTerminalSummary | null => {
  if (tokens[0] !== 'wc') {
    return null;
  }

  const args = tokens.slice(1);
  const countsLines = args.some(
    (token) => token === '-l' || token === '--lines' || /^-[^-].*l/.test(token),
  );
  if (!countsLines) {
    return null;
  }

  const files = args.filter((token) => token !== '--' && !token.startsWith('-'));
  if (files.length === 0) {
    return null;
  }

  return {
    group: 'Ran',
    description: `line count for ${files.length} ${files.length === 1 ? 'file' : 'files'}`,
  };
};

const summarizeFilteredPnpmCommand = (tokens: string[]): CommandTerminalSummary | null => {
  if (tokens[0] !== 'pnpm' || tokens[1] !== '--filter' || !tokens[2]) {
    return null;
  }

  const workspaceFilter = tokens[2];
  const commandToken = tokens[3];
  if (!commandToken) {
    return null;
  }

  if (commandToken === 'exec') {
    const executable = tokens[4];
    const subcommand = tokens[5];
    if (!executable) {
      return null;
    }

    const description = [
      'pnpm',
      '--filter',
      workspaceFilter,
      'exec',
      executable,
      ...(subcommand && !subcommand.startsWith('-') ? [subcommand] : []),
    ].join(' ');
    const files = tokens
      .slice(subcommand && !subcommand.startsWith('-') ? 6 : 5)
      .filter(
        (token) => token !== '--' && !token.startsWith('-') && looksLikeExplicitTestFile(token),
      );

    return {
      group: 'Ran',
      description,
      files: files.length > 0 ? files : undefined,
    };
  }

  const description = ['pnpm', '--filter', workspaceFilter, commandToken].join(' ');
  const separatorIndex = tokens.indexOf('--');
  const files =
    separatorIndex >= 0
      ? tokens.slice(separatorIndex + 1).filter((token) => looksLikeExplicitTestFile(token))
      : [];

  return {
    group: 'Ran',
    description,
    files: files.length > 0 ? files : undefined,
  };
};

const summarizeGitDiffCommand = (tokens: string[]): CommandTerminalSummary | null => {
  if (tokens[0] !== 'git' || tokens[1] !== 'diff') {
    return null;
  }

  const separatorIndex = tokens.indexOf('--');
  if (separatorIndex < 0) {
    return null;
  }

  const paths = tokens
    .slice(separatorIndex + 1)
    .filter((token) => token.length > 0 && token !== '--');

  if (paths.length === 0) {
    return null;
  }

  const isSummaryDiff =
    tokens.includes('--name-status') || tokens.includes('--name-only') || tokens.includes('--stat');
  return {
    group: 'Ran',
    description: tokens.includes('--staged')
      ? isSummaryDiff
        ? 'staged diff summary'
        : 'staged diff'
      : isSummaryDiff
        ? 'git diff summary'
        : 'git diff',
    files: paths,
  };
};

const ripgrepPatternFromTokens = (tokens: string[]): string | undefined => {
  const args = tokens.slice(1);
  let pattern: string | undefined;
  for (let index = 0; index < args.length; index += 1) {
    const token = args[index] ?? '';
    if (token === '--') {
      continue;
    }
    if (token === '-e' || token === '--regexp') {
      return args[index + 1];
    }
    if (rgOptionsWithSkippedValue.has(token)) {
      index += 1;
      continue;
    }
    if (token.startsWith('-')) {
      continue;
    }
    pattern = token;
    break;
  }
  return pattern;
};

const formatStagedSearchTerms = (terms: string[]): string => {
  const visibleTerms = terms.slice(0, TERMINAL_FILE_DETAIL_LIMIT);
  const remainingCount = terms.length - visibleTerms.length;
  return [
    'terms:',
    ...visibleTerms.map((term) => `- ${term}`),
    ...(remainingCount > 0 ? [`  +${remainingCount} more`] : []),
  ].join('\n');
};

const summarizeStagedGitShowPipeline = (tokens: string[]): CommandTerminalSummary | null => {
  if (tokens[0] !== 'git' || tokens[1] !== 'show') {
    return null;
  }
  const stagedPathToken = tokens[2] ?? '';
  if (!stagedPathToken.startsWith(':') || stagedPathToken.length === 1) {
    return null;
  }

  const stagedPath = stagedPathToken.slice(1);
  const rgIndex = tokens.indexOf('rg');
  if (rgIndex >= 0) {
    const pattern = ripgrepPatternFromTokens(tokens.slice(rgIndex));
    const terms = pattern ? splitAlternationSearchTerms(pattern) : null;
    const termsLine = terms ? `\n${formatStagedSearchTerms(terms)}` : '';
    return {
      group: 'Ran',
      description: `git show search\n- ${stagedPath}${termsLine}`,
    };
  }

  const sedIndex = tokens.indexOf('sed');
  if (sedIndex >= 0) {
    const rangeToken = tokens.slice(sedIndex + 1).find((token) => /^\d+,\d+p$/.test(token));
    const rangeMatch = rangeToken?.match(/^(\d+),(\d+)p$/);
    const pathWithRange = rangeMatch
      ? `${stagedPath}:${rangeMatch[1]}-${rangeMatch[2]}`
      : stagedPath;
    return {
      group: 'Ran',
      description: `git show\n- ${pathWithRange}`,
    };
  }

  return null;
};

const commandTerminalSummary = (command: string): CommandTerminalSummary => {
  const readableCommand = unwrapShellCommand(command);
  const fullTokens = shellLikeTokens(readableCommand);
  const readChainSummary = summarizeReadCommandChain(fullTokens);
  if (readChainSummary) {
    return readChainSummary;
  }

  const stagedGitShowSummary = summarizeStagedGitShowPipeline(fullTokens);
  if (stagedGitShowSummary) {
    return stagedGitShowSummary;
  }

  const tokens = firstCommandSegment(fullTokens);
  const executable = tokens[0];
  const filteredPnpmSummary = summarizeFilteredPnpmCommand(tokens);
  const vitestSummary = summarizeVitestRunCommand(tokens);
  const jestSummary = summarizeJestRunCommand(tokens);
  const lineCountSummary = summarizeLineCountCommand(tokens);
  const gitDiffSummary = summarizeGitDiffCommand(tokens);
  const planSectionReadSummary = summarizePlanSectionReadCommand(tokens);

  if (filteredPnpmSummary) {
    return filteredPnpmSummary;
  }
  if (vitestSummary) {
    return vitestSummary;
  }
  if (jestSummary) {
    return jestSummary;
  }
  if (lineCountSummary) {
    return lineCountSummary;
  }
  if (gitDiffSummary) {
    return gitDiffSummary;
  }
  if (planSectionReadSummary) {
    return planSectionReadSummary;
  }

  if (executable === 'sed') {
    return summarizeSedCommand(tokens) ?? { group: 'Ran', description: readableCommand };
  }
  if (executable === 'cat' || executable === 'nl') {
    return summarizeReadCommand(tokens) ?? { group: 'Ran', description: readableCommand };
  }
  if (executable === 'rg') {
    return summarizeRipgrepCommand(tokens);
  }
  if (executable === 'find') {
    return summarizeFindCommand(tokens);
  }

  return { group: 'Ran', description: readableCommand };
};

const formatTerminalAction = (action: string, color = false): string =>
  color ? `${terminalLabelStyles.action}${action}${ANSI_RESET}` : action;

const formatActionDescription = (description: string, color = false): string =>
  description.replace(/^[^\s\n]+/, (action) => formatTerminalAction(action, color));

const formatTerminalFileDetails = (files: string[]): string => {
  const visibleFiles = files.slice(0, TERMINAL_FILE_DETAIL_LIMIT);
  const remainingCount = files.length - visibleFiles.length;
  return [
    ...visibleFiles.map((file) => `- ${file}`),
    ...(remainingCount > 0 ? [`  +${remainingCount} more`] : []),
  ].join('\n');
};

const formatCommandStartedDescription = (command: string, color = false): string => {
  const summary = commandTerminalSummary(command);
  if (summary.group === 'Ran' && summary.files && summary.files.length > 0) {
    const filesBlock = formatTerminalFileDetails(summary.files);
    const detailsBlock =
      summary.details && summary.details.length > 0 ? `\n${summary.details.join('\n')}` : '';
    return `${formatTerminalAction('Ran', color)} ${summary.description}\n${filesBlock}${detailsBlock}`;
  }
  if (summary.group === 'Explored') {
    return '';
  }
  return summary.group === 'Ran'
    ? `${formatTerminalAction('Ran', color)} ${summary.description}`
    : formatActionDescription(summary.description, color);
};

const formatExploredTerminalBlock = (description: string, color = false): string => {
  const [firstLine = '', ...restLines] = description.split('\n');
  const firstItemLine = formatActionDescription(firstLine, color);
  if (restLines.length === 0) {
    return firstItemLine;
  }
  return `${firstItemLine}\n${restLines
    .map((line) =>
      line === '' ||
      line.startsWith('- ') ||
      /^\s+\+\s?\d+ more$/.test(line) ||
      /^(files|terms):$/.test(line) ||
      /^(Read|Search|Explore)(?:\s|$)/.test(line)
        ? line
        : `  ${line}`,
    )
    .join('\n')}`;
};

const formatPassedCommandTerminalBlock = (
  command: string,
  _stats: TerminalOutputStats | null,
  color = false,
): string => {
  const summary = commandTerminalSummary(command);
  if (summary.group === 'Ran' || summary.silent) {
    return '';
  }

  return `${formatExploredTerminalBlock(summary.description, color)}\n`;
};

const summarizeFailedTestCommand = (command: string): FailedTestCommandSummary | null => {
  const tokens = firstCommandSegment(shellLikeTokens(unwrapShellCommand(command)));
  const files = commandTestFiles(tokens);
  if (files.length === 0) {
    return null;
  }

  const testName = commandOptionValue(tokens, ['-t', '--testNamePattern', '--test-name-pattern']);
  if (tokens.includes('jest')) {
    return { label: 'jest test', files, testName };
  }
  if (tokens.includes('vitest')) {
    return { label: 'vitest test', files, testName };
  }
  return null;
};

const formatFailedCommandTerminalBlock = (text: string): string => {
  const stats = terminalOutputStats(text);
  if (!stats) {
    return '';
  }

  const byteCount = Buffer.byteLength(stats.output, 'utf8');
  const lineCount = stats.output.split(/\r?\n/).length;
  return `\n  output: ${byteCount} bytes, ${lineCount} lines omitted\n  command output omitted from workflow log\n`;
};

const trimBlankLines = (lines: string[]): string[] => {
  let start = 0;
  let end = lines.length;
  while (start < end && lines[start]?.trim() === '') {
    start += 1;
  }
  while (end > start && lines[end - 1]?.trim() === '') {
    end -= 1;
  }
  return lines.slice(start, end);
};

const workflowSummarySectionHeading = (line: string): string | null => {
  const match = line.match(/^\*\*(.+)\*\*$/);
  return match?.[1] ?? null;
};

const parseWorkflowSections = (
  text: string,
  headingForLine: (line: string) => string | null,
): Map<string, string[]> => {
  const sections = new Map<string, string[]>();
  let currentSection: string | null = null;
  for (const line of text.split(/\r?\n/)) {
    const heading = headingForLine(line);
    if (heading) {
      currentSection = heading;
      sections.set(currentSection, []);
      continue;
    }
    if (currentSection) {
      sections.get(currentSection)?.push(line);
    }
  }
  return sections;
};

const compactWorkflowValidationLine = (line: string): string => {
  const knownLimitationPrefix = '* Known limitation: ';
  if (line.startsWith(knownLimitationPrefix)) {
    return `* Deferred: ${line.slice(knownLimitationPrefix.length)}`;
  }

  const commandMatch = line.match(/^\* `([^`]+)`: (.+)$/);
  if (!commandMatch) {
    return line;
  }

  const [, command, result] = commandMatch;
  let label: string | null = null;
  if (command.includes('@gondoor/backend test') && command.includes('test/onboarding/')) {
    label = 'Backend onboarding spec';
  } else if (command.includes('@gondoor/backend test') && command.includes('test/documents/')) {
    label = 'Backend document spec';
  } else if (command.includes('@gondoor/backend build')) {
    label = 'Backend build';
  } else if (command.includes('@gondoor/web exec vitest run')) {
    label = 'Web docs tests';
  }

  return label ? `* ${label}: ${result}` : line;
};

const boundedSectionLines = (lines: string[], limit: number): string[] => {
  const visibleLines = trimBlankLines(lines).filter((line) => line.trim().length > 0);
  const shownLines = visibleLines.slice(0, limit);
  const hiddenLines = visibleLines.length - shownLines.length;
  return hiddenLines > 0 ? [...shownLines, `  +${hiddenLines} more`] : shownLines;
};

const sentenceWithPeriod = (text: string): string => {
  const trimmed = text.trim().replace(/[;,]$/, '');
  return /[.!?]$/.test(trimmed) ? trimmed : `${trimmed}.`;
};

const compactReviewIssueText = (severity: string, text: string): string => {
  const withoutExample = text.split(/\s+Example:/)[0]?.trim() ?? text.trim();
  if (severity === 'Warning' && withoutExample.includes(':')) {
    return sentenceWithPeriod(withoutExample.split(':')[0] ?? withoutExample);
  }
  if (severity === 'Suggestion') {
    return sentenceWithPeriod(withoutExample.replace(/\s+around\s+.*$/i, ''));
  }
  return sentenceWithPeriod(withoutExample);
};

const formatReviewIssueBullet = (severity: string, bulletLine: string): string[] => {
  const rawText = bulletLine.replace(/^[-*]\s+/, '').trim();
  const linkedIssueMatch = rawText.match(/^\[[^\]]+\]\((.+):(\d+)\):\s*(.+)$/);
  const issueText = linkedIssueMatch?.[3] ?? rawText.replace(/\[[^\]]+\]\([^)]+\)/g, '').trim();
  return [`* ${severity}: ${compactReviewIssueText(severity, issueText)}`];
};

const formatReviewIssues = (lines: string[]): string[] => {
  const formattedLines: string[] = [];
  let severity = 'Issue';
  for (const line of lines) {
    const trimmed = line.trim();
    const severityMatch = trimmed.match(/^####\s+(.+)$/);
    if (severityMatch?.[1]) {
      severity = severityMatch[1].toLowerCase().replace(/^\w/, (char) => char.toUpperCase());
      continue;
    }
    const prefixedSeverityMatch = trimmed.match(
      /^[-*]\s*(Critical|Warning|Suggestion|Issue)\s*:\s*(.+)$/i,
    );
    if (prefixedSeverityMatch) {
      const explicitSeverity = prefixedSeverityMatch[1].replace(/^\w/, (char) =>
        char.toUpperCase(),
      );
      formattedLines.push(
        ...formatReviewIssueBullet(explicitSeverity, `* ${prefixedSeverityMatch[2]}`),
      );
      continue;
    }
    if (/^[-*]\s+/.test(trimmed)) {
      formattedLines.push(...formatReviewIssueBullet(severity, trimmed));
    }
  }
  return formattedLines;
};

const reviewPlanLine = (lines: string[]): string[] => {
  const planLine = trimBlankLines(lines)[0]?.replace(/^`+|`+$/g, '');
  if (!planLine) {
    return [];
  }
  const linkMatch = planLine.match(/^\[([^\]]+)\]\([^)]+\)$/);
  return [`\`${linkMatch?.[1] ?? planLine}\``];
};

const nextSectionLines = (lines: string[]): string[] => {
  const trimmedLines = trimBlankLines(lines).filter((line) => line.trim().length > 0);
  const explicitNextValues: {
    status?: string;
    nextAction?: string;
  } = {};

  for (let index = 0; index < trimmedLines.length; index += 1) {
    const labelMatch = trimmedLines[index].trim().match(/^(Status|Next Action):\s*(.*)$/i);
    if (!labelMatch) {
      continue;
    }

    const field = labelMatch[1].toLowerCase() === 'status' ? 'status' : 'nextAction';
    const inlineValue = labelMatch[2].trim();
    const nextValue = inlineValue.length > 0 ? inlineValue : trimmedLines[index + 1]?.trim();
    if (!nextValue || /^(Status|Next Action):\s*/i.test(nextValue)) {
      continue;
    }

    explicitNextValues[field] = nextValue.replace(/^[-*]\s+/, '').replace(/^`+|`+$/g, '');
  }

  const explicitLines: string[] = [];
  if (explicitNextValues.status) {
    explicitLines.push(`Status: \`${explicitNextValues.status}\``);
  }
  if (
    explicitNextValues.nextAction &&
    !shouldSuppressTerminalNextAction(explicitNextValues.status, explicitNextValues.nextAction)
  ) {
    explicitLines.push(`Next Action: \`${explicitNextValues.nextAction}\``);
  }
  if (explicitLines.length > 0) {
    return explicitLines;
  }

  const transitionLine = trimmedLines[0];
  const status = transitionLine?.match(/->\s*([a-z-]+)\s*$/)?.[1];
  if (!status) {
    return [];
  }
  const nextAction = workflowNextActionForStatus(status);
  return nextAction && !shouldSuppressTerminalNextAction(status, nextAction)
    ? [`Status: \`${status}\``, `Next Action: \`${nextAction}\``]
    : [`Status: \`${status}\``];
};

const shouldSuppressTerminalNextAction = (
  status: string | undefined,
  nextAction: string | undefined,
): boolean => status === 'completed' && nextAction === 'commit-summary';

const workflowNextActionForStatus = (status: string): NextAction | null => {
  switch (status) {
    case 'active':
      return 'execute-plan';
    case 'review':
      return 'review-plan';
    case 'blocked':
      return 'unblock-plan';
    case 'reopening':
      return 'reopen-plan';
    case 'completed':
      return 'commit-summary';
    default:
      return null;
  }
};

const reviewSummaryLines = (lines: string[]): string[] => {
  return boundedSectionLines(lines, TERMINAL_FILE_DETAIL_LIMIT);
};

type WorkflowSummarySection = [heading: string, lines: string[]];

const hasWorkflowSummaryLines = (section: WorkflowSummarySection): boolean => {
  return section[1].length > 0;
};

const formatWorkflowReviewSummary = (trimmedText: string): string | null => {
  if (
    !trimmedText.includes('**Plan**') ||
    !trimmedText.includes('**Summary**') ||
    !trimmedText.includes('**Issues**') ||
    !trimmedText.includes('**Final Verdict**')
  ) {
    return null;
  }

  const sections = parseWorkflowSections(trimmedText, workflowSummarySectionHeading);
  const outputSections: WorkflowSummarySection[] = [
    ['Plan', reviewPlanLine(sections.get('Plan') ?? [])],
    ['Summary', reviewSummaryLines(sections.get('Summary') ?? [])],
    ['Issues', formatReviewIssues(sections.get('Issues') ?? [])],
    ['Final Verdict', trimBlankLines(sections.get('Final Verdict') ?? [])],
    ['Next', nextSectionLines(sections.get('Next') ?? [])],
  ];

  return outputSections
    .filter(hasWorkflowSummaryLines)
    .flatMap(([heading, lines], index) => [...(index > 0 ? [''] : []), `**${heading}**`, ...lines])
    .join('\n')
    .trimEnd();
};

const formatSharedKeyDetails = (lines: string[]): string[] => {
  const keyDetails = trimBlankLines(lines).filter((line) => {
    const trimmed = line.trim();
    if (trimmed.length === 0) {
      return false;
    }
    if (/\bsub-agents?\b/i.test(trimmed)) {
      return false;
    }
    if (/^\*?\s*Branch:/i.test(trimmed)) {
      return false;
    }
    return true;
  });
  return keyDetails.slice(0, 5);
};

const formatWorkflowSharedSummary = (trimmedText: string): string | null => {
  if (
    !trimmedText.includes('**Plan**') ||
    !trimmedText.includes('**Summary**') ||
    !trimmedText.includes('**Key Details**') ||
    !trimmedText.includes('**Next**')
  ) {
    return null;
  }

  const sections = parseWorkflowSections(trimmedText, workflowSummarySectionHeading);
  const validationLines = trimBlankLines(sections.get('Validation') ?? []).map(
    compactWorkflowValidationLine,
  );
  const outputSections: WorkflowSummarySection[] = [
    ['Plan', trimBlankLines(sections.get('Plan') ?? [])],
    ['Summary', boundedSectionLines(sections.get('Summary') ?? [], TERMINAL_FILE_DETAIL_LIMIT + 1)],
    ['Key Details', formatSharedKeyDetails(sections.get('Key Details') ?? [])],
    ['Validation', validationLines],
    ['Next', nextSectionLines(sections.get('Next') ?? [])],
  ];

  return outputSections
    .filter(hasWorkflowSummaryLines)
    .flatMap(([heading, lines], index) => [...(index > 0 ? [''] : []), `**${heading}**`, ...lines])
    .join('\n')
    .trimEnd();
};

const formatWorkflowAgentSummary = (text: string): string => {
  const trimmedText = text.trimEnd();
  return (
    formatWorkflowReviewSummary(trimmedText) ??
    formatWorkflowSharedSummary(trimmedText) ??
    trimmedText
  );
};

const formatCommandTerminalOutput = (
  command: string,
  text: string,
  exitCode: CommandExitCode,
  color = false,
): string => {
  const stats = terminalOutputStats(text);
  if (exitCode === 0) {
    return formatPassedCommandTerminalBlock(command, stats, color);
  }
  if (!stats) {
    return '';
  }
  return formatFailedCommandTerminalBlock(stats.output);
};

const formatTerminalEventBlock = (body: string): string => (body ? `${body.trimEnd()}\n\n` : '');

export const formatWorkflowElapsedTime = (durationMs: number): string => {
  const totalSeconds = Math.max(0, Math.floor(durationMs / 1000));
  const seconds = totalSeconds % 60;
  const totalMinutes = Math.floor(totalSeconds / 60);
  const minutes = totalMinutes % 60;
  const hours = Math.floor(totalMinutes / 60);
  if (hours > 0) {
    return `${hours}h ${String(minutes).padStart(2, '0')}m ${String(seconds).padStart(2, '0')}s`;
  }
  if (totalMinutes > 0) {
    return `${totalMinutes}m ${String(seconds).padStart(2, '0')}s`;
  }
  return `${seconds}s`;
};

const formatEditedFileSummaryLine = (summary: EditedFileSummary, color = false): string => {
  const formattedAction = formatTerminalAction(summary.action, color);
  const additions = `+${summary.additions}`;
  const deletions = `-${summary.deletions}`;
  const formattedAdditions = color
    ? `${terminalLabelStyles.diffAdded}${additions}${ANSI_RESET}`
    : additions;
  const formattedDeletions = color
    ? `${terminalLabelStyles.diffDeleted}${deletions}${ANSI_RESET}`
    : deletions;
  return `* ${formattedAction} ${summary.path} (${formattedAdditions} ${formattedDeletions})`;
};

const formatEditedFilesForTerminal = (summaries: EditedFileSummary[], color = false): string =>
  summaries.map((summary) => formatEditedFileSummaryLine(summary, color)).join('\n');

const formatEditedFilesForLog = (summaries: EditedFileSummary[]): string | undefined => {
  if (summaries.length === 0) {
    return undefined;
  }
  return summaries
    .map((summary, index) => {
      const line = `${summary.action} ${summary.path} (+${summary.additions} -${summary.deletions})`;
      return index === 0 ? line : `    ${line}`;
    })
    .join('\n');
};

const stripAnsiSequences = (text: string): string => text.replace(ANSI_SEQUENCE_PATTERN, '');

const stripNonSgrAnsiSequences = (text: string): string =>
  text.replace(
    ANSI_SEQUENCE_PATTERN,
    (sequence, _parameters: string | undefined, finalByte: string | undefined) =>
      finalByte === 'm' ? sequence : '',
  );

const formatTerminalLabel = (label: string, style: TerminalLabelStyle, color = false): string =>
  color ? `${terminalLabelStyles[style]}${label}${ANSI_RESET}` : label;

const formatCommandFailureHeadline = (
  command: string,
  exitCode: CommandExitCode,
  color = false,
): string => {
  const exitDescription = exitCode === 'unknown' ? 'unknown' : String(exitCode);
  const failedTestSummary = summarizeFailedTestCommand(command);
  const commandSummary = commandTerminalSummary(command);
  const commandLabel = failedTestSummary?.label ?? commandSummary.failureLabel ?? command;
  return `${formatTerminalLabel('[failed]', 'commandFailed', color)} ${commandLabel} (exit ${exitDescription})`;
};

const terminalPathMarkers = [
  '/.ai/',
  '/apps/',
  '/packages/',
  '/src/',
  '/docs/',
  '/supabase/',
  '/scripts/',
  '/tests/',
  '/e2e/',
];

const displayPathForTerminal = (filePath: string): string => {
  const slashPath = filePath.replace(/\\/g, '/');
  const relativePath = path.isAbsolute(filePath)
    ? path.relative(process.cwd(), filePath).replace(/\\/g, '/')
    : slashPath;
  if (!relativePath.startsWith('../') && relativePath !== '..') {
    return relativePath;
  }

  for (const marker of terminalPathMarkers) {
    const markerIndex = slashPath.lastIndexOf(marker);
    if (markerIndex >= 0) {
      return slashPath.slice(markerIndex + 1);
    }
  }

  return relativePath;
};

const applyPatchVerificationFailureSummary = (text: string, color = false): string | null => {
  const match = text.match(
    /ERROR codex_core::tools::router: error=apply_patch verification failed: Failed to find expected lines in (.+?):/,
  );
  if (!match) {
    return null;
  }

  const absoluteOrRelativeFile = match[1] ?? '';
  const file = displayPathForTerminal(absoluteOrRelativeFile);
  const contextStart = match.index === undefined ? 0 : match.index + match[0].length;
  const missingContextLine = text
    .slice(contextStart)
    .split(/\r?\n/)
    .map((line) => line.trim())
    .find(Boolean);
  const contextLines = missingContextLine
    ? ['', 'Patch context not found:', missingContextLine]
    : [];

  return [
    `${formatTerminalLabel('[failed]', 'commandFailed', color)} apply_patch (verification failed)`,
    `- ${file}`,
    ...contextLines,
    '',
    'Re-read the target section and apply a fresh patch.',
    '',
    'command output omitted from workflow log',
    '',
    '',
  ].join('\n');
};

const formatCodexStderrForTerminal = (text: string, color = false): string =>
  applyPatchVerificationFailureSummary(text, color) ?? text;

const stageStylesByPromptPath: Record<string, { label: string; colorCode: string }> = {
  [rel('.ai', 'prompts', 'plan-validator.md')]: { label: 'VALIDATE', colorCode: '\u001b[37;45m' },
  [rel('.ai', 'prompts', 'fix-plan.md')]: { label: 'FIX PLAN', colorCode: '\u001b[37;45m' },
  [rel('.ai', 'prompts', 'execute-plan.md')]: { label: 'EXECUTE', colorCode: '\u001b[37;45m' },
  [rel('.ai', 'prompts', 'unblock-plan.md')]: { label: 'UNBLOCK', colorCode: '\u001b[37;45m' },
  [rel('.ai', 'prompts', 'review-changes.md')]: { label: 'REVIEW', colorCode: '\u001b[37;45m' },
  [rel('.ai', 'prompts', 'reopen-plan.md')]: { label: 'REOPEN', colorCode: '\u001b[37;45m' },
  [rel('.ai', 'prompts', 'commit-summary.md')]: { label: 'SUMMARY', colorCode: '\u001b[37;45m' },
};

export const supportsWorkflowAnsiColor = (
  env: NodeJS.ProcessEnv = process.env,
  stream: Pick<NodeJS.WriteStream, 'isTTY'> = process.stdout,
): boolean => {
  if (Object.prototype.hasOwnProperty.call(env, 'NO_COLOR')) {
    return false;
  }
  if (env.FORCE_COLOR === '0') {
    return false;
  }
  if (env.FORCE_COLOR && env.FORCE_COLOR !== '0') {
    return true;
  }
  return Boolean(stream.isTTY);
};

export const formatWorkflowProgressLine = ({
  iteration,
  maxIterations,
  status,
  nextAction,
  promptPath,
  model,
  reasoning,
  color = false,
}: {
  iteration: number;
  maxIterations: number;
  status: string;
  nextAction: string;
  promptPath: string;
  model: CodexModel;
  reasoning: ReasoningEffort;
  color?: boolean;
}): string => {
  const stage = stageStylesByPromptPath[promptPath] ?? {
    label: 'WORKFLOW',
    colorCode: '\u001b[37;45m',
  };
  const progressPrefix = `[${iteration}/${maxIterations}] STAGE ${stage.label}`;
  const formattedProgressPrefix = color
    ? `${stage.colorCode}${progressPrefix}${ANSI_RESET}`
    : progressPrefix;
  return `${formattedProgressPrefix}\n${status} -> ${nextAction}\nmodel: ${model} | reasoning: ${reasoning}`;
};

export const WORKFLOW_WAIT_NOTICE_INTERVAL_MS = 120_000;

const formatWorkflowWaitElapsedTime = (elapsedMs: number): string => {
  if (elapsedMs < 60_000) {
    return formatWorkflowElapsedTime(elapsedMs);
  }
  return `${Math.floor(elapsedMs / 60_000)}m`;
};

export const formatWorkflowWaitLine = ({
  promptPath,
  elapsedMs,
  color = false,
}: {
  promptPath: string;
  elapsedMs: number;
  color?: boolean;
}): string => {
  const line = `[wait] ${path.basename(promptPath)} running ${formatWorkflowWaitElapsedTime(elapsedMs)}`;
  return color ? `${WORKFLOW_WAIT_NOTICE_COLOR}${line}${ANSI_RESET}` : line;
};

export const createWorkflowWaitNotice = ({
  outputStream,
  enabled,
  promptPath,
  now,
  startedAt,
  color,
  intervalMs = WORKFLOW_WAIT_NOTICE_INTERVAL_MS,
}: {
  outputStream: OutputStream;
  enabled: boolean;
  promptPath: string;
  now: () => number;
  startedAt: number;
  color: boolean;
  intervalMs?: number;
}) => {
  let timeout: ReturnType<typeof setTimeout> | undefined;
  let stopped = true;
  let lastActivityAt = startedAt;

  const clear = () => {
    if (!timeout) {
      return;
    }
    clearTimeout(timeout);
    timeout = undefined;
  };

  const schedule = () => {
    if (!enabled || stopped || timeout) {
      return;
    }
    timeout = setTimeout(() => {
      timeout = undefined;
      if (stopped) {
        return;
      }
      outputStream.stdout(
        `${formatWorkflowWaitLine({
          promptPath,
          elapsedMs: Math.max(0, now() - lastActivityAt),
          color,
        })}\n\n`,
      );
      schedule();
    }, intervalMs);
    timeout.unref?.();
  };

  return {
    start: () => {
      if (!enabled) {
        return;
      }
      stopped = false;
      schedule();
    },
    markActivity: () => {
      if (stopped) {
        return;
      }
      lastActivityAt = now();
      clear();
      schedule();
    },
    stop: () => {
      stopped = true;
      clear();
    },
  };
};

export const formatCodexJsonlEventForTerminal = (
  line: string,
  { color = false }: CodexTerminalFormatOptions = {},
): string => {
  const parseLine = stripAnsiSequences(line);
  const trimmed = parseLine.trim();
  if (!trimmed) {
    return '';
  }

  let parsed: unknown;
  try {
    parsed = JSON.parse(trimmed);
  } catch {
    const passthroughLine = stripNonSgrAnsiSequences(line);
    return passthroughLine
      ? `${passthroughLine.endsWith('\n') ? passthroughLine : `${passthroughLine}\n`}`
      : '';
  }

  const event = asRecord(parsed);
  const eventType = toDisplayString(event?.type);
  const codexLabel = formatTerminalLabel('[codex]', 'codex', color);
  if (eventType === 'thread.started') {
    const threadId = toDisplayString(event?.thread_id);
    return formatTerminalEventBlock(
      `${codexLabel} thread started${threadId ? ` ${threadId}` : ''}`,
    );
  }
  if (eventType === 'turn.started') {
    return formatTerminalEventBlock(`${codexLabel} turn started`);
  }
  if (eventType === 'turn.completed') {
    return formatTerminalEventBlock(`${codexLabel} turn completed`);
  }
  if (eventType === 'turn.failed') {
    const error = asRecord(event?.error);
    const message = toDisplayString(error?.message) ?? 'unknown error';
    return formatTerminalEventBlock(`${codexLabel} turn failed: ${message}`);
  }
  if (eventType === 'error') {
    const message = toDisplayString(event?.message) ?? 'unknown error';
    return formatTerminalEventBlock(`${codexLabel} error: ${message}`);
  }

  const payload = asRecord(event?.payload);
  if (payload?.type === 'token_count') {
    const info = asRecord(payload.info);
    const lastTokenUsage = asRecord(info?.last_token_usage);
    const usedTokens = lastTokenUsage?.total_tokens;
    const contextWindowTokens = info?.model_context_window;
    if (
      isFiniteNumber(usedTokens) &&
      isFiniteNumber(contextWindowTokens) &&
      contextWindowTokens > 0
    ) {
      const percent = ((usedTokens / contextWindowTokens) * 100).toFixed(2);
      const contextLabel = formatTerminalLabel('[context]', 'context', color);
      return formatTerminalEventBlock(
        `${contextLabel} ${usedTokens}/${contextWindowTokens} tokens (${percent}%)`,
      );
    }
    return '';
  }

  const item = asRecord(event?.item);
  const itemType = toDisplayString(item?.type);
  if (itemType === 'command_execution') {
    const command = toDisplayString(item?.command) ?? '(unknown command)';
    const status = toDisplayString(item?.status);
    if (eventType === 'item.started' || status === 'in_progress') {
      return formatTerminalEventBlock(formatCommandStartedDescription(command, color));
    }

    const rawExitCode = item?.exit_code;
    const exitCode: CommandExitCode = isFiniteNumber(rawExitCode) ? rawExitCode : 'unknown';
    const output = toDisplayString(item?.aggregated_output) ?? '';
    return formatTerminalEventBlock(
      exitCode === 0
        ? formatCommandTerminalOutput(command, output, exitCode, color)
        : `${formatCommandFailureHeadline(command, exitCode, color)}${formatCommandTerminalOutput(
            command,
            output,
            exitCode,
            color,
          )}`,
    );
  }
  if (itemType === 'agent_message') {
    const text = toDisplayString(item?.text);
    return text
      ? formatTerminalEventBlock(
          `${formatTerminalLabel('[agent]', 'agent', color)}\n${formatWorkflowAgentSummary(text)}`,
        )
      : '';
  }

  return '';
};

export const createCodexLiveOutputFormatter = (
  outputStream: OutputStream,
  options: CodexTerminalFormatOptions = {},
) => {
  let stdoutBuffer = '';
  let lastExploredBlock = '';
  let lastCommandBlock = '';
  let pendingReadBlock = '';
  let pendingTurnCompletedBlock = '';

  const isExploredBlock = (formatted: string): boolean => {
    const firstLine = formatted.split(/\r?\n/, 1)[0] ?? '';
    return /^(?:\x1B\[[0-9;]*m)?(?:Read|Search|Explore)(?:\x1B\[0m)?(?:\s|$)/.test(firstLine);
  };

  const isReadBlock = (formatted: string): boolean => {
    const firstLine = formatted.split(/\r?\n/, 1)[0] ?? '';
    return /^(?:\x1B\[[0-9;]*m)?Read(?:\x1B\[0m)?(?:\s|$)/.test(firstLine);
  };

  const isTurnCompletedBlock = (formatted: string): boolean =>
    /^(?:\x1B\[[0-9;]*m)?\[codex\](?:\x1B\[0m)? turn completed(?:\r?\n|$)/.test(formatted);

  const isCommandBlock = (formatted: string): boolean => {
    const firstLine = formatted.split(/\r?\n/, 1)[0] ?? '';
    return /^(?:\x1B\[[0-9;]*m)?(?:Ran|\[failed\])(?:\x1B\[0m)?(?:\s|$)/.test(firstLine);
  };

  const flushPendingReadBlock = () => {
    if (!pendingReadBlock) {
      return;
    }
    outputStream.stdout(`${pendingReadBlock}\n\n`);
    pendingReadBlock = '';
  };

  const flushPendingTurnCompleted = () => {
    if (!pendingTurnCompletedBlock) {
      return;
    }
    outputStream.stdout(pendingTurnCompletedBlock);
    pendingTurnCompletedBlock = '';
  };

  const writeFormattedOutput = (formatted: string) => {
    if (!formatted) {
      return;
    }

    if (isTurnCompletedBlock(formatted)) {
      pendingTurnCompletedBlock = formatted;
      return;
    }

    flushPendingTurnCompleted();

    if (isReadBlock(formatted)) {
      if (formatted === lastExploredBlock) {
        return;
      }
      lastCommandBlock = '';
      lastExploredBlock = formatted;
      const trimmedBlock = formatted.replace(/\r?\n+$/, '');
      pendingReadBlock = pendingReadBlock ? `${pendingReadBlock}\n${trimmedBlock}` : trimmedBlock;
      return;
    }

    flushPendingReadBlock();

    if (isExploredBlock(formatted)) {
      if (formatted === lastExploredBlock) {
        return;
      }
      lastCommandBlock = '';
      lastExploredBlock = formatted;
      outputStream.stdout(formatted);
      return;
    }

    lastExploredBlock = '';
    if (isCommandBlock(formatted)) {
      if (formatted === lastCommandBlock) {
        return;
      }
      lastCommandBlock = formatted;
      outputStream.stdout(formatted);
      return;
    }

    lastCommandBlock = '';
    outputStream.stdout(formatted);
  };

  return {
    stdout: (chunk: string) => {
      stdoutBuffer += chunk;
      const lines = stdoutBuffer.split(/\r?\n/);
      stdoutBuffer = lines.pop() ?? '';
      for (const line of lines) {
        const formatted = formatCodexJsonlEventForTerminal(line, options);
        writeFormattedOutput(formatted);
      }
    },
    stderr: (chunk: string) => {
      outputStream.stderr(formatCodexStderrForTerminal(chunk, options.color));
    },
    flush: ({ includePendingTurnCompleted = true }: CodexLiveOutputFlushOptions = {}) => {
      if (stdoutBuffer) {
        const formatted = formatCodexJsonlEventForTerminal(stdoutBuffer, options);
        stdoutBuffer = '';
        writeFormattedOutput(formatted);
      }
      flushPendingReadBlock();
      if (includePendingTurnCompleted) {
        flushPendingTurnCompleted();
      }
    },
  };
};

const codexAgentMessageTexts = (stdout: string): string[] => {
  const messages: string[] = [];
  for (const line of stdout.split(/\r?\n/)) {
    const trimmed = line.trim();
    if (!trimmed) {
      continue;
    }

    let parsed: unknown;
    try {
      parsed = JSON.parse(trimmed);
    } catch {
      continue;
    }

    const event = asRecord(parsed);
    const item = asRecord(event?.item);
    if (item?.type === 'agent_message' && typeof item.text === 'string') {
      messages.push(item.text);
    }
  }
  return messages;
};

const stdoutContainsJsonEvents = (stdout: string): boolean => {
  for (const line of stdout.split(/\r?\n/)) {
    const trimmed = line.trim();
    if (!trimmed) {
      continue;
    }
    try {
      JSON.parse(trimmed);
      return true;
    } catch {
      continue;
    }
  }
  return false;
};

const commandRecordFromCodexEvent = (
  command: string,
  exitCode: number | 'unknown',
  output: string,
): WorkflowFailureDebugCommandRecord => {
  const summary = failureDebugOutputSummary(output);
  return {
    source: 'codex-command',
    command,
    exitCode,
    outputByteCount: summary?.byteCount ?? 0,
    outputLineCount: summary?.lineCount ?? 0,
    outputExcerpt: summary?.excerpt,
    outputTruncated: summary?.truncated ?? false,
  };
};

const commandRecordFromProcessCapture = (
  source: 'review-staging' | 'review-cleanup',
  command: string,
  exitCode: number | 'unknown',
  stdout: string,
  stderr: string,
): WorkflowFailureDebugCommandRecord => {
  const stdoutSummary = failureDebugOutputSummary(stdout);
  const stderrSummary = failureDebugOutputSummary(stderr);
  return {
    source,
    command,
    exitCode,
    stdoutByteCount: stdoutSummary?.byteCount ?? 0,
    stdoutLineCount: stdoutSummary?.lineCount ?? 0,
    stdoutExcerpt: stdoutSummary?.excerpt,
    stdoutTruncated: stdoutSummary?.truncated ?? false,
    stderrByteCount: stderrSummary?.byteCount ?? 0,
    stderrLineCount: stderrSummary?.lineCount ?? 0,
    stderrExcerpt: stderrSummary?.excerpt,
    stderrTruncated: stderrSummary?.truncated ?? false,
  };
};

const codexRecentCommandRecords = (stdout: string): WorkflowFailureDebugCommandRecord[] => {
  const commands: WorkflowFailureDebugCommandRecord[] = [];
  for (const line of stdout.split(/\r?\n/)) {
    const trimmed = line.trim();
    if (!trimmed) {
      continue;
    }

    let parsed: unknown;
    try {
      parsed = JSON.parse(trimmed);
    } catch {
      continue;
    }

    const event = asRecord(parsed);
    const item = asRecord(event?.item);
    if (item?.type !== 'command_execution') {
      continue;
    }

    const command = toDisplayString(item.command);
    if (!command) {
      continue;
    }
    const status = toDisplayString(item.status);
    if (event?.type === 'item.started' || status === 'in_progress') {
      continue;
    }
    const rawExitCode = item.exit_code;
    const exitCode: number | 'unknown' = isFiniteNumber(rawExitCode) ? rawExitCode : 'unknown';
    const output = toDisplayString(item.aggregated_output) ?? '';
    commands.push(commandRecordFromCodexEvent(command, exitCode, output));
  }

  return commands.slice(-3);
};

const failureStopExcerpt = (stopReason: string): string | undefined => {
  const match = /^(?<label>[A-Za-z0-9][A-Za-z0-9_-]* exec) output contained STOP:?\s*/.exec(
    stopReason,
  );
  if (!match) {
    return undefined;
  }

  const excerpt = stopReason.slice(match[0].length).trim() || 'STOP';
  return boundedInlineExcerpt(excerpt);
};

const createWorkflowFailureDebugRecord = ({
  timestamp,
  iteration,
  planPath,
  status,
  nextAction,
  promptPath,
  result,
  exitCode,
  stopReason,
  failureMetadata,
  stdout,
  stderr,
  staging,
  cleanup,
  taskContext,
}: {
  timestamp: string;
  iteration: number;
  planPath: string;
  status: Status;
  nextAction: NextAction;
  promptPath: string;
  result: string;
  exitCode?: number;
  stopReason: string;
  failureMetadata: FailureMetadataLogFields;
  stdout: string;
  stderr: string;
  staging?: ReviewStagingProcess;
  cleanup?: ReviewCleanupProcess;
}): WorkflowFailureDebugRecord => {
  const stdoutSummary = !stdoutContainsJsonEvents(stdout)
    ? failureDebugOutputSummary(stdout)
    : undefined;
  const stderrSummary = failureDebugOutputSummary(stderr);
  const agentMessages = codexAgentMessageTexts(stdout);
  const recentCommands = [
    ...codexRecentCommandRecords(stdout),
    ...(staging
      ? [
          commandRecordFromProcessCapture(
            'review-staging',
            staging.command,
            staging.exitCode ?? 'unknown',
            staging.stdout,
            staging.stderr,
          ),
        ]
      : []),
    ...(cleanup
      ? [
          commandRecordFromProcessCapture(
            'review-cleanup',
            cleanup.command,
            cleanup.exitCode ?? 'unknown',
            cleanup.stdout,
            cleanup.stderr,
          ),
        ]
      : []),
  ];

  return {
    timestamp,
    iteration,
    planPath,
    status,
    nextAction,
    promptPath,
    result,
    exitCode: exitCode ?? null,
    stopReason,
    failureKind: failureMetadata.failureKind,
    failureReason: failureMetadata.failureReason,
    stdoutByteCount: Buffer.byteLength(stdout, 'utf8'),
    stdoutLineCount: stdout ? stdout.split(/\r?\n/).length : 0,
    stderrByteCount: Buffer.byteLength(stderr, 'utf8'),
    stderrLineCount: stderr ? stderr.split(/\r?\n/).length : 0,
    stdoutExcerpt: stdoutSummary?.excerpt,
    stdoutTruncated: stdoutSummary?.truncated,
    stderrExcerpt: stderrSummary?.excerpt,
    stderrTruncated: stderrSummary?.truncated,
    stopExcerpt: failureStopExcerpt(stopReason),
    lastAgentMessageExcerpt:
      agentMessages.length > 0 ? boundedInlineExcerpt(agentMessages.at(-1) ?? '') : undefined,
    recentCommands,
  };
};

const normalizeStopDirectiveLine = (line: string): string => {
  const trimmed = line.trim();
  const inlineCodeMatch = /^`([^`]+)`(.*)$/.exec(trimmed);
  if (!inlineCodeMatch) {
    return trimmed;
  }

  const [, inlineCodeText, suffix] = inlineCodeMatch;
  const normalizedInlineCodeText = inlineCodeText.trim();
  return `${normalizedInlineCodeText}${suffix}`.trim();
};

const containsStopDirective = (text: string): boolean =>
  text.split(/\r?\n/).some((line) => {
    const trimmed = normalizeStopDirectiveLine(line);
    return (
      trimmed === 'STOP' ||
      trimmed.startsWith('STOP:') ||
      trimmed.startsWith('STOP (') ||
      trimmed.startsWith('STOP `') ||
      trimmed.startsWith('STOP -')
    );
  });

const boundedInlineExcerpt = (text: string): string | undefined => {
  const normalized = text.replace(/\s+/g, ' ').trim();
  if (!normalized) {
    return undefined;
  }
  if (normalized.length <= STOP_REASON_EXCERPT_CHAR_LIMIT) {
    return normalized;
  }
  return `${normalized.slice(0, STOP_REASON_EXCERPT_CHAR_LIMIT - 3).trimEnd()}...`;
};

const stripStopDirectivePrefix = (line: string): string | undefined => {
  const trimmed = normalizeStopDirectiveLine(line);
  if (!containsStopDirective(trimmed)) {
    return undefined;
  }
  if (trimmed === 'STOP') {
    return undefined;
  }

  let excerpt = trimmed.replace(/^STOP\b/, '').trim();
  excerpt = excerpt.replace(/^[:\-\s]+/, '').trim();
  if (excerpt.startsWith('(') && excerpt.endsWith(')')) {
    excerpt = excerpt.slice(1, -1).trim();
  }
  if (excerpt.startsWith('`') && excerpt.endsWith('`')) {
    excerpt = excerpt.slice(1, -1).trim();
  }
  if (excerpt.startsWith('`') && excerpt.endsWith('`)')) {
    excerpt = excerpt.slice(1, -2).trim();
  }
  return boundedInlineExcerpt(excerpt);
};

const plainStopExcerpt = (text: string): string | undefined => {
  const stopLine = text.split(/\r?\n/).find((line) => line.includes('STOP'));
  if (!stopLine) {
    return undefined;
  }
  return stripStopDirectivePrefix(stopLine) ?? boundedInlineExcerpt(stopLine);
};

const formatStopReason = (
  excerpt?: string,
  codexExecLabel = workflowRunnerCodexExecLabel(WORKFLOW_RUNNER_CODEX_PROFILE),
): string => `${codexExecLabel} output contained STOP${excerpt ? `: ${excerpt}` : ''}`;

const REVIEW_ENTRY_STAGED_WORK_REASON_PREFIX =
  'review blocked before review-plan because staged files already exist; finish pending staged work or another review first';

const classifyFailureForLog = (reason: string): FailureMetadataLogFields => {
  const stopMatch = /^(?<label>[A-Za-z0-9][A-Za-z0-9_-]* exec) output contained STOP:?\s*/.exec(
    reason,
  );
  if (stopMatch) {
    return {
      failureKind: 'codex-stop',
      failureReason: reason.slice(stopMatch[0].length).trim() || 'STOP',
      nextSuggestedAction: 'unblock-plan with evidence',
    };
  }
  if (/^could not launch [A-Za-z0-9][A-Za-z0-9_-]* exec(?::|$)/.test(reason)) {
    return {
      failureKind: 'codex-launch',
      failureReason: reason,
      nextSuggestedAction: 'fix Codex launch environment, then rerun workflow-runner',
    };
  }
  if (/^[A-Za-z0-9][A-Za-z0-9_-]* exec exited with code\b/.test(reason)) {
    return {
      failureKind: 'codex-exit',
      failureReason: reason,
      nextSuggestedAction: 'inspect workflow log, fix runtime failure, then rerun workflow-runner',
    };
  }
  if (reason.startsWith(REVIEW_ENTRY_STAGED_WORK_REASON_PREFIX)) {
    return {
      failureKind: 'review-entry-staged-work',
      failureReason: reason,
      nextSuggestedAction:
        'finish or unstage existing staged work before starting review-plan, then rerun workflow-runner',
    };
  }
  if (
    reason.startsWith('review staging git add') ||
    reason.startsWith('could not launch review staging git add')
  ) {
    return {
      failureKind: 'review-staging',
      failureReason: reason,
      nextSuggestedAction: 'fix review staging paths or git error, then rerun workflow-runner',
    };
  }
  if (reason.startsWith('review hunk ownership incomplete')) {
    return {
      failureKind: 'review-hunk-ownership',
      failureReason: reason,
      nextSuggestedAction:
        'update ## Hunk Ownership for shared-file hunks, then rerun workflow-runner',
    };
  }
  if (
    reason.startsWith('review cleanup git restore') ||
    reason.startsWith('could not launch review cleanup git restore')
  ) {
    return {
      failureKind: 'review-unstage',
      failureReason: reason,
      nextSuggestedAction:
        'fix review cleanup git error or manually unstage plan paths, then rerun workflow-runner',
    };
  }
  if (reason.startsWith('plan-owned changes remain after commit-summary')) {
    return {
      failureKind: 'dirty-plan-owned-paths',
      failureReason: reason,
      nextSuggestedAction: 'inspect plan-owned changes, commit them, then rerun workflow-runner',
    };
  }
  if (reason === 'plan content unchanged after successful nonterminal workflow action') {
    return {
      failureKind: 'unchanged-plan',
      failureReason: reason,
      nextSuggestedAction:
        'inspect workflow output and update plan state, then rerun workflow-runner',
    };
  }
  if (reason.includes('may only hand off')) {
    return {
      failureKind: 'invalid-transition',
      failureReason: reason,
      nextSuggestedAction: 'fix plan status and next action, then rerun workflow-runner',
    };
  }
  if (reason.startsWith('maximum iterations ')) {
    return {
      failureKind: 'max-iterations',
      failureReason: reason,
      nextSuggestedAction: 'inspect plan progress, then resume with workflow-runner if still valid',
    };
  }
  return {
    failureKind: 'runner-failure',
    failureReason: reason,
    nextSuggestedAction: 'inspect workflow log, resolve failure, then rerun workflow-runner',
  };
};

export const codexOutputStopReason = (
  stdout: string,
  stderr: string,
  codexExecLabel = workflowRunnerCodexExecLabel(WORKFLOW_RUNNER_CODEX_PROFILE),
): string | undefined => {
  if (stderr.includes('STOP')) {
    return formatStopReason(plainStopExcerpt(stderr), codexExecLabel);
  }

  const agentMessages = codexAgentMessageTexts(stdout);
  if (agentMessages.length > 0) {
    for (const message of agentMessages) {
      if (containsStopDirective(message)) {
        const excerpt = message
          .split(/\r?\n/)
          .map(stripStopDirectivePrefix)
          .find((value): value is string => typeof value === 'string');
        return formatStopReason(excerpt, codexExecLabel);
      }
    }
    return undefined;
  }

  let sawJsonLine = false;
  for (const line of stdout.split(/\r?\n/)) {
    const trimmed = line.trim();
    if (!trimmed) {
      continue;
    }
    try {
      JSON.parse(trimmed);
      sawJsonLine = true;
    } catch {
      continue;
    }
  }

  if (sawJsonLine) {
    return undefined;
  }
  if (stdout.includes('STOP')) {
    return formatStopReason(plainStopExcerpt(stdout), codexExecLabel);
  }
  return undefined;
};

const parseScopeCleanupDecision = (stdout: string): ScopeCleanupDecision | undefined => {
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
      if (action !== 'keep' && action !== 'unstage') {
        continue;
      }
      const patch =
        typeof record.patch === 'string' && record.patch.trim().length > 0
          ? record.patch
          : undefined;
      return { action, patch };
    } catch {
      continue;
    }
  }
  return undefined;
};

export const codexOutputContainsStop = (stdout: string, stderr: string): boolean =>
  codexOutputStopReason(stdout, stderr) !== undefined;

export const codexExecutionConfig = (promptPath: string): CodexExecutionConfig => {
  const config = PROMPT_CODEX_EXECUTION_OVERRIDES[promptPath];
  if (!config) {
    throw new Error(`workflow runner codex config missing for prompt: ${promptPath}`);
  }
  return config;
};

const codexExecArgs = ({
  executionConfig,
  promptPath,
  prompt,
  rootDir,
}: {
  executionConfig: CodexExecutionConfig;
  promptPath: string;
  prompt: string;
  rootDir: string;
}): string[] => {
  const args = [
    'exec',
    '--json',
    '--model',
    executionConfig.model,
    '-c',
    `model_reasoning_effort="${executionConfig.reasoning}"`,
  ];

  if (promptPath === COMMIT_SUMMARY_PROMPT_PATH) {
    args.push('--add-dir', path.join(rootDir, '.git'));
  }

  args.push(prompt);
  return args;
};

const promptRoutes: Record<string, string> = {
  'draft|plan-validator': PLAN_VALIDATOR_PROMPT_PATH,
  'draft|fix-plan': FIX_PLAN_PROMPT_PATH,
  'approved|execute-plan': EXECUTE_PLAN_PROMPT_PATH,
  'active|execute-plan': EXECUTE_PLAN_PROMPT_PATH,
  'blocked|execute-plan': UNBLOCK_PLAN_PROMPT_PATH,
  'blocked|unblock-plan': UNBLOCK_PLAN_PROMPT_PATH,
  'review|review-plan': REVIEW_CHANGES_PROMPT_PATH,
  'reopening|reopen-plan': REOPEN_PLAN_PROMPT_PATH,
  'completed|commit-summary': COMMIT_SUMMARY_PROMPT_PATH,
};

const promptActionLabels: Record<string, string> = {
  [rel('.ai', 'prompts', 'plan-validator.md')]: 'Validate',
  [rel('.ai', 'prompts', 'fix-plan.md')]: 'Fix',
  [rel('.ai', 'prompts', 'execute-plan.md')]: 'Execute',
  [rel('.ai', 'prompts', 'unblock-plan.md')]: 'Unblock',
  [rel('.ai', 'prompts', 'review-changes.md')]: 'Review',
  [rel('.ai', 'prompts', 'fix-review.md')]: 'Fix review',
  [rel('.ai', 'prompts', 'reopen-plan.md')]: 'Reopen',
  [rel('.ai', 'prompts', 'commit-summary.md')]: 'Commit summary',
};

const stateMachinePromptPaths = new Set(Object.keys(promptActionLabels));

const orderedInstructionPaths = [
  rel('.ai', 'instructions', 'ai-workflow.md'),
  rel('.ai', 'instructions', 'architecture.md'),
  rel('.ai', 'instructions', 'web.md'),
  rel('.ai', 'instructions', 'admin.md'),
  rel('.ai', 'instructions', 'backend.md'),
  rel('.ai', 'instructions', 'supabase.md'),
  rel('.ai', 'instructions', 'ui.md'),
  rel('.ai', 'instructions', 'i18n.md'),
  rel('.ai', 'instructions', 'auth.md'),
  rel('.ai', 'instructions', 'shared', 'testing.md'),
] as const;

const planSectionLines = (content: string, heading: string): string[] => {
  const lines = content.split(/\r?\n/);
  const start = lines.findIndex((line) => line.trim() === heading);
  if (start === -1) {
    return [];
  }
  const collected: string[] = [];
  for (const line of lines.slice(start + 1)) {
    if (line.trim().startsWith('## ')) {
      break;
    }
    collected.push(line);
  }
  return collected;
};

const slugifyTaskWords = (value: string): string =>
  value
    .toLowerCase()
    .replace(/`[^`]*`/g, '')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .replace(/-{2,}/g, '-');

export const parsePlanTasks = (content: string): PlanTask[] => {
  const tasks: PlanTask[] = [];
  const seen = new Set<string>();
  const taskPattern = /^\s*\d+\.\s+\[task:([0-9]{2}-[a-z0-9]+(?:-[a-z0-9]+)*)\]\s+(.+?)\s*$/;

  for (const line of content.split(/\r?\n/)) {
    const match = line.match(taskPattern);
    if (!match) {
      continue;
    }
    const id = match[1];
    if (seen.has(id)) {
      continue;
    }
    seen.add(id);
    const name = match[2].trim();
    const words = id.replace(/^[0-9]{2}-/, '');
    tasks.push({
      id,
      words,
      name,
      artifactWords: slugifyTaskWords(name) || words,
    });
  }

  return tasks;
};

const repoRelativeSpecPathPattern =
  /(^|[`(\s*-])((?!\/)(?!\.\.?\/)(?:[A-Za-z0-9._-]+\/)*[A-Za-z0-9._-]+\.spec\.md)(?=$|[`)\s])/g;

const extractSpecPaths = (planContent: string): string[] => {
  const paths: string[] = [];
  for (const line of planSectionLines(planContent, '## Spec')) {
    for (const match of line.matchAll(repoRelativeSpecPathPattern)) {
      paths.push(match[2]);
    }
  }
  return uniquePaths(paths);
};

const extractPlanOwnedPaths = (planContent: string): string[] => {
  const paths: string[] = [];
  let activeSection = '';
  for (const line of planSectionLines(planContent, '## Files (MANDATORY)')) {
    const trimmed = line.trim();
    if (trimmed.startsWith('### ')) {
      activeSection = targetSubheadings.has(trimmed) ? trimmed : '';
      continue;
    }
    if (!activeSection || trimmed.length === 0) {
      continue;
    }
    const bulletValue = parseReviewStagingBulletValue(trimmed);
    if (bulletValue === null) {
      activeSection = '';
      continue;
    }
    let value = bulletValue;
    if (isNoReviewStagingPathPlaceholder(value)) {
      continue;
    }
    if (value.endsWith(' (assumed)')) {
      value = value.slice(0, -' (assumed)'.length);
    }
    paths.push(value);
  }
  return uniquePaths(paths);
};

const escapeRegExp = (value: string): string => value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

const extractPlanOwnedFileSection = (planContent: string): string[] => {
  const lines = planSectionLines(planContent, '## Files (MANDATORY)');
  const trimmed = [...lines];
  while (trimmed[0]?.trim() === '') {
    trimmed.shift();
  }
  while (trimmed.at(-1)?.trim() === '') {
    trimmed.pop();
  }
  return trimmed;
};

const extractFieldValue = (lines: string[], fieldName: string): string | undefined => {
  const pattern = new RegExp(`^\\*\\s*${escapeRegExp(fieldName)}:\\s*(.+)$`, 'i');
  for (const line of lines) {
    const match = line.trim().match(pattern);
    if (match) {
      return boundedInlineExcerpt(match[1]);
    }
  }
  return undefined;
};

const extractNestedListItems = (lines: string[], fieldName: string, limit = 5): string[] => {
  const pattern = new RegExp(`^\\*\\s*${escapeRegExp(fieldName)}:\\s*$`, 'i');
  const values: string[] = [];
  let collecting = false;

  for (const line of lines) {
    const trimmed = line.trim();
    if (pattern.test(trimmed)) {
      collecting = true;
      continue;
    }
    if (!collecting) {
      continue;
    }
    if (/^###\s+/.test(trimmed)) {
      break;
    }
    if (/^\*\s+/.test(trimmed) && !/^\s+/.test(line)) {
      break;
    }
    const bulletMatch = trimmed.match(/^(?:[-*]|\d+\.)\s+(.+)$/);
    if (!bulletMatch) {
      continue;
    }
    const value = boundedInlineExcerpt(bulletMatch[1]);
    if (value) {
      values.push(value);
      if (values.length >= limit) {
        break;
      }
    }
  }

  return values;
};

const summarizeMeaningfulLines = (lines: string[], limit = 5): string[] => {
  const values: string[] = [];
  let inCodeFence = false;
  for (const line of lines) {
    const trimmed = line.trim();
    if (trimmed.startsWith('```')) {
      inCodeFence = !inCodeFence;
      continue;
    }
    if (inCodeFence || trimmed.length === 0 || /^###\s+/.test(trimmed)) {
      continue;
    }
    const bulletMatch = trimmed.match(/^(?:[-*]|\d+\.)\s+(.+)$/);
    const candidate = bulletMatch ? bulletMatch[1] : trimmed;
    const excerpt = boundedInlineExcerpt(candidate);
    if (!excerpt) {
      continue;
    }
    values.push(excerpt);
    if (values.length >= limit) {
      break;
    }
  }
  return values;
};

const extractVersionedSectionEntries = (
  content: string,
  heading: string,
): Array<{ heading: string; lines: string[] }> => {
  const lines = sectionLines(content, heading);
  if (lines === null) {
    return [];
  }

  const entries: Array<{ heading: string; lines: string[] }> = [];
  let current: { heading: string; lines: string[] } | undefined;
  for (const line of lines) {
    const trimmed = line.trim();
    if (!current && (trimmed.length === 0 || trimmed === '(empty)' || trimmed === '---')) {
      continue;
    }
    if (trimmed.startsWith('### ')) {
      current = { heading: trimmed, lines: [] };
      entries.push(current);
      continue;
    }
    if (!current) {
      continue;
    }
    current.lines.push(line);
  }

  return entries.filter((entry) => entry.lines.some((line) => line.trim().length > 0));
};
const extractCurrentPhaseSummary = (planContent: string): string[] => {
  for (const heading of [
    '## Current Phase',
    '## Current Implementation Status',
    '## Summary',
    '## Verification Status',
  ]) {
    const lines = sectionLines(planContent, heading);
    if (lines === null) {
      continue;
    }
    const summary = summarizeMeaningfulLines(lines);
    if (summary.length > 0) {
      return summary;
    }
  }

  const latestExecution = extractVersionedSectionEntries(planContent, '## Execution Log').at(-1);
  return latestExecution ? summarizeMeaningfulLines(latestExecution.lines) : [];
};

const extractLatestExecutionSummary = (planContent: string): string[] => {
  const latestExecution = extractVersionedSectionEntries(planContent, '## Execution Log').at(-1);
  return latestExecution ? summarizeMeaningfulLines(latestExecution.lines) : [];
};

const extractLatestValidationSummary = (
  planContent: string,
): { result?: string; details: string[] } => {
  const latestValidation = extractVersionedSectionEntries(planContent, '## Validation History').at(
    -1,
  );
  if (!latestValidation) {
    return { details: [] };
  }

  const details = [
    ...extractNestedListItems(latestValidation.lines, 'Critical Issues'),
    ...extractNestedListItems(latestValidation.lines, 'Warnings'),
    ...extractNestedListItems(latestValidation.lines, 'Notes'),
  ];

  if (details.length === 0) {
    details.push(
      ...summarizeMeaningfulLines(
        latestValidation.lines.filter(
          (line) => !/^\*\s*(Result|Recommendation):/i.test(line.trim()),
        ),
      ),
    );
  }

  return {
    result: extractFieldValue(latestValidation.lines, 'Result'),
    details: details.slice(0, 5),
  };
};

const extractLatestReviewSummary = (
  planContent: string,
): {
  heading?: string;
  summary?: string;
  decision?: string;
  evidence?: string;
  unresolvedFindings: string[];
} => {
  const latestReview = extractVersionedSectionEntries(planContent, '## Review History').at(-1);
  if (!latestReview) {
    return { unresolvedFindings: [] };
  }

  const unresolvedFindings = extractNestedListItems(latestReview.lines, 'Issues')
    .filter((value) => !/^resolved:/i.test(value))
    .slice(0, 5);

  return {
    heading: latestReview.heading.startsWith('### ')
      ? latestReview.heading.replace(/^###\s+/, '')
      : undefined,
    summary: extractFieldValue(latestReview.lines, 'Summary'),
    decision: extractFieldValue(latestReview.lines, 'Decision'),
    evidence: extractFieldValue(latestReview.lines, 'Evidence'),
    unresolvedFindings,
  };
};

const extractLatestReviewRemediationContext = (planContent: string): string[] => {
  const status = extractSectionValue(planContent, '## Status');
  const nextAction = extractSectionValue(planContent, '## Next Action');
  if (status !== 'active' || nextAction !== 'execute-plan') {
    return [];
  }

  const review = extractLatestReviewSummary(planContent);
  if (review.unresolvedFindings.length === 0 && !review.evidence) {
    return [];
  }

  const context: string[] = [];
  if (review.heading) {
    context.push(`Source Review: ${review.heading}`);
  }
  if (review.summary) {
    context.push(`Summary: ${review.summary}`);
  }
  if (review.decision) {
    context.push(`Decision: ${review.decision}`);
  }
  if (review.evidence) {
    context.push(`Evidence: ${review.evidence}`);
  }
  context.push(...review.unresolvedFindings);
  return context;
};

const extractActiveBlockers = (planContent: string): string[] => {
  const lines = sectionLines(planContent, '## Blockers');
  if (lines === null) {
    return [];
  }

  const blockers: Array<{ heading: string; lines: string[] }> = [];
  const hasExplicitBlockerSections = lines.some((line) => /^###\s+Blocker\b/i.test(line.trim()));
  let current: { heading: string; lines: string[] } | undefined;
  for (const line of lines) {
    const trimmed = line.trim();
    if (/^###\s+Blocker\b/i.test(trimmed)) {
      current = { heading: trimmed, lines: [] };
      blockers.push(current);
      continue;
    }
    if (hasExplicitBlockerSections) {
      current?.lines.push(line);
      continue;
    }
    current ??= { heading: '## Blockers', lines: [] };
    if (!blockers.includes(current)) {
      blockers.push(current);
    }
    current.lines.push(line);
  }

  return blockers
    .filter((blocker) => {
      const status = extractFieldValue(blocker.lines, 'Status');
      return !(status && /^resolved$/i.test(status));
    })
    .map((blocker) => {
      const details = [
        extractFieldValue(blocker.lines, 'Description'),
        extractFieldValue(blocker.lines, 'Required Action'),
        extractFieldValue(blocker.lines, 'Next Step'),
      ].filter((value): value is string => typeof value === 'string');
      return boundedInlineExcerpt([blocker.heading.replace(/^###\s+/, ''), ...details].join(' | '));
    })
    .filter((value): value is string => typeof value === 'string')
    .slice(0, 5);
};

const summarizeLatestTokenUsage = (
  latestTokenUsage?: WorkflowContextSnapshotTokenUsage,
): string[] => {
  if (!latestTokenUsage) {
    return [];
  }

  const lines: string[] = [];
  if (isFiniteNumber(latestTokenUsage.iteration)) {
    lines.push(`Iteration: ${latestTokenUsage.iteration}`);
  }
  if (typeof latestTokenUsage.promptPath === 'string' && latestTokenUsage.promptPath.length > 0) {
    lines.push(`Prompt: ${latestTokenUsage.promptPath}`);
  }
  if (isFiniteNumber(latestTokenUsage.stageInputTokens)) {
    lines.push(`Stage Input Tokens: ${latestTokenUsage.stageInputTokens}`);
  }
  if (isFiniteNumber(latestTokenUsage.stageUncachedInputTokens)) {
    lines.push(`Stage Uncached Input Tokens: ${latestTokenUsage.stageUncachedInputTokens}`);
  }
  if (isFiniteNumber(latestTokenUsage.stageOutputTokens)) {
    lines.push(`Stage Output Tokens: ${latestTokenUsage.stageOutputTokens}`);
  }
  if (isFiniteNumber(latestTokenUsage.stageTotalTokens)) {
    lines.push(`Stage Total Tokens: ${latestTokenUsage.stageTotalTokens}`);
  }
  if (isFiniteNumber(latestTokenUsage.totalTokens)) {
    lines.push(`Cumulative Total Tokens: ${latestTokenUsage.totalTokens}`);
  }
  return lines.slice(0, 6);
};

const formatSnapshotSection = (heading: string, items: string[], empty = '(none)'): string =>
  `${heading}\n${items.length > 0 ? items.map((item) => `* ${item}`).join('\n') : empty}`;

const extractSnapshotActiveBlockers = (planContent: string): string[] =>
  extractActiveBlockers(planContent).filter((blocker) => blocker !== '## Blockers');

export const workflowContextSnapshotRelativePath = (planName: string): string =>
  rel('.ai', 'artifacts', planName, 'state', 'context.md');

const workflowContextSnapshotAbsolutePath = (rootDir: string, planName: string): string =>
  path.join(rootDir, workflowContextSnapshotRelativePath(planName));

export const generateWorkflowContextSnapshot = ({
  planName,
  planPath,
  planContent,
  latestTokenUsage,
}: {
  planName: string;
  planPath: string;
  planContent: string;
  latestTokenUsage?: WorkflowContextSnapshotTokenUsage;
}): string => {
  const validation = extractLatestValidationSummary(planContent);
  const review = extractLatestReviewSummary(planContent);
  const reviewRemediationContext = extractLatestReviewRemediationContext(planContent);
  const tokenSummary = summarizeLatestTokenUsage(latestTokenUsage);

  return `# Workflow Context Snapshot: ${planName}

## Plan Path

${planPath}

## Current State

* Status: ${extractSectionValue(planContent, '## Status') ?? '(missing)'}
* Next Action: ${extractSectionValue(planContent, '## Next Action') ?? '(missing)'}

${formatSnapshotSection('## Spec Paths', extractSpecPaths(planContent))}

## Plan-Owned Files

${extractPlanOwnedFileSection(planContent).length > 0 ? extractPlanOwnedFileSection(planContent).join('\n') : '(none)'}

${formatSnapshotSection('## Summary', extractCurrentPhaseSummary(planContent))}

${formatSnapshotSection('## Key Details', extractLatestExecutionSummary(planContent))}

## Validation

* Result: ${validation.result ?? '(none recorded)'}
${validation.details.length > 0 ? validation.details.map((detail) => `* ${detail}`).join('\n') : '(none)'}

## Review

* Summary: ${review.summary ?? '(none recorded)'}
* Decision: ${review.decision ?? '(none recorded)'}
* Evidence: ${review.evidence ?? '(none recorded)'}
${formatSnapshotSection('### Unresolved Findings', review.unresolvedFindings)}

${formatSnapshotSection('## Latest Review Remediation Context', reviewRemediationContext)}

${formatSnapshotSection('## Active Blockers', extractSnapshotActiveBlockers(planContent))}

${formatSnapshotSection('## Latest Token Usage Summary', tokenSummary)}
`;
};

const selectInstructionPaths = (planContent: string): string[] => {
  const planOwnedPaths = extractPlanOwnedPaths(planContent);
  const selected = new Set<string>();
  const packageOwners = new Set<string>();

  for (const filePath of planOwnedPaths) {
    if (filePath.startsWith('.ai/')) {
      selected.add(rel('.ai', 'instructions', 'ai-workflow.md'));
    }
    if (filePath.startsWith('apps/web/')) {
      selected.add(rel('.ai', 'instructions', 'web.md'));
      packageOwners.add('apps/web');
    }
    if (filePath.startsWith('apps/admin/')) {
      selected.add(rel('.ai', 'instructions', 'admin.md'));
      packageOwners.add('apps/admin');
    }
    if (filePath.startsWith('apps/backend/')) {
      selected.add(rel('.ai', 'instructions', 'backend.md'));
      packageOwners.add('apps/backend');
    }
    if (filePath.startsWith('supabase/') || filePath.startsWith('packages/supabase/')) {
      selected.add(rel('.ai', 'instructions', 'supabase.md'));
      packageOwners.add(filePath.startsWith('supabase/') ? 'supabase' : 'packages/supabase');
    }
    if (
      filePath.includes('/src/components/ui/') ||
      filePath.includes('/components/ui/') ||
      /\bshadcn\b/i.test(filePath)
    ) {
      selected.add(rel('.ai', 'instructions', 'ui.md'));
    }
    if (
      filePath.startsWith('apps/web/src/messages/') ||
      filePath.startsWith('apps/web/src/i18n/') ||
      filePath.startsWith('apps/admin/src/locales/') ||
      filePath.startsWith('apps/admin/src/i18n/')
    ) {
      selected.add(rel('.ai', 'instructions', 'i18n.md'));
    }
    if (/(^|\/)(auth|session|sessions|role|roles|guard|guards)(\/|\.|-)/i.test(filePath)) {
      selected.add(rel('.ai', 'instructions', 'auth.md'));
    }
    if (
      /(^|\/)(test|tests|e2e)\//i.test(filePath) ||
      /\.(test|spec)\.[cm]?[tj]sx?$/i.test(filePath) ||
      /(^|\/)(jest|vitest|playwright)\.config\./i.test(filePath) ||
      /(^|\/)package\.json$/i.test(filePath)
    ) {
      selected.add(rel('.ai', 'instructions', 'shared', 'testing.md'));
    }
  }

  if (/\bshadcn\b/i.test(planContent)) {
    selected.add(rel('.ai', 'instructions', 'ui.md'));
  }
  if (packageOwners.size > 1 || (planOwnedPaths.length > 0 && selected.size === 0)) {
    selected.add(rel('.ai', 'instructions', 'architecture.md'));
  }

  return orderedInstructionPaths.filter((instructionPath) => selected.has(instructionPath));
};

const activeContextPacket = ({
  promptPath,
  planPath,
  planContent,
  contextSnapshotPath = workflowContextSnapshotRelativePath(path.posix.basename(planPath, '.md')),
}: {
  promptPath: string;
  planPath: string;
  planContent: string;
  contextSnapshotPath?: string;
}): string => {
  const warmPaths = uniquePaths([
    rel('.codex', 'AGENTS.md'),
    promptPath,
    contextSnapshotPath,
    rel('.ai', 'instructions', 'index.md'),
    ...(stateMachinePromptPaths.has(promptPath)
      ? [rel('.ai', 'instructions', 'shared', 'workflow-state.md')]
      : []),
    ...extractSpecPaths(planContent),
    ...selectInstructionPaths(planContent),
  ]);

  return `Active Context Packet:
Load exactly these warm context files:
${warmPaths.map((warmPath) => `- ${warmPath}`).join('\n')}

Use the Active Context Packet and index-selected instruction files only. Do not broadly load \`.ai/instructions/**\`.

Artifact loading rule:
- Use ${contextSnapshotPath} first.
- Open event artifacts only when the snapshot references them and specific evidence is needed.
- Do not broadly load \`.ai/artifacts/**\`.
`;
};

const defaultConsole: ConsoleLike = console;

const failure = (reason: string, iterations = 0, exitCode = 1): RunnerResult => ({
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

const extractSectionValue = (content: string, heading: string): string | null => {
  const lines = content.split(/\r?\n/);
  const headingIndex = lines.findIndex((line) => line.trim() === heading);
  if (headingIndex === -1) {
    return null;
  }
  for (const line of lines.slice(headingIndex + 1)) {
    const trimmed = line.trim();
    if (trimmed.startsWith('##')) {
      return '';
    }
    if (trimmed.length > 0) {
      return trimmed;
    }
  }
  return '';
};

const normalizeWorkflowStateValue = (value: string): string => value.replace(/^`+|`+$/g, '');

const isStatus = (value: string): value is Status => VALID_STATUSES.includes(value as Status);
const isNextAction = (value: string): value is NextAction =>
  VALID_NEXT_ACTIONS.includes(value as NextAction);

type ThinPlanV2WorkflowState = {
  planPath: string;
  status: Status;
  nextAction: NextAction;
  latest?: Record<string, unknown>;
  history?: string[];
  unresolvedBlockers: string[];
  updatedAt: string;
};

type ThinPlanV2FilesState = {
  created: string[];
  modified: string[];
  deleted: string[];
  changedFiles: string[];
  released: string[];
  headSha: string;
  workflow?: {
    status?: string;
    nextAction?: string;
  };
};

const thinPlanV2ArtifactPath = (planName: string, ...segments: string[]): string =>
  rel('.ai', 'artifacts', planName, ...segments);

const readJsonArtifact = async (
  rootDir: string,
  relativePath: string,
): Promise<unknown | Failure> => {
  let raw: string;
  try {
    raw = await readFile(path.join(rootDir, relativePath), 'utf8');
  } catch (error) {
    return { ok: false, reason: `thin-plan-v2 artifact cannot be read: ${relativePath}: ${String(error)}` };
  }
  try {
    return JSON.parse(raw) as unknown;
  } catch {
    return { ok: false, reason: `thin-plan-v2 artifact is malformed JSON: ${relativePath}` };
  }
};

const parseThinPlanV2WorkflowState = (
  raw: unknown,
  expectedPlanPath: string,
  artifactPath: string,
): ThinPlanV2WorkflowState | Failure => {
  const record = asRecord(raw);
  const planPath = record?.planPath;
  const status = record?.status;
  const nextAction = record?.nextAction;
  const updatedAt = record?.updatedAt;
  const unresolvedBlockers = asStringArray(record?.unresolvedBlockers) ?? [];
  const history = asStringArray(record?.history);

  if (
    typeof planPath !== 'string' ||
    planPath !== expectedPlanPath ||
    typeof status !== 'string' ||
    !isStatus(status) ||
    typeof nextAction !== 'string' ||
    !isNextAction(nextAction) ||
    typeof updatedAt !== 'string'
  ) {
    return { ok: false, reason: `thin-plan-v2 workflow state is malformed: ${artifactPath}` };
  }

  return {
    planPath,
    status,
    nextAction,
    latest: asRecord(record?.latest) ?? undefined,
    history,
    unresolvedBlockers,
    updatedAt,
  };
};

const parseThinPlanV2FilesState = (
  raw: unknown,
  artifactPath: string,
): ThinPlanV2FilesState | Failure => {
  const record = asRecord(raw);
  const created = asStringArray(record?.created);
  const modified = asStringArray(record?.modified);
  const deleted = asStringArray(record?.deleted);
  const changedFiles = asStringArray(record?.changedFiles);
  const released = asStringArray(record?.released);
  const headSha = record?.headSha;
  if (!created || !modified || !deleted || !changedFiles || !released || typeof headSha !== 'string') {
    return { ok: false, reason: `thin-plan-v2 files state is malformed: ${artifactPath}` };
  }
  const workflow = asRecord(record?.workflow);
  return {
    created,
    modified,
    deleted,
    changedFiles,
    released,
    headSha,
    workflow: workflow
      ? {
          status: typeof workflow.status === 'string' ? workflow.status : undefined,
          nextAction: typeof workflow.nextAction === 'string' ? workflow.nextAction : undefined,
        }
      : undefined,
  };
};

const readTextArtifact = async (
  rootDir: string,
  relativePath: string,
): Promise<{ ok: true; content: string } | Failure> => {
  try {
    return { ok: true, content: await readFile(path.join(rootDir, relativePath), 'utf8') };
  } catch (error) {
    return { ok: false, reason: `thin-plan-v2 artifact cannot be read: ${relativePath}: ${String(error)}` };
  }
};

const replaceManifestWorkflowValue = (content: string, heading: string, value: string): string => {
  const lines = content.split(/\r?\n/);
  const headingIndex = lines.findIndex((line) => line.trim() === heading);
  if (headingIndex === -1) {
    return content;
  }
  for (let index = headingIndex + 1; index < lines.length; index += 1) {
    if (lines[index].trim().startsWith('##')) {
      return content;
    }
    if (lines[index].trim().length > 0) {
      lines[index] = value;
      return lines.join('\n');
    }
  }
  lines.splice(headingIndex + 1, 0, '', value);
  return lines.join('\n');
};

const demoteMarkdownHeadings = (content: string): string =>
  content
    .replace(/^### /gm, '##### ')
    .replace(/^## /gm, '#### ')
    .replace(/^# /gm, '### ');

const fileSectionBullets = (paths: string[]): string =>
  (paths.length > 0 ? paths : ['None']).map((filePath) => `* ${filePath}`).join('\n');

const latestRecord = (
  workflow: ThinPlanV2WorkflowState,
  kind: string,
): Record<string, unknown> | undefined => asRecord(workflow.latest?.[kind]);

const latestNumber = (record: Record<string, unknown> | undefined): number | undefined =>
  typeof record?.version === 'number' && Number.isInteger(record.version) && record.version > 0
    ? record.version
    : undefined;

const latestString = (
  record: Record<string, unknown> | undefined,
  key: string,
): string | undefined => (typeof record?.[key] === 'string' ? record[key] : undefined);

const synthesizeLatestEventSection = ({
  heading,
  label,
  stateField,
  stateValue,
  latest,
  unresolvedFindings,
}: {
  heading: string;
  label: string;
  stateField: 'Result' | 'Decision' | 'Status';
  stateValue?: string;
  latest: Record<string, unknown> | undefined;
  unresolvedFindings?: string[];
}): string => {
  const version = latestNumber(latest);
  if (!version) {
    return `## ${heading}\n\n(empty)\n`;
  }
  const lines = [
    `## ${heading}`,
    '',
    `### ${label} v${version}`,
    '',
    `* Summary: ${latestString(latest, 'summary') ?? '(none recorded)'}`,
    `* ${stateField}: ${stateValue ?? '(none recorded)'}`,
  ];
  const evidence = latestString(latest, 'evidence');
  if (evidence) {
    lines.push(`* Evidence: ${evidence}`);
  }
  if (unresolvedFindings && unresolvedFindings.length > 0) {
    lines.push('* Issues:', ...unresolvedFindings.map((finding) => `  * ${finding}`));
  }
  return `${lines.join('\n')}\n`;
};

const synthesizeThinPlanV2Content = ({
  manifestContent,
  workflow,
  files,
  fileOwnership,
  implementationMap,
}: {
  manifestContent: string;
  workflow: ThinPlanV2WorkflowState;
  files: ThinPlanV2FilesState;
  fileOwnership: FileOwnershipArtifact;
  implementationMap: string;
}): string => {
  let content = replaceManifestWorkflowValue(manifestContent, '## Status', workflow.status);
  content = replaceManifestWorkflowValue(content, '## Next Action', workflow.nextAction);
  const validation = latestRecord(workflow, 'validation');
  const review = latestRecord(workflow, 'review');
  const execution = latestRecord(workflow, 'execution');
  const unblock = latestRecord(workflow, 'unblock');
  const reopen = latestRecord(workflow, 'reopen');
  const reviewFindings = asStringArray(review?.unresolvedFindings) ?? [];
  const blockerLines =
    workflow.unresolvedBlockers.length > 0
      ? [
          '## Blockers',
          '',
          ...workflow.unresolvedBlockers.flatMap((blocker, index) => [
            `### Blocker v${index + 1}`,
            '',
            `* Description: ${blocker}`,
            '* Status: active',
            '',
          ]),
        ].join('\n')
      : '## Blockers\n\n(empty)\n';

  const releases =
    fileOwnership.released.length > 0
      ? `## File Ownership Releases

${fileOwnership.released
  .map(
    (filePath, index) => `### Release v${index + 1}

* File: ${filePath}
* Status: transferred`,
  )
  .join('\n\n')}
`
      : '';

  return `${content.trimEnd()}

## Implementation Map

${demoteMarkdownHeadings(implementationMap).trim()}

## Ownership Scope

${fileSectionBullets(fileOwnership.owns)}

${releases}## Files (MANDATORY)

### Created files

${fileSectionBullets(files.created)}

### Modified files

${fileSectionBullets(files.modified)}

### Deleted files

${fileSectionBullets(files.deleted)}

${synthesizeLatestEventSection({
  heading: 'Execution Log',
  label: 'Execution',
  stateField: 'Result',
  stateValue: latestString(execution, 'result'),
  latest: execution,
})}
${synthesizeLatestEventSection({
  heading: 'Validation History',
  label: 'Validation',
  stateField: 'Result',
  stateValue: latestString(validation, 'result'),
  latest: validation,
})}
${synthesizeLatestEventSection({
  heading: 'Review History',
  label: 'Review',
  stateField: 'Decision',
  stateValue: latestString(review, 'decision'),
  latest: review,
  unresolvedFindings: reviewFindings,
})}
${synthesizeLatestEventSection({
  heading: 'Unblock History',
  label: 'Unblock',
  stateField: 'Status',
  stateValue: latestString(unblock, 'status'),
  latest: unblock,
})}
${synthesizeLatestEventSection({
  heading: 'Reopen History',
  label: 'Reopen',
  stateField: 'Status',
  stateValue: latestString(reopen, 'status'),
  latest: reopen,
})}
${blockerLines}`;
};

const loadThinPlanV2WorkingContent = async ({
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
  const workflowPath = thinPlanV2ArtifactPath(planName, 'state', 'workflow.json');
  const filesPath = thinPlanV2ArtifactPath(planName, 'state', 'files.json');
  const fileOwnershipPath = thinPlanV2ArtifactPath(planName, 'state', 'file-ownership.json');
  const implementationMapPath = thinPlanV2ArtifactPath(planName, 'implementation-map.md');

  const workflowJson = await readJsonArtifact(rootDir, workflowPath);
  if (isFailure(workflowJson)) {
    return workflowJson;
  }
  const workflow = parseThinPlanV2WorkflowState(workflowJson, planPath, workflowPath);
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
  const fileOwnership = parseFileOwnershipArtifact(JSON.stringify(ownershipRaw), fileOwnershipPath);
  if (isFailure(fileOwnership)) {
    return fileOwnership;
  }

  const implementationMap = await readTextArtifact(rootDir, implementationMapPath);
  if (!implementationMap.ok) {
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
  if (!normalized.ok) {
    return normalized;
  }

  const planPath = normalized.planPath;
  const absolutePlanPath = path.join(rootDir, planPath);
  if (!existsSync(absolutePlanPath)) {
    return { ok: false, reason: `plan file does not exist: ${planPath}` };
  }

  let content: string;
  try {
    content = await readFile(absolutePlanPath, 'utf8');
  } catch (error) {
    return { ok: false, reason: `plan file cannot be read: ${planPath}: ${String(error)}` };
  }

  const extractedStatus = extractSectionValue(content, '## Status');
  if (extractedStatus === null) {
    return { ok: false, reason: 'plan is missing ## Status' };
  }
  const rawStatus = normalizeWorkflowStateValue(extractedStatus);
  if (rawStatus.length === 0) {
    return { ok: false, reason: 'plan status value is empty' };
  }
  if (!isStatus(rawStatus)) {
    return { ok: false, reason: `unknown status value: ${rawStatus}` };
  }

  const extractedNextAction = extractSectionValue(content, '## Next Action');
  if (extractedNextAction === null) {
    return { ok: false, reason: 'plan is missing ## Next Action' };
  }
  const rawNextAction = normalizeWorkflowStateValue(extractedNextAction);
  if (rawNextAction.length === 0) {
    return { ok: false, reason: 'plan next action value is empty' };
  }
  if (!isNextAction(rawNextAction)) {
    return { ok: false, reason: `unknown next action value: ${rawNextAction}` };
  }

  const thinPlan = await validateThinPlanContract({
    rootDir,
    planName: normalized.planName,
    content,
  });
  if (!thinPlan.ok) {
    return thinPlan;
  }

  if (thinPlan.contract === 'thin-plan-v2') {
    const loaded = await loadThinPlanV2WorkingContent({
      rootDir,
      planName: normalized.planName,
      planPath,
      manifestContent: content,
    });
    if (!loaded.ok) {
      return loaded;
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

const routeFor = (status: Status, nextAction: NextAction): Route => {
  const promptPath = promptRoutes[`${status}|${nextAction}`];
  if (!promptPath) {
    return {
      executable: false,
      reason: `undefined status/next action pair: ${status} + ${nextAction}`,
    };
  }

  return {
    executable: true,
    promptPath,
    terminal: status === 'completed' && nextAction === 'commit-summary',
  };
};

const readPrompt = async (
  rootDir: string,
  promptPath: string,
): Promise<{ ok: true; content: string } | Failure> => {
  const absolutePromptPath = path.join(rootDir, promptPath);
  if (!existsSync(absolutePromptPath)) {
    return { ok: false, reason: `prompt file does not exist: ${promptPath}` };
  }
  try {
    return { ok: true, content: await readFile(absolutePromptPath, 'utf8') };
  } catch (error) {
    return { ok: false, reason: `prompt file cannot be read: ${promptPath}: ${String(error)}` };
  }
};

export const generateWorkflowPrompt = ({
  promptPath,
  planPath,
  promptContent,
  planContent = '',
  contextSnapshotPath = workflowContextSnapshotRelativePath(path.posix.basename(planPath, '.md')),
  reviewStagingPaths = [],
  commitSummaryPaths = [],
  unblockNote,
  executeTokenGuardrail,
  taskContext,
  taskSavepointAggregateSummary = false,
}: {
  promptPath: string;
  planPath: string;
  promptContent: string;
  planContent?: string;
  contextSnapshotPath?: string;
  reviewStagingPaths?: string[];
  commitSummaryPaths?: string[];
  unblockNote?: string;
  executeTokenGuardrail?: ExecuteTokenGuardrail;
  taskContext?: WorkflowTaskContext;
  taskSavepointAggregateSummary?: boolean;
}): string => {
  const actionLabel = promptActionLabels[promptPath];
  if (!actionLabel) {
    throw new Error(`unknown workflow prompt path: ${promptPath}`);
  }

  const reviewBoundary =
    promptPath === rel('.ai', 'prompts', 'review-changes.md') && reviewStagingPaths.length > 0
      ? `
Plan-scoped diff boundary:
Use only these plan-owned staged paths:
${reviewStagingPaths.map((stagingPath) => `- ${stagingPath}`).join('\n')}

Run these exact commands for the review diff source:
git diff --staged --name-status -- ${shellPathspecs(reviewStagingPaths)}
git diff --staged -- ${shellPathspecs(reviewStagingPaths)}

Ignore staged files outside this path list. Do not run bare \`git diff --staged\` as the primary review source.
The runner may auto-unstage clearly unrelated staged hunks from these paths before review. Review the remaining path-scoped staged diff only.
Do not unstage or alter unrelated files.
If the path-scoped staged diff is empty, output \`STOP\` with reason \`no staged changes to review\`.
If unrelated changes remain after runner cleanup, output \`STOP\` with reason \`non plan-scoped changes detected\`.
`
      : '';
  const commitBoundary =
    promptPath === rel('.ai', 'prompts', 'commit-summary.md') &&
    commitSummaryPaths.length > 0 &&
    !taskSavepointAggregateSummary
      ? `
Plan-scoped commit boundary:
Use only these non-ignored plan-owned implementation paths:
${commitSummaryPaths.map((stagingPath) => `- ${stagingPath}`).join('\n')}

Run these exact commands before generating the commit message and summary:
git status --short -- ${shellPathspecs(commitSummaryPaths)}
git diff --name-status -- ${shellPathspecs(commitSummaryPaths)}
git add --all -- ${shellPathspecs(commitSummaryPaths)}
git diff --staged --name-status -- ${shellPathspecs(commitSummaryPaths)}
git commit -m "<generated message>" -- ${shellPathspecs(commitSummaryPaths)}

Do not stage .ai files. Do not stage or inspect unrelated paths as commit candidates.
If no files are staged by the path-scoped git add, output \`STOP\` with reason \`no plan-related files to stage\`.
`
      : '';
  const taskSavepointBoundary = taskContext
    ? `
Task savepoint current task:
- Task ID: ${taskContext.task.id}
- Task Words: ${taskContext.task.words}
- Task Name: ${taskContext.task.name}
- Task Stage: ${taskContext.stage}
- Task Artifact: ${taskContext.artifactPath}

Task savepoint rules:
- Work only on the current task above.
- Do not start another \`[task:...]\` item in the same run.
- Keep \`.ai/\` artifacts out of git commits.
- If this stage cannot complete for the current task, output \`STOP\` and keep the same current task active for remediation.
`
    : '';
  const taskAggregateBoundary =
    promptPath === rel('.ai', 'prompts', 'commit-summary.md') && taskSavepointAggregateSummary
      ? `
Task savepoint aggregate summary:
All named plan tasks already have task artifacts under ${taskArtifactsRelativeDir(
          path.posix.basename(planPath, '.md'),
        )}.
Do not create a git commit in this aggregate summary stage.
Verify no remaining plan-owned changes exist, then summarize the task commits and artifacts.
`
      : '';
  const unblockEvidence =
    promptPath === rel('.ai', 'prompts', 'unblock-plan.md')
      ? `
Unblock evidence note:
${unblockNote?.trim() ? unblockNote.trim() : '(none provided)'}
`
      : '';
  const executeGuardrail =
    promptPath === rel('.ai', 'prompts', 'execute-plan.md') && executeTokenGuardrail
      ? `
Execute token guardrail:
The previous stage exceeded token thresholds.
- Use the snapshot as the default source for this run.
- Open the full plan or event artifacts only when exact detail is required for the current task.
- Do not broadly load \`.ai/artifacts/**\` or full historical plan sections.
- If fallback context is needed, open only the exact plan section or exact event file needed for the current fix.
`
      : '';
  const subAgentGuidance = [
    rel('.ai', 'prompts', 'plan-validator.md'),
    rel('.ai', 'prompts', 'fix-plan.md'),
    rel('.ai', 'prompts', 'execute-plan.md'),
    rel('.ai', 'prompts', 'review-changes.md'),
    rel('.ai', 'prompts', 'fix-review.md'),
    rel('.ai', 'prompts', 'reopen-plan.md'),
  ].includes(promptPath)
    ? '\nuse sub-agents'
    : '';

  return `Use ${promptPath}

load: .ai/prompts/superpowers.md
Superpower skill root: ${SUPERPOWER_SKILL_ROOT}
When loading superpower skills, use this root, for example:
- ${path.join(SUPERPOWER_SKILL_ROOT, 'using-superpowers', 'SKILL.md')}
- ${path.join(SUPERPOWER_SKILL_ROOT, 'executing-plans', 'SKILL.md')}
- ${path.join(SUPERPOWER_SKILL_ROOT, 'subagent-driven-development', 'SKILL.md')}
Do not read superpower skills from ${SHARED_SKILL_ROOT}; that root contains separate shared/caveman skills only.
Apply the superpowers advisory guidance for analysis and edge-case checks.${subAgentGuidance}

${activeContextPacket({ promptPath, planPath, planContent, contextSnapshotPath })}
${executeGuardrail}

${taskSavepointBoundary}${taskAggregateBoundary}

${actionLabel}:
${planPath}${reviewBoundary}${commitBoundary}${unblockEvidence}

Workflow prompt content:
<workflow-prompt>
${promptContent.trimEnd()}
</workflow-prompt>
`;
};

const appendLog = async (
  rootDir: string,
  planName: string,
  fields: Array<[string, string | number | undefined]>,
): Promise<{ ok: true } | Failure> => {
  const logDir = path.join(rootDir, '.ai', 'artifacts', planName, 'logs');
  const logPath = path.join(logDir, 'runner.log');
  try {
    await mkdir(logDir, { recursive: true });
    const body = ['---', ...fields.map(([key, value]) => `${key}: ${value ?? ''}`), ''].join('\n');
    await writeFile(logPath, body, { flag: 'a' });
    return { ok: true };
  } catch (error) {
    return { ok: false, reason: `workflow log cannot be created or appended: ${String(error)}` };
  }
};

const taskArtifactsRelativeDir = (planName: string): string =>
  rel('.ai', 'artifacts', planName, 'tasks');

const currentTaskRelativePath = (planName: string): string =>
  rel('.ai', 'artifacts', planName, 'state', 'current-task.md');

const taskArtifactFilePrefix = (task: PlanTask): string => `${task.id}-${task.artifactWords}-v`;

const existingTaskArtifactVersions = async (
  rootDir: string,
  planName: string,
  task: PlanTask,
): Promise<number[]> => {
  const taskDir = path.join(rootDir, taskArtifactsRelativeDir(planName));
  let entries: string[];
  try {
    entries = await readdir(taskDir);
  } catch (error) {
    const code = (error as NodeJS.ErrnoException).code;
    if (code === 'ENOENT') {
      return [];
    }
    throw error;
  }
  const prefix = taskArtifactFilePrefix(task);
  return entries
    .map((entry) => {
      if (!entry.startsWith(prefix) || !entry.endsWith('.md')) {
        return undefined;
      }
      const version = Number(entry.slice(prefix.length, -'.md'.length));
      return Number.isInteger(version) && version > 0 ? version : undefined;
    })
    .filter((version): version is number => typeof version === 'number')
    .sort((a, b) => a - b);
};

const taskCompleted = async (
  rootDir: string,
  planName: string,
  task: PlanTask,
): Promise<boolean> => {
  const taskDir = path.join(rootDir, taskArtifactsRelativeDir(planName));
  let entries: string[];
  try {
    entries = await readdir(taskDir);
  } catch (error) {
    const code = (error as NodeJS.ErrnoException).code;
    if (code === 'ENOENT') {
      return false;
    }
    throw error;
  }
  return entries.some((entry) => entry.startsWith(`${task.id}-`) && entry.endsWith('.md'));
};

const nextIncompleteTask = async (
  rootDir: string,
  planName: string,
  tasks: PlanTask[],
): Promise<PlanTask | undefined> => {
  for (const task of tasks) {
    if (!(await taskCompleted(rootDir, planName, task))) {
      return task;
    }
  }
  return undefined;
};

const nextTaskArtifactRelativePath = async (
  rootDir: string,
  planName: string,
  task: PlanTask,
): Promise<string> => {
  const versions = await existingTaskArtifactVersions(rootDir, planName, task);
  const nextVersion = (versions.at(-1) ?? 0) + 1;
  return rel(taskArtifactsRelativeDir(planName), `${task.id}-${task.artifactWords}-v${nextVersion}.md`);
};

const formatTaskProgressLine = ({
  task,
  stage,
  detail,
}: {
  task: PlanTask;
  stage: TaskStage;
  detail: string;
}): string => `TASK ${task.id} | ${stage} | ${detail}`;

const writeCurrentTaskPointer = async ({
  rootDir,
  planName,
  planPath,
  context,
  timestamp,
}: {
  rootDir: string;
  planName: string;
  planPath: string;
  context: WorkflowTaskContext;
  timestamp: string;
}): Promise<{ ok: true } | Failure> => {
  const pointerPath = path.join(rootDir, currentTaskRelativePath(planName));
  const body = `# Current Task

* Plan: ${planPath}
* Task ID: ${context.task.id}
* Task Words: ${context.task.words}
* Task Name: ${context.task.name}
* Stage: ${context.stage}
* Task Artifact: ${context.artifactPath}
* Commit SHA: ${context.commitSha ?? '(pending)'}
* Updated At: ${timestamp}
`;
  try {
    await mkdir(path.dirname(pointerPath), { recursive: true });
    await writeFile(pointerPath, body, 'utf8');
    return { ok: true };
  } catch (error) {
    return { ok: false, reason: `current task pointer cannot be written: ${String(error)}` };
  }
};

const writeTaskArtifact = async ({
  rootDir,
  planName,
  planPath,
  context,
  changedFiles,
  validationSummary,
  reviewResult,
  commitMessage,
  nextTask,
}: {
  rootDir: string;
  planName: string;
  planPath: string;
  context: WorkflowTaskContext;
  changedFiles: string[];
  validationSummary: string;
  reviewResult: string;
  commitMessage: string;
  nextTask?: PlanTask;
}): Promise<{ ok: true } | Failure> => {
  const artifactPath = path.join(rootDir, context.artifactPath);
  const body = `# Task Savepoint: ${context.task.id}

## Summary

${context.task.name}

## Plan

${planPath}

## Changed Files

${changedFiles.length > 0 ? changedFiles.map((file) => `* ${file}`).join('\n') : '* None'}

## Validation Evidence

${validationSummary}

## Review Result

${reviewResult}

## Commit SHA

${context.commitSha ?? '(unknown)'}

## Commit Message

${commitMessage}

## Task Artifact

${context.artifactPath}

## Next Task

${nextTask ? nextTask.id : '(none)'}
`;
  try {
    await mkdir(path.dirname(artifactPath), { recursive: true });
    await writeFile(artifactPath, body, 'utf8');
    return { ok: true };
  } catch (error) {
    return { ok: false, reason: `task artifact cannot be written: ${String(error)}` };
  }
};

const gitHeadShortSha = async (
  rootDir: string,
  processRunner: ProcessRunner,
): Promise<{ ok: true; sha: string } | Failure> => {
  const result = await processRunner({
    command: 'git',
    args: ['rev-parse', '--short', 'HEAD'],
    cwd: rootDir,
    input: '',
    promptPath: 'git-task-commit-sha',
  });
  if (!result.launched) {
    return { ok: false, reason: `could not launch task commit sha lookup: ${result.error}` };
  }
  if (result.exitCode !== 0) {
    return {
      ok: false,
      reason: `task commit sha lookup exited with code ${result.exitCode}: ${boundedInlineExcerpt(
        result.stderr || result.stdout,
      )}`,
    };
  }
  const sha = result.stdout.trim().split(/\s+/)[0] ?? '';
  if (!sha) {
    return { ok: false, reason: 'task commit sha lookup returned empty output' };
  }
  return { ok: true, sha };
};

const replaceSectionValueInPlan = (content: string, heading: string, value: string): string => {
  const lines = content.split(/\r?\n/);
  const headingIndex = lines.findIndex((line) => line.trim() === heading);
  if (headingIndex === -1) {
    return content;
  }
  let valueIndex = -1;
  for (let index = headingIndex + 1; index < lines.length; index += 1) {
    const trimmed = lines[index].trim();
    if (trimmed.startsWith('##')) {
      break;
    }
    if (trimmed.length > 0) {
      valueIndex = index;
      break;
    }
  }
  if (valueIndex === -1) {
    lines.splice(headingIndex + 1, 0, '', value);
  } else {
    lines[valueIndex] = value;
  }
  return lines.join('\n');
};

const reopenPlanForNextTask = async (
  plan: ParsedPlan,
): Promise<{ ok: true } | Failure> => {
  const nextContent = replaceSectionValueInPlan(
    replaceSectionValueInPlan(plan.content, '## Status', 'active'),
    '## Next Action',
    'execute-plan',
  );
  try {
    await writeFile(plan.absolutePlanPath, nextContent, 'utf8');
    return { ok: true };
  } catch (error) {
    return { ok: false, reason: `plan cannot be reopened for next task: ${String(error)}` };
  }
};

const failureDebugLedgerRelativePath = (planName: string): string =>
  rel('.ai', 'artifacts', planName, 'logs', 'failure.jsonl');

const failureDebugLedgerAbsolutePath = (rootDir: string, planName: string): string =>
  path.join(rootDir, failureDebugLedgerRelativePath(planName));

const appendFailureDebugLedger = async (
  rootDir: string,
  planName: string,
  entry: WorkflowFailureDebugRecord,
): Promise<{ ok: true; pointer: string } | Failure> => {
  const logPath = failureDebugLedgerAbsolutePath(rootDir, planName);
  let existingLineCount = 0;

  try {
    const existing = await readFile(logPath, 'utf8');
    existingLineCount = existing.split(/\r?\n/).filter(Boolean).length;
  } catch (error) {
    const code = (error as NodeJS.ErrnoException).code;
    if (code !== 'ENOENT') {
      return {
        ok: false,
        reason: `workflow failure debug log cannot be read: ${String(error)}`,
      };
    }
  }

  try {
    await mkdir(path.dirname(logPath), { recursive: true });
    await writeFile(logPath, `${JSON.stringify(entry)}\n`, { flag: 'a' });
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
  rel('.ai', 'artifacts', planName, 'logs', 'token-usage.jsonl');

const tokenUsageLedgerAbsolutePath = (rootDir: string, planName: string): string =>
  path.join(rootDir, tokenUsageLedgerRelativePath(planName));

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
  return Object.values(totals).every((value) => isFiniteNumber(value) && value >= 0)
    ? (totals as TokenUsageTotals)
    : undefined;
};

const readTokenUsageTotals = async (
  rootDir: string,
  planName: string,
): Promise<TokenUsageTotals> => {
  try {
    const content = await readFile(tokenUsageLedgerAbsolutePath(rootDir, planName), 'utf8');
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
  stageInputTokens: isFiniteNumber(record.stageInputTokens) ? record.stageInputTokens : null,
  stageCachedInputTokens: isFiniteNumber(record.stageCachedInputTokens)
    ? record.stageCachedInputTokens
    : null,
  stageUncachedInputTokens: isFiniteNumber(record.stageUncachedInputTokens)
    ? record.stageUncachedInputTokens
    : null,
  stageOutputTokens: isFiniteNumber(record.stageOutputTokens) ? record.stageOutputTokens : null,
  stageReasoningOutputTokens: isFiniteNumber(record.stageReasoningOutputTokens)
    ? record.stageReasoningOutputTokens
    : null,
  stageTotalTokens: isFiniteNumber(record.stageTotalTokens) ? record.stageTotalTokens : null,
  totalTokens: isFiniteNumber(record.totalTokens) ? record.totalTokens : null,
});

const readLatestTokenUsage = async (
  rootDir: string,
  planName: string,
): Promise<WorkflowContextSnapshotTokenUsage | undefined> => {
  try {
    const content = await readFile(tokenUsageLedgerAbsolutePath(rootDir, planName), 'utf8');
    const lines = content.trim().split(/\r?\n/).filter(Boolean).reverse();
    for (const line of lines) {
      try {
        const parsed = asRecord(JSON.parse(line));
        if (!parsed) {
          continue;
        }
        return toWorkflowContextSnapshotTokenUsage(parsed);
      } catch {
        continue;
      }
    }
  } catch {
    return undefined;
  }
  return undefined;
};

const readExecuteTokenGuardrail = async ({
  rootDir,
  planName,
  promptPath,
}: {
  rootDir: string;
  planName: string;
  promptPath: string;
}): Promise<ExecuteTokenGuardrail | undefined> => {
  if (promptPath !== EXECUTE_PLAN_PROMPT_PATH) {
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

const writeWorkflowContextSnapshot = async ({
  rootDir,
  plan,
}: {
  rootDir: string;
  plan: ParsedPlan;
}): Promise<WorkflowContextSnapshotResult | Failure> => {
  const latestTokenUsage = await readLatestTokenUsage(rootDir, plan.planName);
  const snapshotPath = workflowContextSnapshotRelativePath(plan.planName);
  const snapshot = generateWorkflowContextSnapshot({
    planName: plan.planName,
    planPath: plan.planPath,
    planContent: plan.content,
    latestTokenUsage,
  });

  try {
    await mkdir(path.dirname(workflowContextSnapshotAbsolutePath(rootDir, plan.planName)), {
      recursive: true,
    });
    await writeFile(workflowContextSnapshotAbsolutePath(rootDir, plan.planName), snapshot, 'utf8');
    return { ok: true, snapshotPath };
  } catch (error) {
    return {
      ok: false,
      reason: `workflow context snapshot cannot be written: ${String(error)}`,
    };
  }
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
    cachedInputTokens: totals.cachedInputTokens + (usage.cachedInputTokens ?? 0),
    uncachedInputTokens: totals.uncachedInputTokens + (usage.uncachedInputTokens ?? 0),
    outputTokens: totals.outputTokens + (usage.outputTokens ?? 0),
    reasoningOutputTokens: totals.reasoningOutputTokens + (usage.reasoningOutputTokens ?? 0),
    totalTokens: totals.totalTokens + (usage.totalTokens ?? 0),
  };
};

const appendTokenUsageLedger = async (
  rootDir: string,
  planName: string,
  entry: Record<string, unknown>,
): Promise<{ ok: true } | Failure> => {
  try {
    await mkdir(path.dirname(tokenUsageLedgerAbsolutePath(rootDir, planName)), { recursive: true });
    await writeFile(tokenUsageLedgerAbsolutePath(rootDir, planName), `${JSON.stringify(entry)}\n`, {
      flag: 'a',
    });
    return { ok: true };
  } catch (error) {
    return {
      ok: false,
      reason: `token usage ledger cannot be created or appended: ${String(error)}`,
    };
  }
};

const defaultProcessRunner: ProcessRunner = (call) =>
  new Promise((resolve) => {
    const executable = call.binaryCommand
      ? {
          command: call.binaryCommand,
          args: call.args,
          env: call.env ?? process.env,
        }
      : {
          command: call.command,
          args: call.args,
          env: call.env ?? process.env,
        };

    const child = spawn(executable.command, executable.args, {
      cwd: call.cwd,
      env: executable.env,
      stdio: processStdioForInput(call.input),
    });
    let stdout = '';
    let stderr = '';
    let stdinError = '';
    let settled = false;

    child.stdout?.setEncoding('utf8');
    child.stderr?.setEncoding('utf8');
    child.stdout?.on('data', (chunk) => {
      stdout += chunk;
      call.onStdout?.(chunk);
    });
    child.stderr?.on('data', (chunk) => {
      stderr += chunk;
      call.onStderr?.(chunk);
    });

    const abortChild = () => {
      const requestedSignal = call.abortSignal?.reason === 'SIGTERM' ? 'SIGTERM' : 'SIGINT';
      child.kill(requestedSignal);
    };

    if (call.abortSignal?.aborted) {
      abortChild();
    } else {
      call.abortSignal?.addEventListener('abort', abortChild, { once: true });
    }

    child.on('error', (error) => {
      if (settled) {
        return;
      }
      call.abortSignal?.removeEventListener('abort', abortChild);
      settled = true;
      resolve({
        launched: false,
        stdout,
        stderr: [stderr, stdinError].filter(Boolean).join('\n'),
        error: String(error),
      });
    });

    child.on('close', (exitCode, signal) => {
      if (settled) {
        return;
      }
      call.abortSignal?.removeEventListener('abort', abortChild);
      settled = true;
      resolve({
        launched: true,
        stdout,
        stderr: [stderr, stdinError].filter(Boolean).join('\n'),
        exitCode: exitCode ?? (signal === 'SIGINT' ? 130 : signal === 'SIGTERM' ? 143 : 1),
        exitSignal: signal,
      });
    });

    writeProcessInput(child.stdin, call.input, (error) => {
      stdinError = [stdinError, `stdin: ${String(error)}`].filter(Boolean).join('\n');
    });
  });

const sectionLines = (content: string, heading: string): string[] | null => {
  const lines = content.split(/\r?\n/);
  const start = lines.findIndex((line) => line.trim() === heading);
  if (start === -1) {
    return null;
  }
  const collected: string[] = [];
  for (const line of lines.slice(start + 1)) {
    if (line.trim().startsWith('## ')) {
      break;
    }
    collected.push(line);
  }
  return collected;
};

const extractLatestUnresolvedBlockerDetail = (content: string): string | undefined => {
  const lines = sectionLines(content, '## Blockers');
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
    blockerSections.length > 0 ? blockerSections : [{ heading: '## Blockers', lines }];
  for (const blocker of sections.slice().reverse()) {
    const resolved =
      /\bresolved\b/i.test(blocker.heading) ||
      blocker.lines.some((line) => /^\*\s*Status:\s*resolved\b/i.test(line.trim()));
    if (resolved) {
      continue;
    }

    const values = new Map<string, string>();
    for (const line of blocker.lines) {
      const match = line.trim().match(/^\*\s*(Description|Required Action|Next Step):\s*(.+)$/i);
      if (match) {
        values.set(match[1].toLowerCase(), match[2]);
      }
    }
    for (const field of ['description', 'required action', 'next step']) {
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
  const lines = sectionLines(content, '## Blockers');
  if (lines === null) {
    return false;
  }
  return /\b(browser|manual|viewport|devtools|computed-style|computed style)\b/i.test(
    lines.join('\n'),
  );
};

const simplifyBrowserValidationDetail = (detail: string): string =>
  detail
    .replace(/^mandatory\s+/i, '')
    .replace(/^browser validation cannot be performed because\s+/i, '')
    .replace(/^validation cannot be performed because\s+/i, '')
    .replace(/\.$/, '')
    .trim();

const blockedPlanDetail = (content: string): string => {
  const detail =
    extractLatestUnresolvedBlockerDetail(content) ??
    'Plan needs unblock evidence before execution can continue';
  if (!hasBrowserValidationBlockerSignal(content) || /^browser validation:/i.test(detail)) {
    return detail;
  }
  return `Browser validation: ${simplifyBrowserValidationDetail(detail)}`;
};

const blockedReasonSummary = (detail: string): { category: string; detail: string } => {
  const browserPrefix = 'Browser validation:';
  if (detail.toLowerCase().startsWith(browserPrefix.toLowerCase())) {
    return {
      category: 'BROWSER VALIDATION',
      detail: detail.slice(browserPrefix.length).trim(),
    };
  }
  return {
    category: 'BLOCKED',
    detail,
  };
};

const targetSubheadings = new Set(['### Created files', '### Modified files', '### Deleted files']);
const noReviewStagingPathPlaceholders = new Set([
  'none',
  'n/a',
  'na',
  'no file',
  'no files',
  'not applicable',
]);
const trailingPlanPathAnnotationPattern = /\s+\(([^)]+)\)$/;

const validateConcretePlanFilePath = async ({
  value,
  rootDir,
  reasonPrefix,
}: {
  value: string;
  rootDir: string;
  reasonPrefix: string;
}): Promise<{ ok: true; path: string } | Failure> => {
  if (value.length === 0) {
    return { ok: false, reason: `${reasonPrefix} is empty` };
  }
  const trailingAnnotation = value
    .match(trailingPlanPathAnnotationPattern)?.[1]
    ?.trim()
    .toLowerCase();
  if (trailingAnnotation !== undefined && trailingAnnotation !== 'assumed') {
    return {
      ok: false,
      reason: `${reasonPrefix} contains annotation; Files (MANDATORY) entries must be exact file paths: ${value}`,
    };
  }
  if (path.isAbsolute(value)) {
    return { ok: false, reason: `${reasonPrefix} is absolute: ${value}` };
  }
  if (value.includes('..')) {
    return { ok: false, reason: `${reasonPrefix} contains ..: ${value}` };
  }
  try {
    const pathStat = await stat(path.join(rootDir, value));
    if (pathStat.isDirectory()) {
      return { ok: false, reason: `${reasonPrefix} is an existing directory: ${value}` };
    }
  } catch {
    // Deleted paths may not exist, and created paths may be staged before commit.
  }
  return { ok: true, path: value };
};

const parseReviewStagingBulletValue = (trimmedLine: string): string | null => {
  if (trimmedLine === '*') {
    return '';
  }
  if (trimmedLine.startsWith('*')) {
    return trimmedLine.replace(/^\*\s?/, '').trim();
  }
  if (trimmedLine === '-') {
    return '';
  }
  const hyphenBulletMatch = trimmedLine.match(/^-\s+(.+)$/);
  return hyphenBulletMatch ? hyphenBulletMatch[1].trim() : null;
};

const unwrapParenthesizedValue = (value: string): string => {
  let unwrapped = value.trim();
  while (unwrapped.length >= 2 && unwrapped.startsWith('(') && unwrapped.endsWith(')')) {
    unwrapped = unwrapped.slice(1, -1).trim();
  }
  return unwrapped;
};

const isNoReviewStagingPathPlaceholder = (value: string): boolean =>
  noReviewStagingPathPlaceholders.has(unwrapParenthesizedValue(value).toLowerCase());

const parseTransferredFileOwnershipReleasePaths = async (
  content: string,
  rootDir: string,
): Promise<ReviewStagingResult> => {
  const lines = sectionLines(content, '## File Ownership Releases');
  if (lines === null) {
    return { ok: true, paths: [] };
  }

  const releases: Array<{ file?: string; transferred: boolean }> = [];
  let current: { file?: string; transferred: boolean } | undefined;
  const ensureCurrent = () => {
    current ??= { transferred: false };
    if (!releases.includes(current)) {
      releases.push(current);
    }
    return current;
  };

  for (const line of lines) {
    const trimmed = line.trim();
    if (trimmed.startsWith('### ')) {
      current = { transferred: false };
      releases.push(current);
      continue;
    }

    const fileMatch = trimmed.match(/^\*\s*File:\s*(.*)$/i);
    if (fileMatch) {
      ensureCurrent().file = fileMatch[1].trim();
      continue;
    }

    const statusMatch = trimmed.match(/^\*\s*Status:\s*(.+)$/i);
    if (statusMatch && statusMatch[1].trim().toLowerCase() === 'transferred') {
      ensureCurrent().transferred = true;
    }
  }

  const paths: string[] = [];
  for (const release of releases) {
    if (release.file === undefined) {
      continue;
    }
    const validated = await validateConcretePlanFilePath({
      value: release.file,
      rootDir,
      reasonPrefix: 'file ownership release path',
    });
    if (!validated.ok) {
      return validated;
    }
    if (release.transferred) {
      paths.push(validated.path);
    }
  }

  return { ok: true, paths: uniquePaths(paths) };
};

export const parseReviewStagingPaths = async ({
  content,
  rootDir = process.cwd(),
  isIgnored = async () => false,
}: ReviewStagingOptions): Promise<ReviewStagingResult> => {
  const lines = sectionLines(content, '## Files (MANDATORY)');
  if (lines === null) {
    return { ok: false, reason: 'plan is missing ## Files (MANDATORY)' };
  }

  const candidates: string[] = [];
  let activeSection = '';
  for (const line of lines) {
    const trimmed = line.trim();
    if (trimmed.startsWith('### ')) {
      activeSection = targetSubheadings.has(trimmed) ? trimmed : '';
      continue;
    }
    if (!activeSection || trimmed.length === 0) {
      continue;
    }
    const bulletValue = parseReviewStagingBulletValue(trimmed);
    if (bulletValue === null) {
      activeSection = '';
      continue;
    }
    let value = bulletValue;
    if (isNoReviewStagingPathPlaceholder(value)) {
      continue;
    }
    if (value.endsWith(' (assumed)')) {
      value = value.slice(0, -' (assumed)'.length);
    }
    const validated = await validateConcretePlanFilePath({
      value,
      rootDir,
      reasonPrefix: 'review staging path',
    });
    if (!validated.ok) {
      return validated;
    }
    candidates.push(validated.path);
  }

  if (candidates.length === 0) {
    return { ok: false, reason: 'plan has no concrete review staging file paths' };
  }

  const released = await parseTransferredFileOwnershipReleasePaths(content, rootDir);
  if (!released.ok) {
    return released;
  }
  const releasedPaths = new Set(released.paths);
  const activeCandidates = candidates.filter((candidate) => !releasedPaths.has(candidate));
  if (activeCandidates.length === 0) {
    return {
      ok: false,
      reason: 'plan has no active review staging file paths after file ownership releases',
    };
  }

  const paths: string[] = [];
  for (const candidate of activeCandidates) {
    if (!(await isIgnored(candidate))) {
      paths.push(candidate);
    }
  }

  if (paths.length === 0) {
    return { ok: false, reason: 'all review staging paths are git-ignored' };
  }

  return { ok: true, paths };
};

const defaultIsIgnored = async (rootDir: string, relativePath: string): Promise<boolean> => {
  if (!existsSync(path.join(rootDir, '.git'))) {
    return false;
  }
  const result = await defaultProcessRunner({
    command: 'git',
    args: ['check-ignore', '-q', '--', relativePath],
    cwd: rootDir,
    input: '',
    promptPath: 'git-check-ignore',
  });
  return result.launched && result.exitCode === 0;
};

const formatPreReviewStagedWorkReason = (output: string): string => {
  const stagedEntries = output
    .split(/\r?\n/)
    .map((line) => line.trimEnd())
    .filter((line) => /^(?:[ACDMRTUXB]|\?\?|!!)[0-9]*\t.+/.test(line))
    .map((line) => line.replace(/\t/g, '  '));
  return stagedEntries.length > 0
    ? `${REVIEW_ENTRY_STAGED_WORK_REASON_PREFIX}:\n\n${stagedEntries.join(';\n')}`
    : REVIEW_ENTRY_STAGED_WORK_REASON_PREFIX;
};

const checkForPreReviewStagedWork = async (
  rootDir: string,
  processRunner: ProcessRunner,
): Promise<{ ok: true } | Failure> => {
  const result = await processRunner({
    command: 'git',
    args: ['diff', '--staged', '--name-status', '--'],
    cwd: rootDir,
    input: '',
    promptPath: 'git-pre-review-staged-check',
  }).catch(
    (error): ProcessResult => ({
      launched: false,
      stdout: '',
      stderr: '',
      error: String(error),
    }),
  );

  if (!result.launched) {
    return {
      ok: false,
      reason: `could not launch review preflight staged file check: ${result.error}`,
    };
  }

  if (result.exitCode !== 0) {
    const details = [result.stderr.trim(), result.stdout.trim()].filter(Boolean).join('\n');
    return {
      ok: false,
      reason: `review preflight staged file check exited with code ${result.exitCode}${details ? `: ${details}` : ''}`,
    };
  }

  const stagedOutput = [result.stdout.trim(), result.stderr.trim()].filter(Boolean).join('\n');
  const reason = formatPreReviewStagedWorkReason(stagedOutput);
  if (reason !== REVIEW_ENTRY_STAGED_WORK_REASON_PREFIX) {
    return { ok: false, reason };
  }

  return { ok: true };
};

const runReviewStagingForPaths = async (
  rootDir: string,
  paths: string[],
  processRunner: ProcessRunner,
): Promise<
  | {
      ok: true;
      staging: ReviewStagingProcess;
      paths: string[];
    }
  | {
      ok: false;
      reason: string;
      staging?: ReviewStagingProcess;
    }
> => {
  const args = ['add', '--all', '--', ...paths];
  const result = await processRunner({
    command: 'git',
    args,
    cwd: rootDir,
    input: '',
    promptPath: 'git-staging',
  }).catch(
    (error): ProcessResult => ({
      launched: false,
      stdout: '',
      stderr: '',
      error: String(error),
    }),
  );
  const staging: ReviewStagingProcess = {
    command: `git add --all -- ${shellPathspecs(paths)}`,
    args,
    stdout: result.stdout,
    stderr: result.stderr,
    exitCode: result.launched ? result.exitCode : undefined,
  };
  if (!result.launched) {
    return {
      ok: false,
      reason: `could not launch review staging git add: ${result.error}`,
      staging: {
        ...staging,
        stopReason: `could not launch review staging git add: ${result.error}`,
      },
    };
  }
  if (result.exitCode !== 0) {
    const details = [result.stderr.trim(), result.stdout.trim()].filter(Boolean).join('\n');
    const reason = `review staging git add exited with code ${result.exitCode}${details ? `: ${details}` : ''}`;
    return {
      ok: false,
      reason,
      staging: { ...staging, stopReason: reason },
    };
  }
  return { ok: true, staging, paths };
};

const runReviewUnstageForPaths = async (
  rootDir: string,
  paths: string[],
  processRunner: ProcessRunner,
): Promise<
  | {
      ok: true;
      cleanup: ReviewCleanupProcess;
    }
  | {
      ok: false;
      reason: string;
      cleanup?: ReviewCleanupProcess;
    }
> => {
  const args = ['restore', '--staged', '--', ...paths];
  const result = await processRunner({
    command: 'git',
    args,
    cwd: rootDir,
    input: '',
    promptPath: 'git-review-unstage',
  }).catch(
    (error): ProcessResult => ({
      launched: false,
      stdout: '',
      stderr: '',
      error: String(error),
    }),
  );
  const cleanup: ReviewCleanupProcess = {
    command: `git restore --staged -- ${shellPathspecs(paths)}`,
    args,
    stdout: result.stdout,
    stderr: result.stderr,
    exitCode: result.launched ? result.exitCode : undefined,
  };
  if (!result.launched) {
    return {
      ok: false,
      reason: `could not launch review cleanup git restore: ${result.error}`,
      cleanup: {
        ...cleanup,
        stopReason: `could not launch review cleanup git restore: ${result.error}`,
      },
    };
  }
  if (result.exitCode !== 0) {
    const details = [result.stderr.trim(), result.stdout.trim()].filter(Boolean).join('\n');
    const reason = `review cleanup git restore exited with code ${result.exitCode}${details ? `: ${details}` : ''}`;
    return {
      ok: false,
      reason,
      cleanup: { ...cleanup, stopReason: reason },
    };
  }
  return { ok: true, cleanup };
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
    command: 'git',
    args: ['diff', '--cached', `--unified=${options.unified ?? 0}`, '--', ...paths],
    cwd: rootDir,
    input: '',
    promptPath: options.promptPath ?? 'git-scope-cleanup-diff',
  }).catch(
    (): ProcessResult => ({
      launched: false,
      stdout: '',
      stderr: '',
      error: 'failed to read staged diff',
    }),
  );

  if (!result.launched || result.exitCode !== 0) {
    return undefined;
  }

  const diff = result.stdout.trim();
  return diff.length > 0 ? diff : undefined;
};

const diffGitHeaderPattern = /^diff --git a\/(.+) b\/(.+)$/;
const diffHunkHeaderPattern = /^@@\s+.+\s+@@/;
const hunkMarkerPattern = /`([^`\n]+)`/g;

const extractStagedDiffHunks = (diff: string, scopedPaths: Set<string>): StagedDiffHunk[] => {
  const hunks: StagedDiffHunk[] = [];
  let currentFile: string | undefined;
  let currentHeader: string | undefined;
  let currentLines: string[] = [];

  const flush = () => {
    if (!currentFile || !currentHeader || !scopedPaths.has(currentFile)) {
      currentLines = [];
      return;
    }
    const text = [currentHeader, ...currentLines].join('\n');
    const changedText = currentLines
      .filter((line) => line.startsWith('+') || line.startsWith('-'))
      .join('\n');
    hunks.push({
      filePath: currentFile,
      header: currentHeader,
      text,
      changedText,
      hash: createHash('sha256').update(text).digest('hex').slice(0, 12),
    });
    currentLines = [];
  };

  for (const line of diff.split(/\r?\n/)) {
    const fileMatch = line.match(diffGitHeaderPattern);
    if (fileMatch) {
      flush();
      currentFile = fileMatch[2];
      currentHeader = undefined;
      continue;
    }
    if (!currentFile || !scopedPaths.has(currentFile)) {
      continue;
    }
    if (
      line.startsWith('+++ ') ||
      line.startsWith('--- ') ||
      line.startsWith('index ') ||
      line.startsWith('new file mode ') ||
      line.startsWith('deleted file mode ')
    ) {
      continue;
    }

    if (diffHunkHeaderPattern.test(line)) {
      flush();
      currentHeader = line;
      currentLines = [];
      continue;
    }

    if (!currentHeader) {
      continue;
    }
    currentLines.push(line);
  }
  flush();

  return hunks;
};

const normalizedOwnershipText = (value: string): string =>
  value
    .toLowerCase()
    .replace(/[`*_]/g, (match) => (match === '_' ? '_' : ' '))
    .replace(/\s+/g, ' ');

const hunkOwnershipTextForFile = (planContent: string, filePath: string): string | undefined => {
  const lines = sectionLines(planContent, '## Hunk Ownership');
  if (lines === null) {
    return undefined;
  }

  const matchingSectionLines: string[] = [];
  let sawFileSubsection = false;
  let active = false;
  for (const line of lines) {
    const headingMatch = line.trim().match(/^###\s+(.+)$/);
    if (headingMatch) {
      sawFileSubsection = true;
      active = headingMatch[1].trim() === filePath;
      continue;
    }
    if (active) {
      matchingSectionLines.push(line);
    }
  }

  if (matchingSectionLines.length > 0) {
    return matchingSectionLines.join('\n');
  }
  return sawFileSubsection ? '' : lines.join('\n');
};

const hunkOwnershipFilePaths = (planContent: string): string[] => {
  const lines = sectionLines(planContent, '## Hunk Ownership');
  if (lines === null) {
    return [];
  }
  return lines
    .map((line) => line.trim().match(/^###\s+(.+)$/)?.[1]?.trim())
    .filter((value): value is string => Boolean(value));
};

const hunkOwnershipMarkers = (ownershipText: string): string[] => {
  const markers: string[] = [];
  for (const match of ownershipText.matchAll(hunkMarkerPattern)) {
    const marker = match[1].trim();
    if (marker.length > 0) {
      markers.push(marker);
    }
  }
  return uniquePaths(markers);
};

const stagedHunkCoveredByOwnership = (hunk: StagedDiffHunk, ownershipText: string): boolean => {
  const haystack = normalizedOwnershipText(ownershipText);
  if (haystack.includes(normalizedOwnershipText(hunk.header))) {
    return true;
  }
  if (haystack.includes(normalizedOwnershipText(`hunk:${hunk.hash}`))) {
    return true;
  }

  const normalizedHunkText = normalizedOwnershipText(hunk.changedText);
  for (const marker of hunkOwnershipMarkers(ownershipText)) {
    if (normalizedHunkText.includes(normalizedOwnershipText(marker))) {
      return true;
    }
  }
  return false;
};

const verifySharedFileHunkOwnership = async ({
  rootDir,
  planContent,
  paths,
  processRunner,
}: {
  rootDir: string;
  planContent: string;
  paths: string[];
  processRunner: ProcessRunner;
}): Promise<{ ok: true } | Failure> => {
  const sharedPaths = new Set(hunkOwnershipFilePaths(planContent).filter((filePath) => paths.includes(filePath)));
  if (sharedPaths.size === 0) {
    return { ok: true };
  }

  const diff = await readCachedDiffForPaths(rootDir, [...sharedPaths], processRunner, {
    unified: 12,
    promptPath: 'git-review-hunk-ownership-diff',
  });
  if (!diff) {
    return { ok: true };
  }

  const hunks = extractStagedDiffHunks(diff, sharedPaths);
  const missingByPath = new Map<string, string[]>();
  for (const hunk of hunks) {
    const ownershipText = hunkOwnershipTextForFile(planContent, hunk.filePath);
    if (ownershipText && stagedHunkCoveredByOwnership(hunk, ownershipText)) {
      continue;
    }
    const missing = missingByPath.get(hunk.filePath) ?? [];
    missing.push(`${hunk.header} (hunk:${hunk.hash})`);
    missingByPath.set(hunk.filePath, missing);
  }

  if (missingByPath.size === 0) {
    return { ok: true };
  }

  const details = [...missingByPath.entries()]
    .map(([filePath, missing]) => `${filePath}: ${missing.slice(0, 8).join(', ')}`)
    .join('; ');
  return {
    ok: false,
    reason: `review hunk ownership incomplete: add ## Hunk Ownership entries for shared-file hunks before review: ${details}`,
  };
};

export const generateScopeCleanupPrompt = ({
  promptContent,
  planPath,
  contextSnapshotPath,
  specPaths,
  paths,
  diff,
  mode,
}: {
  promptContent: string;
  planPath: string;
  contextSnapshotPath: string;
  specPaths: string[];
  paths: string[];
  diff: string;
  mode: 'review' | 'commit-summary';
}): string => `Use ${SCOPE_CLEANUP_PROMPT_PATH} to clean staged scope for ${mode}.

Support prompt content:
${promptContent.trim()}

Rules for this run:
- Never output STOP.
- Output exactly one JSON object and nothing else.
- Use {"action":"keep"} when every staged hunk in the diff is clearly related to the current plan/spec.
- Use {"action":"unstage","patch":"<exact unified diff>"} when any staged hunk is not clearly related to the current plan/spec.
- If a hunk is ambiguous or not provably owned by the plan, treat it as unrelated and unstage it.
- When returning a patch, copy the unrelated hunks exactly from the staged diff, including diff headers and @@ headers, with newline escapes in JSON.

Plan path: ${planPath}

Snapshot path: ${contextSnapshotPath}

Spec paths:
${specPaths.length > 0 ? specPaths.map((specPath) => `- ${specPath}`).join('\n') : '(none)'}

Plan-owned staged paths:
${paths.map((stagingPath) => `- ${stagingPath}`).join('\n')}

Path-scoped staged diff:
${diff}
`;

const runScopeCleanupForPaths = async ({
  codexRuntime,
  rootDir,
  planPath,
  planContent,
  paths,
  processRunner,
  mode,
}: {
  codexRuntime: WorkflowRunnerCodexRuntime;
  rootDir: string;
  planPath: string;
  planContent: string;
  paths: string[];
  processRunner: ProcessRunner;
  mode: 'review' | 'commit-summary';
}): Promise<void> => {
  if (paths.length === 0) {
    return;
  }

  const prompt = await readPrompt(rootDir, SCOPE_CLEANUP_PROMPT_PATH);
  if (!prompt.ok) {
    return;
  }

  const diff = await readCachedDiffForPaths(rootDir, paths, processRunner);
  if (!diff) {
    return;
  }

  const cleanupPrompt = generateScopeCleanupPrompt({
    promptContent: prompt.content,
    planPath,
    contextSnapshotPath: workflowContextSnapshotRelativePath(path.posix.basename(planPath, '.md')),
    specPaths: extractSpecPaths(planContent),
    paths,
    diff,
    mode,
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
    input: '',
    promptPath: SCOPE_CLEANUP_PROMPT_PATH,
    env: codexWorkEnvironment(process.env, codexRuntime.profile),
  }).catch(
    (): ProcessResult => ({
      launched: false,
      stdout: '',
      stderr: '',
      error: 'scope cleanup launch failed',
    }),
  );

  if (!result.launched || result.exitCode !== 0) {
    return;
  }

  const decision = parseScopeCleanupDecision(result.stdout);
  if (!decision || decision.action !== 'unstage' || !decision.patch) {
    return;
  }

  await processRunner({
    command: 'git',
    args: ['apply', '--cached', '-R', '--unidiff-zero'],
    cwd: rootDir,
    input: `${decision.patch.trimEnd()}\n`,
    promptPath: 'git-scope-cleanup-unstage',
  }).catch(
    (): ProcessResult => ({
      launched: false,
      stdout: '',
      stderr: '',
      error: 'scope cleanup apply failed',
    }),
  );
};

const parseCommitSummaryPaths = async (
  rootDir: string,
  content: string,
  isIgnored?: (relativePath: string) => Promise<boolean>,
): Promise<ReviewStagingResult> => {
  const parsed = await parseReviewStagingPaths({
    content,
    rootDir,
    isIgnored: isIgnored ?? ((relativePath) => defaultIsIgnored(rootDir, relativePath)),
  });
  if (parsed.ok) {
    return parsed;
  }
  return { ok: false, reason: parsed.reason.replace(/review staging/g, 'commit summary') };
};

const verifyCommitSummaryPathsClean = async (
  rootDir: string,
  paths: string[],
  processRunner: ProcessRunner,
): Promise<{ ok: true } | Failure> => {
  const args = ['status', '--short', '--', ...paths];
  const result = await processRunner({
    command: 'git',
    args,
    cwd: rootDir,
    input: '',
    promptPath: 'git-commit-summary-clean-check',
  }).catch(
    (error): ProcessResult => ({
      launched: false,
      stdout: '',
      stderr: '',
      error: String(error),
    }),
  );

  if (!result.launched) {
    return {
      ok: false,
      reason: `could not launch commit-summary clean git status: ${result.error}`,
    };
  }
  if (result.exitCode !== 0) {
    const details = [result.stderr.trim(), result.stdout.trim()].filter(Boolean).join('\n');
    return {
      ok: false,
      reason: `commit-summary clean git status exited with code ${result.exitCode}${details ? `: ${details}` : ''}`,
    };
  }

  const dirtyOutput = [result.stdout.trim(), result.stderr.trim()].filter(Boolean).join('\n');
  if (dirtyOutput.length > 0) {
    return {
      ok: false,
      reason: `plan-owned changes remain after commit-summary: ${boundedInlineExcerpt(dirtyOutput)}`,
    };
  }

  return { ok: true };
};

const uniquePaths = (paths: string[]): string[] => [...new Set(paths)];

const fileOwnershipArtifactRelativePath = (planName: string): string =>
  rel('.ai', 'artifacts', planName, 'state', 'file-ownership.json');

const fileOwnershipArtifactAbsolutePath = (rootDir: string, planName: string): string =>
  path.join(rootDir, fileOwnershipArtifactRelativePath(planName));

const parseGitStatusChangedFiles = (output: string): string[] => {
  const paths: string[] = [];
  for (const rawLine of output.split(/\r?\n/)) {
    const line = rawLine.trimEnd();
    if (line.length < 4) {
      continue;
    }
    let filePath = line.slice(3).trim();
    const renameTarget = filePath.match(/\s+->\s+(.+)$/)?.[1];
    if (renameTarget) {
      filePath = renameTarget;
    }
    if (filePath.length > 0) {
      paths.push(filePath);
    }
  }
  return uniquePaths(paths);
};

const readGitChangedFiles = async (
  rootDir: string,
  processRunner: ProcessRunner,
): Promise<{ ok: true; paths: string[] } | Failure> => {
  const result = await processRunner({
    command: 'git',
    args: ['status', '--short', '--untracked-files=all', '--'],
    cwd: rootDir,
    input: '',
    promptPath: 'git-file-ownership-status',
  }).catch(
    (error): ProcessResult => ({
      launched: false,
      stdout: '',
      stderr: '',
      error: String(error),
    }),
  );

  if (!result.launched) {
    return { ok: false, reason: `could not launch file ownership git status: ${result.error}` };
  }
  if (result.exitCode !== 0) {
    const details = [result.stderr.trim(), result.stdout.trim()].filter(Boolean).join('\n');
    return {
      ok: false,
      reason: `file ownership git status exited with code ${result.exitCode}${details ? `: ${details}` : ''}`,
    };
  }
  return { ok: true, paths: parseGitStatusChangedFiles(result.stdout) };
};

const readGitHeadSha = async (
  rootDir: string,
  processRunner: ProcessRunner,
): Promise<{ ok: true; sha: string } | Failure> => {
  const result = await processRunner({
    command: 'git',
    args: ['rev-parse', 'HEAD'],
    cwd: rootDir,
    input: '',
    promptPath: 'git-file-ownership-head',
  }).catch(
    (error): ProcessResult => ({
      launched: false,
      stdout: '',
      stderr: '',
      error: String(error),
    }),
  );

  if (!result.launched) {
    return { ok: false, reason: `could not launch file ownership head check: ${result.error}` };
  }
  if (result.exitCode !== 0) {
    const details = [result.stderr.trim(), result.stdout.trim()].filter(Boolean).join('\n');
    return {
      ok: false,
      reason: `file ownership head check exited with code ${result.exitCode}${details ? `: ${details}` : ''}`,
    };
  }
  return { ok: true, sha: result.stdout.trim() };
};

const parseOwnershipScopeEntries = async (
  content: string,
  rootDir: string,
): Promise<{ ok: true; entries: string[]; present: boolean } | Failure> => {
  const lines = sectionLines(content, '## Ownership Scope');
  if (lines === null) {
    return { ok: true, entries: [], present: false };
  }

  const entries: string[] = [];
  for (const line of lines) {
    const trimmed = line.trim();
    if (trimmed.length === 0) {
      continue;
    }
    const bulletValue = parseReviewStagingBulletValue(trimmed);
    if (bulletValue === null) {
      continue;
    }
    const value = bulletValue.trim();
    if (isNoReviewStagingPathPlaceholder(value)) {
      continue;
    }
    if (path.isAbsolute(value)) {
      return { ok: false, reason: `ownership scope path is absolute: ${value}` };
    }
    if (value.includes('..')) {
      return { ok: false, reason: `ownership scope path contains ..: ${value}` };
    }
    if (value.includes('*') && !value.endsWith('/**')) {
      return { ok: false, reason: `ownership scope path has unsupported glob: ${value}` };
    }
    if (value.endsWith('/**')) {
      const prefix = value.slice(0, -3);
      if (prefix.length === 0) {
        return { ok: false, reason: `ownership scope path is empty: ${value}` };
      }
      entries.push(value);
      continue;
    }
    const validated = await validateConcretePlanFilePath({
      value,
      rootDir,
      reasonPrefix: 'ownership scope path',
    });
    if (!validated.ok) {
      return validated;
    }
    entries.push(validated.path);
  }

  if (entries.length === 0) {
    return { ok: false, reason: 'plan has no concrete ownership scope entries' };
  }

  return { ok: true, entries: uniquePaths(entries), present: true };
};

const resolveOwnershipScopeEntries = (
  entries: string[],
  changedFiles: string[],
  releasedFiles: string[] = [],
): string[] => {
  const released = new Set(releasedFiles);
  const resolved: string[] = [];
  for (const entry of entries) {
    if (entry.endsWith('/**')) {
      const prefix = entry.slice(0, -3);
      for (const changedFile of changedFiles) {
        if (changedFile === prefix || changedFile.startsWith(`${prefix}/`)) {
          resolved.push(changedFile);
        }
      }
      continue;
    }
    resolved.push(entry);
  }
  return uniquePaths(resolved).filter((filePath) => !released.has(filePath));
};

const filterChangedOwnershipFiles = (
  resolvedFiles: string[],
  changedFiles: string[],
  releasedFiles: string[] = [],
): string[] => {
  const resolved = new Set(resolvedFiles);
  const released = new Set(releasedFiles);
  return uniquePaths(changedFiles).filter((filePath) => resolved.has(filePath) && !released.has(filePath));
};

const asStringArray = (value: unknown): string[] | undefined =>
  Array.isArray(value) && value.every((item) => typeof item === 'string')
    ? (value as string[])
    : undefined;

const parseFileOwnershipArtifact = (
  raw: string,
  artifactPath: string,
): FileOwnershipArtifact | Failure => {
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    return { ok: false, reason: `file ownership artifact is malformed: ${artifactPath}` };
  }

  const record = asRecord(parsed);
  const planPath = record?.planPath;
  const status = record?.status;
  const nextAction = record?.nextAction;
  const owns = asStringArray(record?.owns);
  const released = asStringArray(record?.released);
  const resolvedFiles = asStringArray(record?.resolvedFiles);
  const changedFiles = asStringArray(record?.changedFiles);
  const headSha = record?.headSha;
  const updatedAt = record?.updatedAt;
  if (
    typeof planPath !== 'string' ||
    typeof status !== 'string' ||
    !isStatus(status) ||
    typeof nextAction !== 'string' ||
    !isNextAction(nextAction) ||
    !owns ||
    !released ||
    !resolvedFiles ||
    !changedFiles ||
    typeof headSha !== 'string' ||
    typeof updatedAt !== 'string'
  ) {
    return { ok: false, reason: `file ownership artifact is malformed: ${artifactPath}` };
  }

  return {
    planPath,
    status,
    nextAction,
    owns,
    released,
    resolvedFiles,
    changedFiles,
    headSha,
    updatedAt,
  };
};

const refreshCurrentFileOwnershipArtifact = async ({
  rootDir,
  plan,
  processRunner,
  timestamp,
}: {
  rootDir: string;
  plan: ParsedPlan;
  processRunner: ProcessRunner;
  timestamp: () => string;
}): Promise<
  | { ok: true; present: false; changedFiles: string[] }
  | { ok: true; present: true; artifact: FileOwnershipArtifact; changedFiles: string[] }
  | Failure
> => {
  const ownershipScope = await parseOwnershipScopeEntries(plan.content, rootDir);
  if (!ownershipScope.ok) {
    return ownershipScope;
  }
  if (!ownershipScope.present) {
    return { ok: true, present: false, changedFiles: [] };
  }

  const changedFiles = await readGitChangedFiles(rootDir, processRunner);
  if (!changedFiles.ok) {
    return changedFiles;
  }

  const headSha = await readGitHeadSha(rootDir, processRunner);
  if (!headSha.ok) {
    return headSha;
  }
  const released = await parseTransferredFileOwnershipReleasePaths(plan.content, rootDir);
  if (!released.ok) {
    return released;
  }
  const resolvedFiles = resolveOwnershipScopeEntries(
    ownershipScope.entries,
    changedFiles.paths,
    released.paths,
  );
  const artifact: FileOwnershipArtifact = {
    planPath: plan.planPath,
    status: plan.status,
    nextAction: plan.nextAction,
    owns: ownershipScope.entries,
    released: released.paths,
    resolvedFiles,
    changedFiles: filterChangedOwnershipFiles(resolvedFiles, changedFiles.paths, released.paths),
    headSha: headSha.sha,
    updatedAt: timestamp(),
  };
  const artifactPath = fileOwnershipArtifactAbsolutePath(rootDir, plan.planName);
  await mkdir(path.dirname(artifactPath), { recursive: true });
  await writeFile(artifactPath, `${JSON.stringify(artifact, null, 2)}\n`, 'utf8');

  return { ok: true, present: true, artifact, changedFiles: changedFiles.paths };
};

const blockingOwnershipStatuses = new Set<Status>(['active', 'review', 'blocked', 'reopening']);

const readOtherFileOwnershipArtifacts = async (
  rootDir: string,
  currentPlanPath: string,
): Promise<{ ok: true; artifacts: FileOwnershipArtifact[] } | Failure> => {
  const artifactsRoot = path.join(rootDir, '.ai', 'artifacts');
  let entries: string[];
  try {
    entries = await readdir(artifactsRoot);
  } catch (error) {
    const code = (error as NodeJS.ErrnoException).code;
    if (code === 'ENOENT') {
      return { ok: true, artifacts: [] };
    }
    return { ok: false, reason: `file ownership artifacts cannot be listed: ${String(error)}` };
  }

  const artifacts: FileOwnershipArtifact[] = [];
  for (const entry of entries) {
    const artifactPath = path.join(artifactsRoot, entry, 'state', 'file-ownership.json');
    let raw: string;
    try {
      raw = await readFile(artifactPath, 'utf8');
    } catch (error) {
      const code = (error as NodeJS.ErrnoException).code;
      if (code === 'ENOENT' || code === 'EISDIR') {
        continue;
      }
      return { ok: false, reason: `file ownership artifact cannot be read: ${artifactPath}: ${String(error)}` };
    }
    const parsed = parseFileOwnershipArtifact(raw, artifactPath);
    if (!('planPath' in parsed)) {
      return parsed;
    }
    if (parsed.planPath !== currentPlanPath) {
      artifacts.push(parsed);
    }
  }

  return { ok: true, artifacts };
};

const effectiveArtifactResolvedFiles = (
  artifact: FileOwnershipArtifact,
  changedFiles: string[],
): string[] =>
  uniquePaths([
    ...artifact.resolvedFiles,
    ...resolveOwnershipScopeEntries(artifact.owns, changedFiles, artifact.released),
  ]).filter((filePath) => !artifact.released.includes(filePath));

const detectFileOwnershipArtifactConflict = async ({
  rootDir,
  current,
  changedFiles,
}: {
  rootDir: string;
  current: FileOwnershipArtifact;
  changedFiles: string[];
}): Promise<{ ok: true } | Failure> => {
  const otherArtifacts = await readOtherFileOwnershipArtifacts(rootDir, current.planPath);
  if (!otherArtifacts.ok) {
    return otherArtifacts;
  }

  const currentFiles = new Set(current.resolvedFiles);
  const dirtyFiles = new Set(changedFiles);
  for (const other of otherArtifacts.artifacts) {
    const otherFiles = effectiveArtifactResolvedFiles(other, changedFiles);
    const conflictingFiles =
      other.status === 'completed' && other.nextAction === 'commit-summary'
        ? otherFiles.filter((filePath) => currentFiles.has(filePath) && dirtyFiles.has(filePath))
        : blockingOwnershipStatuses.has(other.status)
          ? otherFiles.filter((filePath) => currentFiles.has(filePath))
          : [];
    if (conflictingFiles.length === 0) {
      continue;
    }
    return {
      ok: false,
      reason: `workflow file ownership conflict: ${conflictingFiles[0]} is already owned by ${other.planPath}`,
    };
  }

  return { ok: true };
};

const refreshAndCheckFileOwnershipArtifact = async ({
  rootDir,
  plan,
  processRunner,
  timestamp,
  isIgnored,
}: {
  rootDir: string;
  plan: ParsedPlan;
  processRunner: ProcessRunner;
  timestamp: () => string;
  isIgnored?: (relativePath: string) => Promise<boolean>;
}): Promise<FileOwnershipPreflight | Failure> => {
  const refreshed = await refreshCurrentFileOwnershipArtifact({
    rootDir,
    plan,
    processRunner,
    timestamp,
  });
  if (!refreshed.ok) {
    return refreshed;
  }
  if (!refreshed.present) {
    return { hasOwnershipScope: false };
  }

  const conflict = await detectFileOwnershipArtifactConflict({
    rootDir,
    current: refreshed.artifact,
    changedFiles: refreshed.changedFiles,
  });
  if (!conflict.ok) {
    return conflict;
  }

  const ignored = isIgnored ?? ((relativePath: string) => defaultIsIgnored(rootDir, relativePath));
  const reviewStagingPaths: string[] = [];
  for (const changedFile of refreshed.artifact.changedFiles) {
    if (changedFile.startsWith('.ai/')) {
      continue;
    }
    if (!(await ignored(changedFile))) {
      reviewStagingPaths.push(changedFile);
    }
  }

  return {
    hasOwnershipScope: true,
    artifact: refreshed.artifact,
    reviewStagingPaths,
  };
};

const readThinPlanV2FileOwnershipPreflight = async ({
  rootDir,
  plan,
  isIgnored,
}: {
  rootDir: string;
  plan: ParsedPlan;
  isIgnored?: (relativePath: string) => Promise<boolean>;
}): Promise<FileOwnershipPreflight | Failure> => {
  const fileOwnershipPath = thinPlanV2ArtifactPath(plan.planName, 'state', 'file-ownership.json');
  const filesPath = thinPlanV2ArtifactPath(plan.planName, 'state', 'files.json');
  const ownershipRaw = await readJsonArtifact(rootDir, fileOwnershipPath);
  if (isFailure(ownershipRaw)) {
    return ownershipRaw;
  }
  const artifact = parseFileOwnershipArtifact(JSON.stringify(ownershipRaw), fileOwnershipPath);
  if (isFailure(artifact)) {
    return artifact;
  }
  const filesRaw = await readJsonArtifact(rootDir, filesPath);
  if (isFailure(filesRaw)) {
    return filesRaw;
  }
  const files = parseThinPlanV2FilesState(filesRaw, filesPath);
  if (isFailure(files)) {
    return files;
  }

  const conflict = await detectFileOwnershipArtifactConflict({
    rootDir,
    current: artifact,
    changedFiles: files.changedFiles,
  });
  if (!conflict.ok) {
    return conflict;
  }

  const ignored = isIgnored ?? ((relativePath: string) => defaultIsIgnored(rootDir, relativePath));
  const released = new Set(files.released);
  const reviewStagingPaths: string[] = [];
  for (const changedFile of files.changedFiles) {
    if (changedFile.startsWith('.ai/') || released.has(changedFile)) {
      continue;
    }
    if (!(await ignored(changedFile))) {
      reviewStagingPaths.push(changedFile);
    }
  }

  return {
    hasOwnershipScope: true,
    artifact,
    reviewStagingPaths: uniquePaths(reviewStagingPaths),
  };
};

const parseWorkflowFileOwnershipPaths = async (
  rootDir: string,
  content: string,
  isIgnored?: (relativePath: string) => Promise<boolean>,
): Promise<ReviewStagingResult> => {
  const parsed = await parseReviewStagingPaths({
    content,
    rootDir,
    isIgnored: isIgnored ?? ((relativePath) => defaultIsIgnored(rootDir, relativePath)),
  });
  if (parsed.ok) {
    return { ok: true, paths: uniquePaths(parsed.paths) };
  }
  return { ok: false, reason: parsed.reason.replace(/review staging/g, 'workflow file ownership') };
};

const parseEditedFileSummaryPaths = async (rootDir: string, content: string): Promise<string[]> => {
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
      snapshot.set(relativePath, await readFile(path.join(rootDir, relativePath), 'utf8'));
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
  return content.replace(/\r\n/g, '\n').replace(/\n$/, '').split('\n');
};

const commonLineCount = (beforeLines: string[], afterLines: string[]): number => {
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
      afterContent = await readFile(path.join(rootDir, relativePath), 'utf8');
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
        beforeContent === undefined ? 'Added' : afterContent === undefined ? 'Deleted' : 'Edited',
      path: relativePath,
      additions: afterLines.length - commonLines,
      deletions: beforeLines.length - commonLines,
    });
  }
  return summaries;
};

const parseWorkflowFileLockMetadata = (
  raw: string,
  lockPath: string,
): WorkflowFileLockMetadata | Failure => {
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    return { ok: false, reason: `workflow file lock is malformed: ${lockPath}` };
  }

  const record = asRecord(parsed);
  const planPath = record?.planPath;
  const pid = record?.pid;
  const createdAt = record?.createdAt;
  const ownedPath = record?.path;
  if (
    typeof planPath !== 'string' ||
    !Number.isInteger(pid) ||
    (pid as number) <= 0 ||
    typeof createdAt !== 'string' ||
    typeof ownedPath !== 'string'
  ) {
    return { ok: false, reason: `workflow file lock is malformed: ${lockPath}` };
  }

  return {
    planPath,
    pid: pid as number,
    createdAt,
    path: ownedPath,
  };
};

const isProcessAlive = (pid: number): boolean => {
  try {
    process.kill(pid, 0);
    return true;
  } catch (error) {
    const code = (error as NodeJS.ErrnoException).code;
    return code === 'EPERM';
  }
};

const releaseWorkflowFileLocks = async (
  lockPaths: Set<string>,
): Promise<{ ok: true } | Failure> => {
  for (const lockPath of [...lockPaths]) {
    try {
      await rm(lockPath, { force: true });
      lockPaths.delete(lockPath);
    } catch (error) {
      return {
        ok: false,
        reason: `workflow file lock cannot be released: ${lockPath}: ${String(error)}`,
      };
    }
  }
  return { ok: true };
};

const acquireWorkflowFileOwnershipForPaths = async ({
  rootDir,
  planPath,
  paths,
  heldLockPaths,
  now = () => new Date().toISOString(),
}: {
  rootDir: string;
  planPath: string;
  paths: string[];
  heldLockPaths: Set<string>;
  now?: () => string;
}): Promise<{ ok: true } | Failure> => {
  const acquiredThisAttempt = new Set<string>();
  const releaseAttemptLocks = async (): Promise<Failure | undefined> => {
    const attemptedLocks = [...acquiredThisAttempt];
    const released = await releaseWorkflowFileLocks(acquiredThisAttempt);
    for (const lockPath of attemptedLocks) {
      heldLockPaths.delete(lockPath);
    }
    return released.ok ? undefined : released;
  };

  try {
    await mkdir(workflowFileLockDir(rootDir), { recursive: true });
  } catch (error) {
    return {
      ok: false,
      reason: `workflow file lock directory cannot be created: ${String(error)}`,
    };
  }

  for (const ownedPath of uniquePaths(paths)) {
    const lockPath = workflowFileLockPath(rootDir, ownedPath);
    if (heldLockPaths.has(lockPath)) {
      continue;
    }

    const metadata: WorkflowFileLockMetadata = {
      planPath,
      pid: process.pid,
      createdAt: now(),
      path: ownedPath,
    };

    while (true) {
      try {
        await writeFile(lockPath, JSON.stringify(metadata), { flag: 'wx' });
        heldLockPaths.add(lockPath);
        acquiredThisAttempt.add(lockPath);
        break;
      } catch (error) {
        const code = (error as NodeJS.ErrnoException).code;
        if (code !== 'EEXIST') {
          const releaseFailure = await releaseAttemptLocks();
          return (
            releaseFailure ?? {
              ok: false,
              reason: `workflow file lock cannot be created: ${lockPath}: ${String(error)}`,
            }
          );
        }
      }

      let existingRaw: string;
      try {
        existingRaw = await readFile(lockPath, 'utf8');
      } catch (error) {
        const releaseFailure = await releaseAttemptLocks();
        return (
          releaseFailure ?? {
            ok: false,
            reason: `workflow file lock cannot be read: ${lockPath}: ${String(error)}`,
          }
        );
      }

      const existing = parseWorkflowFileLockMetadata(existingRaw, lockPath);
      if (!('planPath' in existing)) {
        const releaseFailure = await releaseAttemptLocks();
        return releaseFailure ?? existing;
      }
      if (existing.pid === process.pid && existing.planPath === planPath) {
        heldLockPaths.add(lockPath);
        break;
      }
      if (isProcessAlive(existing.pid)) {
        const releaseFailure = await releaseAttemptLocks();
        return (
          releaseFailure ?? {
            ok: false,
            reason: `workflow file ownership conflict: ${ownedPath} is already owned by ${existing.planPath} (pid ${existing.pid})`,
          }
        );
      }

      try {
        await rm(lockPath, { force: true });
      } catch (error) {
        const releaseFailure = await releaseAttemptLocks();
        return (
          releaseFailure ?? {
            ok: false,
            reason: `stale workflow file lock cannot be removed: ${lockPath}: ${String(error)}`,
          }
        );
      }
    }
  }

  return { ok: true };
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
}): Array<[string, string | number | undefined]> => {
  const failureMetadata = stopReason ? classifyFailureForLog(stopReason) : undefined;
  const editedFilesLog = editedFiles ? formatEditedFilesForLog(editedFiles) : undefined;
  return [
    ['timestamp', timestamp],
    ['iteration', iteration],
    ['status', status],
    ['nextAction', nextAction],
    ['promptPath', promptPath],
    ['model', model],
    ['reasoning', reasoning],
    ['contextWindowTokens', contextUsage.contextWindowTokens],
    ['contextWindowUsedTokens', contextUsage.contextWindowUsedTokens],
    ['contextWindowUsedPercent', contextUsage.contextWindowUsedPercent],
    ['planPath', planPath],
    ['startingStatus', status],
    ['startingNextAction', nextAction],
    ['taskId', taskContext?.task.id],
    ['taskName', taskContext?.task.name],
    ['taskStage', taskContext?.stage],
    ['taskArtifact', taskContext?.artifactPath],
    ['commitSha', taskContext?.commitSha],
    ['result', result],
    ['exitCode', exitCode],
    ['durationMs', durationMs],
    ['stopReason', stopReason],
    ...(failureDebugPath
      ? ([['failureDebugPath', failureDebugPath]] as Array<[string, string | number | undefined]>)
      : []),
    ...(failureMetadata
      ? ([
          ['failureKind', failureMetadata.failureKind],
          ['failureReason', failureMetadata.failureReason],
          ['nextSuggestedAction', failureMetadata.nextSuggestedAction],
        ] as Array<[string, string | number | undefined]>)
      : []),
    ...(editedFilesLog
      ? ([['editedFiles', editedFilesLog]] as Array<[string, string | number | undefined]>)
      : []),
    ['stdout', compactCapturedOutputForLog(stdout)],
    ['stderr', compactCapturedOutputForLog(stderr)],
    ...(staging
      ? ([
          ['reviewStagingCommand', staging.command],
          ['reviewStagingExitCode', staging.exitCode],
          ['reviewStagingStdout', compactCapturedOutputForLog(staging.stdout)],
          ['reviewStagingStderr', compactCapturedOutputForLog(staging.stderr)],
        ] as Array<[string, string | number | undefined]>)
      : []),
    ...(cleanup
      ? ([
          ['reviewCleanupCommand', cleanup.command],
          ['reviewCleanupExitCode', cleanup.exitCode],
          ['reviewCleanupStdout', compactCapturedOutputForLog(cleanup.stdout)],
          ['reviewCleanupStderr', compactCapturedOutputForLog(cleanup.stderr)],
        ] as Array<[string, string | number | undefined]>)
      : []),
  ];
};

const transitionAllowed = (
  promptPath: string,
  previous: ParsedPlan,
  next: ParsedPlan,
): { ok: true } | Failure => {
  if (promptPath === rel('.ai', 'prompts', 'execute-plan.md')) {
    const allowedReview = next.status === 'review' && next.nextAction === 'review-plan';
    const allowedActive = next.status === 'active' && next.nextAction === 'execute-plan';
    const allowedBlocked =
      next.status === 'blocked' &&
      (next.nextAction === 'unblock-plan' || next.nextAction === 'execute-plan');
    if (!allowedReview && !allowedActive && !allowedBlocked) {
      return {
        ok: false,
        reason: `execute-plan may only hand off to review + review-plan, active + execute-plan, or blocked + unblock-plan, got ${next.status} + ${next.nextAction}`,
      };
    }
  }
  if (promptPath === rel('.ai', 'prompts', 'review-changes.md')) {
    const allowedActive = next.status === 'active' && next.nextAction === 'execute-plan';
    const allowedCompleted = next.status === 'completed' && next.nextAction === 'commit-summary';
    if (!allowedActive && !allowedCompleted) {
      return {
        ok: false,
        reason: `review-changes may only hand off to active + execute-plan or completed + commit-summary, got ${next.status} + ${next.nextAction}`,
      };
    }
  }
  if (promptPath === rel('.ai', 'prompts', 'unblock-plan.md')) {
    const allowedActive = next.status === 'active' && next.nextAction === 'execute-plan';
    const allowedBlocked =
      next.status === 'blocked' &&
      (next.nextAction === 'unblock-plan' || next.nextAction === 'execute-plan');
    if (!allowedActive && !allowedBlocked) {
      return {
        ok: false,
        reason: `unblock-plan may only hand off to active + execute-plan or remain blocked, got ${next.status} + ${next.nextAction}`,
      };
    }
  }
  if (promptPath === rel('.ai', 'prompts', 'reopen-plan.md')) {
    const allowedActive = next.status === 'active' && next.nextAction === 'execute-plan';
    if (!allowedActive) {
      return {
        ok: false,
        reason: `reopen-plan may only hand off to active + execute-plan, got ${next.status} + ${next.nextAction}`,
      };
    }
  }
  return { ok: true };
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
    return success('workflow runner help', 0);
  }
  const planArgument = options.planName ?? cliArgs.planArgument;
  const compactOutput = options.compactOutput ?? cliArgs.compactOutput;
  const codexProfile =
    options.codexProfile ?? cliArgs.codexProfile ?? WORKFLOW_RUNNER_CODEX_PROFILE;
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
  const streamOutput = compactOutput ? false : (options.streamOutput ?? true);
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
  const emittedWorkflowWarnings = new Set<string>();
  let currentTaskContext: WorkflowTaskContext | undefined;
  const markWorkflowLogCreated = (planName: string) => {
    workflowLogPath = rel('.ai', 'artifacts', planName, 'logs', 'runner.log');
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
    return abortReason === 'SIGINT' || abortReason === 'SIGTERM' ? abortReason : undefined;
  };
  const elapsedLine = () =>
    `- Worked for ${formatWorkflowElapsedTime(Math.max(0, now() - runStartedAt))}`;
  const releaseHeldWorkflowFileLocks = async (): Promise<string | undefined> => {
    const released = await releaseWorkflowFileLocks(heldWorkflowFileLockPaths);
    return released.ok ? undefined : released.reason;
  };
  const finishFailure = async (
    reason: string,
    completedIterations = iterations,
    exitCode = 1,
  ): Promise<RunnerResult> => {
    const releaseFailure = await releaseHeldWorkflowFileLocks();
    const finalReason = releaseFailure ? `${reason}; ${releaseFailure}` : reason;
    logger.error(`FAILED: ${reason}`);
    if (releaseFailure) {
      logger.error(`FAILED: ${releaseFailure}`);
    }
    if (workflowLogPath) {
      logger.error(`- Workflow log: ${workflowLogPath}`);
    }
    if (tokenUsageLogPath) {
      logger.error(`- Token usage ledger: ${tokenUsageLogPath}`);
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
    logger.log('SUCCESS');
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
    const finalReason = releaseFailure ? `${reason}; ${releaseFailure}` : reason;
    const summary = blockedReasonSummary(detail);
    logger.error('BLOCKED');
    logger.error(`- Reason: ${summary.category}`);
    logger.error(`-> ${summary.detail}`);
    logger.error('-> Next: Run Codex CLI with this:');
    logger.error('`use unblock-plan.md`');
    logger.error('`evidence: ...`');
    logger.error(`\`${planPath}\``);
    logger.error('');
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
  const initialParsedPlan = await parsePlan({ planName: planArgument, rootDir });
  if (!initialParsedPlan.ok) {
    return await finishFailure(initialParsedPlan.reason);
  }
  emitWorkflowThresholdWarnings(initialParsedPlan.warnings);
  let parsedPlan: ParsedPlan = initialParsedPlan;
  tokenUsageTotals = await readTokenUsageTotals(rootDir, parsedPlan.planName);
  const syncWorkflowSnapshot = async (
    plan: ParsedPlan,
  ): Promise<WorkflowContextSnapshotResult | Failure> => {
    const snapshotResult = await writeWorkflowContextSnapshot({ rootDir, plan });
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
      route.promptPath === rel('.ai', 'prompts', 'commit-summary.md');
    if (!selectedTask) {
      currentTaskContext = undefined;
    }
    const selectedTaskArtifactPath = selectedTask
      ? await nextTaskArtifactRelativePath(rootDir, parsedPlan.planName, selectedTask)
      : undefined;
    const setTaskStage = async ({
      stage,
      detail,
      commitSha,
    }: {
      stage: TaskStage;
      detail: string;
      commitSha?: string;
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
      logger.log(formatTaskProgressLine({ task: selectedTask, stage, detail }));
      return { ok: true };
    };
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
          result: 'not-launched',
          exitCode: undefined,
          stopReason: reason,
          failureMetadata,
          stdout: '',
          stderr: '',
        }),
      );
      if (!failureDebugResult.ok) {
        return await finishFailure(failureDebugResult.reason);
      }
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
          result: 'not-launched',
          exitCode: undefined,
          durationMs: 0,
          stopReason: reason,
          failureDebugPath: failureDebugResult.pointer,
          stdout: '',
          stderr: '',
          staging: undefined,
          taskContext: currentTaskContext,
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
    let commitSummaryPaths: string[] | undefined;
    let fileOwnershipPreflight: FileOwnershipPreflight | undefined;
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
      progressLogged = true;
    };
    const cleanupReviewStagingPaths = async (
      paths: string[] | undefined,
    ): Promise<{ ok: true } | Failure> => {
      if (
        route.promptPath !== rel('.ai', 'prompts', 'review-changes.md') ||
        !paths ||
        paths.length === 0 ||
        reviewCleanup
      ) {
        return { ok: true };
      }
      const cleanup = await runReviewUnstageForPaths(rootDir, paths, processRunner);
      reviewCleanup = cleanup.cleanup;
      if (!cleanup.ok) {
        return { ok: false, reason: cleanup.reason };
      }
      return { ok: true };
    };
    if (route.promptPath === rel('.ai', 'prompts', 'execute-plan.md') && selectedTask) {
      const taskStage = await setTaskStage({
        stage: 'implementing',
        detail: selectedTask.name,
      });
      if (!taskStage.ok) {
        return await finishFailure(taskStage.reason);
      }
    }
    if (route.promptPath === rel('.ai', 'prompts', 'commit-summary.md') && selectedTask) {
      const taskStage = await setTaskStage({
        stage: 'commit-message',
        detail: 'generating commit',
      });
      if (!taskStage.ok) {
        return await finishFailure(taskStage.reason);
      }
    }
    if (
      route.promptPath === rel('.ai', 'prompts', 'execute-plan.md') ||
      route.promptPath === rel('.ai', 'prompts', 'review-changes.md') ||
      route.promptPath === rel('.ai', 'prompts', 'commit-summary.md')
    ) {
      const preflight =
        parsedPlan.thinPlanContract === 'thin-plan-v2'
          ? await readThinPlanV2FileOwnershipPreflight({
              rootDir,
              plan: parsedPlan,
              isIgnored: options.isIgnored,
            })
          : await refreshAndCheckFileOwnershipArtifact({
              rootDir,
              plan: parsedPlan,
              processRunner,
              timestamp,
              isIgnored: options.isIgnored,
            });
      if ('ok' in preflight && !preflight.ok) {
        return await finishFailure(`workflow file ownership scope invalid: ${preflight.reason}`);
      }
      fileOwnershipPreflight = preflight;
    }
    if (route.promptPath === rel('.ai', 'prompts', 'execute-plan.md')) {
      const ownershipPaths =
        fileOwnershipPreflight?.hasOwnershipScope && fileOwnershipPreflight.artifact
          ? { ok: true as const, paths: fileOwnershipPreflight.artifact.resolvedFiles }
          : await parseWorkflowFileOwnershipPaths(rootDir, parsedPlan.content, options.isIgnored);
      if (!ownershipPaths.ok) {
        return await finishFailure(`workflow file ownership scope invalid: ${ownershipPaths.reason}`);
      }
      const acquired = await acquireWorkflowFileOwnershipForPaths({
        rootDir,
        planPath: parsedPlan.planPath,
        paths: ownershipPaths.paths,
        heldLockPaths: heldWorkflowFileLockPaths,
        now: timestamp,
      });
      if (!acquired.ok) {
        return await finishFailure(acquired.reason);
      }
    }
    if (route.promptPath === rel('.ai', 'prompts', 'review-changes.md')) {
      const preExistingStagedWork = await checkForPreReviewStagedWork(rootDir, processRunner);
      if (!preExistingStagedWork.ok) {
        logWorkflowProgress();
        const durationMs = Math.max(0, now() - attemptStartedAt);
        const logTimestamp = timestamp();
        const failureMetadata = classifyFailureForLog(preExistingStagedWork.reason);
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
            result: 'not-launched',
            exitCode: undefined,
            stopReason: preExistingStagedWork.reason,
            failureMetadata,
            stdout: '',
            stderr: '',
          }),
        );
        if (!failureDebugResult.ok) {
          return await finishFailure(failureDebugResult.reason);
        }
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
            result: 'not-launched',
            exitCode: undefined,
            durationMs,
            stopReason: preExistingStagedWork.reason,
            failureDebugPath: failureDebugResult.pointer,
            stdout: '',
            stderr: '',
            staging: undefined,
            taskContext: currentTaskContext,
          }),
        );
        if (!logResult.ok) {
          return await finishFailure(logResult.reason);
        }
        markWorkflowLogCreated(parsedPlan.planName);
        return await finishFailure(preExistingStagedWork.reason);
      }
      const parsedPaths =
        fileOwnershipPreflight?.hasOwnershipScope && fileOwnershipPreflight.reviewStagingPaths
          ? fileOwnershipPreflight.reviewStagingPaths.length > 0
            ? { ok: true as const, paths: fileOwnershipPreflight.reviewStagingPaths }
            : {
                ok: false as const,
                reason: 'plan has no changed ownership files to stage for review',
              }
          : await parseReviewStagingPaths({
              content: parsedPlan.content,
              rootDir,
              isIgnored:
                options.isIgnored ?? ((relativePath) => defaultIsIgnored(rootDir, relativePath)),
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
            result: 'not-launched',
            exitCode: undefined,
            stopReason: parsedPaths.reason,
            failureMetadata,
            stdout: '',
            stderr: '',
          }),
        );
        if (!failureDebugResult.ok) {
          return await finishFailure(failureDebugResult.reason);
        }
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
            result: 'not-launched',
            exitCode: undefined,
            durationMs,
            stopReason: parsedPaths.reason,
            failureDebugPath: failureDebugResult.pointer,
            stdout: '',
            stderr: '',
            staging: undefined,
            taskContext: currentTaskContext,
          }),
        );
        if (!logResult.ok) {
          return await finishFailure(logResult.reason);
        }
        markWorkflowLogCreated(parsedPlan.planName);
        return await finishFailure(parsedPaths.reason);
      }
      if (selectedTask) {
        const taskStage = await setTaskStage({
          stage: 'reviewing',
          detail: `staged ${parsedPaths.paths.length} ${
            parsedPaths.paths.length === 1 ? 'file' : 'files'
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
      });
      if (!acquired.ok) {
        return await finishFailure(acquired.reason);
      }
      logWorkflowProgress();
      logger.log(
        `Staging ${parsedPaths.paths.length} plan-owned ${
          parsedPaths.paths.length === 1 ? 'file' : 'files'
        } for review...`,
      );
      const staged = await runReviewStagingForPaths(rootDir, parsedPaths.paths, processRunner);
      if (!staged.ok) {
        const cleanup = await cleanupReviewStagingPaths(parsedPaths.paths);
        const stopReason = cleanup.ok ? staged.reason : `${staged.reason}; ${cleanup.reason}`;
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
            result: staged.staging ? 'staging-failed' : 'not-launched',
            exitCode: undefined,
            stopReason,
            failureMetadata,
            stdout: '',
            stderr: '',
            staging: staged.staging,
            cleanup: reviewCleanup,
            taskContext: currentTaskContext,
          }),
        );
        if (!failureDebugResult.ok) {
          return await finishFailure(failureDebugResult.reason);
        }
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
            result: staged.staging ? 'staging-failed' : 'not-launched',
            exitCode: undefined,
            durationMs,
            stopReason,
            failureDebugPath: failureDebugResult.pointer,
            stdout: '',
            stderr: '',
            staging: staged.staging,
            cleanup: reviewCleanup,
          }),
        );
        if (!logResult.ok) {
          return await finishFailure(logResult.reason);
        }
        markWorkflowLogCreated(parsedPlan.planName);
        return await finishFailure(stopReason);
      }
      await runScopeCleanupForPaths({
        codexRuntime,
        rootDir,
        planPath: parsedPlan.planPath,
        planContent: parsedPlan.content,
        paths: staged.paths,
        processRunner,
        mode: 'review',
      });
      staging = staged.staging;
      reviewStagingPaths = staged.paths;
    }
    if (route.promptPath === rel('.ai', 'prompts', 'commit-summary.md')) {
      const parsedPaths = await parseCommitSummaryPaths(
        rootDir,
        parsedPlan.content,
        options.isIgnored,
      );
      if (!parsedPaths.ok) {
        return await finishFailure(`commit summary file scope invalid: ${parsedPaths.reason}`);
      }
      commitSummaryPaths = parsedPaths.paths;
      const acquired = await acquireWorkflowFileOwnershipForPaths({
        rootDir,
        planPath: parsedPlan.planPath,
        paths: commitSummaryPaths,
        heldLockPaths: heldWorkflowFileLockPaths,
        now: timestamp,
      });
      if (!acquired.ok) {
        return await finishFailure(acquired.reason);
      }
    }

    logWorkflowProgress();
    const contextSnapshot = await syncWorkflowSnapshot(parsedPlan);
    if (!contextSnapshot.ok) {
      return await finishFailure(contextSnapshot.reason);
    }
    const executeTokenGuardrail = await readExecuteTokenGuardrail({
      rootDir,
      planName: parsedPlan.planName,
      promptPath: route.promptPath,
    });
    const generatedPrompt = generateWorkflowPrompt({
      promptPath: route.promptPath,
      planPath: parsedPlan.planPath,
      promptContent: prompt.content,
      planContent: parsedPlan.content,
      contextSnapshotPath: contextSnapshot.snapshotPath,
      reviewStagingPaths,
      commitSummaryPaths,
      unblockNote,
      executeTokenGuardrail,
      taskContext: currentTaskContext,
      taskSavepointAggregateSummary,
    });
    const editedSummaryPaths = await parseEditedFileSummaryPaths(rootDir, parsedPlan.content);
    const editedFileSnapshot = await readEditedFileSnapshot(rootDir, editedSummaryPaths);
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
          { color: colorOutput },
        )
      : undefined;
    waitNotice.start();
    const result = await processRunner({
      command: codexRuntime.command,
      binaryCommand: CODEX_BINARY_COMMAND,
      args: codexExecArgs({
        executionConfig,
        promptPath: route.promptPath,
        prompt: generatedPrompt,
        rootDir,
      }),
      cwd: rootDir,
      input: '',
      promptPath: route.promptPath,
      env: codexWorkEnvironment(process.env, codexRuntime.profile),
      abortSignal: options.abortSignal,
      onStdout: liveOutput?.stdout,
      onStderr: liveOutput?.stderr,
    })
      .catch(
        (error): ProcessResult => ({
          launched: false,
          stdout: '',
          stderr: '',
          error: String(error),
        }),
      )
      .finally(() => {
        waitNotice.stop();
      });
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
    }
    liveOutput?.flush();

    let stopReason: string | undefined;
    const interruptSignal =
      currentInterruptSignal() ??
      (result.launched && (result.exitSignal === 'SIGINT' || result.exitSignal === 'SIGTERM')
        ? result.exitSignal
        : undefined);
    if (!result.launched) {
      stopReason = `could not launch ${codexRuntime.execLabel}: ${result.error}`;
    } else if (interruptSignal) {
      stopReason = `${codexRuntime.execLabel} interrupted by ${interruptSignal}`;
    } else if (result.exitCode !== 0) {
      stopReason = `${codexRuntime.execLabel} exited with code ${result.exitCode}`;
    } else {
      stopReason = codexOutputStopReason(result.stdout, result.stderr, codexRuntime.execLabel);
    }

    const appendIterationLog = async (
      iterationStopReason?: string,
      endingPlan?: ParsedPlan,
    ): Promise<{ ok: true } | Failure> => {
      const logTimestamp = timestamp();
      const tokenUsage = parseCodexTokenUsage(result.stdout);
      const thresholdWarnings = collectWorkflowThresholdWarnings({
        planByteSize: Buffer.byteLength((endingPlan ?? parsedPlan).content, 'utf8'),
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
            result: result.launched ? 'launched' : 'launch-failed',
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
          model: executionConfig.model,
          reasoning: executionConfig.reasoning,
          contextUsage,
          result: result.launched ? 'launched' : 'launch-failed',
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
        }),
      );
      if (logResult.ok) {
        markWorkflowLogCreated(parsedPlan.planName);
      }
      if (!logResult.ok || !result.launched) {
        return logResult;
      }

      tokenUsageTotals = addTokenUsageToTotals(tokenUsageTotals, tokenUsage);
      const ledgerResult: TokenUsageLedgerResult = interruptSignal
        ? 'interrupted'
        : iterationStopReason
          ? 'failed'
          : 'success';
      const ledgerResultValue = await appendTokenUsageLedger(rootDir, parsedPlan.planName, {
        timestamp: timestamp(),
        iteration: iterations,
        planPath: parsedPlan.planPath,
        startingStatus: parsedPlan.status,
        startingNextAction: parsedPlan.nextAction,
        promptPath: route.promptPath,
        endingStatus: endingPlan?.status,
        endingNextAction: endingPlan?.nextAction,
        model: executionConfig.model,
        reasoning: executionConfig.reasoning,
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
        ...tokenUsageTotals,
      });
      if (ledgerResultValue.ok) {
        markTokenUsageLogCreated(parsedPlan.planName);
      }
      return ledgerResultValue;
    };

    const nonterminalRouteOutcome = (
      updated: ParsedPlan,
    ):
      | { kind: 'blocked'; reason: string; detail: string; planPath: string }
      | undefined => {
      if (
        route.promptPath === rel('.ai', 'prompts', 'execute-plan.md') &&
        updated.status === 'blocked'
      ) {
        const detail = blockedPlanDetail(updated.content);
        const reason = `plan blocked after execute-plan: ${detail}`;
        return { kind: 'blocked', reason, detail, planPath: updated.planPath };
      }

      if (
        route.promptPath === rel('.ai', 'prompts', 'unblock-plan.md') &&
        updated.status === 'blocked'
      ) {
        const detail = blockedPlanDetail(updated.content);
        const reason = `plan remains blocked after unblock-plan: ${detail}`;
        return { kind: 'blocked', reason, detail, planPath: updated.planPath };
      }

      return undefined;
    };

    const finishNonterminalRouteOutcome = async (
      outcome: NonNullable<ReturnType<typeof nonterminalRouteOutcome>>,
    ): Promise<RunnerResult> => {
      return await finishBlocked(outcome.reason, outcome.detail, outcome.planPath);
    };

    if (stopReason) {
      const updated = await parsePlan({ planName: planArgument, rootDir });
      if (updated.ok) {
        emitWorkflowThresholdWarnings(updated.warnings);
        const transition = transitionAllowed(route.promptPath, parsedPlan, updated);
        if (transition.ok) {
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
      const cleanup = await cleanupReviewStagingPaths(reviewStagingPaths);
      const finalStopReason = cleanup.ok ? stopReason : `${stopReason}; ${cleanup.reason}`;
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
        interruptSignal === 'SIGINT' ? 130 : interruptSignal === 'SIGTERM' ? 143 : 1,
      );
    }

    if (route.terminal) {
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
          stage: 'committed',
          detail: shaResult.sha,
          commitSha: shaResult.sha,
        });
        if (!taskStage.ok) {
          return await finishFailure(taskStage.reason);
        }
      }
      const cleanCheck = await verifyCommitSummaryPathsClean(
        rootDir,
        commitSummaryPaths ?? [],
        processRunner,
      );
      if (!cleanCheck.ok) {
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
          planName: parsedPlan.planName,
          planPath: parsedPlan.planPath,
          context: currentTaskContext,
          changedFiles: commitSummaryPaths ?? [],
          validationSummary: 'See plan validation history and commit-summary stage output.',
          reviewResult: 'Review accepted task for commit-summary.',
          commitMessage: compactCapturedOutputForLog(result.stdout) || '(not captured)',
          nextTask,
        });
        if (!artifact.ok) {
          return await finishFailure(artifact.reason);
        }
        const remainingTask = await nextIncompleteTask(rootDir, parsedPlan.planName, planTasks);
        if (remainingTask) {
          const reopened = await reopenPlanForNextTask(parsedPlan);
          if (!reopened.ok) {
            return await finishFailure(reopened.reason);
          }
          const nextParsed = await parsePlan({ planName: planArgument, rootDir });
          if (!nextParsed.ok) {
            return await finishFailure(nextParsed.reason);
          }
          parsedPlan = nextParsed;
          continue;
        }
        parsedPlan = {
          ...parsedPlan,
          content: await readFile(parsedPlan.absolutePlanPath, 'utf8'),
        };
        continue;
      }
      const snapshotResult = await syncWorkflowSnapshot(parsedPlan);
      if (!snapshotResult.ok) {
        return await finishFailure(snapshotResult.reason);
      }
      const reason = 'completed + commit-summary finished';
      return await finishSuccess(reason, iterations);
    }

    const previousContent = parsedPlan.content;
    const updated = await parsePlan({ planName: planArgument, rootDir });
    if (!updated.ok) {
      const cleanup = await cleanupReviewStagingPaths(reviewStagingPaths);
      const reason = cleanup.ok ? updated.reason : `${updated.reason}; ${cleanup.reason}`;
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
      const cleanup = await cleanupReviewStagingPaths(reviewStagingPaths);
      const reason = cleanup.ok
        ? 'plan content unchanged after successful nonterminal workflow action'
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
      const reason = cleanup.ok ? transition.reason : `${transition.reason}; ${cleanup.reason}`;
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
      route.promptPath === rel('.ai', 'prompts', 'review-changes.md') &&
      updated.status === 'active' &&
      updated.nextAction === 'execute-plan'
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

const isMain = process.argv[1] && fileURLToPath(import.meta.url) === path.resolve(process.argv[1]);

if (isMain) {
  const abortController = new AbortController();
  let requestedSignal: NodeJS.Signals | undefined;
  let interruptCount = 0;
  const handleInterrupt = (signal: NodeJS.Signals) => {
    interruptCount += 1;
    requestedSignal = signal;
    if (interruptCount === 1) {
      abortController.abort(signal);
      return;
    }
    process.exit(signal === 'SIGINT' ? 130 : 143);
  };

  process.on('SIGINT', handleInterrupt);
  process.on('SIGTERM', handleInterrupt);
  void runWorkflowRunner({
    argv: process.argv.slice(2),
    abortSignal: abortController.signal,
    interruptSignal: () => requestedSignal,
  })
    .then((result) => {
      process.exitCode = result.exitCode;
    })
    .finally(() => {
      process.off('SIGINT', handleInterrupt);
      process.off('SIGTERM', handleInterrupt);
    });
}
