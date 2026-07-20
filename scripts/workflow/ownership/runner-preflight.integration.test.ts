import test from "node:test";

import { runWorkflowRunner } from "../runner/runtime.ts";

import {
  CODEX_COMMAND,
  writeThinPlanV2Artifacts,
  ownershipReleaseSection,
  ownershipScopeSection,
  setupWorkspace,
  writePlan,
  writeFileOwnershipArtifact,
  writeArtifactStateFile,
  runnerReturning,
  assert,
  join,
  mkdirSync,
  readFile,
  thinPlanV2Manifest,
  writeFile,
  writeWorkflowEventArtifactSync,
  planWith,
  planWithFileScope,
  type ProcessRunner,
} from "../runner/__tests__/helpers/runner-runtime.ts";

test("workflow runner ignores another plan's invalid ownership workflow state", async () => {
  const workspace = await setupWorkspace();
  try {
    await writePlan(
      workspace.root,
      "current-plan",
      planWithFileScope(
        "active",
        "execute-plan",
        {
          modified: ["apps/web/src/shared.ts"],
        },
        ownershipScopeSection(["apps/web/src/shared.ts"]),
      ),
    );
    await writeFileOwnershipArtifact(workspace.root, "other-plan", {
      planPath: ".ai/plans/other-plan.md",
      workflowState: "active",
      owns: ["apps/web/src/shared.ts"],
      released: [],
      resolvedFiles: ["apps/web/src/shared.ts"],
      changedFiles: [],
      headSha: "abc123",
      updatedAt: "2026-06-04T00:00:00.000Z",
    });
    await writeArtifactStateFile(
      workspace.root,
      "other-plan",
      "workflow.json",
      '{ "status": "active", "nextAction": "execute-plan" }\n',
    );

    const calls: Parameters<ProcessRunner>[0][] = [];
    const result = await runWorkflowRunner({
      argv: [".ai/plans/current-plan.md"],
      rootDir: workspace.root,
      processRunner: async (call) => {
        calls.push(call);
        if (call.command === "git" && call.args[0] === "status") {
          return { launched: true, stdout: "", stderr: "", exitCode: 0 };
        }
        if (call.command === "git" && call.args[0] === "rev-parse") {
          return {
            launched: true,
            stdout: "currenthead\n",
            stderr: "",
            exitCode: 0,
          };
        }
        if (call.promptPath === ".ai/prompts/execute-plan.md") {
          await writePlan(
            workspace.root,
            "current-plan",
            planWithFileScope(
              "blocked",
              "unblock-plan",
              { modified: ["apps/web/src/shared.ts"] },
              ownershipScopeSection(["apps/web/src/shared.ts"]),
            ),
          );
        }
        return { launched: true, stdout: "", stderr: "", exitCode: 0 };
      },
    });

    assert.equal(result.success, false);
    assert.match(result.reason, /plan blocked after execute-plan/);
    assert.equal(
      calls.some((call) => call.promptPath === ".ai/prompts/execute-plan.md"),
      true,
    );

    const artifact = JSON.parse(
      await readFile(
        join(
          workspace.root,
          ".ai",
          "artifacts",
          "current-plan",
          "state",
          "file-ownership.json",
        ),
        "utf8",
      ),
    );
    assert.deepEqual(artifact.resolvedFiles, ["apps/web/src/shared.ts"]);
  } finally {
    await workspace.cleanup();
  }
});

test("workflow runner ignores malformed ownership artifacts from another draft plan", async () => {
  const workspace = await setupWorkspace();
  try {
    await writePlan(
      workspace.root,
      "current-plan",
      planWithFileScope(
        "active",
        "execute-plan",
        {
          modified: ["apps/web/src/shared.ts"],
        },
        ownershipScopeSection(["apps/web/src/shared.ts"]),
      ),
    );
    await writePlan(
      workspace.root,
      "other-plan",
      planWith("draft", "sync-plan-artifacts"),
    );
    await writeArtifactStateFile(
      workspace.root,
      "other-plan",
      "file-ownership.json",
      '{ "tasks": [] }\n',
    );

    const calls: Parameters<ProcessRunner>[0][] = [];
    const result = await runWorkflowRunner({
      argv: [".ai/plans/current-plan.md"],
      rootDir: workspace.root,
      processRunner: async (call) => {
        calls.push(call);
        if (call.command === "git" && call.args[0] === "status") {
          return {
            launched: true,
            stdout: " M apps/web/src/shared.ts\n",
            stderr: "",
            exitCode: 0,
          };
        }
        if (call.command === "git" && call.args[0] === "rev-parse") {
          return {
            launched: true,
            stdout: "headsha\n",
            stderr: "",
            exitCode: 0,
          };
        }
        if (call.promptPath === ".ai/prompts/execute-plan.md") {
          await writePlan(
            workspace.root,
            "current-plan",
            planWithFileScope(
              "blocked",
              "unblock-plan",
              {
                modified: ["apps/web/src/shared.ts"],
              },
              ownershipScopeSection(["apps/web/src/shared.ts"]),
            ),
          );
        }
        return { launched: true, stdout: "", stderr: "", exitCode: 0 };
      },
    });

    assert.equal(result.success, false);
    assert.match(result.reason, /plan blocked after execute-plan/);
    assert.equal(
      calls.some((call) => call.command === CODEX_COMMAND),
      true,
    );
  } finally {
    await workspace.cleanup();
  }
});

