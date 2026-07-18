import { execFile } from "node:child_process";
import { mkdir, open, readFile, readdir } from "node:fs/promises";
import { promisify } from "node:util";
import path from "node:path";

import { lifecycleReportPath, verifyStoredLifecycleReport } from "../lifecycle/lifecycle-report.ts";
import { lifecycleRevisionDir, readCurrentLifecycleState, readTaskOwnershipManifest, writeLifecycleState } from "../lifecycle/lifecycle-store.ts";
import { routeTaskRemediation, type LifecycleStage, type LifecycleState } from "../lifecycle/lifecycle.ts";
import { canonicalJson } from "../lifecycle/lifecycle-ledger.ts";
import { readV7TaskQueue, writeV7TaskQueue, type V7Task } from "../lifecycle/task-queue.ts";
import { acquireLifecycleLock, releaseLifecycleLock } from "../lifecycle/lifecycle-lock.ts";
import { checkpointV7Lifecycle, createV7Workflow } from "../lifecycle/workflow-lifecycle.ts";
import { verifyWorkflowDocumentBinding, writeWorkflowDocumentBinding } from "../lifecycle/workflow-binding.ts";
import { recordLifecycleAttempt, resumeV7Decision, runPlanReviewLoop, type ReviewResponse } from "./runner-orchestrator.ts";
import { runDedicatedCodexStageWithOutput } from "./codex-process.ts";
import type { ExactSessionCheckpoint } from "./session-checkpoint.ts";

const run = promisify(execFile);
const TASK_HEADER = /^\s*\d+\.\s*\[task:([a-z0-9]+(?:-[a-z0-9]+)*)\]\s+(.+?)\s*$/gm;
const zeroReason = "V7 runner lifecycle bookkeeping completed.";

type ControllerResult = Record<string, unknown>;
export type V7StageController = (input: { stage: LifecycleStage; prompt: string; rootDir: string; task?: V7Task }) => Promise<{ checkpoint: ExactSessionCheckpoint; result: ControllerResult }>;
export type AutomaticRunResult = { workflowId: string; runRevision: number; status: string; stage: LifecycleStage; reportPath: string; decisionPath?: string };

const section = (content: string, heading: string): string | undefined => {
  const match = new RegExp(`^##\\s+${heading}\\s*$`, "mi").exec(content);
  if (!match || match.index === undefined) return undefined;
  const start = match.index + match[0].length;
  const next = /^##\s+/m.exec(content.slice(start));
  return content.slice(start, next ? start + next.index : undefined).trim();
};
const workflowFromPlan = (content: string): string => {
  const workflow = content.match(/^\s*workflow\s*:\s*([a-z0-9]+(?:-[a-z0-9]+)*)\s*$/mi)?.[1];
  if (!workflow) throw new Error("V7 plan requires normalized workflow: binding");
  return workflow;
};
const specFromPlan = (content: string, planPath: string, rootDir: string): string => {
  const entry = section(content, "Spec")?.split(/\r?\n/).map((line) => line.trim()).find((line) => line && !line.startsWith("<!--"));
  if (!entry || /^N\/A/i.test(entry)) throw new Error("V7 plan requires one ## Spec path");
  const candidate = entry.replace(/^[-*]\s*/, "").replace(/`/g, "");
  if (candidate.includes(" ")) throw new Error("V7 plan ## Spec must contain exactly one path");
  if (path.isAbsolute(candidate)) return path.resolve(candidate);
  // thin-plan-v2 declares repo-relative paths (normally `.ai/specs/...`).
  // Keep non-repo-relative paths compatible with plans that intentionally use
  // a path relative to their own directory.
  return candidate.startsWith(".ai/") ? path.resolve(rootDir, candidate) : path.resolve(path.dirname(planPath), candidate);
};
const field = (block: string, label: string): string | undefined => block.match(new RegExp(`^\\s*-\\s*${label}:\\s*(.+?)\\s*$`, "mi"))?.[1]?.trim();
const splitList = (value: string | undefined): string[] => !value || /^none$/i.test(value) || /^n\/a$/i.test(value) ? [] : value.split(",").map((item) => item.trim().replace(/`/g, "")).filter(Boolean);

