import assert from "node:assert/strict";
import { writeFile } from "node:fs/promises";
import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import test from "node:test";

import {
  parseCommitSummaryPathsForPlan,
} from "../commit.ts";
import {
  checkReviewStagingWorktreeClean,
  parseReviewStagingPaths,
  runReviewStagingForPaths,
  stagedStatusHasMixedReviewPath,
} from "../staging.ts";
import {
  buildReviewScopeMetadata,
  runScopeCleanupForPathBatches,
  runScopeCleanupForPaths,
  selectReviewPrimaryPaths,
  splitReviewPrimaryPathsIntoBatches,
} from "../scope.ts";
import {
  WORKFLOW_REVIEW_FULL_DIFF_BYTE_LIMIT,
  WORKFLOW_REVIEW_PRIMARY_PATH_LIMIT,
} from "../../../telemetry/token-warnings.ts";
import { WORKFLOW_RUNNER_CODEX_PROFILE } from "../../../config/codex.ts";
import type { ProcessRunner } from "../../types.ts";
import {
  createThinPlanArtifactWriter,
  setupWorkflowWorkspace,
} from "../../__tests__/helpers/workspace.ts";
import {
  planWith,
  planWithFileScope,
  thinPlanManifest,
} from "../../__tests__/helpers/runner-plan.ts";

const PROMPTS = {
  "scope-cleanup.md": "SCOPE CLEANUP PROMPT",
};

const setupWorkspace = () =>
  setupWorkflowWorkspace({
    prefix: "workflow-review-",
    directories: [".ai/plans", ".ai/prompts"],
    prompts: PROMPTS,
  });

const writeThinPlanArtifacts = createThinPlanArtifactWriter("review");

const ownershipReleaseSection = (
  file: string,
  releasedTo = ".ai/plans/dependent-plan.md",
) => `## File Ownership Releases

### Release v1

* File: ${file}
* Released By: .ai/plans/current-plan.md
* Released To: ${releasedTo}
* Evidence: current-plan file-specific validation passed
* Status: transferred
`;

const reviewFileScope = (
  {
    created = [],
    modified = [],
    deleted = [],
  }: {
    created?: string[];
    modified?: string[];
    deleted?: string[];
  },
  extra = "",
) => {
  const bullets = (paths: string[]) =>
    paths.length > 0 ? paths.map((file) => `* ${file}`).join("\n") : "* None";
  return `## Files (MANDATORY)

### Created files

${bullets(created)}

### Modified files

${bullets(modified)}

### Deleted files

${bullets(deleted)}

${extra}`;
};

const codexAgentMessageLine = (text: string) =>
  JSON.stringify({
    type: "item.completed",
    item: {
      id: "item_agent",
      type: "agent_message",
      text,
    },
  });

test("review primary path selection prioritizes focused paths while capped", () => {
  const allPaths = Array.from({ length: 24 }, (_, index) => `src/${index}.ts`);
  assert.deepEqual(
    selectReviewPrimaryPaths({
      allPaths,
      narrowPass: 1,
      latestTaskPaths: ["src/12.ts", "src/3.ts"],
      blockerPaths: ["src/8.ts"],
    }),
    ["src/12.ts", "src/3.ts", "src/8.ts"],
  );
  assert.equal(
    selectReviewPrimaryPaths({ allPaths, narrowPass: 1 }).length,
    WORKFLOW_REVIEW_PRIMARY_PATH_LIMIT,
  );
});

test("review scope excludes generated output from the full-diff budget", async () => {
  const calls: Parameters<ProcessRunner>[0][] = [];
  const generatedPath = "packages/supabase/src/generated.ts";
  const migrationPath = "supabase/migrations/20260714075435_example.sql";
  const servicePath = "apps/backend/src/example.service.ts";
  const runner: ProcessRunner = async (call) => {
    calls.push(call);
    if (call.args.includes("--stat")) {
      return {
        launched: true,
        exitCode: 0,
        stdout: `${generatedPath} | 9000\n${migrationPath} | 300\n${servicePath} | 40\n`,
        stderr: "",
      };
    }
    return {
      launched: true,
      exitCode: 0,
      stdout: "small non-generated diff",
      stderr: "",
    };
  };

  const result = await buildReviewScopeMetadata({
    rootDir: "/workspace",
    paths: [generatedPath, migrationPath, servicePath],
    planContent: `${generatedPath}\n${migrationPath}\n${servicePath}`,
    processRunner: runner,
    narrowPass: 0,
  });

  assert.equal(result.ok, true);
  if (!result.ok) return;
  assert.deepEqual(result.scope.summaryOnlyPaths, [generatedPath]);
  assert.deepEqual(result.scope.reviewPrimaryPaths, [
    migrationPath,
    servicePath,
  ]);
  assert.equal(
    result.scope.diffBytes,
    Buffer.byteLength("small non-generated diff"),
  );
});

