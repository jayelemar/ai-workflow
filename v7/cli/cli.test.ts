import assert from "node:assert/strict";
import { mkdtemp, mkdir, readFile, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";

import { runV7Cli } from "./cli.ts";
import { checkpointV7Lifecycle, createV7Workflow } from "../lifecycle/workflow-lifecycle.ts";
import { lifecycleRevisionDir, readLifecycleState, writeLifecycleState } from "../lifecycle/lifecycle-store.ts";
import { lifecycleLedgerPath } from "../lifecycle/lifecycle-ledger.ts";
import { lifecycleReportPath, regenerateLifecycleReport } from "../lifecycle/lifecycle-report.ts";

const writeStrictCreateInputs = async ({ root, workflowName, workflowId, risk = "HIGH" }: { root: string; workflowName: string; workflowId: string; risk?: "LOW" | "MEDIUM" | "HIGH" }) => {
  const specPath = path.join(root, `${workflowName}.spec.md`);
  const planPath = path.join(root, `${workflowName}.plan.md`);
  const intakeArtifactPath = path.join(root, `${workflowName}.intake.json`);
  const workflowRoot = path.join(root, "workspace");
  const codexHome = path.join(root, "codex-home");
  const sessionId = "3d1941a3-7193-4bdc-9ae5-3e48c7d548fb";
  const invocationStartedAt = new Date(Date.now() - 1_000).toISOString();
  await mkdir(path.join(codexHome, "sessions"), { recursive: true });
  await mkdir(workflowRoot, { recursive: true });
  await writeFile(specPath, `workflow: ${workflowName}\n`, "utf8");
  await writeFile(planPath, `workflow: ${workflowName}\n`, "utf8");
  await writeFile(intakeArtifactPath, JSON.stringify({ version: 7, workflowId, workflowName, risk, intakeRevision: 1, route: "feature" }), "utf8");
  if (risk === "HIGH") await writeFile(path.join(codexHome, "sessions", "intake.jsonl"), `${JSON.stringify({ type: "session_meta", payload: { session_id: sessionId, cwd: workflowRoot } })}\n${JSON.stringify({ type: "turn_context", payload: { cwd: workflowRoot, model: "gpt" } })}\n${JSON.stringify({ type: "event_msg", payload: { type: "token_count", info: { total_token_usage: { input_tokens: 2, cached_input_tokens: 0, output_tokens: 1, reasoning_output_tokens: 0, total_tokens: 3 } } } })}\n`, "utf8");
  return ["create", "--workflow", workflowName, "--route", "feature", "--intake-revision", "1", "--spec", specPath, "--plan", planPath, "--intake-artifact", intakeArtifactPath, "--intake-session", sessionId, "--intake-invocation-start", invocationStartedAt, "--workflow-root", workflowRoot, "--codex-home", codexHome];
};
const valueFrom = (args: string[], flag: string): string | undefined => {
  const index = args.indexOf(flag);
  return index < 0 ? undefined : args[index + 1];
};

test("CLI creates strict HIGH lifecycle and keeps LOW route outside V7", async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), "v7-cli-"));
  try {
    const low = await runV7Cli(await writeStrictCreateInputs({ root, workflowName: "low", workflowId: "low-id", risk: "LOW" }), root);
    assert.equal(JSON.parse(low.message).status, "outside-v7");
    const highInputs = await writeStrictCreateInputs({ root, workflowName: "high", workflowId: "high-id" });
    const high = await runV7Cli(highInputs, root);
    assert.equal(high.exitCode, 0);
    const bug = await createV7Workflow({ rootDir: root, workflowName: "high-bug", workflowId: "high-bug-id", risk: "HIGH", intakeStage: "bug-intake-root-cause-analysis" });
    assert.equal(bug.created, true);
    if (bug.created) assert.equal(bug.state.currentStage, "bug-intake-root-cause-analysis");
    const duplicate = await runV7Cli(highInputs, root);
    assert.equal(duplicate.exitCode, 3);
  } finally { await rm(root, { recursive: true, force: true }); }
});

