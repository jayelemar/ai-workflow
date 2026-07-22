import { readFile, stat } from "node:fs/promises";
import path from "node:path";

import { codexExecutionConfig } from "../../config/codex.ts";
import { REVIEW_CHANGES_PROMPT_PATH, SCOPE_CLEANUP_PROMPT_PATH } from "../../contracts/stage.ts";
import { WORKFLOW_REVIEW_FULL_DIFF_BYTE_LIMIT } from "../../telemetry/token-warnings.ts";
import { extractSpecPaths } from "../plan/parser.ts";
import { workflowContextSnapshotRelativePath } from "../plan/context-snapshot.ts";
import { generateScopeCleanupPrompt, readPrompt } from "../plan/prompt.ts";
import { thinPlanArtifactPath } from "../plan/state.ts";
import { CODEX_BINARY_COMMAND, codexExecArgs, codexWorkEnvironment } from "../process.ts";
import { codexAgentMessageTexts } from "../terminal/codex-events.ts";
import { asRecord, boundedInlineExcerpt } from "../types.ts";
import type { ProcessResult, ProcessRunner, WorkflowFailureDebugRecord, WorkflowRunnerCodexRuntime } from "../types.ts";

type ScopeCleanupDecision = { action: "keep" | "unstage"; patch?: string };
type ScopeCleanupOptions = {
  codexRuntime: WorkflowRunnerCodexRuntime;
  rootDir: string;
  planPath: string;
  planContent: string;
  paths: string[];
  processRunner: ProcessRunner;
  mode: "review" | "commit-summary";
};
type ScopeCleanupResult = { ok: true; skippedLargeDiff?: boolean; diffBytes?: number };

const parseScopeCleanupDecision = (stdout: string): ScopeCleanupDecision | undefined => {
  for (const message of codexAgentMessageTexts(stdout)) {
    const trimmed = message.trim();
    if (!trimmed) continue;
    try {
      const record = asRecord(JSON.parse(trimmed));
      if (!record || (record.action !== "keep" && record.action !== "unstage")) continue;
      const patch = typeof record.patch === "string" && record.patch.trim().length > 0 ? record.patch : undefined;
      return { action: record.action, patch };
    } catch { continue; }
  }
  return undefined;
};

const failureDebugLedgerAbsolutePath = (rootDir: string, planName: string): string =>
  path.join(rootDir, ".ai", "artifacts", planName, "logs", "failure.jsonl");

const latestExecutionEvidenceMtimeMs = async (rootDir: string, planName: string): Promise<number | undefined> => {
  try {
    const workflow = asRecord(JSON.parse(await readFile(path.join(rootDir, thinPlanArtifactPath(planName, "state", "workflow.json")), "utf8")));
    const evidence = asRecord(asRecord(workflow?.latest)?.execution)?.evidence;
    if (typeof evidence !== "string" || path.isAbsolute(evidence)) return undefined;
    return (await stat(path.join(rootDir, evidence))).mtimeMs;
  } catch { return undefined; }
};

const readLatestNonPlanScopedReviewStopEvidence = async (rootDir: string, planName: string): Promise<string | undefined> => {
  let content: string;
  try { content = await readFile(failureDebugLedgerAbsolutePath(rootDir, planName), "utf8"); } catch { return undefined; }
  const executionMtimeMs = await latestExecutionEvidenceMtimeMs(rootDir, planName);
  for (const line of content.split(/\r?\n/).filter(Boolean).reverse()) {
    let entry: Partial<WorkflowFailureDebugRecord>;
    try { entry = JSON.parse(line) as Partial<WorkflowFailureDebugRecord>; } catch { continue; }
    if (entry.promptPath !== REVIEW_CHANGES_PROMPT_PATH || entry.failureKind !== "codex-stop") continue;
    const evidenceText = [entry.failureReason, entry.stopExcerpt, entry.lastAgentMessageExcerpt].filter((value): value is string => typeof value === "string").join("\n");
    if (!evidenceText.includes("non plan-scoped changes detected")) continue;
    const failureTimestampMs = typeof entry.timestamp === "string" ? Date.parse(entry.timestamp) : NaN;
    if (typeof executionMtimeMs === "number" && Number.isFinite(failureTimestampMs) && executionMtimeMs > failureTimestampMs) return undefined;
    const excerpt = entry.lastAgentMessageExcerpt ?? entry.stopExcerpt ?? entry.failureReason;
    return excerpt ? boundedInlineExcerpt(excerpt) : undefined;
  }
  return undefined;
};

const readCachedDiffForPaths = async (rootDir: string, paths: string[], processRunner: ProcessRunner, options: { unified?: number; promptPath?: string } = {}): Promise<string | undefined> => {
  const result = await processRunner({ command: "git", args: ["diff", "--cached", `--unified=${options.unified ?? 0}`, "--", ...paths], cwd: rootDir, input: "", promptPath: options.promptPath ?? "git-scope-cleanup-diff" }).catch((): ProcessResult => ({ launched: false, stdout: "", stderr: "", error: "failed to read staged diff" }));
  if (!result.launched || result.exitCode !== 0) return undefined;
  const diff = result.stdout.trim();
  return diff.length > 0 ? diff : undefined;
};