test("review scope batches aggregate full diffs below the byte limit", async () => {
  const paths = ["src/a.ts", "src/b.ts", "src/c.ts"];
  const pathDiffs = new Map(paths.map((reviewPath) => [
    reviewPath,
    `${reviewPath}:${"x".repeat(30_000)}`,
  ]));
  const runner: ProcessRunner = async (call) => {
    if (call.args.includes("--stat")) {
      return {
        launched: true,
        exitCode: 0,
        stdout: paths.map((reviewPath) => `${reviewPath} | 1`).join("\n"),
        stderr: "",
      };
    }
    const separatorIndex = call.args.indexOf("--");
    const scopedPaths = call.args.slice(separatorIndex + 1);
    return {
      launched: true,
      exitCode: 0,
      stdout: scopedPaths.map((reviewPath) => pathDiffs.get(reviewPath)).join("\n"),
      stderr: "",
    };
  };

  const result = await buildReviewScopeMetadata({
    rootDir: "/workspace",
    paths,
    planContent: "",
    processRunner: runner,
    narrowPass: 0,
  });

  assert.equal(result.ok, true);
  if (!result.ok) return;
  assert.deepEqual(result.scope.reviewPrimaryPathBatches, [
    ["src/a.ts", "src/b.ts"],
    ["src/c.ts"],
  ]);
  assert.ok(result.scope.diffBytes! <= WORKFLOW_REVIEW_FULL_DIFF_BYTE_LIMIT);
});

test("review primary batching keeps an oversized individual file isolated", () => {
  assert.deepEqual(
    splitReviewPrimaryPathsIntoBatches({
      paths: ["src/large.sql", "src/small.sql"],
      diffBytesByPath: new Map([
        ["src/large.sql", WORKFLOW_REVIEW_FULL_DIFF_BYTE_LIMIT + 1],
        ["src/small.sql", 1],
      ]),
    }),
    [["src/large.sql"], ["src/small.sql"]],
  );
});

test("review scope remains reviewable for an oversized individual diff", async () => {
  const result = await buildReviewScopeMetadata({
    rootDir: "/workspace",
    paths: ["src/large.sql"],
    planContent: "",
    processRunner: async (call) => ({
      launched: true,
      exitCode: 0,
      stdout: call.args.includes("--stat")
        ? "src/large.sql | 1\n"
        : "x".repeat(WORKFLOW_REVIEW_FULL_DIFF_BYTE_LIMIT + 1),
      stderr: "",
    }),
    narrowPass: 3,
  });

  assert.equal(result.ok, true);
  if (!result.ok) return;
  assert.deepEqual(result.scope.reviewPrimaryPathBatches, [["src/large.sql"]]);
  assert.equal(
    result.scope.diffBytes,
    WORKFLOW_REVIEW_FULL_DIFF_BYTE_LIMIT + 1,
  );
  assert.match(result.scope.autoNarrowReason ?? "", /review full diff/);
});

test("review staging clears stale staged path then re-adds before review", async () => {
  const calls: Parameters<ProcessRunner>[0][] = [];
  let statusCallCount = 0;
  const runner: ProcessRunner = async (call) => {
    calls.push(call);
    if (call.args[0] === "status") {
      statusCallCount += 1;
      return {
        launched: true,
        exitCode: 0,
        stdout: "M  src/a.ts\n",
        stderr: "",
      };
    }
    if (call.args.slice(0, 3).join(" ") === "diff --cached --name-only") {
      return { launched: true, exitCode: 0, stdout: "src/a.ts\n", stderr: "" };
    }
    return { launched: true, exitCode: 0, stdout: "M  src/a.ts\n", stderr: "" };
  };

  const result = await runReviewStagingForPaths(
    "/tmp/repo",
    ["src/a.ts"],
    runner,
  );

  assert.equal(result.ok, true);
  assert.deepEqual(
    calls.map((call) => call.args.slice(0, 3).join(" ")),
    [
      "status --porcelain=v1 --untracked-files=all",
      "diff --cached --name-only",
      "restore --staged --",
      "add --all --",
      "status --porcelain=v1 --",
    ],
  );
  assert.equal(statusCallCount, 2);
});

