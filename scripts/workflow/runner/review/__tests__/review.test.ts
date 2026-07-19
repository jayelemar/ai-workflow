import assert from "node:assert/strict";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import test from "node:test";

import {
  parseCommitSummaryPathsForPlan,
} from "../commit.ts";
import {
  parseReviewStagingPaths,
  runReviewStagingForPaths,
  stagedStatusHasMixedReviewPath,
} from "../staging.ts";
import {
  buildReviewScopeMetadata,
  runScopeCleanupForPathBatches,
  runScopeCleanupForPaths,
  selectReviewPrimaryPaths,
} from "../scope.ts";
import {
  WORKFLOW_REVIEW_FULL_DIFF_BYTE_LIMIT,
  WORKFLOW_REVIEW_PRIMARY_PATH_LIMIT,
} from "../../../telemetry/token-warnings.ts";
import { WORKFLOW_RUNNER_CODEX_PROFILE } from "../../../config/codex.ts";
import type { ProcessRunner } from "../../types.ts";

type Workspace = {
  root: string;
  cleanup: () => Promise<void>;
};

const PROMPTS = {
  "scope-cleanup.md": "SCOPE CLEANUP PROMPT",
};

const setupWorkspace = async (): Promise<Workspace> => {
  const root = await mkdtemp(join(tmpdir(), "workflow-review-"));
  mkdirSync(join(root, ".ai", "prompts"), { recursive: true });
  for (const [name, content] of Object.entries(PROMPTS)) {
    writeFileSync(join(root, ".ai", "prompts", name), content);
  }
  return {
    root,
    cleanup: () => rm(root, { recursive: true, force: true }),
  };
};

const thinPlanContractSection = () => `## Workflow Content Rules

thin-plan-v1
`;

const planWith = (status: string, nextAction: string, extra = "") => `# Plan

${thinPlanContractSection()}

## Status

${status}

## Next Action

${nextAction}

## Files (MANDATORY)

### Created files

* .ai/scripts/workflow/runner/__tests__/integration/runner.test.ts

### Modified files

* .ai/scripts/workflow/runner.ts

### Deleted files

* None

${extra}
`;

const planWithFileScope = (
  status: string,
  nextAction: string,
  files: {
    created?: string[];
    modified?: string[];
    deleted?: string[];
  },
  extra = "",
) => `# Plan

${thinPlanContractSection()}

## Status

${status}

## Next Action

${nextAction}

## Files (MANDATORY)

### Created files

${(files.created ?? []).map((file) => `* ${file}`).join("\n") || "* None"}

### Modified files

${(files.modified ?? []).map((file) => `* ${file}`).join("\n") || "* None"}

### Deleted files

${(files.deleted ?? []).map((file) => `* ${file}`).join("\n") || "* None"}

${extra}
`;

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

const thinPlanV2Manifest = (
  status = "draft",
  nextAction = "plan-validator",
) => `# Plan: artifact-state

## Workflow Content Rules

thin-plan-v2

## Status

${status}

## Next Action

${nextAction}
`;

const writeThinPlanV2Artifacts = async (
  root: string,
  overrides: Partial<{
    status: string;
    nextAction: string;
    created: string[];
    modified: string[];
    deleted: string[];
    changedFiles: string[];
  }> = {},
) => {
  const artifactRoot = join(root, ".ai", "artifacts", "artifact-state");
  mkdirSync(join(artifactRoot, "state"), { recursive: true });
  const changedFiles = overrides.changedFiles ??
    overrides.modified ?? ["src/artifact-state.ts"];
  await writeFile(
    join(artifactRoot, "state", "workflow.json"),
    `${JSON.stringify(
      {
        planPath: ".ai/plans/artifact-state.md",
        status: overrides.status ?? "review",
        nextAction: overrides.nextAction ?? "review-plan",
        latest: {},
        history: [],
        unresolvedBlockers: [],
        updatedAt: "2026-07-01T00:00:00.000Z",
      },
      null,
      2,
    )}\n`,
  );
  await writeFile(
    join(artifactRoot, "state", "files.json"),
    `${JSON.stringify(
      {
        created: overrides.created ?? [],
        modified: overrides.modified ?? ["src/artifact-state.ts"],
        deleted: overrides.deleted ?? [],
        changedFiles,
        released: [],
        headSha: "abc123",
      },
      null,
      2,
    )}\n`,
  );
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
        content: planWith(
          "review",
          "review-plan",
          `### Created files\n\n${bullet}\n`,
        ),
        rootDir: workspace.root,
        isIgnored: async () => false,
      });
      assert.equal(unsafe.ok, false, name);
    }

    const ignoredOnly = await parseReviewStagingPaths({
      content: planWith(
        "review",
        "review-plan",
        "### Created files\n\n* ignored.log\n",
      ),
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
    content: planWithFileScope(
      "review",
      "review-plan",
      {
        modified: ["src/shared.ts", "src/owned.ts"],
      },
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
        content: planWithFileScope(
          "review",
          "review-plan",
          {
            modified: ["src/owned.ts"],
          },
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

test("commit-summary uses thin-plan-v2 files artifact instead of inline files", async () => {
  const workspace = await setupWorkspace();
  try {
    mkdirSync(join(workspace.root, "src"), { recursive: true });
    await writeFile(
      join(workspace.root, "src", "artifact-state.ts"),
      "artifact state\n",
    );
    await writeThinPlanV2Artifacts(workspace.root, {
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
        manifestContent: thinPlanV2Manifest("completed", "commit-summary"),
        content: planWithFileScope("completed", "commit-summary", {
          modified: ["src/inline-should-not-be-used.ts"],
        }),
        thinPlanContract: "thin-plan-v2",
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

test("commit-summary omits absent non-deleted files from its thin-plan-v2 scope", async () => {
  const workspace = await setupWorkspace();
  try {
    mkdirSync(join(workspace.root, "src"), { recursive: true });
    await writeFile(join(workspace.root, "src", "current.ts"), "current\n");
    await writeThinPlanV2Artifacts(workspace.root, {
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
        manifestContent: thinPlanV2Manifest("completed", "commit-summary"),
        content: planWithFileScope("completed", "commit-summary", {
          modified: ["src/inline-should-not-be-used.ts"],
        }),
        thinPlanContract: "thin-plan-v2",
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