test("Plan Review rejects no-Codex checkpoint and blocks progression", async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), "v7-cli-"));
  try {
    const created = await createV7Workflow({ rootDir: root, workflowName: "high", workflowId: "high-id", risk: "HIGH", intakeStage: "feature-intake" });
    assert.equal(created.created, true);
    if (!created.created) return;
    await checkpointV7Lifecycle({ rootDir: root, workflowName: "high", runRevision: 1, outcome: "succeeded", noCodexReason: "intake is filesystem-only" });
    await checkpointV7Lifecycle({ rootDir: root, workflowName: "high", runRevision: 1, outcome: "succeeded", noCodexReason: "spec is filesystem-only" });
    await checkpointV7Lifecycle({ rootDir: root, workflowName: "high", runRevision: 1, outcome: "succeeded", noCodexReason: "plan is filesystem-only" });
    const blocked = await checkpointV7Lifecycle({ rootDir: root, workflowName: "high", runRevision: 1, outcome: "succeeded", noCodexReason: "review cannot be filesystem-only" });
    assert.equal(blocked.currentStage, "blocker-resolution");
    assert.equal(blocked.runOutcome, "blocked");
  } finally { await rm(root, { recursive: true, force: true }); }
});

test("CLI records missing exact-session inputs as usage-unavailable instead of zero-token", async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), "v7-cli-session-"));
  try {
    const created = await createV7Workflow({ rootDir: root, workflowName: "high", workflowId: "high-id", risk: "HIGH", intakeStage: "feature-intake" });
    assert.equal(created.created, true);
    const result = await runV7Cli(["checkpoint", "--workflow", "high", "--revision", "1", "--stage", "feature-intake", "--attempt", "1", "--outcome", "succeeded"], root);
    assert.equal(result.exitCode, 5);
    assert.equal(JSON.parse(result.message).code, 5);
  } finally { await rm(root, { recursive: true, force: true }); }
});

test("CLI exposes sanitized rejection reason for operator diagnosis", async () => {
  const result = await runV7Cli(["missing-command"], process.cwd());
  const payload = JSON.parse(result.message) as { message: string };
  assert.match(payload.message, /Usage:/);
  assert.doesNotMatch(payload.message, /characters withheld/);
});

test("strict reopen and reroute require bound source evidence", async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), "v7-cli-revisions-"));
  try {
    const createInputs = await writeStrictCreateInputs({ root, workflowName: "high", workflowId: "high-id" });
    assert.equal((await runV7Cli(createInputs, root)).exitCode, 0);
    const sourceDir = lifecycleRevisionDir(root, "high", 1);
    const source = await readLifecycleState(sourceDir);
    assert.ok(source);
    if (!source) return;
    await writeLifecycleState(root, { ...source, currentStage: "completion-summary", runOutcome: "completed" });
    const specPath = valueFrom(createInputs, "--spec");
    const planPath = valueFrom(createInputs, "--plan");
    assert.ok(specPath && planPath);
    const reopened = await runV7Cli(["reopen", "--workflow", "high", "--source-revision", "1", "--spec", specPath!, "--plan", planPath!], root);
    assert.equal(reopened.exitCode, 0);
    assert.equal(JSON.parse(reopened.message).stage, "plan-reopening");

    const rerouteRoot = await mkdtemp(path.join(os.tmpdir(), "v7-cli-reroute-"));
    try {
      const rerouteCreate = await writeStrictCreateInputs({ root: rerouteRoot, workflowName: "reroute", workflowId: "reroute-id" });
      assert.equal((await runV7Cli(rerouteCreate, rerouteRoot)).exitCode, 0);
      const codexHome = valueFrom(rerouteCreate, "--codex-home")!;
      const workflowRoot = valueFrom(rerouteCreate, "--workflow-root")!;
      const sessionId = "9138cda8-b95d-4730-b478-b7d30b0a6470";
      const startedAt = new Date(Date.now() - 1_000).toISOString();
      await writeFile(path.join(codexHome, "sessions", "reroute.jsonl"), `${JSON.stringify({ type: "session_meta", payload: { session_id: sessionId, cwd: workflowRoot } })}\n${JSON.stringify({ type: "event_msg", payload: { type: "token_count", info: { total_token_usage: { input_tokens: 2, cached_input_tokens: 0, output_tokens: 1, reasoning_output_tokens: 0, total_tokens: 3 } } } })}\n`);
      const artifact = path.join(rerouteRoot, "reroute-2.json");
      await writeFile(artifact, JSON.stringify({ version: 7, workflowId: "reroute-id", workflowName: "reroute", risk: "HIGH", intakeRevision: 2, route: "bug" }));
      const rerouted = await runV7Cli(["reroute", "--workflow", "reroute", "--source-revision", "1", "--route", "bug", "--intake-revision", "2", "--intake-artifact", artifact, "--intake-session", sessionId, "--intake-invocation-start", startedAt, "--workflow-root", workflowRoot, "--codex-home", codexHome], rerouteRoot);
      assert.equal(rerouted.exitCode, 0);
      assert.equal(JSON.parse(rerouted.message).runRevision, 2);
      assert.equal((await readLifecycleState(lifecycleRevisionDir(rerouteRoot, "reroute", 1)))?.runOutcome, "superseded");
    } finally { await rm(rerouteRoot, { recursive: true, force: true }); }
  } finally { await rm(root, { recursive: true, force: true }); }
});

