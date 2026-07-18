import path from "node:path";
import { homedir } from "node:os";
import { randomUUID } from "node:crypto";

import { readExactSessionCheckpoint } from "../runner/session-checkpoint.ts";
import { readLifecycleLedgerWithIntegrity, verifyLifecycleLedger } from "../lifecycle/lifecycle-ledger.ts";
import { lifecycleReportPath, regenerateLifecycleReport, verifyLifecycleRevision, verifyStoredLifecycleReport, writeIntegrityVerification } from "../lifecycle/lifecycle-report.ts";
import { readIntegrityInterruptionArtifacts, recordIntegrityInterruption, recoverInterruptedLifecycleFromArtifact, stageCompletionArtifactPath } from "../lifecycle/lifecycle-recovery.ts";
import { isAllowedPreRunRepairPath, resolveV7Decision, resumeV7Decision, runPlanReviewLoop, type ReviewResponse } from "../runner/runner-orchestrator.ts";
import { NO_CODEX_COMPLETING_STAGES, isLifecycleStage } from "../lifecycle/lifecycle.ts";
import { lifecycleRevisionDir, readLifecycleState, writeLifecycleState } from "../lifecycle/lifecycle-store.ts";
import { abandonIntegrityInterruptedV7Workflow, checkpointV7Lifecycle, createV7Workflow, parseLifecycleOutcome, reopenCompletedV7Workflow, reopenIntakeForRouteChange, requireV7PlanSetupLifecycle } from "../lifecycle/workflow-lifecycle.ts";
import { readTaskRemediationResult } from "../lifecycle/task-remediation.ts";
import { verifyWorkflowDocumentBinding, writeWorkflowDocumentBinding } from "../lifecycle/workflow-binding.ts";
import { runAutomaticV7Plan } from "../runner/automatic-runner.ts";
import type { LifecycleState } from "../lifecycle/lifecycle.ts";

const value = (args: string[], flag: string): string | undefined => {
  const index = args.indexOf(flag);
  return index >= 0 ? args[index + 1] : undefined;
};
const values = (args: string[], flag: string): string[] => args.flatMap((entry, index) => entry === flag && args[index + 1] ? [args[index + 1]] : []);
const success = (command: string, state: LifecycleState, extra: Record<string, unknown> = {}): { exitCode: number; message: string } => ({
  exitCode: 0,
  message: JSON.stringify({ ok: true, command, workflowId: state.workflowId, runRevision: state.runRevision, status: state.runOutcome, stage: state.currentStage, ...extra }),
});
const errorCode = (message: string): number => /usage-unavailable|blocked/i.test(message) ? 5 : /integrity|tamper|proof/i.test(message) ? 4 : /lock|conflict|active V7 workflow/i.test(message) ? 3 : /Usage:|invalid|requires|rejects|mismatch|missing/i.test(message) ? 2 : 1;
const publicError = (message: string): string => message
  .replace(/[\r\n\t]+/g, " ")
  .replace(/(api[_-]?key|authorization|bearer|token|password)\s*[=:]\s*[^\s,;]+/gi, "$1=[redacted]")
  .slice(0, 1_000);
const documentBindsWorkflow = async (documentPath: string, workflowName: string): Promise<boolean> => {
  if (!path.isAbsolute(documentPath)) return false;
  try {
    const { readFile } = await import("node:fs/promises");
    const content = await readFile(documentPath, "utf8");
    return new RegExp(`(^|\\n)\\s*workflow(?:Name)?\\s*:\\s*${workflowName}\\s*$`, "mi").test(content);
  } catch { return false; }
};
const intakeStageForRoute = (route: string): "feature-intake" | "bug-intake-root-cause-analysis" => {
  if (route === "feature") return "feature-intake";
  if (route === "bug") return "bug-intake-root-cause-analysis";
  throw new Error("invalid V7 intake route");
};
const isUuid = (value: string | undefined): value is string => Boolean(value && /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(value));

