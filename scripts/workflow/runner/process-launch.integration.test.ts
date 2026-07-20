import test from "node:test";

import { runWorkflowRunner } from "./runtime.ts";

import {
  CODEX_COMMAND,
  CODEX_EXEC_LABEL,
  OVERRIDE_CODEX_PROFILE,
  OVERRIDE_CODEX_EXEC_LABEL,
  OVERRIDE_CODEX_HOME_SUFFIX,
  writeThinPlanV2Artifacts,
  setupWorkspace,
  writePlan,
  planArg,
  collectConsole,
  runnerReturning,
  assert,
  codexExecutionConfig,
  join,
  mkdirSync,
  readFile,
  rm,
  thinPlanV2Manifest,
  writeFile,
  writeFileSync,
  writeWorkflowEventArtifactSync,
  planWith,
  WORKFLOW_RUNNER_CODEX_FALLBACK_MODEL,
  type ProcessRunner,
} from "./__tests__/helpers/runner-runtime.ts";

test(`startup validation fails before ${CODEX_EXEC_LABEL} for invalid plan inputs`, async () => {
  const workspace = await setupWorkspace();
  try {
    const processCalls: Parameters<ProcessRunner>[0][] = [];
    const processRunner: ProcessRunner = async (call) => {
      processCalls.push(call);
      return { launched: true, stdout: "", stderr: "", exitCode: 0 };
    };

    assert.equal(
      (
        await runWorkflowRunner({
          planName: "",
          rootDir: workspace.root,
          processRunner,
        })
      ).success,
      false,
    );
    assert.match(
      (
        await runWorkflowRunner({
          planName: planArg("missing"),
          rootDir: workspace.root,
          processRunner,
        })
      ).reason,
      /plan file does not exist/,
    );

    await writePlan(
      workspace.root,
      "missing-status",
      "## Next Action\n\nexecute-plan\n",
    );
    await writePlan(workspace.root, "missing-action", "## Status\n\nactive\n");
    await writePlan(
      workspace.root,
      "empty-status",
      "## Status\n\n## Next Action\n\nexecute-plan\n",
    );
    await writePlan(
      workspace.root,
      "empty-action",
      "## Status\n\nactive\n\n## Next Action\n",
    );
    await writePlan(
      workspace.root,
      "unknown-status",
      planWith("unknown", "execute-plan"),
    );
    await writePlan(
      workspace.root,
      "unknown-action",
      planWith("active", "unknown"),
    );

    for (const planName of [
      "missing-status",
      "missing-action",
      "empty-status",
      "empty-action",
      "unknown-status",
      "unknown-action",
    ]) {
      const result = await runWorkflowRunner({
        planName: planArg(planName),
        rootDir: workspace.root,
        processRunner,
      });
      assert.equal(result.success, false, planName);
    }
    assert.equal(processCalls.length, 0);
  } finally {
    await workspace.cleanup();
  }
});
test(`plan argument validation rejects unsupported path forms before ${CODEX_EXEC_LABEL}`, async () => {
  const workspace = await setupWorkspace();
  try {
    const processCalls: Parameters<ProcessRunner>[0][] = [];
    for (const planName of [
      "workflow-runner",
      "workflow-runner.md",
      ".ai/plans/workflow-runner",
      ".ai/plans/workflow-runner.txt",
      "docs/workflow-runner.md",
      "../workflow-runner.md",
      "/tmp/workflow-runner.md",
    ]) {
      const result = await runWorkflowRunner({
        planName,
        rootDir: workspace.root,
        processRunner: async (call) => {
          processCalls.push(call);
          return { launched: true, stdout: "", stderr: "", exitCode: 0 };
        },
      });
      assert.equal(result.success, false, planName);
      assert.match(result.reason, /plan argument/, planName);
    }
    assert.equal(processCalls.length, 0);
  } finally {
    await workspace.cleanup();
  }
});