test("CLI records corrupted-ledger interruption and abandons only into a linked revision", async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), "v7-cli-integrity-"));
  try {
    const created = await createV7Workflow({ rootDir: root, workflowName: "high", workflowId: "high-id", risk: "HIGH", intakeStage: "feature-intake" });
    assert.equal(created.created, true);
    if (!created.created) return;
    await checkpointV7Lifecycle({ rootDir: root, workflowName: "high", runRevision: 1, outcome: "succeeded", noCodexReason: "intake recorded" });
    const sourceDir = lifecycleRevisionDir(root, "high", 1);
    await writeFile(lifecycleLedgerPath(sourceDir), "{corrupt\n", "utf8");
    const rejected = await runV7Cli(["recover", "--workflow", "high", "--revision", "1", "--mode", "retry", "--stage", "blocker-resolution", "--attempt", "1", "--reason", "retry"], root);
    assert.equal(rejected.exitCode, 4, rejected.message);
    assert.equal((await readLifecycleState(sourceDir))?.runOutcome, "interrupted");
    const abandoned = await runV7Cli(["recover", "--workflow", "high", "--revision", "1", "--mode", "abandon", "--reason", "ledger corruption reviewed"], root);
    assert.equal(abandoned.exitCode, 0);
    const payload = JSON.parse(abandoned.message);
    assert.equal(payload.runRevision, 2);
    assert.equal((await readLifecycleState(sourceDir))?.runOutcome, "interrupted");
    const successorDir = lifecycleRevisionDir(root, "high", 2);
    const abandonment = JSON.parse(await readFile(path.join(successorDir, "recovery", "source-abandonment.json"), "utf8"));
    assert.equal(abandonment.sourceRunRevision, 1);
  } finally { await rm(root, { recursive: true, force: true }); }
});

test("completed report verification is read-only and records tamper evidence", async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), "v7-cli-terminal-report-"));
  try {
    const created = await createV7Workflow({ rootDir: root, workflowName: "high", workflowId: "high-id", risk: "HIGH", intakeStage: "feature-intake" });
    assert.equal(created.created, true);
    if (!created.created) return;
    const revisionDir = lifecycleRevisionDir(root, "high", 1);
    const completed = { ...created.state, currentStage: "completion-summary" as const, runOutcome: "completed" as const };
    await writeLifecycleState(root, completed);
    await regenerateLifecycleReport(revisionDir, completed);
    await writeFile(lifecycleReportPath(revisionDir), "tampered report\n", "utf8");
    const result = await runV7Cli(["report", "--workflow", "high", "--revision", "1"], root);
    assert.equal(result.exitCode, 4);
    assert.equal(await readFile(lifecycleReportPath(revisionDir), "utf8"), "tampered report\n");
    const verificationPath = JSON.parse(result.message).verificationPath as string;
    assert.match(await readFile(verificationPath, "utf8"), /integrity verification failed/);
  } finally { await rm(root, { recursive: true, force: true }); }
});
