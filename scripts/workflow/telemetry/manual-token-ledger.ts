import { mkdir, readdir, readFile, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";

import { tokenUsageLedgerRelativePath } from "./token-ledger.ts";
import {
  parseSessionTokenSnapshot,
  type ContextUsage,
  type SessionTokenSnapshot,
  type TokenUsageTotals,
} from "./session-snapshot.ts";

export { parseSessionTokenSnapshot } from "./session-snapshot.ts";

export type ManualTokenUsageStage = "spec" | "plan" | "execute";

type ManualTokenLedgerRecord = TokenUsageTotals &
  ContextUsage & {
    timestamp: string;
    mode: "manual";
    manualStage: ManualTokenUsageStage;
    promptPath: string;
    model: string;
    reasoning: "session-log";
    stageInputTokens: number;
    stageCachedInputTokens: number;
    stageUncachedInputTokens: number;
    stageOutputTokens: number;
    stageReasoningOutputTokens: number;
    stageTotalTokens: number;
    sessionId: string;
    sessionFilePath: string;
    sessionTotalInputTokens: number;
    sessionTotalCachedInputTokens: number;
    sessionTotalUncachedInputTokens: number;
    sessionTotalOutputTokens: number;
    sessionTotalReasoningOutputTokens: number;
    sessionTotalTokens: number;
  };

type AppendManualTokenUsageOptions = {
  rootDir: string;
  planName: string;
  stage: ManualTokenUsageStage;
  sessionId?: string;
  codexHome?: string;
};

export type AppendManualTokenUsageResult =
  | {
      ok: true;
      status: "appended";
      ledgerPath: string;
      entry: ManualTokenLedgerRecord;
    }
  | {
      ok: true;
      status: "skipped";
      ledgerPath: string;
      reason: string;
    }
  | {
      ok: false;
      reason: string;
      ledgerPath?: string;
    };

const zeroTotals = (): TokenUsageTotals => ({
  inputTokens: 0,
  cachedInputTokens: 0,
  uncachedInputTokens: 0,
  outputTokens: 0,
  reasoningOutputTokens: 0,
  totalTokens: 0,
});

const asRecord = (value: unknown): Record<string, unknown> | null =>
  typeof value === "object" && value !== null
    ? (value as Record<string, unknown>)
    : null;

const isFiniteNumber = (value: unknown): value is number =>
  typeof value === "number" && Number.isFinite(value);

const manualPromptPath = (stage: ManualTokenUsageStage): string => {
  switch (stage) {
    case "spec":
      return ".ai/prompts/generate-spec.md";
    case "plan":
      return ".ai/prompts/create-plan.md";
    case "execute":
      return ".ai/manual/execute.md";
  }
};

export const defaultCodexHome = (): string => {
  const envCodexHome = process.env.CODEX_HOME?.trim();
  if (envCodexHome) {
    return path.resolve(envCodexHome);
  }

  return path.join(os.homedir(), ".codex");
};

const readJsonlRecords = async (
  filePath: string,
): Promise<Record<string, unknown>[]> => {
  let content: string;
  try {
    content = await readFile(filePath, "utf8");
  } catch {
    return [];
  }

  return content
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean)
    .map((line) => {
      try {
        return asRecord(JSON.parse(line));
      } catch {
        return null;
      }
    })
    .filter((record): record is Record<string, unknown> => record !== null);
};

const relativeSessionPath = (codexHome: string, absolutePath: string): string => {
  const relativePath = path.relative(codexHome, absolutePath);
  return relativePath.length > 0 && !relativePath.startsWith("..")
    ? relativePath
    : absolutePath;
};

const collectSessionFiles = async (directory: string): Promise<string[]> => {
  let entries: Awaited<ReturnType<typeof readdir>>;
  try {
    entries = await readdir(directory, { withFileTypes: true });
  } catch {
    return [];
  }

  const files: string[] = [];
  for (const entry of entries) {
    const entryPath = path.join(directory, entry.name);
    if (entry.isDirectory()) {
      files.push(...(await collectSessionFiles(entryPath)));
      continue;
    }
    if (entry.isFile() && entry.name.endsWith(".jsonl")) {
      files.push(entryPath);
    }
  }
  return files;
};

const findSessionFileById = async (
  sessionsDir: string,
  sessionId: string,
): Promise<string | null> => {
  const files = await collectSessionFiles(sessionsDir);
  const match = files.find((filePath) => filePath.includes(sessionId));
  return match ?? null;
};

