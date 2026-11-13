import { spawn } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { runHealthCheck, workflowRoot } from "./health-check.mjs";

const guidance = "scripts/maintenance/workflow-guidance.test.mjs";
const healthTests = "scripts/maintenance/health-check.test.mjs";
const hookTests = "scripts/maintenance/git-hooks.test.mjs";
const selectorTests = "scripts/maintenance/pre-push.test.mjs";
const setupTests = "scripts/setup/agents-override.test.mjs";
const contextTests = "scripts/maintenance/worktree-context.test.mjs";

// null means full regression; an empty array means no ref needs testing.
export function selectTests(paths) {
  if (paths === null) return null;
  if (!paths.length) return [];
  const selected = new Set([guidance]);
  for (const file of paths) {
    if (file.startsWith(".agents/skills/worktree-setup/")) {
      selected.add(contextTests);
    } else if (
      file === "scripts/setup/agents-override.mjs" ||
      file === "docs/codex-agent.md"
    ) {
      selected.add(setupTests);
    } else if (file === "scripts/maintenance/cleanup-local.mjs") {
      selected.add("scripts/maintenance/cleanup-local.test.mjs");
    } else if (file === "scripts/maintenance/health-check.mjs") {
      [healthTests, hookTests, selectorTests].forEach((test) =>
        selected.add(test),
      );
    } else if (file === "scripts/maintenance/pre-push.mjs") {
      [selectorTests, hookTests, healthTests].forEach((test) =>
        selected.add(test),
      );
    } else if (/^scripts\/.+\.test\.(mjs|ts)$/.test(file)) {
      selected.add(file);
    } else if (file.startsWith(".husky/")) {
      [hookTests, healthTests, selectorTests].forEach((test) =>
        selected.add(test),
      );
    } else if (
      /^(?:AGENTS\.md|README\.md)$/.test(file) ||
      /^(?:docs|prompts|instructions)\/.+\.md$/.test(file) ||
      /^\.agents\/skills\/.+\.(?:md|yaml)$/.test(file)
    ) {
      // Static health and guidance tests cover ordinary prose and skill metadata.
    } else {
      return null;
    }
  }
  return [...selected].sort();
}

const execute = ({ command, args, cwd, env }) =>
  new Promise((resolve) => {
    const child = spawn(command, args, {
      cwd,
      env,
      stdio: ["ignore", "pipe", "pipe"],
    });
    let stdout = "";
    let stderr = "";
    child.stdout.on("data", (chunk) => (stdout += chunk));
    child.stderr.on("data", (chunk) => (stderr += chunk));
    child.on("error", (error) =>
      resolve({ exitCode: 1, stdout, stderr: error.message }),
    );
    child.on("close", (code) =>
      resolve({ exitCode: code ?? 1, stdout, stderr }),
    );
  });

export async function changedPaths(updates, git) {
  const lines = updates.trim().split(/\r?\n/).filter(Boolean);
  if (!lines.length) return null;
  const paths = new Set();
  let hasUpdate = false;
  for (const line of lines) {
    const fields = line.trim().split(/\s+/);
    if (fields.length !== 4) return null;
    const [, local, , remote] = fields;
    if (
      !/^(?:[a-f0-9]{40}|[a-f0-9]{64})$/i.test(local) ||
      remote.length !== local.length ||
      !/^[a-f0-9]+$/i.test(remote)
    )
      return null;
    if (/^0+$/.test(local)) continue; // Deleting a ref sends no new code.
    if (/^0+$/.test(remote)) return null; // A new remote ref has no comparison base.
    hasUpdate = true;
    // Account for both the outgoing changes and the checkout being tested.
    for (const [base, head] of [
      [remote, local],
      [local, "HEAD"],
    ]) {
      const diff = await git([
        "diff",
        "--name-only",
        "-z",
        "--no-renames",
        base,
        head,
        "--",
      ]);
      if (diff.exitCode !== 0) return null;
      diff.stdout
        .split("\0")
        .filter(Boolean)
        .forEach((file) => paths.add(file));
    }
  }
  if (!hasUpdate) return [];
  // Tests execute the current checkout, so include local tracked/untracked edits.
  for (const args of [
    ["diff", "--name-only", "-z", "--no-renames", "HEAD", "--"],
    ["ls-files", "--others", "--exclude-standard", "-z"],
  ]) {
    const result = await git(args);
    if (result.exitCode !== 0) return null;
    result.stdout
      .split("\0")
      .filter(Boolean)
      .forEach((file) => paths.add(file));
  }
  return [...paths].sort();
}

export async function runPrePush({
  updates,
  root = workflowRoot,
  commandExecutor = execute,
  healthCheck = runHealthCheck,
  stdout = console.log,
  stderr = console.error,
} = {}) {
  const git = (args) =>
    commandExecutor({
      command: "git",
      args,
      cwd: root,
      env: { ...process.env, GIT_NO_LAZY_FETCH: "1" },
    });
  let tests = selectTests(await changedPaths(updates, git));
  if (tests?.some((test) => !existsSync(path.join(root, test)))) tests = null;
  if (tests === null) {
    stdout(
      "Pre-push: full regression (new ref, unavailable base, or unclassified change)",
    );
    return (await healthCheck({ args: ["--full"], workflowDirectory: root }))
      .ok;
  }
  // Always validate source, configuration, routing, references, and formatting.
  if (!(await healthCheck({ args: [], workflowDirectory: root })).ok)
    return false;
  if (!tests.length) {
    stdout("PASS pre-push: no changed files require regression tests");
    return true;
  }
  stdout(
    `Pre-push: ${tests.length} affected test file(s): ${tests.join(", ")}`,
  );
  const result = await commandExecutor({
    command: process.execPath,
    args: ["--import", "tsx", "--test", ...tests],
    cwd: root,
  });
  if (result.stdout) stdout(result.stdout.trimEnd());
  if (result.stderr) stderr(result.stderr.trimEnd());
  return result.exitCode === 0;
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  try {
    const updates = process.stdin.isTTY ? "" : readFileSync(0, "utf8");
    process.exitCode = (await runPrePush({ updates })) ? 0 : 1;
  } catch (error) {
    console.error(`FAIL pre-push: ${error.message}`);
    process.exitCode = 1;
  }
}
