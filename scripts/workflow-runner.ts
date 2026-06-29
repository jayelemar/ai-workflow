import { spawn } from 'node:child_process';
import type { Writable } from 'node:stream';
import { createHash } from 'node:crypto';
import { mkdir, readFile, rm, stat, writeFile } from 'node:fs/promises';
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
import { validateThinPlanContract } from './workflow-runner/thin-plan.ts';
type CodexProfile = 'codex-work' | 'codex-personal' | 'codex-adam' | 'codex-work6598';
type CodexModel = 'gpt-5.5' | 'gpt-5.4' | 'gpt-5.4-mini' | 'gpt-5.3-codex-spark';
type ReasoningEffort = 'medium' | 'high' | 'xhigh';
type CodexExecutionConfig = {
  model: CodexModel;
  reasoning: ReasoningEffort;
};

export const WORKFLOW_RUNNER_CODEX_PROFILE: CodexProfile = 'codex-work6598' as const;
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
  'deployment-validation',
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
const CODEX_WORK_COMMAND = WORKFLOW_RUNNER_CODEX_PROFILE;
const CODEX_BINARY_COMMAND = 'codex';
const CODEX_HOME_DIRECTORY = `.${WORKFLOW_RUNNER_CODEX_PROFILE}`;
const CODEX_EXEC_LABEL = `${CODEX_WORK_COMMAND} exec`;
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
  status: Status;
  nextAction: NextAction;
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

