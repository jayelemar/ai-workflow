#!/usr/bin/env node

import { spawn } from "node:child_process";
import { constants } from "node:fs";
import { access, stat } from "node:fs/promises";
import { fileURLToPath } from "node:url";

const REQUIRED_SOURCE_PATHS = [
  ".ai/README.md",
  ".ai/AGENTS.md",
  ".ai/.gitignore",
  ".ai/config/agent-models.toml",
  ".ai/config/agent-model-evals.md",
  ".ai/instructions",
  ".ai/prompts/select-workflow.md",
  ".ai/prompts/create-plan.md",
  ".ai/prompts/execute-plan.md",
  ".ai/prompts/review-changes.md",
  ".ai/templates/plan.template.md",
  ".ai/wrappers/select-workflow.md",
  ".ai/wrappers/execute-plan.md",
  ".ai/scripts/workflow/stage-contract.test.mjs",
  ".ai/scripts/models/update-agent-models.mjs",
  ".ai/scripts/models/update-agent-models.test.mjs",
  ".ai/scripts/workflow/telemetry/manual-token-usage.ts",
  ".ai/scripts/workflow/telemetry/manual-token-usage.test.ts",
  ".ai/scripts/maintenance/health-check.test.mjs",
];

const LOCAL_ONLY_PATHS = [".ai/artifacts", ".ai/plans", ".ai/specs"];

const DEFAULT_COMMANDS = [
  {
    label: "prettier workflow source check",
    command: "pnpm",
    args: [
      "exec",
      "prettier",
      "--check",
      ".ai/instructions",
      ".ai/changelogs",
      ".ai/wrappers",
      ".ai/prompts",
      ".ai/templates",
      ".ai/README.md",
    ],
  },
];

const FULL_TEST_COMMAND = {
  label: "workflow script tests",
  command: "pnpm",
  shell: true,
  args: [
    "exec",
    "tsx",
    "--test",
    "$(find .ai/scripts -type f -name '*.test.*' -print | sort)",
  ],
};

const pathExists = async (path) => {
  try {
    await access(path, constants.F_OK);
    return true;
  } catch {
    return false;
  }
};

const pathIsDirectory = async (path) => {
  try {
    return (await stat(path)).isDirectory();
  } catch {
    return false;
  }
};

const runCommand = (command) =>
  new Promise((resolve) => {
    const child = command.shell
      ? spawn([command.command, ...command.args].join(" "), {
          cwd: command.cwd,
          env: process.env,
          shell: true,
          stdio: ["ignore", "pipe", "pipe"],
        })
      : spawn(command.command, command.args, {
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
    child.on("error", (error) => resolve({ exitCode: 127, stdout, stderr: error.message }));
    child.on("close", (exitCode) => resolve({ exitCode: exitCode ?? 1, stdout, stderr }));
  });

export const parseHealthCheckArgs = (args) => {
  if (args.length === 0) return { full: false };
  if (args.length === 1 && args[0] === "--full") return { full: true };
  if (args.length === 1 && ["-h", "--help"].includes(args[0])) return { help: true, full: false };
  return { error: `Unknown option: ${args.join(" ")}`, full: false };
};

const runStep = async ({ label, command, cwd, commandExecutor, stderr }) => {
  const result = await commandExecutor({ ...command, cwd });
  if (result.exitCode === 0) return true;
  stderr(`FAIL ${label}`);
  if (result.stdout?.trim()) stderr(result.stdout.trim());
  if (result.stderr?.trim()) stderr(result.stderr.trim());
  return false;
};

export const runHealthCheck = async ({
  args = process.argv.slice(2),
  cwd = process.cwd(),
  commandExecutor = runCommand,
  stdout = console.log,
  stderr = console.error,
} = {}) => {
  const options = parseHealthCheckArgs(args);
  if (options.help) {
    stdout("Usage: node .ai/scripts/maintenance/health-check.mjs [--full]");
    return { ok: true };
  }
  if (options.error) {
    stderr(`FAIL parse arguments: ${options.error}`);
    return { ok: false };
  }
  if (!(await pathIsDirectory(`${cwd}/.ai`))) {
    stderr("FAIL parent repository root containing .ai/");
    return { ok: false };
  }
  if (!(await runStep({
    label: "parent Git ignores .ai",
    command: { command: "git", args: ["check-ignore", "-q", "--", ".ai"] },
    cwd,
    commandExecutor,
    stderr,
  }))) return { ok: false };

  for (const relativePath of [...REQUIRED_SOURCE_PATHS, ...LOCAL_ONLY_PATHS]) {
    if (!(await pathExists(`${cwd}/${relativePath}`))) {
      stderr(`FAIL missing required path: ${relativePath}`);
      return { ok: false };
    }
  }
  for (const relativePath of LOCAL_ONLY_PATHS) {
    if (!(await runStep({
      label: `local-only path remains ignored: ${relativePath}`,
      command: { command: "git", args: ["check-ignore", "-q", "--", relativePath] },
      cwd,
      commandExecutor,
      stderr,
    }))) return { ok: false };
  }
  for (const command of options.full ? [...DEFAULT_COMMANDS, FULL_TEST_COMMAND] : DEFAULT_COMMANDS) {
    if (!(await runStep({ label: command.label, command, cwd, commandExecutor, stderr }))) return { ok: false };
  }
  stdout("PASS .ai health check");
  return { ok: true };
};

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const result = await runHealthCheck();
  process.exitCode = result.ok ? 0 : 1;
}