test(`missing selected prompt files fail before ${CODEX_EXEC_LABEL}`, async () => {
  const workspace = await setupWorkspace();
  try {
    await rm(join(workspace.root, ".ai", "prompts", "execute-plan.md"));
    await writePlan(
      workspace.root,
      "workflow-runner",
      planWith("active", "execute-plan"),
    );
    let launched = false;
    const result = await runWorkflowRunner({
      planName: planArg("workflow-runner"),
      rootDir: workspace.root,
      processRunner: async () => {
        launched = true;
        return { launched: true, stdout: "", stderr: "", exitCode: 0 };
      },
    });
    assert.equal(result.success, false);
    assert.equal(launched, false);
    assert.match(result.reason, /prompt file does not exist/);
  } finally {
    await workspace.cleanup();
  }
});

test(`${OVERRIDE_CODEX_EXEC_LABEL} override applies to launched codex commands and CODEX_HOME`, async () => {
  const workspace = await setupWorkspace();
  try {
    await writePlan(
      workspace.root,
      "workflow-runner",
      planWith("active", "execute-plan"),
    );
    const calls: Parameters<ProcessRunner>[0][] = [];
    const result = await runWorkflowRunner({
      argv: [
        "--profile",
        OVERRIDE_CODEX_PROFILE,
        ".ai/plans/workflow-runner.md",
      ],
      rootDir: workspace.root,
      processRunner: runnerReturning(
        { launched: true, stdout: "ok", stderr: "", exitCode: 0 },
        (call) => {
          calls.push(call);
          if (call.promptPath === ".ai/prompts/execute-plan.md") {
            writeFileSync(
              join(workspace.root, ".ai", "plans", "workflow-runner.md"),
              planWith("review", "review-plan"),
            );
          }
        },
      ),
    });
    assert.equal(result.success, false);
    assert.deepEqual(
      calls
        .filter((call) => call.command === OVERRIDE_CODEX_PROFILE)
        .map((call) => call.promptPath),
      [
        ".ai/prompts/execute-plan.md",
        ".ai/prompts/scope-cleanup.md",
        ".ai/prompts/review-changes.md",
      ],
    );
    assert.equal(calls[0].command, OVERRIDE_CODEX_PROFILE);
    assert.match(
      calls[0].env?.CODEX_HOME ?? "",
      new RegExp(`${OVERRIDE_CODEX_HOME_SUFFIX.replace("/", "\\/")}$`),
    );
  } finally {
    await workspace.cleanup();
  }
});

test("codex execution config requires an explicit prompt mapping", () => {
  assert.deepEqual(codexExecutionConfig(".ai/prompts/sync-plan-artifacts.md"), {
    model: "gpt-5.6-luna",
    reasoning: "medium",
  });
  assert.deepEqual(codexExecutionConfig(".ai/prompts/commit-summary.md"), {
    model: "gpt-5.6-terra",
    reasoning: "medium",
  });
  assert.throws(
    () => codexExecutionConfig(".ai/prompts/unknown.md"),
    /workflow runner codex config missing for prompt: \.ai\/prompts\/unknown\.md/,
  );
});