test("review staging skips plan paths that are no longer changed", async () => {
  const calls: Parameters<ProcessRunner>[0][] = [];
  const runner: ProcessRunner = async (call) => {
    calls.push(call);
    if (call.args[0] === "status") {
      return {
        launched: true,
        exitCode: 0,
        stdout: " M src/changed.ts\n?? src/new.ts\n",
        stderr: "",
      };
    }
    return { launched: true, exitCode: 0, stdout: "", stderr: "" };
  };

  const result = await runReviewStagingForPaths(
    "/tmp/repo",
    ["src/changed.ts", "src/new.ts", "src/already-committed.ts"],
    runner,
  );

  assert.equal(result.ok, true);
  assert.deepEqual(result.ok && result.paths, ["src/changed.ts", "src/new.ts"]);
  const addCall = calls.find((call) => call.args[0] === "add");
  assert.deepEqual(addCall?.args, [
    "add",
    "--all",
    "--",
    "src/changed.ts",
    "src/new.ts",
  ]);
});

test("review staging fails when path remains mixed staged and unstaged", async () => {
  const runner: ProcessRunner = async (call) => {
    if (call.args[0] === "status") {
      return {
        launched: true,
        exitCode: 0,
        stdout: "MM src/a.ts\n",
        stderr: "",
      };
    }
    return { launched: true, exitCode: 0, stdout: "", stderr: "" };
  };

  const result = await runReviewStagingForPaths(
    "/tmp/repo",
    ["src/a.ts"],
    runner,
  );

  assert.equal(result.ok, false);
  assert.match(result.ok ? "" : result.reason, /mixed staged\/unstaged/);
  assert.equal(stagedStatusHasMixedReviewPath("MM src/a.ts\n"), true);
  assert.equal(stagedStatusHasMixedReviewPath("M  src/a.ts\n"), false);
});

test("review staging rejects a worktree mutation that occurs after staging", async () => {
  const result = await checkReviewStagingWorktreeClean(
    "/tmp/repo",
    ["src/a.ts"],
    async (call) => {
      assert.deepEqual(call.args, ["diff", "--quiet", "--", "src/a.ts"]);
      assert.equal(call.promptPath, "git-review-staging-worktree-check");
      return { launched: true, exitCode: 1, stdout: "", stderr: "" };
    },
  );

  assert.equal(result.ok, false);
  assert.match(result.ok ? "" : result.reason, /review scope changed after staging/);
});

test("scope cleanup skips Codex when staged diff exceeds 80 KB", async () => {
  const workspace = await setupWorkspace();
  try {
    const calls: Parameters<ProcessRunner>[0][] = [];
    const hugeDiff = `diff --git a/src/a.ts b/src/a.ts\n${"x".repeat(
      WORKFLOW_REVIEW_FULL_DIFF_BYTE_LIMIT + 1,
    )}`;
    const result = await runScopeCleanupForPaths({
      codexRuntime: {
        command: "codex",
        profile: WORKFLOW_RUNNER_CODEX_PROFILE,
        execLabel: "codex exec",
      },
      rootDir: workspace.root,
      planPath: ".ai/plans/workflow-runner.md",
      planContent: planWithFileScope("review", "review-plan", {
        modified: ["src/a.ts"],
      }),
      paths: ["src/a.ts"],
      processRunner: async (call) => {
        calls.push(call);
        if (call.command === "git" && call.args[0] === "diff") {
          return { launched: true, exitCode: 0, stdout: hugeDiff, stderr: "" };
        }
        return { launched: true, exitCode: 0, stdout: "", stderr: "" };
      },
      mode: "review",
    });

    assert.equal(result.skippedLargeDiff, true);
    assert.equal(
      calls.some((call) => call.command === "codex"),
      false,
    );
  } finally {
    await workspace.cleanup();
  }
});

