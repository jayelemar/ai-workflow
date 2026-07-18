import { randomUUID } from "node:crypto";
import { mkdir, open, readFile, readdir, rename } from "node:fs/promises";
import path from "node:path";

import { lifecycleDisplayName, type LifecycleState } from "./lifecycle.ts";
import { readLifecycleLedgerWithIntegrity, verifyLifecycleLedger, type LedgerVerification, type LifecycleLedgerRecord, type LifecycleTokenUsage } from "./lifecycle-ledger.ts";

const add = (left: LifecycleTokenUsage, right: LifecycleTokenUsage): LifecycleTokenUsage => ({
  inputTokens: left.inputTokens + right.inputTokens,
  cachedInputTokens: left.cachedInputTokens + right.cachedInputTokens,
  uncachedInputTokens: left.uncachedInputTokens + right.uncachedInputTokens,
  outputTokens: left.outputTokens + right.outputTokens,
  reasoningTokens: left.reasoningTokens + right.reasoningTokens,
  totalTokens: left.totalTokens + right.totalTokens,
});
const zero: LifecycleTokenUsage = { inputTokens: 0, cachedInputTokens: 0, uncachedInputTokens: 0, outputTokens: 0, reasoningTokens: 0, totalTokens: 0 };

export const lifecycleReportPath = (revisionDir: string): string => path.join(revisionDir, "report.md");
export const integrityVerificationPath = (revisionDir: string, verificationId: string): string => path.join(revisionDir, "verifications", `integrity-report-${verificationId}.md`);
const invalid = (records: LifecycleLedgerRecord[], reason: string): LedgerVerification => ({ valid: false, records, reason });

export const verifyLifecycleRevision = async (revisionDir: string): Promise<LedgerVerification> => {
  const ledger = await readLifecycleLedgerWithIntegrity(revisionDir);
  if (ledger.parseError) return invalid(ledger.records, ledger.parseError);
  const chain = verifyLifecycleLedger(ledger.records);
  if (!chain.valid) return chain;
  const { readStageCompletionArtifact, readRecoveryArtifact } = await import("./lifecycle-recovery.ts");
  const { readDecisionNeededArtifact, readDecisionResolutionArtifact } = await import("../runner/runner-orchestrator.ts");
  const { readTaskRemediationResult, taskRemediationArtifactPath } = await import("./task-remediation.ts");
  for (const record of chain.records) {
    try {
      if (record.recordKind === "stage-attempt" && record.tokenUsage.totalTokens > 0) {
        if (!record.artifactHash || !record.attempt) return invalid(chain.records, `missing completion artifact reference for ${record.stage}#${record.attempt ?? "?"}`);
        const artifact = await readStageCompletionArtifact(revisionDir, record.stage, record.attempt);
        if (artifact.artifactHash !== record.artifactHash || artifact.workflowId !== record.workflowId || artifact.runRevision !== record.runRevision) return invalid(chain.records, `completion artifact identity mismatch for ${record.stage}#${record.attempt}`);
      }
      if (record.remediationHash) {
        if (!record.taskId || !record.attempt) return invalid(chain.records, "task remediation ledger record lacks task identity");
        const remediation = await readTaskRemediationResult(taskRemediationArtifactPath(revisionDir, record.taskId, record.attempt));
        if (remediation.remediationHash !== record.remediationHash) return invalid(chain.records, `task remediation hash mismatch for ${record.taskId}`);
      }
      if (record.recordKind === "recovery") {
        if (!record.artifactHash || !record.relatedAttempt) return invalid(chain.records, "recovery ledger record lacks immutable recovery reference");
        const recovery = await readRecoveryArtifact(revisionDir, record.stage, record.relatedAttempt);
        if (recovery.recoveryHash !== record.artifactHash) return invalid(chain.records, `recovery artifact hash mismatch for ${record.stage}#${record.relatedAttempt}`);
      }
      if (record.recordKind === "decision") {
        if (!record.artifactHash) return invalid(chain.records, "decision ledger record lacks immutable decision reference");
        const directory = path.join(revisionDir, "decisions");
        const names = await readdir(directory).catch(() => [] as string[]);
        let found = false;
        for (const name of names) {
          const candidate = path.join(directory, name);
          if (/^decision-needed-\d+\.json$/.test(name) && (await readDecisionNeededArtifact(candidate)).decisionHash === record.artifactHash) found = true;
          if (/^decision-resolution-[0-9a-f-]+\.json$/i.test(name) && (await readDecisionResolutionArtifact(candidate)).resolutionHash === record.artifactHash) found = true;
        }
        if (!found) return invalid(chain.records, "decision ledger record references missing or altered artifact");
      }
    } catch (error) {
      return invalid(chain.records, `immutable evidence invalid: ${error instanceof Error ? error.message : String(error)}`);
    }
  }
  return chain;
};
export const renderLifecycleReport = (state: LifecycleState, records: LifecycleLedgerRecord[], verificationOverride?: LedgerVerification): string => {
  const verification = verificationOverride ?? verifyLifecycleLedger(records);
  const totals = records.reduce((sum, record) => add(sum, record.tokenUsage), zero);
  const rows = records.map((record) => `| ${record.recordKind} | ${lifecycleDisplayName(record.stage)} | ${record.attempt ?? ""} | ${record.outcome} | ${record.durationMs} | ${record.tokenUsage.inputTokens} | ${record.tokenUsage.cachedInputTokens} | ${record.tokenUsage.uncachedInputTokens} | ${record.tokenUsage.outputTokens} | ${record.tokenUsage.reasoningTokens} | ${record.tokenUsage.totalTokens} | ${record.taskId ?? ""} | ${record.sessionId ?? ""} | ${record.remediationHash ?? record.artifactHash ?? ""} | ${record.evidence ?? ""} |`).join("\n");
  return `# V7 Lifecycle Report: ${state.workflowName}\n\n- Workflow ID: \`${state.workflowId}\`\n- Run revision: ${state.runRevision}\n- Intake revision: ${state.intakeRevision}\n- Route: ${state.route}\n- Run outcome: ${state.runOutcome}\n- Current stage: ${lifecycleDisplayName(state.currentStage)} (\`${state.currentStage}\`)\n- Hash chain: ${verification.valid ? "VERIFIED" : `INVALID — ${verification.reason}`}\n\n## Attempts\n\n| Kind | Stage | Attempt | Outcome | Duration ms | Input | Cached | Uncached | Output | Reasoning | Total | Task ID | Session ID | Evidence artifact hash | Redacted evidence |\n| --- | --- | ---: | --- | ---: | ---: | ---: | ---: | ---: | ---: | ---: | --- | --- | --- | --- |\n${rows || "| No attempts recorded | | | | | | | | | | | | | | |"}\n\n## Token totals\n\n| Input | Cached | Uncached | Output | Reasoning | Total |\n| ---: | ---: | ---: | ---: | ---: | ---: |\n| ${totals.inputTokens} | ${totals.cachedInputTokens} | ${totals.uncachedInputTokens} | ${totals.outputTokens} | ${totals.reasoningTokens} | ${totals.totalTokens} |\n`;
};