export const V7_USAGE = `Usage:
  pnpm exec tsx .ai/v7/workflow-runner.ts <plan-path.md>
  pnpm exec tsx .ai/v7/workflow-runner.ts create --workflow <name> --route <feature|bug> --intake-revision 1 --spec <absolute-path> --plan <absolute-path> --intake-artifact <absolute-path> --intake-session <uuid> --intake-invocation-start <RFC3339> --workflow-root <absolute-path>
  pnpm exec tsx .ai/v7/workflow-runner.ts checkpoint --workflow <name> --revision <n> --stage <stage> --outcome <outcome> (--session <id> --invocation-start <RFC3339> --workflow-root <absolute-path> | --reason <non-empty>)
  pnpm exec tsx .ai/v7/workflow-runner.ts reopen --workflow <name> --source-revision <n> --spec <absolute-path> --plan <absolute-path>
  pnpm exec tsx .ai/v7/workflow-runner.ts reroute --workflow <name> --source-revision <n> --route <feature|bug> --intake-revision <n> --intake-artifact <absolute-path> --intake-session <uuid> --intake-invocation-start <RFC3339> --workflow-root <absolute-path>
  pnpm exec tsx .ai/v7/workflow-runner.ts recover --workflow <name> --revision <n> --mode <proof|retry> --stage <stage> --attempt <n>
  pnpm exec tsx .ai/v7/workflow-runner.ts recover --workflow <name> --revision <n> --mode abandon --reason <non-empty>
  pnpm exec tsx .ai/v7/workflow-runner.ts resolve-decision --workflow <name> --revision <n> --decision <absolute-path> --resolution-id <uuid> --selected-option <id>
  pnpm exec tsx .ai/v7/workflow-runner.ts resume-decision --workflow <name> --revision <n> --resolution-id <uuid>
  pnpm exec tsx .ai/v7/workflow-runner.ts report --workflow <name> --revision <n>
  pnpm exec tsx .ai/v7/workflow-runner.ts start --workflow <name>`;