test(`${CODEX_EXEC_LABEL} uses prompt-tier model and reasoning policy`, async () => {
  const workspace = await setupWorkspace();
  try {
    await writePlan(
      workspace.root,
      "workflow-runner",
      planWith("review", "review-plan"),
    );
    const calls: Parameters<ProcessRunner>[0][] = [];
    const result = await runWorkflowRunner({
      planName: planArg("workflow-runner"),
      rootDir: workspace.root,
      processRunner: runnerReturning(
        { launched: true, stdout: "ok", stderr: "", exitCode: 0 },
        (call) => {
          calls.push(call);
          if (
            call.command === CODEX_COMMAND &&
            call.promptPath === ".ai/prompts/review-changes.md"
          ) {
            writeWorkflowEventArtifactSync({
              root: workspace.root,
              planName: "workflow-runner",
              kind: "review",
              version: 1,
            });
            writeFileSync(
              join(workspace.root, ".ai", "plans", "workflow-runner.md"),
              planWith("completed", "commit-summary"),
            );
          }
        },
      ),
    });

    assert.equal(result.success, true);
    const codexCalls = calls.filter((call) => call.command === CODEX_COMMAND);
    assert.equal(codexCalls.length, 3);
    assert.deepEqual(codexCalls[0].args.slice(0, 6), [
      "exec",
      "--json",
      "--model",
      "gpt-5.6-terra",
      "-c",
      'model_reasoning_effort="high"',
    ]);
    assert.deepEqual(codexCalls[1].args.slice(0, 6), [
      "exec",
      "--json",
      "--model",
      "gpt-5.6-terra",
      "-c",
      'model_reasoning_effort="xhigh"',
    ]);
    assert.deepEqual(codexCalls[2].args.slice(0, 6), [
      "exec",
      "--json",
      "--model",
      "gpt-5.6-terra",
      "-c",
      'model_reasoning_effort="medium"',
    ]);
    assert.match(
      codexCalls[0].args[6],
      /^Use \.ai\/prompts\/scope-cleanup\.md/,
    );
    assert.match(
      codexCalls[1].args[6],
      /git diff --staged -- \.ai\/scripts\/workflow\/runner\/__tests__\/integration\/runner\.test\.ts \.ai\/scripts\/workflow\/runner\.ts/,
    );
    assert.match(
      codexCalls[1].args[6],
      /git diff --staged --name-status -- \.ai\/scripts\/workflow\/runner\/__tests__\/integration\/runner\.test\.ts \.ai\/scripts\/workflow\/runner\.ts/,
    );
    assert.match(
      codexCalls[1].args[6],
      /^Use \.ai\/prompts\/review-changes\.md/,
    );
    assert.equal(codexCalls[2].args.includes("--add-dir"), true);
    assert.equal(
      codexCalls[2].args.includes(join(workspace.root, ".git")),
      true,
    );
    assert.match(
      codexCalls[2].args.at(-1) ?? "",
      /^Use \.ai\/prompts\/commit-summary\.md/,
    );

    const log = await readFile(
      join(
        workspace.root,
        ".ai",
        "artifacts",
        "workflow-runner",
        "logs",
        "runner.log",
      ),
      "utf8",
    );
    assert.match(log, /model: gpt-5\.6-terra/);
    assert.match(log, /reasoning: xhigh/);
    assert.match(log, /reasoning: medium/);
  } finally {
    await workspace.cleanup();
  }
});