export const parseV7Tasks = (plan: string, workflowRoot: string): V7Task[] => {
  const matches = [...plan.matchAll(TASK_HEADER)];
  if (!matches.length) throw new Error("V7 plan requires structured [task:...] tasks");
  const tasks = matches.map((match, index) => {
    const block = plan.slice(match.index!, matches[index + 1]?.index ?? plan.length);
    const files = splitList(field(block, "Files"));
    const validation = splitList(field(block, "Validation"));
    const dependsOn = splitList(field(block, "Depends on")).map((value) => value.replace(/^task:/, ""));
    if (!files.length || !validation.length) throw new Error(`V7 task ${match[1]} requires Files and Validation`);
    if (files.some((file) => path.isAbsolute(file) || file.includes("..") || /[*?{}]/.test(file))) throw new Error(`V7 task ${match[1]} has invalid owned file`);
    return { id: match[1], title: match[2].trim(), files: files.map((file) => path.resolve(workflowRoot, file)), validation, dependsOn };
  });
  if (new Set(tasks.map((task) => task.id)).size !== tasks.length) throw new Error("V7 task IDs must be unique");
  return tasks;
};

const findJson = (value: unknown, found: ControllerResult[]): void => {
  if (typeof value === "string") {
    const trimmed = value.trim();
    if (trimmed.startsWith("{") && trimmed.endsWith("}")) try { found.push(JSON.parse(trimmed) as ControllerResult); } catch { /* non-controller text */ }
    const fenced = [...value.matchAll(/```(?:json)?\s*([\s\S]*?)```/gi)];
    for (const match of fenced) try { found.push(JSON.parse(match[1]) as ControllerResult); } catch { /* invalid candidate */ }
  } else if (Array.isArray(value)) value.forEach((item) => findJson(item, found));
  else if (value && typeof value === "object") Object.values(value as Record<string, unknown>).forEach((item) => findJson(item, found));
};
export const controllerResultFromCodexOutput = (output: string, stage: LifecycleStage): ControllerResult => {
  const candidates: ControllerResult[] = [];
  for (const line of output.split(/\r?\n/)) {
    try { findJson(JSON.parse(line), candidates); } catch { findJson(line, candidates); }
  }
  const result = candidates.reverse().find((candidate) => candidate.stage === stage || candidate.verdict || candidate.result);
  if (!result || (result.stage !== undefined && result.stage !== stage)) throw new Error(`V7 ${stage} controller did not return strict structured result`);
  return result;
};

const defaultController: V7StageController = async ({ stage, prompt, rootDir }) => {
  const promptPath = `.ai/v7/wrappers/stages/${stage}.md`;
  const response = await runDedicatedCodexStageWithOutput({ rootDir, promptPath, prompt });
  return { checkpoint: response.checkpoint, result: controllerResultFromCodexOutput(response.output, stage) };
};
const okay = (result: ControllerResult): boolean => result.verdict === "OKAY" || result.result === "OKAY";
const auditFindings = (result: ControllerResult): boolean => result.verdict === "FINDINGS" && Array.isArray(result.findings);
const findings = (result: ControllerResult): ReviewResponse["findings"] => Array.isArray(result.findings) ? result.findings as ReviewResponse["findings"] : undefined;
const latestDecisionPath = async (revisionDir: string): Promise<string> => {
  const decision = (await readdir(path.join(revisionDir, "decisions")).catch(() => [] as string[])).filter((name) => /^decision-needed-\d+\.json$/.test(name)).sort().at(-1);
  return path.join(revisionDir, "decisions", decision ?? "decision-needed-1.json");
};