test("scope cleanup restages the review scope when an unstage decision empties it", async () => {
  const workspace = await setupWorkspace();
  try {
    const calls: Parameters<ProcessRunner>[0][] = [];
    const stagedDiff = [
      "diff --git a/src/a.ts b/src/a.ts",
      "--- a/src/a.ts",
      "+++ b/src/a.ts",
      "@@ -1,0 +1 @@",
      "+const implementation = true;",
    ].join("\n");
    let scopeWasUnstaged = false;
    const result = await runScopeCleanupForPaths({
      codexRuntime: {
        command: "codex",
        profile: WORKFLOW_RUNNER_CODEX_PROFILE,
        execLabel: "codex exec",
      },
      rootDir: workspace.root,
      planPath: ".ai/plans/workflow-runner.md",
      planContent: planWithFileScope("review", "review-plan", {
        modified: ["src/a.ts"],
      }),
      paths: ["src/a.ts"],
      processRunner: async (call) => {
        calls.push(call);
        if (call.command === "git" && call.args[0] === "diff") {
          return {
            launched: true,
            exitCode: 0,
            stdout: scopeWasUnstaged ? "" : stagedDiff,
            stderr: "",
          };
        }
        if (call.command === "codex") {
          return {
            launched: true,
            exitCode: 0,
            stdout: codexAgentMessageLine(
              JSON.stringify({ action: "unstage", patch: stagedDiff }),
            ),
            stderr: "",
          };
        }
        if (call.promptPath === "git-scope-cleanup-unstage") {
          scopeWasUnstaged = true;
        }
        return { launched: true, exitCode: 0, stdout: "", stderr: "" };
      },
      mode: "review",
    });

    assert.equal(result.ok, true);
    assert.equal(
      calls.some(
        (call) => call.promptPath === "git-scope-cleanup-restage-empty-scope",
      ),
      true,
    );
  } finally {
    await workspace.cleanup();
  }
});

test("scope cleanup batches oversized aggregate diffs", async () => {
  const workspace = await setupWorkspace();
  try {
    const calls: Parameters<ProcessRunner>[0][] = [];
    const diffForPath = (scopedPath: string, marker: string) =>
      [
        `diff --git a/${scopedPath} b/${scopedPath}`,
        `--- a/${scopedPath}`,
        `+++ b/${scopedPath}`,
        "@@ -1,0 +1 @@",
        `+${marker.repeat(50_000)}`,
      ].join("\n");
    const diffs: Record<string, string> = {
      "src/a.ts": diffForPath("src/a.ts", "a"),
      "src/b.ts": diffForPath("src/b.ts", "b"),
      "src/c.ts": diffForPath("src/c.ts", "c"),
    };

    const result = await runScopeCleanupForPathBatches({
      codexRuntime: {
        command: "codex",
        profile: WORKFLOW_RUNNER_CODEX_PROFILE,
        execLabel: "codex exec",
      },
      rootDir: workspace.root,
      planPath: ".ai/plans/workflow-runner.md",
      planContent: planWithFileScope("review", "review-plan", {
        modified: ["src/a.ts", "src/b.ts", "src/c.ts"],
      }),
      paths: ["src/a.ts", "src/b.ts", "src/c.ts"],
      processRunner: async (call) => {
        calls.push(call);
        if (call.command === "git" && call.args[0] === "diff") {
          const separatorIndex = call.args.indexOf("--");
          const scopedPaths = call.args.slice(separatorIndex + 1);
          return {
            launched: true,
            exitCode: 0,
            stdout: scopedPaths
              .map((scopedPath) => diffs[scopedPath] ?? "")
              .join("\n"),
            stderr: "",
          };
        }
        if (call.command === "codex") {
          return {
            launched: true,
            exitCode: 0,
            stdout: codexAgentMessageLine(JSON.stringify({ action: "keep" })),
            stderr: "",
          };
        }
        return { launched: true, exitCode: 0, stdout: "", stderr: "" };
      },
      mode: "review",
    });

    assert.equal(result.skippedLargeDiff, undefined);
    assert.equal(calls.filter((call) => call.command === "codex").length, 3);
  } finally {
    await workspace.cleanup();
  }
});

