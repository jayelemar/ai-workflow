import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import type { CodexTokenUsage } from "../../telemetry/token-usage.ts";
import { exceedsWorkflowTokenThresholds } from "../../telemetry/token-warnings.ts";
import { isWorkflowTokenGuardedPrompt } from "../plan/prompt.ts";
import {
  asRecord,
  isFiniteNumber,
  toDisplayString,
  type Failure,
  type TokenUsageTotals,
  type WorkflowContextSnapshotTokenUsage,
  type WorkflowFailureDebugRecord,
  type WorkflowTokenGuardrail,
} from "../types.ts";
import { createZeroTokenUsageTotals } from "./telemetry.ts";

const rel = (...segments: string[]) => segments.join("/");

const failureDebugLedgerRelativePath = (planName: string): string =>
  rel(".ai", "artifacts", planName, "logs", "failure.jsonl");

const failureDebugLedgerAbsolutePath = (
  rootDir: string,
  planName: string,
): string => path.join(rootDir, failureDebugLedgerRelativePath(planName));

export const appendFailureDebugLedger = async (
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

export const tokenUsageLedgerRelativePath = (planName: string): string =>
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

export const readTokenUsageTotals = async (
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
    return createZeroTokenUsageTotals();
  }
  return createZeroTokenUsageTotals();
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

export const readLatestTokenUsage = async (
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

export const readWorkflowTokenGuardrail = async ({
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

export const addTokenUsageToTotals = (
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

export const appendTokenUsageLedger = async (
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
      { flag: "a" },
    );
    return { ok: true };
  } catch (error) {
    return {
      ok: false,
      reason: `token usage ledger cannot be created or appended: ${String(error)}`,
    };
  }
};