export const detectLatestSessionSnapshot = async ({
  codexHome,
  cwd,
  sessionId,
}: {
  codexHome: string;
  cwd: string;
  sessionId?: string;
}): Promise<SessionTokenSnapshot | null> => {
  const sessionsDir = path.join(codexHome, "sessions");
  let candidateFiles: string[];

  if (sessionId) {
    const sessionFile = await findSessionFileById(sessionsDir, sessionId);
    candidateFiles = sessionFile ? [sessionFile] : [];
  } else {
    candidateFiles = await collectSessionFiles(sessionsDir);
    candidateFiles.sort((left, right) => right.localeCompare(left));
  }

  for (const filePath of candidateFiles) {
    let content: string;
    try {
      content = await readFile(filePath, "utf8");
    } catch {
      continue;
    }

    const snapshot = parseSessionTokenSnapshot(
      content,
      relativeSessionPath(codexHome, filePath),
      cwd,
    );
    if (!snapshot) {
      continue;
    }
    if (!sessionId || snapshot.sessionId === sessionId) {
      return snapshot;
    }
  }

  return null;
};

const sessionTotalsFromRecord = (
  record: Record<string, unknown>,
): TokenUsageTotals | null => {
  const inputTokens = record.sessionTotalInputTokens;
  const cachedInputTokens = record.sessionTotalCachedInputTokens;
  const uncachedInputTokens = record.sessionTotalUncachedInputTokens;
  const outputTokens = record.sessionTotalOutputTokens;
  const reasoningOutputTokens = record.sessionTotalReasoningOutputTokens;
  const totalTokens = record.sessionTotalTokens;
  if (
    !isFiniteNumber(inputTokens) ||
    !isFiniteNumber(cachedInputTokens) ||
    !isFiniteNumber(uncachedInputTokens) ||
    !isFiniteNumber(outputTokens) ||
    !isFiniteNumber(reasoningOutputTokens) ||
    !isFiniteNumber(totalTokens)
  ) {
    return null;
  }

  return {
    inputTokens,
    cachedInputTokens,
    uncachedInputTokens,
    outputTokens,
    reasoningOutputTokens,
    totalTokens,
  };
};

const cumulativeTotalsFromRecord = (
  record: Record<string, unknown>,
): TokenUsageTotals | null => {
  const inputTokens = record.inputTokens;
  const cachedInputTokens = record.cachedInputTokens;
  const uncachedInputTokens = record.uncachedInputTokens;
  const outputTokens = record.outputTokens;
  const reasoningOutputTokens = record.reasoningOutputTokens;
  const totalTokens = record.totalTokens;
  if (
    !isFiniteNumber(inputTokens) ||
    !isFiniteNumber(cachedInputTokens) ||
    !isFiniteNumber(uncachedInputTokens) ||
    !isFiniteNumber(outputTokens) ||
    !isFiniteNumber(reasoningOutputTokens) ||
    !isFiniteNumber(totalTokens)
  ) {
    return null;
  }

  return {
    inputTokens,
    cachedInputTokens,
    uncachedInputTokens,
    outputTokens,
    reasoningOutputTokens,
    totalTokens,
  };
};

const addTotals = (left: TokenUsageTotals, right: TokenUsageTotals): TokenUsageTotals => ({
  inputTokens: left.inputTokens + right.inputTokens,
  cachedInputTokens: left.cachedInputTokens + right.cachedInputTokens,
  uncachedInputTokens: left.uncachedInputTokens + right.uncachedInputTokens,
  outputTokens: left.outputTokens + right.outputTokens,
  reasoningOutputTokens:
    left.reasoningOutputTokens + right.reasoningOutputTokens,
  totalTokens: left.totalTokens + right.totalTokens,
});

const subtractTotals = (
  current: TokenUsageTotals,
  previous: TokenUsageTotals,
): TokenUsageTotals | null => {
  const diff = {
    inputTokens: current.inputTokens - previous.inputTokens,
    cachedInputTokens: current.cachedInputTokens - previous.cachedInputTokens,
    uncachedInputTokens:
      current.uncachedInputTokens - previous.uncachedInputTokens,
    outputTokens: current.outputTokens - previous.outputTokens,
    reasoningOutputTokens:
      current.reasoningOutputTokens - previous.reasoningOutputTokens,
    totalTokens: current.totalTokens - previous.totalTokens,
  };

  return Object.values(diff).every((value) => value >= 0) ? diff : null;
};

const readLatestManualCheckpointForSession = async (
  ledgerPath: string,
  sessionId: string,
): Promise<Record<string, unknown> | null> => {
  const records = await readJsonlRecords(ledgerPath);
  for (let index = records.length - 1; index >= 0; index -= 1) {
    const record = records[index];
    if (record.mode !== "manual" || record.sessionId !== sessionId) {
      continue;
    }
    if (sessionTotalsFromRecord(record)) {
      return record;
    }
  }
  return null;
};