export const verifyStoredLifecycleReport = async (revisionDir: string, state: LifecycleState): Promise<LedgerVerification> => {
  const verification = await verifyLifecycleRevision(revisionDir);
  if (!verification.valid) return verification;
  try {
    if (await readFile(lifecycleReportPath(revisionDir), "utf8") !== renderLifecycleReport(state, verification.records, verification)) {
      return invalid(verification.records, "stored lifecycle report does not match verified derived evidence");
    }
  } catch (error) {
    return invalid(verification.records, `stored lifecycle report is unreadable: ${error instanceof Error ? error.message : String(error)}`);
  }
  return verification;
};

export const regenerateLifecycleReport = async (revisionDir: string, state: LifecycleState): Promise<string> => {
  const verification = await verifyLifecycleRevision(revisionDir);
  const report = renderLifecycleReport(state, verification.records, verification);
  const reportPath = lifecycleReportPath(revisionDir);
  await mkdir(path.dirname(reportPath), { recursive: true });
  const temporary = `${reportPath}.${process.pid}.${randomUUID()}.tmp`;
  const handle = await open(temporary, "wx");
  try {
    await handle.writeFile(report, "utf8");
    await handle.sync();
  } finally { await handle.close(); }
  await rename(temporary, reportPath);
  const directory = await open(path.dirname(reportPath), "r");
  try { await directory.sync(); } finally { await directory.close(); }
  return report;
};

export const writeIntegrityVerification = async (revisionDir: string, reason: string, verificationId = randomUUID()): Promise<string> => {
  const verificationPath = integrityVerificationPath(revisionDir, verificationId);
  await mkdir(path.dirname(verificationPath), { recursive: true });
  const handle = await open(verificationPath, "wx");
  try {
    await handle.writeFile(`# V7 integrity verification failed\n\n${reason.replace(/[\r\n]+/g, " ")}\n`, "utf8");
    await handle.sync();
  } finally { await handle.close(); }
  return verificationPath;
};