const controllerPrompt = ({ stage, workflowName, specPath, planPath, task }: { stage: LifecycleStage; workflowName: string; specPath: string; planPath: string; task?: V7Task }): string => [
  `V7 stage: ${stage}. Workflow: ${workflowName}.`,
  `Read only approved inputs unless stage is task-implementation. Spec: ${specPath}. Plan: ${planPath}.`,
  task ? `Current immutable task: ${task.id} — ${task.title}. Allowed files: ${task.files.join(", ")}. Validation: ${task.validation.join(" && ")}.` : "",
  "Return only one JSON object. OKAY: {stage, verdict:\"OKAY\"}. FINDINGS: {stage, verdict:\"FINDINGS\", findings:[{findingCode,severity:\"LOW\"|\"MEDIUM\"|\"HIGH\",material:true,deterministic:boolean,message,options?:[{id,summary}],recommendationId?:string}]}. Task Review must also include conventionalCommit as a valid conventional-commit subject.",
].filter(Boolean).join("\n");

const stageCodex = async (rootDir: string, state: LifecycleState, specPath: string, planPath: string, controller: V7StageController, task?: V7Task): Promise<ControllerResult> => {
  const response = await controller({ stage: state.currentStage, rootDir, task, prompt: controllerPrompt({ stage: state.currentStage, workflowName: state.workflowName, specPath, planPath, task }) });
  if (!response.checkpoint.sessionId || response.checkpoint.tokenUsage.totalTokens <= 0) throw new Error(`V7 ${state.currentStage} controller lacks exact positive session evidence`);
  return { ...response.result, __checkpoint: response.checkpoint };
};
const checkpointFrom = (result: ControllerResult): ExactSessionCheckpoint => result.__checkpoint as ExactSessionCheckpoint;