test("workflow runner ignores malformed workflow state from another draft plan", async () => {
  const workspace = await setupWorkspace();
  try {
    await writePlan(
      workspace.root,
      "current-plan",
      planWithFileScope(
        "active",
        "execute-plan",
        {
          modified: ["apps/web/src/shared.ts"],
        },
        ownershipScopeSection(["apps/web/src/shared.ts"]),
      ),
    );
    await writePlan(
      workspace.root,
      "other-plan",
      planWith("draft", "sync-plan-artifacts"),
    );
    await writeFileOwnershipArtifact(workspace.root, "other-plan", {
      planPath: ".ai/plans/other-plan.md",
      owns: ["apps/web/src/shared.ts"],
      released: [],
      resolvedFiles: ["apps/web/src/shared.ts"],
      changedFiles: ["apps/web/src/shared.ts"],
      headSha: "otherhead",
      updatedAt: "2026-06-04T00:00:00.000Z",
    });
    await writeArtifactStateFile(
      workspace.root,
      "other-plan",
      "workflow.json",
      '{ "workflowState": "draft-artifact-sync" }\n',
    );

    const calls: Parameters<ProcessRunner>[0][] = [];
    const result = await runWorkflowRunner({
      argv: [".ai/plans/current-plan.md"],
      rootDir: workspace.root,
      processRunner: async (call) => {
        calls.push(call);
        if (call.command === "git" && call.args[0] === "status") {
          return {
            launched: true,
            stdout: " M apps/web/src/shared.ts\n",
            stderr: "",
            exitCode: 0,
          };
        }
        if (call.command === "git" && call.args[0] === "rev-parse") {
          return {
            launched: true,
            stdout: "headsha\n",
            stderr: "",
            exitCode: 0,
          };
        }
        if (call.promptPath === ".ai/prompts/execute-plan.md") {
          await writePlan(
            workspace.root,
            "current-plan",
            planWithFileScope(
              "blocked",
              "unblock-plan",
              {
                modified: ["apps/web/src/shared.ts"],
              },
              ownershipScopeSection(["apps/web/src/shared.ts"]),
            ),
          );
        }
        return { launched: true, stdout: "", stderr: "", exitCode: 0 };
      },
    });

    assert.equal(result.success, false);
    assert.match(result.reason, /plan blocked after execute-plan/);
    assert.equal(
      calls.some((call) => call.command === CODEX_COMMAND),
      true,
    );
  } finally {
    await workspace.cleanup();
  }
});

