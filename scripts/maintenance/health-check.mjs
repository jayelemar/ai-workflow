#!/usr/bin/env node

import { spawn } from "node:child_process";
import { constants } from "node:fs";
import { access, readdir, readFile, stat } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

export const workflowRoot = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  "../..",
);

const REQUIRED_SOURCE_PATHS = [
  ".gitignore",
  "AGENTS.md",
  "README.md",
  "package.json",
  "pnpm-lock.yaml",
  "config/agent-models.toml",
  "config/agent-model-evals.md",
  "docs/codex-agent.md",
  "instructions/ai-workflow.md",
  "instructions/shared/workflow-state.md",
  "instructions/shared/reasoning-quality.md",
  "instructions/shared/flow-trace-artifacts.md",
  "instructions/shared/testing.md",
  "prompts/select-workflow.md",
  "prompts/generate-spec.md",
  "prompts/generate-flow-artifacts.md",
  "prompts/create-plan.md",
  "prompts/execute-plan.md",
  "prompts/review-changes.md",
  "prompts/plan-progress.md",
  "prompts/goal-checkpoint.md",
  "templates/plan.template.md",
  "wrappers/README.md",
  "wrappers/generate-flow-artifacts.md",
  "scripts/workflow/stage-contract.test.mjs",
  "scripts/workflow/telemetry/manual-token-usage.ts",
  "scripts/workflow/telemetry/manual-token-usage.test.ts",
  "scripts/models/update-agent-models.mjs",
  "scripts/models/update-agent-models.test.mjs",
  "scripts/maintenance/health-check.test.mjs",
];

const REQUIRED_LOCAL_PATHS = [
  "instructions/index.md",
  "instructions/architecture.md",
  "instructions/ui.md",
];

const LOCAL_ONLY_PROBES = [
  ...REQUIRED_LOCAL_PATHS,
  "plans/.health-check-probe",
  "specs/.health-check-probe",
  "artifacts/.health-check-probe",
  "logs/.health-check-probe",
  "state/.health-check-probe",
];

const FORBIDDEN_PATHS = [
  "changelogs",
  "instructions/shared/ai-workflow.md",
  "prompts/generate-user-flow.md",
  "prompts/manual-preview.md",
  "prompts/plan-validator.md",
  "wrappers/generate-user-flow.md",
  "scripts/workflow/runner",
  "scripts/workflow/runner.spec.md",
];

const FORMAT_ROOTS = [
  "AGENTS.md",
  "README.md",
  "docs/codex-agent.md",
  "instructions",
  "prompts",
  "templates",
  "wrappers",
  "scripts",
  "package.json",
  "pnpm-lock.yaml",
];

const REFERENCE_ROOTS = [
  "AGENTS.md",
  "README.md",
  "docs/codex-agent.md",
  "instructions",
  "prompts",
  "templates",
  "wrappers",
];

const pathExists = async (targetPath) => {
  try {
    await access(targetPath, constants.F_OK);
    return true;
  } catch {
    return false;
  }
};

const pathIsDirectory = async (targetPath) => {
  try {
    return (await stat(targetPath)).isDirectory();
  } catch {
    return false;
  }
};

const collectFiles = async (targetPath, predicate) => {
  const absolutePath = path.join(workflowRoot, targetPath);
  if (!(await pathExists(absolutePath))) return [];
  if (!(await pathIsDirectory(absolutePath))) {
    return predicate(targetPath) ? [targetPath] : [];
  }

  const collected = [];
  for (const entry of await readdir(absolutePath, { withFileTypes: true })) {
    if (
      [
        ".git",
        "node_modules",
        "artifacts",
        "logs",
        "plans",
        "specs",
        "state",
      ].includes(entry.name)
    ) {
      continue;
    }
    const relativePath = path.posix.join(targetPath, entry.name);
    if (entry.isDirectory()) {
      collected.push(...(await collectFiles(relativePath, predicate)));
    } else if (predicate(relativePath)) {
      collected.push(relativePath);
    }
  }
  return collected;
};

const collectFromRoots = async (roots, predicate) => {
  const files = await Promise.all(
    roots.map((root) => collectFiles(root, predicate)),
  );
  return [...new Set(files.flat())].sort();
};

const runCommand = (command) =>
  new Promise((resolve) => {
    const child = spawn(command.command, command.args, {
      cwd: command.cwd,
      env: process.env,
      stdio: ["ignore", "pipe", "pipe"],
    });
    let stdout = "";
    let stderr = "";
    child.stdout.setEncoding("utf8");
    child.stderr.setEncoding("utf8");
    child.stdout.on("data", (chunk) => (stdout += chunk));
    child.stderr.on("data", (chunk) => (stderr += chunk));
    child.on("error", (error) =>
      resolve({ exitCode: 127, stdout, stderr: error.message }),
    );
    child.on("close", (exitCode) =>
      resolve({ exitCode: exitCode ?? 1, stdout, stderr }),
    );
  });

export const parseHealthCheckArgs = (args) => {
  if (args.length === 0) return { full: false };
  if (args.length === 1 && args[0] === "--full") return { full: true };
  if (args.length === 1 && ["-h", "--help"].includes(args[0])) {
    return { help: true, full: false };
  }
  return { error: `Unknown option: ${args.join(" ")}`, full: false };
};