const taskBaselinePath = (revisionDir: string, taskId: string): string => path.join(revisionDir, "tasks", `task-${taskId}-scope-baseline.json`);
const workingPaths = async (rootDir: string): Promise<string[]> => {
  const { stdout } = await run("git", ["status", "--porcelain=v1", "--untracked-files=all"], { cwd: rootDir });
  return stdout.split(/\r?\n/).filter(Boolean).map((line) => line.slice(3).split(" -> ").at(-1)!).map((file) => path.resolve(rootDir, file)).sort();
};
const writeTaskBaseline = async (revisionDir: string, task: V7Task, rootDir: string): Promise<void> => {
  const target = taskBaselinePath(revisionDir, task.id);
  await mkdir(path.dirname(target), { recursive: true });
  try {
    const handle = await open(target, "wx");
    try { await handle.writeFile(`${canonicalJson({ version: 7, taskId: task.id, paths: await workingPaths(rootDir) })}\n`, "utf8"); await handle.sync(); } finally { await handle.close(); }
  } catch (error: unknown) { if ((error as NodeJS.ErrnoException).code !== "EEXIST") throw error; }
};
const taskBaseline = async (revisionDir: string, taskId: string): Promise<Set<string>> => {
  const value = JSON.parse(await readFile(taskBaselinePath(revisionDir, taskId), "utf8")) as { version?: unknown; taskId?: unknown; paths?: unknown };
  if (value.version !== 7 || value.taskId !== taskId || !Array.isArray(value.paths) || !value.paths.every((candidate) => typeof candidate === "string" && path.isAbsolute(candidate))) throw new Error("invalid V7 task scope baseline");
  return new Set(value.paths);
};
const assertTaskScope = async (rootDir: string, revisionDir: string, workflowName: string, task: V7Task, staged = false): Promise<void> => {
  const args = staged ? ["diff", "--cached", "--name-only"] : ["diff", "--name-only", "HEAD"];
  const { stdout } = await run("git", args, { cwd: rootDir });
  const tracked = stdout.split(/\r?\n/).filter(Boolean).map((file) => path.resolve(rootDir, file));
  const baseline = staged ? new Set<string>() : await taskBaseline(revisionDir, task.id);
  const runtime = path.join(rootDir, ".ai", "artifacts", workflowName, "v7");
  const untracked = staged ? [] : (await workingPaths(rootDir)).filter((file) => !baseline.has(file) && !file.startsWith(`${runtime}${path.sep}`));
  const changed = [...new Set([...tracked.filter((file) => staged || !baseline.has(file)), ...untracked])];
  const outside = changed.filter((file) => !task.files.includes(file));
  if (outside.length) throw new Error(`V7 task ${task.id} changed out-of-scope file`);
};
const runValidation = async (rootDir: string, task: V7Task): Promise<void> => {
  for (const command of task.validation) await run("bash", ["-lc", command], { cwd: rootDir, maxBuffer: 10 * 1024 * 1024 });
};
const conventional = (value: unknown): value is string => typeof value === "string" && /^(build|chore|ci|docs|feat|fix|perf|refactor|revert|style|test)(\([a-z0-9][a-z0-9-]*\))?!?: .{1,72}$/.test(value);
const taskReviewPath = (revisionDir: string, taskId: string): string => path.join(revisionDir, "tasks", `task-${taskId}-review.json`);
const writeTaskReview = async (revisionDir: string, task: V7Task, message: string): Promise<void> => {
  const target = taskReviewPath(revisionDir, task.id);
  await mkdir(path.dirname(target), { recursive: true });
  const handle = await open(target, "wx");
  try { await handle.writeFile(`${canonicalJson({ version: 7, taskId: task.id, conventionalCommit: message })}\n`, "utf8"); await handle.sync(); } finally { await handle.close(); }
};
const readTaskReview = async (revisionDir: string, taskId: string): Promise<string> => {
  const value = JSON.parse(await readFile(taskReviewPath(revisionDir, taskId), "utf8")) as { version?: unknown; taskId?: unknown; conventionalCommit?: unknown };
  if (value.version !== 7 || value.taskId !== taskId || !conventional(value.conventionalCommit)) throw new Error("V7 Task Review lacks validated conventional commit message");
  return value.conventionalCommit;
};
const commitTask = async (rootDir: string, task: V7Task, message: string): Promise<void> => {
  await run("git", ["add", "-A", "--", ...task.files.map((file) => path.relative(rootDir, file))], { cwd: rootDir });
  await assertTaskScope(rootDir, "", "", task, true);
  const { stdout } = await run("git", ["diff", "--cached", "--name-only"], { cwd: rootDir });
  if (!stdout.trim()) throw new Error(`V7 task ${task.id} commit preflight found no owned changes`);
  await run("git", ["diff", "--check", "--cached"], { cwd: rootDir });
  await run("git", ["commit", "-m", message], { cwd: rootDir });
};

const loadInputs = async (rootDir: string, planInput: string) => {
  const planPath = path.resolve(rootDir, planInput);
  if (path.extname(planPath) !== ".md") throw new Error("V7 automatic runner requires a .md plan path");
  const plan = await readFile(planPath, "utf8");
  const workflowName = workflowFromPlan(plan);
  const specPath = specFromPlan(plan, planPath, rootDir);
  const spec = await readFile(specPath, "utf8");
  if (!new RegExp(`(^|\\n)\\s*workflow(?:Name)?\\s*:\\s*${workflowName}\\s*$`, "mi").test(spec)) throw new Error("V7 spec workflow binding mismatch");
  const intakePath = path.join(rootDir, ".ai", "artifacts", workflowName, "v7", "intake.json");
  const intake = JSON.parse(await readFile(intakePath, "utf8")) as { version?: unknown; workflowId?: unknown; workflowName?: unknown; risk?: unknown; route?: unknown; intakeStage?: unknown };
  if (intake.version !== 7 || intake.workflowName !== workflowName || typeof intake.workflowId !== "string" || intake.risk !== "HIGH") throw new Error("V7 requires valid HIGH intake artifact");
  return { planPath, specPath, workflowName, intake, tasks: parseV7Tasks(plan, rootDir) };
};