test("workflow runner ignores legacy ownership artifacts from other plans", async () => {
  const workspace = await setupWorkspace();
  try {
    await writePlan(
      workspace.root,
      "current-plan",
      planWithFileScope(
        "active",
        "execute-plan",
        {
          modified: ["apps/web/src/shared.ts"],
        },
        ownershipScopeSection(["apps/web/src/shared.ts"]),
      ),
    );
    await writeArtifactStateFile(
      workspace.root,
      "other-plan",
      "file-ownership.json",
      JSON.stringify(
        {
          planPath: ".ai/plans/other-plan.md",
          ownedFiles: ["apps/web/src/shared.ts"],
          releasedFiles: [],
        },
        null,
        2,
      ),
    );
    await writeArtifactStateFile(
      workspace.root,
      "other-plan",
      "workflow.json",
      JSON.stringify(
        {
          planPath: ".ai/plans/other-plan.md",
          workflowState: "draft-artifact-sync",
          latest: {},
          history: [],
          unresolvedBlockers: [],
          updatedAt: "2026-07-08T00:00:00.000Z",
        },
        null,
        2,
      ),
    );

    const calls: Parameters<ProcessRunner>[0][] = [];
    const result = await runWorkflowRunner({
      argv: [".ai/plans/current-plan.md"],
      rootDir: workspace.root,
      processRunner: async (call) => {
        calls.push(call);
        if (call.command === "git" && call.args[0] === "status") {
          return {
            launched: true,
            stdout: " M apps/web/src/shared.ts\n",
            stderr: "",
            exitCode: 0,
          };
        }
        if (call.command === "git" && call.args[0] === "rev-parse") {
          return {
            launched: true,
            stdout: "headsha\n",
            stderr: "",
            exitCode: 0,
          };
        }
        if (call.promptPath === ".ai/prompts/execute-plan.md") {
          await writePlan(
            workspace.root,
            "current-plan",
            planWithFileScope(
              "blocked",
              "unblock-plan",
              {
                modified: ["apps/web/src/shared.ts"],
              },
              ownershipScopeSection(["apps/web/src/shared.ts"]),
            ),
          );
        }
        return { launched: true, stdout: "", stderr: "", exitCode: 0 };
      },
    });

    assert.equal(result.success, false);
    assert.match(result.reason, /plan blocked after execute-plan/);
    assert.equal(
      calls.some((call) => call.command === CODEX_COMMAND),
      true,
    );

  } finally {
    await workspace.cleanup();
  }
});

test("workflow runner ignores malformed ownership artifacts from other plans", async () => {
  const workspace = await setupWorkspace();
  try {
    await writePlan(
      workspace.root,
      "current-plan",
      planWithFileScope(
        "active",
        "execute-plan",
        {
          modified: ["apps/web/src/shared.ts"],
        },
        ownershipScopeSection(["apps/web/src/shared.ts"]),
      ),
    );
    await writePlan(
      workspace.root,
      "other-plan",
      planWith("active", "execute-plan"),
    );
    await writeArtifactStateFile(
      workspace.root,
      "other-plan",
      "file-ownership.json",
      '{ "tasks": [] }\n',
    );

    const calls: Parameters<ProcessRunner>[0][] = [];
    const result = await runWorkflowRunner({
      argv: [".ai/plans/current-plan.md"],
      rootDir: workspace.root,
      processRunner: async (call) => {
        calls.push(call);
        if (call.command === "git" && call.args[0] === "status") {
          return {
            launched: true,
            stdout: " M apps/web/src/shared.ts\n",
            stderr: "",
            exitCode: 0,
          };
        }
        if (call.command === "git" && call.args[0] === "rev-parse") {
          return {
            launched: true,
            stdout: "headsha\n",
            stderr: "",
            exitCode: 0,
          };
        }
        if (call.promptPath === ".ai/prompts/execute-plan.md") {
          await writePlan(
            workspace.root,
            "current-plan",
            planWithFileScope(
              "blocked",
              "unblock-plan",
              { modified: ["apps/web/src/shared.ts"] },
              ownershipScopeSection(["apps/web/src/shared.ts"]),
            ),
          );
        }
        return { launched: true, stdout: "", stderr: "", exitCode: 0 };
      },
    });

    assert.equal(result.success, false);
    assert.match(result.reason, /plan blocked after execute-plan/);
    assert.equal(
      calls.some((call) => call.promptPath === ".ai/prompts/execute-plan.md"),
      true,
    );
  } finally {
    await workspace.cleanup();
  }
});