test("review staging parses and filters concrete non-ignored files and rejects unsafe paths", async () => {
  const workspace = await setupWorkspace();
  try {
    mkdirSync(join(workspace.root, "src"), { recursive: true });
    writeFileSync(join(workspace.root, "src", "file.ts"), "");
    mkdirSync(join(workspace.root, "src", "dir"), { recursive: true });
    const plan = `## Files (MANDATORY)

### Created files

* src/file.ts (assumed)
* ignored.log

### Modified files

* None

### Deleted files

* deleted.ts
`;
    const parsed = await parseReviewStagingPaths({
      content: plan,
      rootDir: workspace.root,
      isIgnored: async (pathValue) => pathValue === "ignored.log",
    });
    assert.deepEqual(parsed.ok && parsed.paths, ["src/file.ts", "deleted.ts"]);

    for (const [name, bullet] of [
      ["empty", "* "],
      ["absolute", "* /tmp/file.ts"],
      ["parent", "* ../file.ts"],
      ["directory", "* src/dir"],
    ] as const) {
      const unsafe = await parseReviewStagingPaths({
        content: reviewFileScope({ created: [bullet.slice(2)] }),
        rootDir: workspace.root,
        isIgnored: async () => false,
      });
      assert.equal(unsafe.ok, false, name);
    }

    const ignoredOnly = await parseReviewStagingPaths({
      content: reviewFileScope({ created: ["ignored.log"] }),
      rootDir: workspace.root,
      isIgnored: async () => true,
    });
    assert.equal(ignoredOnly.ok, false);
    assert.match(
      ignoredOnly.ok ? "" : ignoredOnly.reason,
      /all review staging paths are git-ignored/,
    );
  } finally {
    await workspace.cleanup();
  }
});

test("review staging excludes transferred file ownership releases", async () => {
  const parsed = await parseReviewStagingPaths({
    content: reviewFileScope(
      { modified: ["src/shared.ts", "src/owned.ts"] },
      ownershipReleaseSection("src/shared.ts", ".ai/plans/dependent-plan.md"),
    ),
    isIgnored: async () => false,
  });

  assert.deepEqual(parsed.ok && parsed.paths, ["src/owned.ts"]);
});

test("review staging rejects unsafe transferred file ownership release paths", async () => {
  const workspace = await setupWorkspace();
  try {
    mkdirSync(join(workspace.root, "src", "dir"), { recursive: true });
    for (const [name, releasePath, reason] of [
      ["empty", "", /file ownership release path is empty/],
      ["absolute", "/tmp/shared.ts", /file ownership release path is absolute/],
      ["parent", "../shared.ts", /file ownership release path contains \.\./],
      [
        "directory",
        "src/dir",
        /file ownership release path is an existing directory/,
      ],
    ] as const) {
      const parsed = await parseReviewStagingPaths({
        content: reviewFileScope(
          { modified: ["src/owned.ts"] },
          ownershipReleaseSection(releasePath, ".ai/plans/dependent-plan.md"),
        ),
        rootDir: workspace.root,
        isIgnored: async () => false,
      });
      assert.equal(parsed.ok, false, name);
      assert.match(parsed.ok ? "" : parsed.reason, reason);
    }
  } finally {
    await workspace.cleanup();
  }
});

test("commit-summary uses thin-plan files artifact instead of inline files", async () => {
  const workspace = await setupWorkspace();
  try {
    mkdirSync(join(workspace.root, "src"), { recursive: true });
    await writeFile(
      join(workspace.root, "src", "artifact-state.ts"),
      "artifact state\n",
    );
    await writeThinPlanArtifacts(workspace.root, {
      status: "completed",
      nextAction: "commit-summary",
      modified: [
        "src/artifact-state.ts",
        ".ai/artifacts/artifact-state/logs/runner.log",
      ],
      changedFiles: [
        "src/artifact-state.ts",
        ".ai/artifacts/artifact-state/logs/runner.log",
      ],
    });
    const parsed = await parseCommitSummaryPathsForPlan(
      workspace.root,
      {
        planName: "artifact-state",
        planPath: ".ai/plans/artifact-state.md",
        absolutePlanPath: join(
          workspace.root,
          ".ai",
          "plans",
          "artifact-state.md",
        ),
        manifestContent: thinPlanManifest("completed", "commit-summary"),
        content: planWithFileScope("completed", "commit-summary", {
          modified: ["src/inline-should-not-be-used.ts"],
        }),
        thinPlanContract: "thin-plan",
        status: "completed",
        nextAction: "commit-summary",
        warnings: [],
      },
      async () => false,
    );

    assert.deepEqual(parsed.ok && parsed.paths, ["src/artifact-state.ts"]);
  } finally {
    await workspace.cleanup();
  }
});