test(`${CODEX_EXEC_LABEL} retries selected model twice before retrying fallback model twice on capacity`, async () => {
  const workspace = await setupWorkspace();
  try {
    await writePlan(
      workspace.root,
      "capacity-fallback",
      planWith("completed", "commit-summary"),
    );
    const calls: Parameters<ProcessRunner>[0][] = [];
    const output = collectConsole();
    let codexLaunches = 0;
    const result = await runWorkflowRunner({
      planName: planArg("capacity-fallback"),
      rootDir: workspace.root,
      console: output.console,
      processRunner: async (call) => {
        calls.push(call);
        if (call.command !== CODEX_COMMAND) {
          return { launched: true, stdout: "", stderr: "", exitCode: 0 };
        }
        codexLaunches += 1;
        if (codexLaunches <= 4) {
          return {
            launched: true,
            stdout: "",
            stderr:
              "[codex] error: Selected model is at capacity. Please try a different model.",
            exitCode: 1,
          };
        }
        return { launched: true, stdout: "summary", stderr: "", exitCode: 0 };
      },
    });

    assert.equal(result.success, true);
    const codexCalls = calls.filter((call) => call.command === CODEX_COMMAND);
    assert.equal(codexCalls.length, 5);
    assert.deepEqual(
      codexCalls.map((call) => call.promptPath),
      Array.from({ length: 5 }, () => ".ai/prompts/commit-summary.md"),
    );
    assert.deepEqual(
      codexCalls.map((call) => call.args.slice(0, 4)),
      [
        ["exec", "--json", "--model", "gpt-5.6-terra"],
        ["exec", "--json", "--model", "gpt-5.6-terra"],
        ["exec", "--json", "--model", "gpt-5.6-terra"],
        ["exec", "--json", "--model", WORKFLOW_RUNNER_CODEX_FALLBACK_MODEL],
        ["exec", "--json", "--model", WORKFLOW_RUNNER_CODEX_FALLBACK_MODEL],
      ],
    );

    const log = await readFile(
      join(
        workspace.root,
        ".ai",
        "artifacts",
        "capacity-fallback",
        "logs",
        "runner.log",
      ),
      "utf8",
    );
    assert.match(
      log,
      new RegExp(`model: ${WORKFLOW_RUNNER_CODEX_FALLBACK_MODEL}`),
    );
    assert.equal(
      output.lines.some((line) =>
        /retrying \.ai\/prompts\/commit-summary\.md with the same model \(2\/3\)/.test(
          line,
        ),
      ),
      true,
    );
    assert.equal(
      output.lines.some((line) =>
        /retrying \.ai\/prompts\/commit-summary\.md with the same model \(3\/3\)/.test(
          line,
        ),
      ),
      true,
    );
    assert.equal(
      output.lines.some((line) =>
        /retrying \.ai\/prompts\/commit-summary\.md with fallback model gpt-5\.5 \(1\/2\)/.test(
          line,
        ),
      ),
      true,
    );
    assert.equal(
      output.lines.some((line) =>
        /retrying \.ai\/prompts\/commit-summary\.md with fallback model gpt-5\.5 \(2\/2\)/.test(
          line,
        ),
      ),
      true,
    );
  } finally {
    await workspace.cleanup();
  }
});

test(`${CODEX_EXEC_LABEL} grants commit-summary explicit write access to .git`, async () => {
  const workspace = await setupWorkspace();
  try {
    await writePlan(
      workspace.root,
      "workflow-runner",
      planWith("review", "review-plan"),
    );
    const calls: Parameters<ProcessRunner>[0][] = [];
    const result = await runWorkflowRunner({
      planName: planArg("workflow-runner"),
      rootDir: workspace.root,
      processRunner: runnerReturning(
        { launched: true, stdout: "ok", stderr: "", exitCode: 0 },
        (call) => {
          calls.push(call);
          if (
            call.command === CODEX_COMMAND &&
            call.promptPath === ".ai/prompts/review-changes.md"
          ) {
            writeWorkflowEventArtifactSync({
              root: workspace.root,
              planName: "workflow-runner",
              kind: "review",
              version: 1,
            });
            writeFileSync(
              join(workspace.root, ".ai", "plans", "workflow-runner.md"),
              planWith("completed", "commit-summary"),
            );
          }
        },
      ),
    });

    assert.equal(result.success, true);
    const commitSummaryCall = calls.find(
      (call) =>
        call.command === CODEX_COMMAND &&
        call.promptPath === ".ai/prompts/commit-summary.md",
    );
    assert.ok(commitSummaryCall);
    assert.equal(commitSummaryCall.args.includes("--add-dir"), true);
    assert.equal(
      commitSummaryCall.args.includes(join(workspace.root, ".git")),
      true,
    );
  } finally {
    await workspace.cleanup();
  }
});