test("workflow runner resolves ownership globs to actual changed files for review staging", async () => {
  const workspace = await setupWorkspace();
  try {
    await writePlan(
      workspace.root,
      "glob-plan",
      planWithFileScope(
        "review",
        "review-plan",
        {
          modified: ["stale/files-list.ts"],
        },
        ownershipScopeSection([
          "apps/admin/src/features/admin-ugc-templates/**",
        ]),
      ),
    );

    const calls: Parameters<ProcessRunner>[0][] = [];
    const result = await runWorkflowRunner({
      argv: [".ai/plans/glob-plan.md"],
      rootDir: workspace.root,
      isIgnored: async () => false,
      processRunner: async (call) => {
        calls.push(call);
        if (call.promptPath === "git-review-staging-changed-paths") {
          return {
            launched: true,
            stdout: " M apps/admin/src/features/admin-ugc-templates/list.tsx\n",
            stderr: "",
            exitCode: 0,
          };
        }
        if (call.promptPath === "git-commit-summary-clean-check") {
          return { launched: true, stdout: "", stderr: "", exitCode: 0 };
        }
        if (
          call.command === "git" &&
          call.args[0] === "status" &&
          call.args[1] === "--short"
        ) {
          return {
            launched: true,
            stdout: [
              " M apps/admin/src/features/admin-ugc-templates/list.tsx",
              " M apps/web/src/features/dashboard/ignore.tsx",
            ].join("\n"),
            stderr: "",
            exitCode: 0,
          };
        }
        if (call.command === "git" && call.args[0] === "rev-parse") {
          return {
            launched: true,
            stdout: "headsha\n",
            stderr: "",
            exitCode: 0,
          };
        }
        if (call.command === "git") {
          return { launched: true, stdout: "", stderr: "", exitCode: 0 };
        }
        if (call.promptPath === ".ai/prompts/review-changes.md") {
          writeWorkflowEventArtifactSync({
            root: workspace.root,
            planName: "glob-plan",
            kind: "review",
            version: 1,
          });
          await writePlan(
            workspace.root,
            "glob-plan",
            planWithFileScope(
              "completed",
              "commit-summary",
              {
                modified: [
                  "apps/admin/src/features/admin-ugc-templates/list.tsx",
                ],
              },
              ownershipScopeSection([
                "apps/admin/src/features/admin-ugc-templates/**",
              ]),
            ),
          );
        }
        return { launched: true, stdout: "summary", stderr: "", exitCode: 0 };
      },
    });

    assert.equal(result.success, true);
    const gitAddCall = calls.find(
      (call) => call.command === "git" && call.args[0] === "add",
    );
    assert.ok(gitAddCall);
    assert.deepEqual(gitAddCall.args, [
      "add",
      "--all",
      "--",
      "apps/admin/src/features/admin-ugc-templates/list.tsx",
    ]);

    const artifact = JSON.parse(
      await readFile(
        join(
          workspace.root,
          ".ai",
          "artifacts",
          "glob-plan",
          "state",
          "file-ownership.json",
        ),
        "utf8",
      ),
    );
    assert.deepEqual(artifact.resolvedFiles, [
      "apps/admin/src/features/admin-ugc-templates/list.tsx",
    ]);
    assert.deepEqual(artifact.changedFiles, [
      "apps/admin/src/features/admin-ugc-templates/list.tsx",
    ]);
  } finally {
    await workspace.cleanup();
  }
});

test("completed clean ownership artifacts do not block later plans", async () => {
  const workspace = await setupWorkspace();
  try {
    await writePlan(
      workspace.root,
      "current-plan",
      planWithFileScope(
        "active",
        "execute-plan",
        {
          modified: ["src/shared.ts"],
        },
        ownershipScopeSection(["src/shared.ts"]),
      ),
    );
    await writeFileOwnershipArtifact(workspace.root, "completed-plan", {
      planPath: ".ai/plans/completed-plan.md",
      workflowState: "completed",
      owns: ["src/shared.ts"],
      released: [],
      resolvedFiles: ["src/shared.ts"],
      changedFiles: [],
      headSha: "abc123",
      updatedAt: "2026-06-04T00:00:00.000Z",
    });

    const calls: Parameters<ProcessRunner>[0][] = [];
    const result = await runWorkflowRunner({
      argv: [".ai/plans/current-plan.md"],
      rootDir: workspace.root,
      processRunner: async (call) => {
        calls.push(call);
        if (call.command === "git" && call.args[0] === "status") {
          return { launched: true, stdout: "", stderr: "", exitCode: 0 };
        }
        if (call.command === "git" && call.args[0] === "rev-parse") {
          return {
            launched: true,
            stdout: "headsha\n",
            stderr: "",
            exitCode: 0,
          };
        }
        if (call.promptPath === ".ai/prompts/execute-plan.md") {
          await writePlan(
            workspace.root,
            "current-plan",
            planWithFileScope(
              "blocked",
              "unblock-plan",
              {
                modified: ["src/shared.ts"],
              },
              ownershipScopeSection(["src/shared.ts"]),
            ),
          );
        }
        return { launched: true, stdout: "", stderr: "", exitCode: 0 };
      },
    });

    assert.equal(result.success, false);
    assert.match(result.reason, /plan blocked after execute-plan/);
    assert.equal(
      calls.some((call) => call.promptPath === ".ai/prompts/execute-plan.md"),
      true,
    );
  } finally {
    await workspace.cleanup();
  }
});

