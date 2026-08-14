import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";

import { tokenUsageLedgerRelativePath } from "./token-ledger.ts";
import {
  type ContextUsage,
  type TokenUsageTotals,
} from "./session-snapshot.ts";
import {
  defaultCodexHome,
  detectLatestSessionSnapshot,
} from "./manual-token-sessions.ts";
import {
  addTotals,
  subtractTotals,
  zeroTotals,
} from "./manual-token-totals.ts";

export { parseSessionTokenSnapshot } from "./session-snapshot.ts";
export {
  defaultCodexHome,
  detectLatestSessionSnapshot,
} from "./manual-token-sessions.ts";

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
      return ".ai/prompts/execute-plan.md";
  }
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
  let ledgerPath: string;
  try {
    ledgerPath = path.join(rootDir, tokenUsageLedgerRelativePath(planName));
  } catch (error) {
    return { ok: false, reason: String(error) };
  }
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
    latestManualCheckpoint.sessionTotalTokens ===
      sessionSnapshot.totals.totalTokens
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
