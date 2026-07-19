#!/usr/bin/env node

import { spawn } from "node:child_process";
import { constants } from "node:fs";
import { access, stat } from "node:fs/promises";
import { fileURLToPath } from "node:url";

const REQUIRED_SOURCE_PATHS = [
  ".ai/README.md",
  ".ai/AGENTS.md",
  ".ai/.gitignore",
  ".ai/instructions",
  ".ai/changelogs",
  ".ai/wrappers",
  ".ai/prompts",
  ".ai/prompts/generate-user-flow.md",
  ".ai/wrappers/generate-user-flow.md",
  ".ai/templates",
  ".ai/scripts",
  ".ai/scripts/workflow/runner.ts",
  ".ai/scripts/workflow/runner.test.ts",
  ".ai/scripts/workflow/runner.spec.md",
  ".ai/scripts/workflow/config/codex.ts",
  ".ai/scripts/workflow/config/codex.test.ts",
  ".ai/scripts/workflow/contracts/stage.ts",
  ".ai/scripts/workflow/contracts/stage.test.ts",
  ".ai/scripts/workflow/runner/cli.ts",
  ".ai/scripts/workflow/runner/instruction-router.ts",
  ".ai/scripts/workflow/runner/instruction-router.test.ts",
  ".ai/scripts/workflow/runner/thin-plan.ts",
  ".ai/scripts/workflow/runner/runner.manual-plan.test.ts",
  ".ai/scripts/workflow/telemetry/manual-token-usage.ts",
  ".ai/scripts/workflow/telemetry/manual-token-usage.test.ts",
  ".ai/scripts/workflow/telemetry/token-ledger.ts",
  ".ai/scripts/workflow/telemetry/token-usage.ts",
  ".ai/scripts/workflow/telemetry/token-warnings.ts",
  ".ai/scripts/workflow/ownership/reset-file-ownership.mjs",
  ".ai/scripts/workflow/ownership/reset-file-ownership.test.mjs",
  ".ai/scripts/maintenance/health-check.mjs",
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
  {
    label: "workflow runner help",
    command: "pnpm",
    args: ["exec", "tsx", ".ai/scripts/workflow/runner.ts", "--help"],
  },
];

const RUNNER_TEST_COMMAND = {
  label: "workflow runner tests",
  command: "pnpm",
  args: [
    "exec",
    "tsx",
    "--test",
    ".ai/scripts/workflow/runner.test.ts",
    ".ai/scripts/workflow/config/codex.test.ts",
  ],
};

const FULL_WORKFLOW_TEST_COMMAND = {
  label: "full workflow script tests",
  command: "pnpm",
  // `find` produces all nested target test paths. Paths are fixed internal
  // source paths, not user-provided values.
  shell: true,
  args: [
    "exec",
    "tsx",
    "--test",
    "$(find .ai/scripts -type f -name '*.test.*' -print | sort)",
  ],
};

const quoteCommandPart = (part) => {
  if (/^[A-Za-z0-9_./:=@+-]+$/.test(part)) {
    return part;
  }
  return `'${part.replaceAll("'", "'\\''")}'`;
};

const formatCommand = ({ command, args }) => [command, ...args].map(quoteCommandPart).join(" ");

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
    child.stdout.on("data", (chunk) => {
      stdout += chunk;
    });
    child.stderr.on("data", (chunk) => {
      stderr += chunk;
    });
    child.on("error", (error) => {
      resolve({ exitCode: 127, stdout, stderr: error.message });
    });
    child.on("close", (exitCode) => {
      resolve({ exitCode: exitCode ?? 1, stdout, stderr });
    });
  });

export const parseHealthCheckArgs = (args) => {
  const options = { runnerTests: false, full: false };

  for (const arg of args) {
    if (arg === "--runner-tests") {
      options.runnerTests = true;
      continue;
    }
    if (arg === "--full") {
      options.full = true;
      continue;
    }
    if (arg === "-h" || arg === "--help") {
      return { help: true, runnerTests: false, full: false };
    }
    return { error: `Unknown option: ${arg}`, runnerTests: false, full: false };
  }

  return options;
};

const fail = ({ label, command, message, result, stderr }) => {
  stderr(`FAIL ${label}`);
  if (command) {
    stderr(`Command: ${formatCommand(command)}`);
  }
  if (message) {
    stderr(message);
  }
  if (result?.stdout?.trim()) {
    stderr(result.stdout.trim());
  }
  if (result?.stderr?.trim()) {
    stderr(result.stderr.trim());
  }
};

const runStepCommand = async ({ label, command, cwd, runner, stderr }) => {
  const commandWithCwd = { ...command, cwd };
  const result = await runner(commandWithCwd);

  if (result.exitCode === 0) {
    return true;
  }

  fail({ label, command: commandWithCwd, result, stderr });
  return false;
};

const checkPathExists = async ({ cwd, relativePath, stderr }) => {
  const absolutePath = `${cwd}/${relativePath}`;
  if (await pathExists(absolutePath)) {
    return true;
  }

  fail({
    label: `required source path exists: ${relativePath}`,
    message: `Missing required path: ${relativePath}`,
    stderr,
  });
  return false;
};

export const runHealthCheck = async ({
  args = process.argv.slice(2),
  cwd = process.cwd(),
  runner = runCommand,
  stdout = console.log,
  stderr = console.error,
} = {}) => {
  const options = parseHealthCheckArgs(args);

  if (options.help) {
    stdout(`Usage: node .ai/scripts/maintenance/health-check.mjs [--runner-tests|--full]

Checks the private .ai workflow source from the parent repository root.

Options:
  --runner-tests  Include workflow runner tests
  --full          Run the complete workflow test command`);
    return { ok: true };
  }

  if (options.error) {
    fail({ label: "parse arguments", message: options.error, stderr });
    return { ok: false };
  }

  if (!(await pathIsDirectory(`${cwd}/.ai`))) {
    fail({
      label: "parent repository root containing .ai",
      message: "Run this command from the parent repository root containing .ai/.",
      stderr,
    });
    return { ok: false };
  }

  if (
    !(await runStepCommand({
      label: "parent Git ignores .ai",
      command: { command: "git", args: ["check-ignore", "-q", "--", ".ai"] },
      cwd,
      runner,
      stderr,
    }))
  ) {
    return { ok: false };
  }

  for (const relativePath of REQUIRED_SOURCE_PATHS) {
    if (!(await checkPathExists({ cwd, relativePath, stderr }))) {
      return { ok: false };
    }
  }

  for (const relativePath of LOCAL_ONLY_PATHS) {
    if (
      !(await runStepCommand({
        label: `local-only path remains ignored: ${relativePath}`,
        command: { command: "git", args: ["check-ignore", "-q", "--", relativePath] },
        cwd,
        runner,
        stderr,
      }))
    ) {
      return { ok: false };
    }
  }

  const commands = options.full
    ? [...DEFAULT_COMMANDS, FULL_WORKFLOW_TEST_COMMAND]
    : options.runnerTests
      ? [...DEFAULT_COMMANDS, RUNNER_TEST_COMMAND]
      : DEFAULT_COMMANDS;

  for (const command of commands) {
    if (!(await runStepCommand({ label: command.label, command, cwd, runner, stderr }))) {
      return { ok: false };
    }
  }

  stdout("PASS .ai health check");
  return { ok: true };
};

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const result = await runHealthCheck();
  process.exitCode = result.ok ? 0 : 1;
}