test("thin-plan ownership preflight trusts terminal workflow state over stale ownership status", async () => {
  const workspace = await setupWorkspace();
  try {
    await writePlan(
      workspace.root,
      "artifact-state",
      thinPlanV2Manifest("approved", "execute-plan"),
    );
    await writeThinPlanV2Artifacts(workspace.root, {
      status: "approved",
      nextAction: "execute-plan",
      modified: ["src/shared.ts"],
      changedFiles: ["src/shared.ts"],
      owns: ["src/shared.ts"],
      latest: {
        validation: {
          version: 1,
          result: "APPROVED",
          summary: "Plan approved.",
          evidence: ".ai/artifacts/artifact-state/events/validation-v1.md",
        },
      },
      history: [".ai/artifacts/artifact-state/events/validation-v1.md"],
      activeBlockers: [],
    });
    await writeFileOwnershipArtifact(workspace.root, "completed-plan", {
      planPath: ".ai/plans/completed-plan.md",
      workflowState: "review",
      owns: ["src/shared.ts"],
      released: [],
      resolvedFiles: ["src/shared.ts"],
      changedFiles: ["src/shared.ts"],
      headSha: "abc123",
      updatedAt: "2026-06-04T00:00:00.000Z",
    });
    mkdirSync(
      join(workspace.root, ".ai", "artifacts", "completed-plan", "state"),
      { recursive: true },
    );
    await writeFile(
      join(
        workspace.root,
        ".ai",
        "artifacts",
        "completed-plan",
        "state",
        "workflow.json",
      ),
      `${JSON.stringify(
        {
          planPath: ".ai/plans/completed-plan.md",
          workflowState: "completed",
          latest: {},
          history: [],
          unresolvedBlockers: [],
          updatedAt: "2026-06-04T00:05:00.000Z",
        },
        null,
        2,
      )}\n`,
      "utf8",
    );

    const calls: Parameters<ProcessRunner>[0][] = [];
    const result = await runWorkflowRunner({
      argv: [".ai/plans/artifact-state.md"],
      rootDir: workspace.root,
      processRunner: async (call) => {
        calls.push(call);
        if (call.command === "git" && call.args[0] === "status") {
          return { launched: true, stdout: "", stderr: "", exitCode: 0 };
        }
        if (call.command === "git" && call.args[0] === "rev-parse") {
          return {
            launched: true,
            stdout: "headsha\n",
            stderr: "",
            exitCode: 0,
          };
        }
        if (call.promptPath === ".ai/prompts/execute-plan.md") {
          await writePlan(
            workspace.root,
            "artifact-state",
            thinPlanV2Manifest("blocked", "unblock-plan"),
          );
          await writeThinPlanV2Artifacts(workspace.root, {
            status: "blocked",
            nextAction: "unblock-plan",
            modified: ["src/shared.ts"],
            changedFiles: ["src/shared.ts"],
            owns: ["src/shared.ts"],
            activeBlockers: ["Blocker v1 | validation environment unavailable"],
          });
        }
        return { launched: true, stdout: "", stderr: "", exitCode: 0 };
      },
    });

    assert.equal(result.success, false);
    assert.match(result.reason, /plan blocked after execute-plan/);
    assert.equal(
      calls.some((call) => call.promptPath === ".ai/prompts/execute-plan.md"),
      true,
    );
  } finally {
    await workspace.cleanup();
  }
});

test("workflow runner ignores completed-plan ownership state", async () => {
  const workspace = await setupWorkspace();
  try {
    await writePlan(
      workspace.root,
      "current-plan",
      planWithFileScope(
        "active",
        "execute-plan",
        {
          modified: ["src/shared.ts"],
        },
        ownershipScopeSection(["src/shared.ts"]),
      ),
    );
    await writeFileOwnershipArtifact(workspace.root, "completed-plan", {
      planPath: ".ai/plans/completed-plan.md",
      workflowState: "completed",
      owns: ["src/shared.ts"],
      released: [],
      resolvedFiles: ["src/shared.ts"],
      changedFiles: [],
      headSha: "abc123",
      updatedAt: "2026-06-04T00:00:00.000Z",
    });

    const calls: Parameters<ProcessRunner>[0][] = [];
    const result = await runWorkflowRunner({
      argv: [".ai/plans/current-plan.md"],
      rootDir: workspace.root,
      processRunner: async (call) => {
        calls.push(call);
        if (call.command === "git" && call.args[0] === "status") {
          return {
            launched: true,
            stdout: " M src/shared.ts\n",
            stderr: "",
            exitCode: 0,
          };
        }
        if (call.command === "git" && call.args[0] === "rev-parse") {
          return {
            launched: true,
            stdout: "headsha\n",
            stderr: "",
            exitCode: 0,
          };
        }
        if (call.promptPath === ".ai/prompts/execute-plan.md") {
          await writePlan(
            workspace.root,
            "current-plan",
            planWithFileScope(
              "blocked",
              "unblock-plan",
              { modified: ["src/shared.ts"] },
              ownershipScopeSection(["src/shared.ts"]),
            ),
          );
        }
        return { launched: true, stdout: "", stderr: "", exitCode: 0 };
      },
    });

    assert.equal(result.success, false);
    assert.match(result.reason, /plan blocked after execute-plan/);
    assert.equal(
      calls.some((call) => call.promptPath === ".ai/prompts/execute-plan.md"),
      true,
    );
  } finally {
    await workspace.cleanup();
  }
});