const runStep = async ({ label, command, commandExecutor, stderr }) => {
  const result = await commandExecutor({ ...command, cwd: workflowRoot });
  if (result.exitCode === 0) return { ok: true, result };
  stderr(`FAIL ${label}`);
  if (result.stdout?.trim()) stderr(result.stdout.trim());
  if (result.stderr?.trim()) stderr(result.stderr.trim());
  return { ok: false, result };
};

const gitCheck = async ({
  label,
  args,
  expectExitCode,
  commandExecutor,
  stderr,
}) => {
  const result = await commandExecutor({
    command: "git",
    args,
    cwd: workflowRoot,
  });
  if (result.exitCode === expectExitCode) return true;
  stderr(`FAIL ${label}`);
  if (result.stdout?.trim()) stderr(result.stdout.trim());
  if (result.stderr?.trim()) stderr(result.stderr.trim());
  return false;
};

const validateLiteralReferences = async (stderr) => {
  const markdownFiles = await collectFromRoots(REFERENCE_ROOTS, (file) =>
    file.endsWith(".md"),
  );
  const missing = new Set();

  for (const markdownFile of markdownFiles) {
    const source = await readFile(
      path.join(workflowRoot, markdownFile),
      "utf8",
    );
    for (const match of source.matchAll(/\.ai\/[A-Za-z0-9_./*<>@-]+/g)) {
      const reference = match[0].replace(/[.,;:]+$/, "");
      if (/[<>*]/.test(reference)) continue;
      if (/^\.ai\/(artifacts|logs|plans|specs|state)(\/|$)/.test(reference))
        continue;
      const target = path.resolve(workflowRoot, "..", reference);
      if (!(await pathExists(target)))
        missing.add(`${markdownFile}: ${reference}`);
    }
  }

  if (missing.size === 0) return true;
  stderr(
    `FAIL missing literal .ai references:\n${[...missing].sort().join("\n")}`,
  );
  return false;
};

export const runHealthCheck = async ({
  args = process.argv.slice(2),
  commandExecutor = runCommand,
  stdout = console.log,
  stderr = console.error,
} = {}) => {
  const options = parseHealthCheckArgs(args);
  if (options.help) {
    stdout("Usage: node scripts/maintenance/health-check.mjs [--full]");
    return { ok: true, root: workflowRoot };
  }
  if (options.error) {
    stderr(`FAIL parse arguments: ${options.error}`);
    return { ok: false, root: workflowRoot };
  }

  for (const relativePath of [
    ...REQUIRED_SOURCE_PATHS,
    ...REQUIRED_LOCAL_PATHS,
  ]) {
    if (!(await pathExists(path.join(workflowRoot, relativePath)))) {
      stderr(`FAIL missing required path: ${relativePath}`);
      return { ok: false, root: workflowRoot };
    }
  }

  for (const relativePath of FORBIDDEN_PATHS) {
    if (await pathExists(path.join(workflowRoot, relativePath))) {
      stderr(`FAIL retired workflow path still exists: ${relativePath}`);
      return { ok: false, root: workflowRoot };
    }
  }

  for (const relativePath of REQUIRED_SOURCE_PATHS) {
    if (
      !(await gitCheck({
        label: `canonical source is allowlisted: ${relativePath}`,
        args: ["check-ignore", "--no-index", "-q", "--", relativePath],
        expectExitCode: 1,
        commandExecutor,
        stderr,
      }))
    )
      return { ok: false, root: workflowRoot };
  }

  for (const relativePath of LOCAL_ONLY_PROBES) {
    if (
      !(await gitCheck({
        label: `local path remains ignored: ${relativePath}`,
        args: ["check-ignore", "--no-index", "-q", "--", relativePath],
        expectExitCode: 0,
        commandExecutor,
        stderr,
      }))
    )
      return { ok: false, root: workflowRoot };

    const tracked = await commandExecutor({
      command: "git",
      args: ["ls-files", "--", relativePath],
      cwd: workflowRoot,
    });
    if (tracked.exitCode !== 0 || tracked.stdout.trim()) {
      stderr(`FAIL local path is tracked: ${relativePath}`);
      return { ok: false, root: workflowRoot };
    }
  }

  if (!(await validateLiteralReferences(stderr))) {
    return { ok: false, root: workflowRoot };
  }

  const formatFiles = await collectFromRoots(FORMAT_ROOTS, (file) =>
    /\.(md|mjs|ts|json|yaml)$/.test(file),
  );
  const formatStep = await runStep({
    label: "workflow Markdown and script formatting",
    command: {
      command: "pnpm",
      args: ["exec", "prettier", "--check", ...formatFiles],
    },
    commandExecutor,
    stderr,
  });
  if (!formatStep.ok) return { ok: false, root: workflowRoot };

  if (options.full) {
    const testFiles = await collectFiles("scripts", (file) =>
      /\.test\.(mjs|ts)$/.test(file),
    );
    const testStep = await runStep({
      label: "workflow script tests",
      command: {
        command: process.execPath,
        args: ["--import", "tsx", "--test", ...testFiles.sort()],
      },
      commandExecutor,
      stderr,
    });
    if (!testStep.ok) return { ok: false, root: workflowRoot };
  }

  stdout("PASS .ai health check");
  return { ok: true, root: workflowRoot };
};

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const result = await runHealthCheck();
  process.exitCode = result.ok ? 0 : 1;
}