const readLatestCumulativeTotals = async (
  ledgerPath: string,
): Promise<TokenUsageTotals> => {
  const records = await readJsonlRecords(ledgerPath);
  for (let index = records.length - 1; index >= 0; index -= 1) {
    const totals = cumulativeTotalsFromRecord(records[index]);
    if (totals) {
      return totals;
    }
  }
  return zeroTotals();
};

const appendLedgerRecord = async (
  ledgerPath: string,
  entry: ManualTokenLedgerRecord,
): Promise<void> => {
  await mkdir(path.dirname(ledgerPath), { recursive: true });
  await writeFile(ledgerPath, `${JSON.stringify(entry)}\n`, { flag: "a" });
};

export const appendManualTokenUsageCheckpoint = async ({
  rootDir,
  planName,
  stage,
  sessionId,
  codexHome = defaultCodexHome(),
}: AppendManualTokenUsageOptions): Promise<AppendManualTokenUsageResult> => {
  const ledgerPath = path.join(rootDir, tokenUsageLedgerRelativePath(planName));
  const sessionSnapshot = await detectLatestSessionSnapshot({
    codexHome,
    cwd: rootDir,
    sessionId,
  });
  if (!sessionSnapshot) {
    return {
      ok: false,
      ledgerPath,
      reason: `no Codex session log with cwd ${rootDir} was found`,
    };
  }

  const latestManualCheckpoint = await readLatestManualCheckpointForSession(
    ledgerPath,
    sessionSnapshot.sessionId,
  );
  const previousSessionTotals = latestManualCheckpoint
    ? sessionTotalsFromRecord(latestManualCheckpoint)
    : zeroTotals();
  const previousCumulativeTotals = await readLatestCumulativeTotals(ledgerPath);

  if (
    latestManualCheckpoint &&
    latestManualCheckpoint.manualStage === stage &&
    latestManualCheckpoint.sessionTotalTokens === sessionSnapshot.totals.totalTokens
  ) {
    return {
      ok: true,
      status: "skipped",
      ledgerPath,
      reason: `manual ${stage} checkpoint already recorded for session ${sessionSnapshot.sessionId}`,
    };
  }

  const stageTotals = subtractTotals(
    sessionSnapshot.totals,
    previousSessionTotals,
  );
  if (!stageTotals) {
    return {
      ok: false,
      ledgerPath,
      reason: `session totals moved backwards for session ${sessionSnapshot.sessionId}`,
    };
  }

  if (stageTotals.totalTokens === 0) {
    return {
      ok: true,
      status: "skipped",
      ledgerPath,
      reason: `no new token usage was recorded since the previous manual checkpoint`,
    };
  }

  const cumulativeTotals = addTotals(previousCumulativeTotals, stageTotals);
  const entry: ManualTokenLedgerRecord = {
    timestamp: new Date().toISOString(),
    mode: "manual",
    manualStage: stage,
    promptPath: manualPromptPath(stage),
    model: sessionSnapshot.model,
    reasoning: "session-log",
    stageInputTokens: stageTotals.inputTokens,
    stageCachedInputTokens: stageTotals.cachedInputTokens,
    stageUncachedInputTokens: stageTotals.uncachedInputTokens,
    stageOutputTokens: stageTotals.outputTokens,
    stageReasoningOutputTokens: stageTotals.reasoningOutputTokens,
    stageTotalTokens: stageTotals.totalTokens,
    ...cumulativeTotals,
    ...sessionSnapshot.contextUsage,
    sessionId: sessionSnapshot.sessionId,
    sessionFilePath: sessionSnapshot.sessionFilePath,
    sessionTotalInputTokens: sessionSnapshot.totals.inputTokens,
    sessionTotalCachedInputTokens: sessionSnapshot.totals.cachedInputTokens,
    sessionTotalUncachedInputTokens: sessionSnapshot.totals.uncachedInputTokens,
    sessionTotalOutputTokens: sessionSnapshot.totals.outputTokens,
    sessionTotalReasoningOutputTokens:
      sessionSnapshot.totals.reasoningOutputTokens,
    sessionTotalTokens: sessionSnapshot.totals.totalTokens,
  };

  try {
    await appendLedgerRecord(ledgerPath, entry);
  } catch (error) {
    return {
      ok: false,
      ledgerPath,
      reason: `token usage ledger cannot be created or appended: ${String(error)}`,
    };
  }

  return {
    ok: true,
    status: "appended",
    ledgerPath,
    entry,
  };
};