test("released ownership artifact files do not block dependent plans", async () => {
  const workspace = await setupWorkspace();
  try {
    await writePlan(
      workspace.root,
      "current-plan",
      planWithFileScope(
        "active",
        "execute-plan",
        {
          modified: ["src/shared.ts"],
        },
        ownershipScopeSection(["src/shared.ts"]),
      ),
    );
    await writeFileOwnershipArtifact(workspace.root, "other-plan", {
      planPath: ".ai/plans/other-plan.md",
      workflowState: "active",
      owns: ["src/shared.ts"],
      released: ["src/shared.ts"],
      resolvedFiles: [],
      changedFiles: [],
      headSha: "abc123",
      updatedAt: "2026-06-04T00:00:00.000Z",
    });

    const calls: Parameters<ProcessRunner>[0][] = [];
    const result = await runWorkflowRunner({
      argv: [".ai/plans/current-plan.md"],
      rootDir: workspace.root,
      processRunner: async (call) => {
        calls.push(call);
        if (call.command === "git" && call.args[0] === "status") {
          return { launched: true, stdout: "", stderr: "", exitCode: 0 };
        }
        if (call.command === "git" && call.args[0] === "rev-parse") {
          return {
            launched: true,
            stdout: "headsha\n",
            stderr: "",
            exitCode: 0,
          };
        }
        if (call.promptPath === ".ai/prompts/execute-plan.md") {
          await writePlan(
            workspace.root,
            "current-plan",
            planWithFileScope(
              "blocked",
              "unblock-plan",
              {
                modified: ["src/shared.ts"],
              },
              ownershipScopeSection(["src/shared.ts"]),
            ),
          );
        }
        return { launched: true, stdout: "", stderr: "", exitCode: 0 };
      },
    });

    assert.equal(result.success, false);
    assert.match(result.reason, /plan blocked after execute-plan/);
    assert.equal(
      calls.some((call) => call.promptPath === ".ai/prompts/execute-plan.md"),
      true,
    );
  } finally {
    await workspace.cleanup();
  }
});

test("commit-summary excludes transferred file ownership releases from commit boundary", async () => {
  const workspace = await setupWorkspace();
  try {
    await writePlan(
      workspace.root,
      "current-plan",
      planWithFileScope(
        "completed",
        "commit-summary",
        {
          modified: ["src/shared.ts", "src/owned.ts"],
        },
        ownershipReleaseSection("src/shared.ts", ".ai/plans/dependent-plan.md"),
      ),
    );
    const calls: Parameters<ProcessRunner>[0][] = [];
    const result = await runWorkflowRunner({
      argv: [".ai/plans/current-plan.md"],
      rootDir: workspace.root,
      processRunner: runnerReturning(
        { launched: true, stdout: "summary", stderr: "", exitCode: 0 },
        (call) => {
          calls.push(call);
        },
      ),
    });

    assert.equal(result.success, true);
    const codexCall = calls.find((call) => call.command === CODEX_COMMAND);
    assert.ok(codexCall);
    const prompt = codexCall.args.at(-1) ?? "";
    assert.match(prompt, /- src\/owned\.ts/);
    assert.doesNotMatch(prompt, /- src\/shared\.ts/);
    assert.match(prompt, /git add --all -- src\/owned\.ts/);
    assert.doesNotMatch(prompt, /git add --all -- src\/shared\.ts/);
  } finally {
    await workspace.cleanup();
  }
});