export const runScopeCleanupForPaths = async ({ codexRuntime, rootDir, planPath, planContent, paths, processRunner, mode }: ScopeCleanupOptions): Promise<ScopeCleanupResult> => {
  if (paths.length === 0) return { ok: true };
  const prompt = await readPrompt(rootDir, SCOPE_CLEANUP_PROMPT_PATH);
  if (!prompt.ok) return { ok: true };
  const diff = await readCachedDiffForPaths(rootDir, paths, processRunner);
  if (!diff) return { ok: true };
  const diffBytes = Buffer.byteLength(diff, "utf8");
  if (diffBytes > WORKFLOW_REVIEW_FULL_DIFF_BYTE_LIMIT) return { ok: true, skippedLargeDiff: true, diffBytes };
  const previousNonPlanScopedStopEvidence = mode === "review" ? await readLatestNonPlanScopedReviewStopEvidence(rootDir, path.posix.basename(planPath, ".md")) : undefined;
  const cleanupPrompt = generateScopeCleanupPrompt({ promptContent: prompt.content, planPath, contextSnapshotPath: workflowContextSnapshotRelativePath(path.posix.basename(planPath, ".md")), specPaths: extractSpecPaths(planContent), paths, diff, mode, previousNonPlanScopedStopEvidence });
  const result = await processRunner({ command: codexRuntime.command, binaryCommand: CODEX_BINARY_COMMAND, args: codexExecArgs({ executionConfig: codexExecutionConfig(SCOPE_CLEANUP_PROMPT_PATH), promptPath: SCOPE_CLEANUP_PROMPT_PATH, prompt: cleanupPrompt, rootDir }), cwd: rootDir, input: "", promptPath: SCOPE_CLEANUP_PROMPT_PATH, env: codexWorkEnvironment(process.env, codexRuntime.profile) }).catch((): ProcessResult => ({ launched: false, stdout: "", stderr: "", error: "scope cleanup launch failed" }));
  if (!result.launched || result.exitCode !== 0) return { ok: true, diffBytes };
  const decision = parseScopeCleanupDecision(result.stdout);
  if (!decision || decision.action !== "unstage" || !decision.patch) return { ok: true, diffBytes };
  await processRunner({ command: "git", args: ["apply", "--cached", "-R", "--unidiff-zero"], cwd: rootDir, input: `${decision.patch.trimEnd()}\n`, promptPath: "git-scope-cleanup-unstage" }).catch((): ProcessResult => ({ launched: false, stdout: "", stderr: "", error: "scope cleanup apply failed" }));
  const remainingDiff = await readCachedDiffForPaths(rootDir, paths, processRunner, {
    promptPath: "git-scope-cleanup-postcheck",
  });
  if (!remainingDiff) {
    // Scope cleanup may remove unrelated hunks, but it must never leave an
    // otherwise valid review with nothing to inspect. Re-stage the runner's
    // complete plan-owned scope; review then decides whether remediation is
    // required from concrete staged evidence.
    await processRunner({
      command: "git",
      args: ["add", "--all", "--", ...paths],
      cwd: rootDir,
      input: "",
      promptPath: "git-scope-cleanup-restage-empty-scope",
    }).catch((): ProcessResult => ({
      launched: false,
      stdout: "",
      stderr: "",
      error: "scope cleanup restage failed",
    }));
  }
  return { ok: true, diffBytes };
};

export const runScopeCleanupForPathBatches = async (options: ScopeCleanupOptions): Promise<ScopeCleanupResult> => {
  const { rootDir, paths, processRunner } = options;
  if (paths.length === 0) return { ok: true };
  let totalDiffBytes = 0;
  let batchPaths: string[] = [];
  let batchBytes = 0;
  let skippedLargeDiffBytes: number | undefined;
  const flushBatch = async () => {
    if (batchPaths.length === 0) return;
    const result = await runScopeCleanupForPaths({ ...options, paths: batchPaths });
    if (result.skippedLargeDiff) skippedLargeDiffBytes = Math.max(skippedLargeDiffBytes ?? 0, result.diffBytes ?? 0);
    batchPaths = [];
    batchBytes = 0;
  };
  for (const scopedPath of paths) {
    const diff = await readCachedDiffForPaths(rootDir, [scopedPath], processRunner, { promptPath: "git-scope-cleanup-batch-size" });
    if (!diff) continue;
    const diffBytes = Buffer.byteLength(diff, "utf8");
    totalDiffBytes += diffBytes;
    if (diffBytes > WORKFLOW_REVIEW_FULL_DIFF_BYTE_LIMIT) { await flushBatch(); skippedLargeDiffBytes = Math.max(skippedLargeDiffBytes ?? 0, diffBytes); continue; }
    if (batchPaths.length > 0 && batchBytes + diffBytes > WORKFLOW_REVIEW_FULL_DIFF_BYTE_LIMIT) await flushBatch();
    batchPaths.push(scopedPath);
    batchBytes += diffBytes;
  }
  await flushBatch();
  return skippedLargeDiffBytes ? { ok: true, skippedLargeDiff: true, diffBytes: skippedLargeDiffBytes } : { ok: true, diffBytes: totalDiffBytes };
};
