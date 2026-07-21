import assert from "node:assert/strict";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";

import { parseHealthCheckArgs, runHealthCheck } from "./health-check.mjs";

const createWorkspace = async ({ includeAi = true } = {}) => {
  const root = await mkdtemp(join(tmpdir(), "health-check-"));

  if (includeAi) {
    await mkdir(join(root, ".ai", "instructions"), { recursive: true });
    await mkdir(join(root, ".ai", "changelogs"), { recursive: true });
    await mkdir(join(root, ".ai", "wrappers"), { recursive: true });
    await mkdir(join(root, ".ai", "prompts"), { recursive: true });
    await mkdir(join(root, ".ai", "templates"), { recursive: true });
    await mkdir(join(root, ".ai", "scripts", "workflow", "config"), { recursive: true });
    await mkdir(join(root, ".ai", "scripts", "workflow", "contracts"), { recursive: true });
    await mkdir(join(root, ".ai", "scripts", "workflow", "runner"), { recursive: true });
    await mkdir(join(root, ".ai", "scripts", "workflow", "runner", "__tests__", "integration"), {
      recursive: true,
    });
    await mkdir(join(root, ".ai", "scripts", "workflow", "telemetry"), { recursive: true });
    await mkdir(join(root, ".ai", "scripts", "workflow", "ownership"), { recursive: true });
    await mkdir(join(root, ".ai", "scripts", "maintenance"), { recursive: true });
    await mkdir(join(root, ".ai", "artifacts"), { recursive: true });
    await mkdir(join(root, ".ai", "plans"), { recursive: true });
    await mkdir(join(root, ".ai", "specs"), { recursive: true });
    await mkdir(join(root, ".ai", "state"), { recursive: true });
    await writeFile(join(root, ".ai", "README.md"), "# README\n");
    await writeFile(join(root, ".ai", "AGENTS.md"), "# AGENTS\n");
    await writeFile(join(root, ".ai", ".gitignore"), "*\n");
    await writeFile(join(root, ".ai", "prompts", "generate-user-flow.md"), "# Generate User Flow\n");
    await writeFile(join(root, ".ai", "wrappers", "generate-user-flow.md"), "# Generate User Flow Wrapper\n");
    await Promise.all([
      "workflow/runner.ts",
      "workflow/runner/__tests__/integration/runner.test.ts",
      "workflow/runner.spec.md",
      "workflow/config/codex.ts",
      "workflow/config/codex.test.ts",
      "workflow/contracts/stage.ts",
      "workflow/contracts/stage.test.ts",
      "workflow/runner/cli.ts",
      "workflow/runner/instruction-router.ts",
      "workflow/runner/instruction-router.test.ts",
      "workflow/runner/thin-plan.ts",
      "workflow/document-formats.ts",
      "workflow/migrate-document-formats.ts",
      "workflow/runner/runner.manual-plan.test.ts",
      "workflow/telemetry/manual-token-usage.ts",
      "workflow/telemetry/manual-token-usage.test.ts",
      "workflow/telemetry/token-ledger.ts",
      "workflow/telemetry/token-usage.ts",
      "workflow/telemetry/token-warnings.ts",
      "workflow/ownership/reset-file-ownership.mjs",
      "workflow/ownership/reset-file-ownership.test.mjs",
      "maintenance/health-check.mjs",
      "maintenance/health-check.test.mjs",
    ].map((relativePath) =>
      writeFile(join(root, ".ai", "scripts", relativePath), "export {};\n"),
    ));
  }

  return {
    root,
    cleanup: () => rm(root, { recursive: true, force: true }),
  };
};

const successfulRunner = (calls) => async (command) => {
  calls.push(command);
  return { exitCode: 0, stdout: "", stderr: "" };
};

const runWith = async ({ args = [], runner = successfulRunner([]), includeAi = true } = {}) => {
  const workspace = await createWorkspace({ includeAi });
  const stdout = [];
  const stderr = [];

  try {
    const result = await runHealthCheck({
      args,
      cwd: workspace.root,
      runner,
      stdout: (message) => stdout.push(message),
      stderr: (message) => stderr.push(message),
    });

    return { result, stdout, stderr, root: workspace.root };
  } finally {
    await workspace.cleanup();
  }
};

