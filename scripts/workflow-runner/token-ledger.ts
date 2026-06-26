import { readFile } from 'node:fs/promises';

const rel = (...segments: string[]) => segments.join('/');

const asRecord = (value: unknown): Record<string, unknown> | null =>
  typeof value === 'object' && value !== null ? (value as Record<string, unknown>) : null;

const isFiniteNumber = (value: unknown): value is number =>
  typeof value === 'number' && Number.isFinite(value);

const promptActionFromPath = (promptPath: string): string => {
  const fileName = promptPath.split('/').pop() ?? promptPath;
  return fileName.endsWith('.md') ? fileName.slice(0, -'.md'.length) : fileName;
};

export type TokenUsageLedgerAnalysis = {
  ledgerPath: string;
  latestStage?: {
    iteration?: number;
    promptPath: string;
    promptAction: string;
    totalInputTokens?: number;
    uncachedInputTokens?: number;
  };
  cumulative?: {
    inputTokens?: number;
    totalTokens?: number;
  };
};

export const tokenUsageLedgerRelativePath = (planName: string): string =>
  rel('.ai', 'artifacts', planName, 'logs', 'token-usage.jsonl');

export const analyzeTokenUsageLedger = async (
  rootDir: string,
  planName: string,
): Promise<TokenUsageLedgerAnalysis> => {
  const ledgerPath = tokenUsageLedgerRelativePath(planName);
  let content: string;
  try {
    content = await readFile(`${rootDir}/${ledgerPath}`, 'utf8');
  } catch {
    return { ledgerPath };
  }

  const records = content
    .trim()
    .split(/\r?\n/)
    .filter(Boolean)
    .map((line) => {
      try {
        return asRecord(JSON.parse(line));
      } catch {
        return null;
      }
    })
    .filter((record): record is Record<string, unknown> => record !== null);
  const latest = records.at(-1);
  if (!latest) {
    return { ledgerPath };
  }

  const promptPath =
    typeof latest.promptPath === 'string' && latest.promptPath.length > 0
      ? latest.promptPath
      : '(unknown)';

  return {
    ledgerPath,
    latestStage: {
      iteration: isFiniteNumber(latest.iteration) ? latest.iteration : undefined,
      promptPath,
      promptAction: promptActionFromPath(promptPath),
      totalInputTokens: isFiniteNumber(latest.stageInputTokens)
        ? latest.stageInputTokens
        : undefined,
      uncachedInputTokens: isFiniteNumber(latest.stageUncachedInputTokens)
        ? latest.stageUncachedInputTokens
        : undefined,
    },
    cumulative: {
      inputTokens: isFiniteNumber(latest.inputTokens) ? latest.inputTokens : undefined,
      totalTokens: isFiniteNumber(latest.totalTokens) ? latest.totalTokens : undefined,
    },
  };
};