type WorkflowFileLockMetadata = {
  planPath: string;
  pid: number;
  createdAt: string;
  path: string;
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

const isFiniteNumber = (value: unknown): value is number =>
  typeof value === 'number' && Number.isFinite(value);

const prependPath = (pathValue: string, entry: string): string => {
  const entries = pathValue.split(path.delimiter).filter(Boolean);
  if (entries.includes(entry)) {
    return pathValue;
  }
  return [entry, pathValue].filter(Boolean).join(path.delimiter);
};

export const codexWorkEnvironment = (
  baseEnv: NodeJS.ProcessEnv = process.env,
): NodeJS.ProcessEnv => {
  const home = baseEnv.HOME ?? homedir();
  const nodeBinPath = path.join(home, '.nvm', 'versions', 'node', CODEX_WORK_NODE_VERSION, 'bin');

  return {
    ...baseEnv,
    CODEX_HOME: path.join(home, CODEX_HOME_DIRECTORY),
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

const failedTestNameFromOutput = (text: string): string | undefined => {
  const failureLine = text
    .split(/\r?\n/)
    .map((line) => line.trim())
    .find((line) => line.startsWith('● '));
  if (!failureLine) {
    return undefined;
  }
  const parts = failureLine
    .split('›')
    .map((part) => part.trim())
    .filter(Boolean);
  return parts.at(-1)?.replace(/^●\s*/, '');
};

const failedTestAssertionLines = (text: string): string[] => {
  const lines = text.split(/\r?\n/).map((line) => line.trim());
  const assertionStart = lines.findIndex(
    (line) =>
      line.startsWith('expect(') || line.startsWith('Error:') || line.startsWith('AssertionError'),
  );
  if (assertionStart < 0) {
    return [];
  }

  const assertionLines: string[] = [];
  for (const line of lines.slice(assertionStart)) {
    if (!line) {
      continue;
    }
    if (/^(Test Suites:|Tests:|Snapshots:|Time:|Ran all test suites)/.test(line)) {
      break;
    }
    assertionLines.push(line);
    if (assertionLines.length === 4) {
      break;
    }
  }
  return assertionLines;
};

const formatFailedTestCommandTerminalBlock = (command: string, text: string): string | null => {
  const summary = summarizeFailedTestCommand(command);
  if (!summary) {
    return null;
  }

  const fileLines = formatTerminalFileDetails(summary.files).split('\n');
  const testName = summary.testName ?? failedTestNameFromOutput(text);
  const testNameLine = testName ? [`- ${testName}`] : [];
  const assertionLines = failedTestAssertionLines(text);
  const body = [
    ...fileLines,
    ...testNameLine,
    '',
    ...assertionLines,
    '',
    'command output omitted from workflow log',
  ];

  return `\n${body.join('\n')}\n`;
};

const formatFailedCommandTerminalBlock = (text: string): string => {
  const stats = terminalOutputStats(text);
  if (!stats) {
    return '';
  }

  let output = stats.output.slice(0, TERMINAL_FAILED_COMMAND_OUTPUT_CHAR_LIMIT);
  let truncated = stats.output.length > TERMINAL_FAILED_COMMAND_OUTPUT_CHAR_LIMIT;
  const lines = output.split(/\r?\n/);
  if (lines.length > TERMINAL_FAILED_COMMAND_OUTPUT_LINE_LIMIT) {
    output = lines.slice(0, TERMINAL_FAILED_COMMAND_OUTPUT_LINE_LIMIT).join('\n');
    truncated = true;
  }

  const body = output
    .split(/\r?\n/)
    .map((line) => `  ${line}`)
    .join('\n');
  return `\n${body}\n  ${truncated ? '... output truncated in terminal; ' : ''}command output omitted from workflow log\n`;
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
  if (explicitNextValues.nextAction) {
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
  return nextAction
    ? [`Status: \`${status}\``, `Next Action: \`${nextAction}\``]
    : [`Status: \`${status}\``];
};

const workflowNextActionForStatus = (status: string): NextAction | null => {
  switch (status) {
    case 'active':
      return 'execute-plan';
    case 'review':
      return 'review-plan';
    case 'deployment-validation':
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
  return (
    formatFailedTestCommandTerminalBlock(command, stats.output) ??
    formatFailedCommandTerminalBlock(stats.output)
  );
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
  reasoning,
  color = false,
}: {
  iteration: number;
  maxIterations: number;
  status: string;
  nextAction: string;
  promptPath: string;
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
  return `${formattedProgressPrefix}\n${status} -> ${nextAction} | reasoning: ${reasoning}`;
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
  if (!stopReason.startsWith(`${CODEX_EXEC_LABEL} output contained STOP`)) {
    return undefined;
  }

  const excerpt =
    stopReason.replace(new RegExp(`^${CODEX_EXEC_LABEL} output contained STOP:?\\s*`), '') ||
    'STOP';
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

const formatStopReason = (excerpt?: string): string =>
  `${CODEX_EXEC_LABEL} output contained STOP${excerpt ? `: ${excerpt}` : ''}`;

const classifyFailureForLog = (reason: string): FailureMetadataLogFields => {
  if (reason.startsWith(`${CODEX_EXEC_LABEL} output contained STOP`)) {
    return {
      failureKind: 'codex-stop',
      failureReason:
        reason.replace(new RegExp(`^${CODEX_EXEC_LABEL} output contained STOP:?\\s*`), '') ||
        'STOP',
      nextSuggestedAction: 'unblock-plan with evidence',
    };
  }
  if (reason.startsWith(`could not launch ${CODEX_EXEC_LABEL}`)) {
    return {
      failureKind: 'codex-launch',
      failureReason: reason,
      nextSuggestedAction: 'fix Codex launch environment, then rerun workflow-runner',
    };
  }
  if (reason.startsWith(`${CODEX_EXEC_LABEL} exited with code`)) {
    return {
      failureKind: 'codex-exit',
      failureReason: reason,
      nextSuggestedAction: 'inspect workflow log, fix runtime failure, then rerun workflow-runner',
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

export const codexOutputStopReason = (stdout: string, stderr: string): string | undefined => {
  if (stderr.includes('STOP')) {
    return formatStopReason(plainStopExcerpt(stderr));
  }

  const agentMessages = codexAgentMessageTexts(stdout);
  if (agentMessages.length > 0) {
    for (const message of agentMessages) {
      if (containsStopDirective(message)) {
        const excerpt = message
          .split(/\r?\n/)
          .map(stripStopDirectivePrefix)
          .find((value): value is string => typeof value === 'string');
        return formatStopReason(excerpt);
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
    return formatStopReason(plainStopExcerpt(stdout));
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
  'deployment-validation|commit-summary': COMMIT_SUMMARY_PROMPT_PATH,
  'deployment-validation|unblock-plan': UNBLOCK_PLAN_PROMPT_PATH,
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

const isStatus = (value: string): value is Status => VALID_STATUSES.includes(value as Status);
const isNextAction = (value: string): value is NextAction =>
  VALID_NEXT_ACTIONS.includes(value as NextAction);

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

  const rawStatus = extractSectionValue(content, '## Status');
  if (rawStatus === null) {
    return { ok: false, reason: 'plan is missing ## Status' };
  }
  if (rawStatus.length === 0) {
    return { ok: false, reason: 'plan status value is empty' };
  }
  if (!isStatus(rawStatus)) {
    return { ok: false, reason: `unknown status value: ${rawStatus}` };
  }

  const rawNextAction = extractSectionValue(content, '## Next Action');
  if (rawNextAction === null) {
    return { ok: false, reason: 'plan is missing ## Next Action' };
  }
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

  return {
    ok: true,
    planName: normalized.planName,
    planPath,
    absolutePlanPath,
    content,
    status: rawStatus,
    nextAction: rawNextAction,
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
    promptPath === rel('.ai', 'prompts', 'commit-summary.md') && commitSummaryPaths.length > 0
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
    const executable =
      call.command === CODEX_WORK_COMMAND
        ? {
            command: CODEX_BINARY_COMMAND,
            args: call.args,
            env: call.env ?? codexWorkEnvironment(),
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

const extractLatestDeploymentValidationField = (
  content: string,
  fieldName: string,
): string | undefined => {
  const lines = sectionLines(content, '## Deployment Validation');
  if (lines === null) {
    return undefined;
  }

  const pattern = new RegExp(`^\\*\\s*${fieldName}:\\s*(.+)$`, 'i');
  let latest: string | undefined;
  for (const line of lines) {
    const match = line.trim().match(pattern);
    if (match) {
      latest = boundedInlineExcerpt(match[1]);
    }
  }
  return latest;
};

const deploymentValidationDetail = (content: string): { commit?: string; detail: string } => {
  const pendingValidation = extractLatestDeploymentValidationField(content, 'Pending Validation');
  const reason = extractLatestDeploymentValidationField(content, 'Reason');
  const commit = extractLatestDeploymentValidationField(content, 'Commit');
  return {
    commit,
    detail: pendingValidation ?? reason ?? 'Deployment or external validation is pending',
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
): Promise<string | undefined> => {
  const result = await processRunner({
    command: 'git',
    args: ['diff', '--cached', '--unified=0', '--', ...paths],
    cwd: rootDir,
    input: '',
    promptPath: 'git-scope-cleanup-diff',
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
  rootDir,
  planPath,
  planContent,
  paths,
  processRunner,
  mode,
}: {
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
    command: CODEX_WORK_COMMAND,
    args: codexExecArgs({
      executionConfig,
      promptPath: SCOPE_CLEANUP_PROMPT_PATH,
      prompt: cleanupPrompt,
      rootDir,
    }),
    cwd: rootDir,
    input: '',
    promptPath: SCOPE_CLEANUP_PROMPT_PATH,
    env: codexWorkEnvironment(),
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
    if (previous.status === 'deployment-validation') {
      const allowedPending =
        next.status === 'deployment-validation' && next.nextAction === 'unblock-plan';
      const allowedCompleted = next.status === 'completed' && next.nextAction === 'commit-summary';
      const allowedReopening = next.status === 'reopening' && next.nextAction === 'reopen-plan';
      if (!allowedPending && !allowedCompleted && !allowedReopening) {
        return {
          ok: false,
          reason: `deployment-validation unblock-plan may only hand off to deployment-validation + unblock-plan, completed + commit-summary, or reopening + reopen-plan, got ${next.status} + ${next.nextAction}`,
        };
      }
      return { ok: true };
    }

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
  if (
    promptPath === rel('.ai', 'prompts', 'commit-summary.md') &&
    previous.status === 'deployment-validation'
  ) {
    const allowedPending =
      next.status === 'deployment-validation' && next.nextAction === 'unblock-plan';
    if (!allowedPending) {
      return {
        ok: false,
        reason: `deployment-validation commit-summary may only hand off to deployment-validation + unblock-plan, got ${next.status} + ${next.nextAction}`,
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
  const planArgument = options.planName ?? cliArgs.planArgument;
  const compactOutput = options.compactOutput ?? cliArgs.compactOutput;
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
  const finishDeploymentValidation = async (
    reason: string,
    content: string,
    planPath: string,
    completedIterations = iterations,
  ): Promise<RunnerResult> => {
    const releaseFailure = await releaseHeldWorkflowFileLocks();
    const finalReason = releaseFailure ? `${reason}; ${releaseFailure}` : reason;
    const summary = deploymentValidationDetail(content);
    logger.error('DEPLOYMENT VALIDATION');
    logger.error('- Reason: DEPLOYMENT VALIDATION');
    logger.error(`-> ${summary.detail}`);
    if (summary.commit) {
      logger.error(`-> Commit: ${summary.commit}`);
    }
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
    if (route.promptPath === rel('.ai', 'prompts', 'execute-plan.md')) {
      const ownershipPaths = await parseWorkflowFileOwnershipPaths(
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
      });
      if (!acquired.ok) {
        return await finishFailure(acquired.reason);
      }
    }
    if (route.promptPath === rel('.ai', 'prompts', 'review-changes.md')) {
      const parsedPaths = await parseReviewStagingPaths({
        content: parsedPlan.content,
        rootDir,
        isIgnored: options.isIgnored ?? ((relativePath) => defaultIsIgnored(rootDir, relativePath)),
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
          }),
        );
        if (!logResult.ok) {
          return await finishFailure(logResult.reason);
        }
        markWorkflowLogCreated(parsedPlan.planName);
        return await finishFailure(parsedPaths.reason);
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

    iterations = nextIteration;
    logger.log(
      formatWorkflowProgressLine({
        iteration: iterations,
        maxIterations: MAX_ITERATIONS,
        status: parsedPlan.status,
        nextAction: parsedPlan.nextAction,
        promptPath: route.promptPath,
        reasoning: executionConfig.reasoning,
        color: colorOutput,
      }),
    );
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
      command: CODEX_WORK_COMMAND,
      args: codexExecArgs({
        executionConfig,
        promptPath: route.promptPath,
        prompt: generatedPrompt,
        rootDir,
      }),
      cwd: rootDir,
      input: '',
      promptPath: route.promptPath,
      env: codexWorkEnvironment(),
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
      stopReason = `could not launch ${CODEX_EXEC_LABEL}: ${result.error}`;
    } else if (interruptSignal) {
      stopReason = `${CODEX_EXEC_LABEL} interrupted by ${interruptSignal}`;
    } else if (result.exitCode !== 0) {
      stopReason = `${CODEX_EXEC_LABEL} exited with code ${result.exitCode}`;
    } else {
      stopReason = codexOutputStopReason(result.stdout, result.stderr);
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

    if (stopReason) {
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

    if (
      updated.status === 'deployment-validation' &&
      updated.nextAction === 'unblock-plan' &&
      (route.promptPath === rel('.ai', 'prompts', 'commit-summary.md') ||
        route.promptPath === rel('.ai', 'prompts', 'unblock-plan.md'))
    ) {
      const detail = deploymentValidationDetail(updated.content);
      const reason = `deployment validation pending: ${detail.detail}`;
      return await finishDeploymentValidation(reason, updated.content, updated.planPath);
    }

    if (
      route.promptPath === rel('.ai', 'prompts', 'execute-plan.md') &&
      updated.status === 'blocked'
    ) {
      const detail = blockedPlanDetail(updated.content);
      const reason = `plan blocked after execute-plan: ${detail}`;
      return await finishBlocked(reason, detail, updated.planPath);
    }

    if (
      route.promptPath === rel('.ai', 'prompts', 'unblock-plan.md') &&
      updated.status === 'blocked'
    ) {
      const detail = blockedPlanDetail(updated.content);
      const reason = `plan remains blocked after unblock-plan: ${detail}`;
      return await finishBlocked(reason, detail, updated.planPath);
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