export const runV7Cli = async (argv: string[], rootDir = process.cwd()): Promise<{ exitCode: number; message: string }> => {
  const [command, ...args] = argv;
  try {
    if (command?.endsWith(".md")) {
      if (args.length) throw new Error(V7_USAGE);
      const result = await runAutomaticV7Plan({ rootDir, planInput: command });
      const decision = result.stage === "decision-needed";
      const completed = result.status === "completed";
      return {
        exitCode: completed ? 0 : decision ? 6 : 5,
        message: JSON.stringify({ ok: completed, command: "run", workflowId: result.workflowId, runRevision: result.runRevision, status: result.status, stage: result.stage, reportPath: result.reportPath, decisionPath: result.decisionPath }),
      };
    }
    if (command === "create") {
      const workflowName = value(args, "--workflow");
      const route = value(args, "--route");
      const intakeRevision = Number(value(args, "--intake-revision"));
      const specPath = value(args, "--spec");
      const planPath = value(args, "--plan");
      const intakeArtifactPath = value(args, "--intake-artifact");
      const intakeSession = value(args, "--intake-session");
      const invocationStartedAt = value(args, "--intake-invocation-start");
      const workflowRoot = value(args, "--workflow-root");
      if (!workflowName || !route || !["feature", "bug"].includes(route) || intakeRevision !== 1 || !specPath || !planPath || !intakeArtifactPath || !isUuid(intakeSession) || !invocationStartedAt || !workflowRoot || !path.isAbsolute(workflowRoot) || !path.isAbsolute(intakeArtifactPath)
        || !(await documentBindsWorkflow(specPath, workflowName)) || !(await documentBindsWorkflow(planPath, workflowName))) throw new Error("invalid V7 create binding inputs");
      const { readFile } = await import("node:fs/promises");
      const intakeArtifact = JSON.parse(await readFile(intakeArtifactPath, "utf8")) as { version?: unknown; workflowId?: unknown; workflowName?: unknown; risk?: unknown; intakeRevision?: unknown; intakeStage?: unknown; route?: unknown };
      const expectedStage = intakeStageForRoute(route);
      if (intakeArtifact.version !== 7 || typeof intakeArtifact.workflowId !== "string" || intakeArtifact.workflowName !== workflowName || intakeArtifact.intakeRevision !== 1 || (intakeArtifact.intakeStage !== expectedStage && intakeArtifact.route !== route)) throw new Error("V7 intake artifact does not bind requested route and revision");
      if (intakeArtifact.risk === "LOW" || intakeArtifact.risk === "MEDIUM") return { exitCode: 0, message: JSON.stringify({ ok: true, command, workflowId: intakeArtifact.workflowId, route: intakeArtifact.risk === "LOW" ? "direct" : "manual", status: "outside-v7" }) };
      if (intakeArtifact.risk !== "HIGH") throw new Error("V7 intake artifact has invalid risk");
      const codexHome = value(args, "--codex-home") ?? process.env.CODEX_HOME?.trim() ?? path.join(homedir(), ".codex");
      const session = await readExactSessionCheckpoint({ sessionId: intakeSession, rootDir: path.resolve(workflowRoot), codexHome: path.resolve(codexHome), invocationStartedAt });
      const created = await createV7Workflow({ rootDir, workflowName, workflowId: intakeArtifact.workflowId, risk: "HIGH", intakeStage: expectedStage });
      if (!created.created) throw new Error("V7 create did not allocate HIGH lifecycle");
      await writeWorkflowDocumentBinding({ revisionDir: lifecycleRevisionDir(rootDir, workflowName, created.state.runRevision), state: created.state, specPath, planPath });
      const next = await checkpointV7Lifecycle({ rootDir, workflowName, runRevision: created.state.runRevision, outcome: "succeeded", session });
      return success(command, next, { attempt: 1 });
    }
    if (command === "checkpoint") {
      const workflowName = value(args, "--workflow");
      const revision = Number(value(args, "--revision"));
      const stage = value(args, "--stage");
      const outcomeArg = value(args, "--outcome");
      const sessionId = value(args, "--session");
      const reason = value(args, "--reason") ?? value(args, "--no-codex");
      const invocationStartedAt = value(args, "--invocation-start");
      const workflowRoot = value(args, "--workflow-root");
      const taskId = value(args, "--task-id");
      const taskAllowedFiles = values(args, "--allowed-file");
      const attempt = Number(value(args, "--attempt"));
      if (!workflowName || !Number.isInteger(revision) || revision < 1 || !stage || !isLifecycleStage(stage) || !outcomeArg) throw new Error(V7_USAGE);
      const outcome = parseLifecycleOutcome(outcomeArg);
      const state = await readLifecycleState(lifecycleRevisionDir(rootDir, workflowName, revision));
      if (!state || state.currentStage !== stage) throw new Error(`V7 checkpoint stage does not match active lifecycle stage: ${stage}`);
      if (!Number.isSafeInteger(attempt) || attempt < 1) throw new Error(V7_USAGE);
      const ledger = await readLifecycleLedgerWithIntegrity(lifecycleRevisionDir(rootDir, workflowName, revision));
      const expectedAttempt = ledger.records.filter((record) => record.recordKind === "stage-attempt" && record.stage === stage).length + 1;
      if (ledger.parseError || attempt !== expectedAttempt) throw new Error(`V7 checkpoint requires next attempt number ${expectedAttempt}`);
      const codexBacked = !NO_CODEX_COMPLETING_STAGES.includes(state.currentStage);
      if (!codexBacked && (sessionId || invocationStartedAt || workflowRoot)) throw new Error("declared no-Codex V7 stage rejects session, invocation-start, and workflow-root inputs");
      if (!codexBacked && !["zero-token", "skipped"].includes(outcome)) throw new Error("declared no-Codex V7 stage only accepts zero-token or skipped outcomes");
      if (!codexBacked && !reason?.trim()) throw new Error("declared no-Codex V7 stage requires non-empty --reason");
      const failureOutcome = ["failed", "blocked", "usage-unavailable", "interrupted"].includes(outcome);
      if (codexBacked && reason && !failureOutcome) throw new Error("Codex-backed successful V7 stage rejects --reason; provide exact-session evidence");
      if (state.currentStage === "blocker-resolution" && outcome === "zero-token") {
        const resumeStage = value(args, "--resume-stage");
        if (!resumeStage || resumeStage !== state.resumeStage) throw new Error("Blocker Resolution requires matching --resume-stage");
      }
      let session;
      let sessionUnavailable = false;
      if (codexBacked) {
        const codexHome = value(args, "--codex-home") ?? process.env.CODEX_HOME?.trim() ?? path.join(homedir(), ".codex");
        try {
          if (!sessionId || !invocationStartedAt || !workflowRoot || !path.isAbsolute(workflowRoot)) throw new Error("missing exact-session inputs");
          session = await readExactSessionCheckpoint({ sessionId, rootDir: path.resolve(workflowRoot), codexHome: path.resolve(codexHome), invocationStartedAt });
        }
        catch { sessionUnavailable = true; /* record usage-unavailable evidence instead of advancing */ }
      }
      if (codexBacked && failureOutcome && !reason?.trim() && !sessionUnavailable) throw new Error(`V7 ${outcome} outcome requires non-empty --reason`);
      if (state.currentStage === "plan-review" && !sessionUnavailable) {
        const reviewResultPath = value(args, "--review-result");
        const specPath = value(args, "--spec");
        const planPath = value(args, "--plan");
        const changedPaths = values(args, "--changed-file");
        if (!reviewResultPath || !path.isAbsolute(reviewResultPath) || !specPath || !planPath || !path.isAbsolute(specPath) || !path.isAbsolute(planPath) || !session || changedPaths.some((candidate) => !path.isAbsolute(candidate)) || changedPaths.some((candidate) => !isAllowedPreRunRepairPath({ rootDir, workflowName, specPath, planPath, candidate }))) throw new Error("Plan Review requires bound inputs and allowed absolute repair paths");
        const { readFile } = await import("node:fs/promises");
        const parsed = JSON.parse(await readFile(reviewResultPath, "utf8")) as Omit<ReviewResponse, "sessionId" | "tokenUsage" | "model">;
        if (!["OKAY", "FINDINGS"].includes(parsed.verdict) || (parsed.verdict === "FINDINGS" && !Array.isArray(parsed.findings))) throw new Error("invalid V7 Plan Review result schema");
        const reviewResult: ReviewResponse = { ...parsed, sessionId: session.sessionId, tokenUsage: session.tokenUsage, model: session.model };
        const result = await runPlanReviewLoop({ rootDir, state, specPath, planPath, review: async () => reviewResult, repair: async () => ({ changedPaths }) });
        return result.result === "decision-needed"
          ? { exitCode: 6, message: JSON.stringify({ ok: false, code: 6, command, workflowId: result.state.workflowId, runRevision: result.state.runRevision, status: result.state.runOutcome, stage: result.state.currentStage }) }
          : success(command, result.state, { attempt });
      }
      let validationDefect = false;
      if (state.currentStage === "plan-validation") {
        const validationPath = value(args, "--validation-result");
        if (!validationPath || !path.isAbsolute(validationPath)) throw new Error("Plan Validation requires --validation-result");
        const { readFile } = await import("node:fs/promises");
        const validation = JSON.parse(await readFile(validationPath, "utf8")) as { result?: unknown; verdict?: unknown };
        if (!["OKAY", "defect"].includes(String(validation.result ?? validation.verdict))) throw new Error("invalid V7 Plan Validation result schema");
        validationDefect = String(validation.result ?? validation.verdict) === "defect";
      }
      const remediationResultPath = value(args, "--remediation-result");
      if (remediationResultPath && (!path.isAbsolute(remediationResultPath) || !taskId)) throw new Error("Task remediation requires absolute --remediation-result and --task-id");
      const remediationResult = remediationResultPath ? await readTaskRemediationResult(remediationResultPath) : undefined;
      const next = await checkpointV7Lifecycle({ rootDir, workflowName, runRevision: revision, outcome, session, noCodexReason: codexBacked ? undefined : reason, evidence: sessionUnavailable ? "usage-unavailable: exact-session-validation" : reason, taskId, taskAllowedFiles, workflowRoot, validationDefect, remediationRequired: Boolean(remediationResult), remediationResult });
      return sessionUnavailable
        ? { exitCode: 5, message: JSON.stringify({ ok: false, code: 5, command, workflowId: next.workflowId, runRevision: next.runRevision, status: next.runOutcome, stage: next.currentStage }) }
        : success(command, next, { attempt });
    }
    if (command === "resolve-decision") {
      const workflowName = value(args, "--workflow");
      const revision = Number(value(args, "--revision"));
      const decisionPath = value(args, "--decision");
      const resolutionId = value(args, "--resolution-id");
      const selectedOptionId = value(args, "--selected-option");
      if (!workflowName || !Number.isSafeInteger(revision) || revision < 1 || !decisionPath || !path.isAbsolute(decisionPath) || !resolutionId || !selectedOptionId) throw new Error(V7_USAGE);
      const state = await readLifecycleState(lifecycleRevisionDir(rootDir, workflowName, revision));
      if (!state) throw new Error(`no matching V7 lifecycle record for ${workflowName}#${revision}`);
      const resolution = await resolveV7Decision({ rootDir, state, decisionPath, resolutionId, selectedOptionId });
      return success(command, state, { resolutionHash: resolution.resolutionHash });
    }
    if (command === "resume-decision") {
      const workflowName = value(args, "--workflow");
      const revision = Number(value(args, "--revision"));
      const resolutionId = value(args, "--resolution-id");
      if (!workflowName || !Number.isSafeInteger(revision) || revision < 1 || !resolutionId) throw new Error(V7_USAGE);
      const state = await readLifecycleState(lifecycleRevisionDir(rootDir, workflowName, revision));
      if (!state) throw new Error(`no matching V7 lifecycle record for ${workflowName}#${revision}`);
      const next = await resumeV7Decision({ rootDir, state, resolutionId });
      return success(command, next);
    }
    if (command === "recover") {
      const workflowName = value(args, "--workflow");
      const revision = Number(value(args, "--revision"));
      const mode = value(args, "--mode");
      const stage = value(args, "--stage");
      const attempt = Number(value(args, "--attempt"));
      const reason = value(args, "--reason");
      if (!workflowName || !Number.isSafeInteger(revision) || revision < 1 || !["proof", "retry", "abandon"].includes(mode ?? "")) throw new Error(V7_USAGE);
      const revisionDir = lifecycleRevisionDir(rootDir, workflowName, revision);
      const state = await readLifecycleState(revisionDir);
      if (!state) throw new Error(`no matching V7 lifecycle record for ${workflowName}#${revision}`);
      if (mode === "abandon") {
        const abandoned = await abandonIntegrityInterruptedV7Workflow({ rootDir, workflowName, runRevision: revision, reason: reason ?? "" });
        return success(command, abandoned.state, { abandonedRevision: revision, abandonmentHash: abandoned.abandonment.recoveryHash });
      }
      if (!stage || !isLifecycleStage(stage) || !Number.isSafeInteger(attempt) || attempt < 1 || state.currentStage !== stage) throw new Error("V7 recovery state/stage/attempt mismatch");
      const integrity = await readLifecycleLedgerWithIntegrity(revisionDir);
      const verification = integrity.parseError ? { valid: false as const, reason: integrity.parseError } : verifyLifecycleLedger(integrity.records);
      if (!verification.valid) {
        const interruptions = await readIntegrityInterruptionArtifacts(revisionDir);
        if (!interruptions.length) {
          await recordIntegrityInterruption({
            rootDir,
            revisionDir,
            state,
            reasonCode: "ledger-integrity-failure",
            observedHashes: integrity.records.map((record) => record.contentHash),
            recoveryId: randomUUID(),
          });
        }
        throw new Error("V7 recovery rejected due to invalid ledger integrity; abandon into a linked revision is required");
      }
      if (mode === "retry") {
        if (state.runOutcome !== "interrupted" || !reason?.trim()) throw new Error("V7 retry requires interrupted lifecycle state and non-empty reason");
        const nextAttempt = integrity.records.filter((record) => record.recordKind === "stage-attempt" && record.stage === stage).length + 1;
        if (attempt !== nextAttempt) throw new Error(`V7 retry requires next attempt number ${nextAttempt}`);
        const next = { ...state, runOutcome: "active" as const, updatedAt: new Date().toISOString() };
        await writeLifecycleState(rootDir, next);
        await regenerateLifecycleReport(revisionDir, next);
        return success(command, next, { attempt });
      }
      const sessionId = value(args, "--session");
      const workflowRoot = value(args, "--workflow-root");
      const invocationStartedAt = value(args, "--invocation-start");
      const completionArtifact = value(args, "--completion-artifact");
      if (!sessionId || !workflowRoot || !path.isAbsolute(workflowRoot) || !invocationStartedAt || !completionArtifact || path.resolve(completionArtifact) !== stageCompletionArtifactPath(revisionDir, stage, attempt)) throw new Error(V7_USAGE);
      const codexHome = value(args, "--codex-home") ?? process.env.CODEX_HOME?.trim() ?? path.join(homedir(), ".codex");
      const session = await readExactSessionCheckpoint({ sessionId, rootDir: path.resolve(workflowRoot), codexHome: path.resolve(codexHome), invocationStartedAt });
      try {
        const next = await recoverInterruptedLifecycleFromArtifact({ rootDir, revisionDir, state, stage, attempt, sessionId, tokenUsage: session.tokenUsage });
        return success(command, next, { attempt });
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        if (/artifact|ledger|proof/i.test(message) && !(await readIntegrityInterruptionArtifacts(revisionDir)).length) {
          await recordIntegrityInterruption({ rootDir, revisionDir, state, reasonCode: "recovery-proof-integrity-failure", recoveryId: randomUUID() });
        }
        throw error;
      }
    }
    if (command === "report") {
      const workflowName = value(args, "--workflow");
      const revision = Number(value(args, "--revision"));
      if (!workflowName || !Number.isSafeInteger(revision) || revision < 1) throw new Error(V7_USAGE);
      const revisionDir = lifecycleRevisionDir(rootDir, workflowName, revision);
      const state = await readLifecycleState(revisionDir);
      if (!state) throw new Error(`no matching V7 lifecycle record for ${workflowName}#${revision}`);
      const verification = ["completed", "superseded"].includes(state.runOutcome)
        ? await verifyStoredLifecycleReport(revisionDir, state)
        : await verifyLifecycleRevision(revisionDir);
      if (["completed", "superseded"].includes(state.runOutcome)) {
        const verificationPath = !verification.valid ? await writeIntegrityVerification(revisionDir, verification.reason) : undefined;
        return { exitCode: verification.valid ? 0 : 4, message: JSON.stringify({ ok: verification.valid, command, workflowId: state.workflowId, runRevision: state.runRevision, status: state.runOutcome, stage: state.currentStage, reportPath: lifecycleReportPath(revisionDir), verificationPath }) };
      }
      await regenerateLifecycleReport(revisionDir, state);
      return { exitCode: verification.valid ? 0 : 4, message: JSON.stringify({ ok: verification.valid, command, workflowId: state.workflowId, runRevision: state.runRevision, status: state.runOutcome, stage: state.currentStage, reportPath: lifecycleReportPath(revisionDir) }) };
    }
    if (command === "start") {
      const workflowName = value(args, "--workflow");
      if (!workflowName) throw new Error(V7_USAGE);
      const state = await requireV7PlanSetupLifecycle(rootDir, workflowName);
      return success(command, state);
    }
    if (command === "reopen") {
      const workflowName = value(args, "--workflow");
      const sourceRevision = Number(value(args, "--source-revision"));
      const specPath = value(args, "--spec");
      const planPath = value(args, "--plan");
      if (!workflowName || !Number.isSafeInteger(sourceRevision) || sourceRevision < 1 || !specPath || !planPath || !(await documentBindsWorkflow(specPath, workflowName)) || !(await documentBindsWorkflow(planPath, workflowName))) throw new Error(V7_USAGE);
      const sourceDir = lifecycleRevisionDir(rootDir, workflowName, sourceRevision);
      const source = await readLifecycleState(sourceDir);
      if (!source || source.runOutcome !== "completed") throw new Error("V7 reopen requires completed source revision");
      await verifyWorkflowDocumentBinding({ revisionDir: sourceDir, state: source, specPath, planPath });
      const state = await reopenCompletedV7Workflow({ rootDir, workflowName, sourceRevision });
      await writeWorkflowDocumentBinding({ revisionDir: lifecycleRevisionDir(rootDir, workflowName, state.runRevision), state, specPath, planPath });
      return success(command, state);
    }
    if (command === "reroute") {
      const workflowName = value(args, "--workflow");
      const sourceRevision = Number(value(args, "--source-revision"));
      const route = value(args, "--route");
      const intakeRevision = Number(value(args, "--intake-revision"));
      const intakeArtifactPath = value(args, "--intake-artifact");
      const intakeSession = value(args, "--intake-session");
      const invocationStartedAt = value(args, "--intake-invocation-start");
      const workflowRoot = value(args, "--workflow-root");
      if (!workflowName || !Number.isSafeInteger(sourceRevision) || sourceRevision < 1 || !route || !["feature", "bug"].includes(route) || !Number.isSafeInteger(intakeRevision) || intakeRevision < 2 || !intakeArtifactPath || !path.isAbsolute(intakeArtifactPath) || !isUuid(intakeSession) || !invocationStartedAt || !workflowRoot || !path.isAbsolute(workflowRoot)) throw new Error(V7_USAGE);
      const sourceDir = lifecycleRevisionDir(rootDir, workflowName, sourceRevision);
      const source = await readLifecycleState(sourceDir);
      if (!source || source.intakeRevision + 1 !== intakeRevision) throw new Error("V7 reroute requires exactly incremented source intake revision");
      const binding = await verifyWorkflowDocumentBinding({ revisionDir: sourceDir, state: source });
      const { readFile } = await import("node:fs/promises");
      const intakeArtifact = JSON.parse(await readFile(intakeArtifactPath, "utf8")) as { version?: unknown; workflowId?: unknown; workflowName?: unknown; risk?: unknown; intakeRevision?: unknown; intakeStage?: unknown; route?: unknown };
      const intakeStage = intakeStageForRoute(route);
      if (intakeArtifact.version !== 7 || intakeArtifact.workflowId !== source.workflowId || intakeArtifact.workflowName !== workflowName || intakeArtifact.risk !== "HIGH" || intakeArtifact.intakeRevision !== intakeRevision || (intakeArtifact.intakeStage !== intakeStage && intakeArtifact.route !== route)) throw new Error("V7 reroute intake artifact does not bind source and selected route");
      const codexHome = value(args, "--codex-home") ?? process.env.CODEX_HOME?.trim() ?? path.join(homedir(), ".codex");
      const session = await readExactSessionCheckpoint({ sessionId: intakeSession, rootDir: path.resolve(workflowRoot), codexHome: path.resolve(codexHome), invocationStartedAt });
      const result = await reopenIntakeForRouteChange({ rootDir, workflowName, sourceRevision, risk: "HIGH", intakeStage });
      if (!result.created) throw new Error("V7 reroute did not allocate HIGH lifecycle");
      const revisionDir = lifecycleRevisionDir(rootDir, workflowName, result.state.runRevision);
      await writeWorkflowDocumentBinding({ revisionDir, state: result.state, specPath: binding.specPath, planPath: binding.planPath });
      const next = await checkpointV7Lifecycle({ rootDir, workflowName, runRevision: result.state.runRevision, outcome: "succeeded", session });
      return success(command, next, { attempt: 1, supersededRevision: sourceRevision });
    }
    throw new Error(V7_USAGE);
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    const code = errorCode(message);
    return { exitCode: code, message: JSON.stringify({ ok: false, code, message: `V7 command rejected: ${publicError(message)}` }) };
  }
};

if (import.meta.url === `file://${process.argv[1]}`) {
  void runV7Cli(process.argv.slice(2)).then((result) => {
    (result.exitCode === 0 ? process.stdout : process.stderr).write(`${result.message}\n`);
    process.exitCode = result.exitCode;
  });
}
