import assert from "node:assert/strict";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { mkdirSync } from "node:fs";
import { dirname, join } from "node:path";
import { tmpdir } from "node:os";
import test from "node:test";

import {
  canonicalFileOwnershipArtifact,
  detectFileOwnershipArtifactConflict,
  parseFileOwnershipArtifact,
  parseGitStatusChangedFileEntries,
  refreshAndCheckFileOwnershipArtifact,
} from "./file-ownership.ts";
import type {
  FileOwnershipArtifact,
  ParsedPlan,
  ProcessRunner,
} from "../runner/types.ts";

const setupWorkspace = async () => {
  const root = await mkdtemp(join(tmpdir(), "workflow-file-ownership-"));
  mkdirSync(join(root, ".ai", "plans"), { recursive: true });
  return {
    root,
    cleanup: () => rm(root, { recursive: true, force: true }),
  };
};

const writeArtifact = async (
  root: string,
  planName: string,
  artifact: Record<string, unknown>,
) => {
  const artifactPath = join(
    root,
    ".ai",
    "artifacts",
    planName,
    "state",
    "file-ownership.json",
  );
  mkdirSync(dirname(artifactPath), { recursive: true });
  await writeFile(artifactPath, `${JSON.stringify(artifact, null, 2)}\n`, "utf8");
  return artifactPath;
};

const writeWorkflow = async (
  root: string,
  planName: string,
  workflowState = "active",
) => {
  const workflowPath = join(
    root,
    ".ai",
    "artifacts",
    planName,
    "state",
    "workflow.json",
  );
  mkdirSync(dirname(workflowPath), { recursive: true });
  await writeFile(
    workflowPath,
    `${JSON.stringify(
      {
        planPath: `.ai/plans/${planName}.md`,
        workflowState,
        latest: {},
        history: [],
        unresolvedBlockers: [],
        updatedAt: "2026-07-19T00:00:00.000Z",
      },
      null,
      2,
    )}\n`,
    "utf8",
  );
};

const parsedPlan = (content: string): ParsedPlan => ({
  ok: true,
  planName: "current-plan",
  planPath: ".ai/plans/current-plan.md",
  absolutePlanPath: "/tmp/current-plan.md",
  manifestContent: content,
  content,
  thinPlanContract: "thin-plan-v2",
  workflowState: "active",
  warnings: [],
});

test("git status ownership parser classifies created modified deleted and rename targets", () => {
  assert.deepEqual(
    parseGitStatusChangedFileEntries(
      [
        " M src/modified.ts",
        "A  src/added.ts",
        " D src/deleted.ts",
        "R  src/old.ts -> src/new.ts",
        "?? src/untracked.ts",
        " M src/modified.ts",
      ].join("\n"),
    ),
    [
      { path: "src/modified.ts", change: "modified" },
      { path: "src/added.ts", change: "created" },
      { path: "src/deleted.ts", change: "deleted" },
      { path: "src/new.ts", change: "modified" },
      { path: "src/untracked.ts", change: "created" },
    ],
  );
});

test("file ownership artifact parser migrates legacy shape and canonicalizes output", () => {
  const parsed = parseFileOwnershipArtifact(
    JSON.stringify({
      planPath: ".ai/plans/legacy-plan.md",
      ownedFiles: ["src/shared.ts"],
      releasedFiles: ["src/released.ts"],
    }),
    "file-ownership.json",
  );

  if ("ok" in parsed) {
    assert.fail(parsed.reason);
  }
  assert.equal(parsed.migratedFromLegacy, true);
  assert.deepEqual(canonicalFileOwnershipArtifact(parsed), {
    planPath: ".ai/plans/legacy-plan.md",
    owns: ["src/shared.ts"],
    released: ["src/released.ts"],
    resolvedFiles: [],
    changedFiles: [],
    headSha: "",
    updatedAt: "",
  });
});

test("file ownership refresh resolves globs to changed files and writes sidecar", async () => {
  const workspace = await setupWorkspace();
  try {
    const processRunner: ProcessRunner = async (call) => {
      if (call.command === "git" && call.args[0] === "status") {
        return {
          launched: true,
          stdout: [
            " M src/features/owned.ts",
            " M src/other.ts",
            " M .ai/artifacts/current-plan/state/context.md",
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
      return { launched: true, stdout: "", stderr: "", exitCode: 0 };
    };

    const result = await refreshAndCheckFileOwnershipArtifact({
      rootDir: workspace.root,
      plan: parsedPlan(`## Ownership Scope

* src/features/**
* .ai/artifacts/current-plan/state/context.md
`),
      processRunner,
      timestamp: () => "2026-07-19T00:00:00.000Z",
      isIgnored: async () => false,
    });

    if ("ok" in result) {
      assert.fail(result.reason);
    }
    assert.equal(result.hasOwnershipScope, true);
    assert.deepEqual(result.artifact.resolvedFiles, [
      "src/features/owned.ts",
      ".ai/artifacts/current-plan/state/context.md",
    ]);
    assert.deepEqual(result.artifact.changedFiles, [
      "src/features/owned.ts",
      ".ai/artifacts/current-plan/state/context.md",
    ]);
    assert.deepEqual(result.reviewStagingPaths, ["src/features/owned.ts"]);

    const written = JSON.parse(
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
    ) as FileOwnershipArtifact;
    assert.equal(written.headSha, "headsha");
  } finally {
    await workspace.cleanup();
  }
});

test("file ownership conflict detection uses canonical workflow state", async () => {
  const workspace = await setupWorkspace();
  try {
    await writeArtifact(workspace.root, "other-plan", {
      planPath: ".ai/plans/other-plan.md",
      status: "completed",
      nextAction: "commit-summary",
      owns: ["src/shared.ts"],
      released: [],
      resolvedFiles: ["src/shared.ts"],
      changedFiles: ["src/shared.ts"],
      headSha: "otherhead",
      updatedAt: "2026-07-19T00:00:00.000Z",
    });
    await writeWorkflow(
      workspace.root,
      "other-plan",
      "active",
    );

    const conflict = await detectFileOwnershipArtifactConflict({
      rootDir: workspace.root,
      current: {
        planPath: ".ai/plans/current-plan.md",
        owns: ["src/shared.ts"],
        released: [],
        resolvedFiles: ["src/shared.ts"],
        changedFiles: ["src/shared.ts"],
        headSha: "currenthead",
        updatedAt: "2026-07-19T00:01:00.000Z",
      },
      changedFiles: ["src/shared.ts"],
      dirtyFiles: [],
    });

    if (conflict.ok) {
      assert.fail("expected ownership conflict");
    }
    assert.match(conflict.reason, /\.ai\/plans\/other-plan\.md/);
  } finally {
    await workspace.cleanup();
  }
});