export const runAutomaticV7Plan = async ({ rootDir = process.cwd(), planInput, controller = defaultController }: { rootDir?: string; planInput: string; controller?: V7StageController }): Promise<AutomaticRunResult> => {
  const input = await loadInputs(rootDir, planInput);
  let state = await readCurrentLifecycleState(rootDir, input.workflowName);
  if (!state) {
    const intakeStage = input.intake.intakeStage === "bug-intake-root-cause-analysis" || input.intake.route === "bug" ? "bug-intake-root-cause-analysis" : "feature-intake";
    const created = await createV7Workflow({ rootDir, workflowName: input.workflowName, workflowId: input.intake.workflowId, risk: "HIGH", intakeStage });
    if (!created.created) throw new Error("V7 automatic runner rejected non-HIGH intake");
    state = created.state;
    await writeWorkflowDocumentBinding({ revisionDir: lifecycleRevisionDir(rootDir, state.workflowName, state.runRevision), state, specPath: input.specPath, planPath: input.planPath });
  } else {
    await verifyWorkflowDocumentBinding({ revisionDir: lifecycleRevisionDir(rootDir, state.workflowName, state.runRevision), state, specPath: input.specPath, planPath: input.planPath });
  }
  const revisionDir = lifecycleRevisionDir(rootDir, state.workflowName, state.runRevision);
  const lock = await acquireLifecycleLock(revisionDir, { workflowId: state.workflowId, runRevision: state.runRevision });
  try {
    if (state.currentStage === "decision-needed") {
      const resolution = (await readdir(path.join(revisionDir, "decisions")).catch(() => [] as string[]))
        .filter((name) => /^decision-resolution-[0-9a-f-]+\.json$/i.test(name)).sort().at(-1);
      if (!resolution) return { workflowId: state.workflowId, runRevision: state.runRevision, status: state.runOutcome, stage: state.currentStage, reportPath: lifecycleReportPath(revisionDir), decisionPath: await latestDecisionPath(revisionDir) };
      state = await resumeV7Decision({ rootDir, state, resolutionId: resolution.slice("decision-resolution-".length, -".json".length) });
    }
    let queue: Awaited<ReturnType<typeof readV7TaskQueue>> | undefined;
    while (state.runOutcome === "active") {
      if (["feature-intake", "bug-intake-root-cause-analysis", "specification-generation", "plan-creation", "plan-reopening"].includes(state.currentStage)) {
        const result = await stageCodex(rootDir, state, input.specPath, input.planPath, controller);
        if (!okay(result) && !auditFindings(result)) throw new Error(`V7 ${state.currentStage} audit requires structured OKAY or FINDINGS result`);
        state = await checkpointV7Lifecycle({ rootDir, workflowName: state.workflowName, runRevision: state.runRevision, outcome: "succeeded", session: checkpointFrom(result) });
        continue;
      }
      if (state.currentStage === "plan-review") {
        const review = await stageCodex(rootDir, state, input.specPath, input.planPath, controller);
        const response: ReviewResponse = { sessionId: checkpointFrom(review).sessionId, model: checkpointFrom(review).model, tokenUsage: checkpointFrom(review).tokenUsage, verdict: okay(review) ? "OKAY" : "FINDINGS", findings: findings(review) };
        const result = await runPlanReviewLoop({ rootDir, state, specPath: input.specPath, planPath: input.planPath, review: async () => response, repair: async () => ({ changedPaths: [] }) });
        state = result.state;
        if (result.result === "decision-needed") return { workflowId: state.workflowId, runRevision: state.runRevision, status: state.runOutcome, stage: state.currentStage, reportPath: lifecycleReportPath(revisionDir), decisionPath: await latestDecisionPath(revisionDir) };
        continue;
      }
      if (state.currentStage === "plan-setup") {
        try { queue = await readV7TaskQueue(revisionDir); } catch { queue = await writeV7TaskQueue({ revisionDir, workflowId: state.workflowId, runRevision: state.runRevision, workflowRoot: rootDir, tasks: input.tasks }); }
        state = await checkpointV7Lifecycle({ rootDir, workflowName: state.workflowName, runRevision: state.runRevision, outcome: "zero-token", noCodexReason: zeroReason });
        continue;
      }
      if (state.currentStage === "plan-validation") {
        const result = await stageCodex(rootDir, state, input.specPath, input.planPath, controller);
        state = await checkpointV7Lifecycle({ rootDir, workflowName: state.workflowName, runRevision: state.runRevision, outcome: "succeeded", session: checkpointFrom(result), validationDefect: !okay(result) });
        continue;
      }
      if (["task-implementation", "task-verification", "task-review", "task-commit"].includes(state.currentStage)) {
        queue ??= await readV7TaskQueue(revisionDir);
        const records = (await import("../lifecycle/lifecycle-ledger.ts")).readLifecycleLedger(revisionDir);
        const completed = (await records).filter((record) => record.stage === "task-commit" && record.outcome === "zero-token").length;
        const task = queue.tasks[completed];
        if (!task) throw new Error("V7 task queue exhausted before Completion Summary");
        if (state.currentStage === "task-commit") {
          const ownership = await readTaskOwnershipManifest(revisionDir, task.id);
          if (ownership.ownershipHash.length !== 64) throw new Error("V7 task ownership integrity failure");
          const message = await readTaskReview(revisionDir, task.id);
          await commitTask(rootDir, task, message);
          state = await checkpointV7Lifecycle({ rootDir, workflowName: state.workflowName, runRevision: state.runRevision, outcome: "zero-token", noCodexReason: zeroReason, taskId: task.id });
          if (completed + 1 < queue.tasks.length) {
            state = { ...state, currentStage: "task-implementation", updatedAt: new Date().toISOString() };
            await writeLifecycleState(rootDir, state);
          }
          continue;
        }
        if (state.currentStage === "task-implementation") await writeTaskBaseline(revisionDir, task, rootDir);
        if (state.currentStage === "task-verification") await runValidation(rootDir, task);
        const result = await stageCodex(rootDir, state, input.specPath, input.planPath, controller, task);
        if (!okay(result)) {
          const recorded = await recordLifecycleAttempt({ rootDir, state, outcome: "succeeded", codexBacked: true, sessionId: checkpointFrom(result).sessionId, model: checkpointFrom(result).model, tokenUsage: checkpointFrom(result).tokenUsage, taskId: task.id, evidence: "Task finding requires scoped remediation.", advance: false });
          state = routeTaskRemediation(recorded);
          await writeLifecycleState(rootDir, state);
          continue;
        }
        await assertTaskScope(rootDir, revisionDir, state.workflowName, task);
        if (state.currentStage === "task-review" && !conventional(result.conventionalCommit)) throw new Error("V7 Task Review requires valid conventionalCommit");
        if (state.currentStage === "task-review") await writeTaskReview(revisionDir, task, result.conventionalCommit as string);
        const evidence = state.currentStage === "task-review" ? "Task Review returned a validated conventional commit message." : undefined;
        state = await checkpointV7Lifecycle({ rootDir, workflowName: state.workflowName, runRevision: state.runRevision, outcome: "succeeded", session: checkpointFrom(result), taskId: task.id, taskAllowedFiles: task.files, workflowRoot: rootDir, evidence });
        continue;
      }
      if (state.currentStage === "completion-summary") {
        state = await checkpointV7Lifecycle({ rootDir, workflowName: state.workflowName, runRevision: state.runRevision, outcome: "zero-token", noCodexReason: zeroReason });
        continue;
      }
      throw new Error(`V7 automatic runner stopped at ${state.currentStage}/${state.runOutcome}`);
    }
    const verified = await verifyStoredLifecycleReport(revisionDir, state);
    if (!verified.valid) throw new Error(`V7 final report integrity failure: ${verified.reason}`);
    return { workflowId: state.workflowId, runRevision: state.runRevision, status: state.runOutcome, stage: state.currentStage, reportPath: lifecycleReportPath(revisionDir) };
  } finally { await releaseLifecycleLock(revisionDir, lock.ownerId); }
};