test(`removed compact CLI mode stops before ${CODEX_EXEC_LABEL}`, async () => {
  const workspace = await setupWorkspace();
  try {
    const processCalls: Parameters<ProcessRunner>[0][] = [];
    const processRunner: ProcessRunner = async (call) => {
      processCalls.push(call);
      return { launched: true, stdout: "", stderr: "", exitCode: 0 };
    };

    const compactFlag = await runWorkflowRunner({
      argv: ["--compact"],
      rootDir: workspace.root,
      processRunner,
    });
    assert.equal(compactFlag.success, false);
    assert.match(compactFlag.reason, /unknown workflow runner flag: --compact/);

    const compactWithPlan = await runWorkflowRunner({
      argv: ["--compact", "workflow-runner.md"],
      rootDir: workspace.root,
      processRunner,
    });
    assert.equal(compactWithPlan.success, false);
    assert.match(
      compactWithPlan.reason,
      /unknown workflow runner flag: --compact/,
    );

    const missingUnblockNote = await runWorkflowRunner({
      argv: [".ai/plans/workflow-runner.md", "--unblock-note"],
      rootDir: workspace.root,
      processRunner,
    });
    assert.equal(missingUnblockNote.success, false);
    assert.match(missingUnblockNote.reason, /--unblock-note requires a value/);

    const missingCodexProfile = await runWorkflowRunner({
      argv: [".ai/plans/workflow-runner.md", "--profile"],
      rootDir: workspace.root,
      processRunner,
    });
    assert.equal(missingCodexProfile.success, false);
    assert.match(missingCodexProfile.reason, /--profile requires a value/);

    const invalidCodexProfile = await runWorkflowRunner({
      argv: ["--profile", "../codex-personal", ".ai/plans/workflow-runner.md"],
      rootDir: workspace.root,
      processRunner,
    });
    assert.equal(invalidCodexProfile.success, false);
    assert.match(invalidCodexProfile.reason, /invalid --profile value/);

    assert.equal(processCalls.length, 0);
  } finally {
    await workspace.cleanup();
  }
});

test("workflow runner --help prints usage without launching Codex", async () => {
  const workspace = await setupWorkspace();
  try {
    const processCalls: Parameters<ProcessRunner>[0][] = [];
    const processRunner: ProcessRunner = async (call) => {
      processCalls.push(call);
      return { launched: true, stdout: "", stderr: "", exitCode: 0 };
    };
    const output: string[] = [];
    const errors: string[] = [];

    const result = await runWorkflowRunner({
      argv: ["--help"],
      rootDir: workspace.root,
      processRunner,
      console: {
        log: (message) => output.push(message),
        error: (message) => errors.push(message),
      },
    });

    assert.equal(result.success, true);
    assert.equal(result.exitCode, 0);
    assert.match(
      output.join("\n"),
      /Usage: pnpm exec tsx \.ai\/scripts\/workflow\/runner\.ts/,
    );
    assert.doesNotMatch(output.join("\n"), /--compact/);
    assert.deepEqual(errors, []);
    assert.equal(processCalls.length, 0);
  } finally {
    await workspace.cleanup();
  }
});

for (const branch of [
  "main",
  "master",
  "dev",
  "development",
  "staging",
  "feature/workflow",
  "HEAD",
]) {
  test(`workflow runner starts on ${branch === "HEAD" ? "detached HEAD" : branch}`, async () => {
    const workspace = await setupWorkspace();
    try {
      mkdirSync(join(workspace.root, ".git"), { recursive: true });
      mkdirSync(join(workspace.root, "src"), { recursive: true });
      await writeFile(
        join(workspace.root, "src", "artifact-state.ts"),
        "artifact state\n",
      );
      await writeThinPlanV2Artifacts(workspace.root, {
        status: "completed",
        nextAction: "commit-summary",
      });
      await writePlan(
        workspace.root,
        "artifact-state",
        thinPlanV2Manifest("completed", "commit-summary"),
      );
      const processCalls: Parameters<ProcessRunner>[0][] = [];
      const processRunner: ProcessRunner = async (call) => {
        processCalls.push(call);
        if (
          call.command === "git" &&
          call.args.join(" ") === "rev-parse --abbrev-ref HEAD"
        ) {
          return {
            launched: true,
            stdout: `${branch}\n`,
            stderr: "",
            exitCode: 0,
          };
        }
        return { launched: true, stdout: "", stderr: "", exitCode: 0 };
      };

      const result = await runWorkflowRunner({
        argv: [".ai/plans/artifact-state.md"],
        rootDir: workspace.root,
        processRunner,
        streamOutput: false,
      });

      assert.equal(result.success, true);
      assert.equal(
        processCalls.some((call) => call.command === CODEX_COMMAND),
        true,
      );
    } finally {
      await workspace.cleanup();
    }
  });
}