test("commit-summary supplements a thin-plan inventory with declared task files", async () => {
  const workspace = await setupWorkspace();
  try {
    mkdirSync(join(workspace.root, "src"), { recursive: true });
    await writeFile(join(workspace.root, "src", "task.ts"), "task\n");
    await writeThinPlanArtifacts(workspace.root, {
      status: "completed",
      nextAction: "commit-summary",
      modified: ["src/earlier-task.ts"],
      changedFiles: ["src/earlier-task.ts"],
    });

    const parsed = await parseCommitSummaryPathsForPlan(
      workspace.root,
      {
        planName: "artifact-state",
        planPath: ".ai/plans/artifact-state.md",
        absolutePlanPath: join(
          workspace.root,
          ".ai",
          "plans",
          "artifact-state.md",
        ),
        manifestContent: thinPlanManifest("completed", "commit-summary"),
        content: planWithFileScope("completed", "commit-summary", {
          modified: ["src/inline-should-not-be-used.ts"],
        }),
        thinPlanContract: "thin-plan",
        status: "completed",
        nextAction: "commit-summary",
        warnings: [],
      },
      async () => false,
      ["src/task.ts"],
    );

    assert.deepEqual(parsed.ok && parsed.paths, ["src/task.ts"]);
  } finally {
    await workspace.cleanup();
  }
});

test("commit-summary omits absent non-deleted files from its thin-plan scope", async () => {
  const workspace = await setupWorkspace();
  try {
    mkdirSync(join(workspace.root, "src"), { recursive: true });
    await writeFile(join(workspace.root, "src", "current.ts"), "current\n");
    await writeThinPlanArtifacts(workspace.root, {
      status: "completed",
      nextAction: "commit-summary",
      created: ["src/future-test.ts"],
      modified: ["src/current.ts", "src/stale-test.ts"],
      deleted: ["src/deleted.ts"],
      changedFiles: [
        "src/current.ts",
        "src/future-test.ts",
        "src/stale-test.ts",
        "src/deleted.ts",
      ],
    });

    const parsed = await parseCommitSummaryPathsForPlan(
      workspace.root,
      {
        planName: "artifact-state",
        planPath: ".ai/plans/artifact-state.md",
        absolutePlanPath: join(
          workspace.root,
          ".ai",
          "plans",
          "artifact-state.md",
        ),
        manifestContent: thinPlanManifest("completed", "commit-summary"),
        content: planWithFileScope("completed", "commit-summary", {
          modified: ["src/inline-should-not-be-used.ts"],
        }),
        thinPlanContract: "thin-plan",
        status: "completed",
        nextAction: "commit-summary",
        warnings: [],
      },
      async () => false,
    );

    assert.deepEqual(parsed.ok && parsed.paths, [
      "src/current.ts",
      "src/deleted.ts",
    ]);
  } finally {
    await workspace.cleanup();
  }
});

test("review staging ignores Files section rule bullets after concrete file lists", async () => {
  const parsed = await parseReviewStagingPaths({
    content: `## Files (MANDATORY)

### Created files

* src/created.ts

### Modified files

* src/modified.ts

### Deleted files

* None

Rules:

* MUST use concrete file paths
* MUST NOT use vague terms like "service layer" or "module"
`,
    isIgnored: async () => false,
  });

  assert.deepEqual(parsed.ok && parsed.paths, [
    "src/created.ts",
    "src/modified.ts",
  ]);
});

test("review staging ignores common no-file placeholders", async () => {
  const parsed = await parseReviewStagingPaths({
    content: `## Files (MANDATORY)

### Created files

* src/created.ts

### Modified files

* none
- None
* (none)
- (None)
* N/A
- (n/a)
* no files
- (no files)

### Deleted files

* deleted.ts
`,
    isIgnored: async () => false,
  });

  assert.deepEqual(parsed.ok && parsed.paths, ["src/created.ts", "deleted.ts"]);
});

test("review staging rejects annotated file bullets that are not exact paths", async () => {
  const parsed = await parseReviewStagingPaths({
    content: `## Files (MANDATORY)

### Created files

* src/file.ts (inspect only if needed)

### Modified files

* src/other.ts (only if coverage changes)

### Deleted files

* None
`,
    isIgnored: async () => false,
  });

  assert.equal(parsed.ok, false);
  assert.match(
    parsed.ok ? "" : parsed.reason,
    /review staging path contains annotation; Files \(MANDATORY\) entries must be exact file paths/,
  );
});