test("parseHealthCheckArgs keeps --full distinct from the runner-test subset", () => {
  assert.deepEqual(parseHealthCheckArgs([]), { runnerTests: false, full: false });
  assert.deepEqual(parseHealthCheckArgs(["--runner-tests"]), { runnerTests: true, full: false });
  assert.deepEqual(parseHealthCheckArgs(["--full"]), { runnerTests: false, full: true });
});

test("default mode skips workflow runner tests", async () => {
  const calls = [];

  const { result } = await runWith({ runner: successfulRunner(calls) });

  assert.equal(result.ok, true);
  assert.equal(
    calls.some((call) => call.args.includes("--test")),
    false,
  );
});

test("--runner-tests includes workflow runner tests", async () => {
  const calls = [];

  const { result } = await runWith({ args: ["--runner-tests"], runner: successfulRunner(calls) });

  assert.equal(result.ok, true);
  assert.equal(
    calls.some(
      (call) =>
        call.command === "pnpm" &&
        call.args.join(" ") ===
          "exec tsx --test $(find .ai/scripts/workflow -type f -name '*.test.*' -print | sort)",
    ),
    true,
  );
});

test("--full includes every workflow-script test pattern", async () => {
  const calls = [];

  const { result } = await runWith({ args: ["--full"], runner: successfulRunner(calls) });

  assert.equal(result.ok, true);
  assert.equal(
    calls.some(
      (call) =>
        call.args.join(" ") ===
          "exec tsx --test $(find .ai/scripts -type f -name '*.test.*' -print | sort)" &&
        call.shell === true,
    ),
    true,
  );
});

test("missing .ai directory fails clearly", async () => {
  const calls = [];

  const { result, stderr } = await runWith({ includeAi: false, runner: successfulRunner(calls) });

  assert.equal(result.ok, false);
  assert.match(stderr.join("\n"), /parent repository root containing \.ai/);
  assert.equal(calls.length, 0);
});

test("parent repo not ignoring .ai fails clearly", async () => {
  const calls = [];
  const runner = async (command) => {
    calls.push(command);
    if (command.command === "git" && command.args.join(" ") === "check-ignore -q -- .ai") {
      return { exitCode: 1, stdout: "", stderr: "" };
    }
    return { exitCode: 0, stdout: "", stderr: "" };
  };

  const { result, stderr } = await runWith({ runner });

  assert.equal(result.ok, false);
  assert.match(stderr.join("\n"), /parent Git ignores \.ai/);
  assert.match(stderr.join("\n"), /git check-ignore -q -- \.ai/);
  assert.equal(calls.some((call) => call.command === "pnpm"), false);
});

test("command failures report the failed step and command", async () => {
  const runner = async (command) => {
    if (command.command === "pnpm" && command.args.includes("prettier")) {
      return { exitCode: 2, stdout: "Checking formatting...\n", stderr: "format failed\n" };
    }
    return { exitCode: 0, stdout: "", stderr: "" };
  };

  const { result, stderr } = await runWith({ runner });

  assert.equal(result.ok, false);
  assert.match(stderr.join("\n"), /prettier workflow source check/);
  assert.match(
    stderr.join("\n"),
    /pnpm exec prettier --check \.ai\/instructions \.ai\/changelogs \.ai\/wrappers \.ai\/prompts \.ai\/templates \.ai\/README\.md/,
  );
  assert.match(stderr.join("\n"), /format failed/);
});

test("missing user-flow workflow source file fails clearly", async () => {
  const calls = [];
  const workspace = await createWorkspace();
  const stdout = [];
  const stderr = [];

  try {
    await rm(join(workspace.root, ".ai", "prompts", "generate-user-flow.md"), { force: true });

    const result = await runHealthCheck({
      cwd: workspace.root,
      runner: successfulRunner(calls),
      stdout: (message) => stdout.push(message),
      stderr: (message) => stderr.push(message),
    });

    assert.equal(result.ok, false);
    assert.match(stderr.join("\n"), /required source path exists: \.ai\/prompts\/generate-user-flow\.md/);
    assert.match(stderr.join("\n"), /Missing required path: \.ai\/prompts\/generate-user-flow\.md/);
    assert.equal(calls.some((call) => call.command === "pnpm"), false);
  } finally {
    await workspace.cleanup();
  }
});
