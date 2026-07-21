import assert from "node:assert/strict";
import { mkdir, mkdtemp, readFile, writeFile } from "node:fs/promises";
import { rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import test from "node:test";

import type { PlanTask, WorkflowTaskContext } from "../types.ts";
import {
  currentTaskArtifactRelativePath,
  formatTaskProgressLine,
  nextIncompleteTask,
  readTaskArtifactStage,
  readableTaskProgressDescription,
  taskArtifactCommitSha,
  taskArtifactsRelativeDir,
  writeCurrentTaskPointer,
  writeTaskArtifact,
  writeTaskStageArtifact,
} from "./savepoints.ts";
import {
  estimateBossSummaryPercent,
  extractCommitSummarySubject,
  extractSummaryLines,
  readCompletedTaskSavepoints,
  writeBossSummary,
  writeExecutionSummary,
} from "./summaries.ts";
import { readHeadTaskCommit } from "./savepoints/commit-recovery.ts";

const testTask = (id: string, name: string): PlanTask => ({
  id,
  words: id.replace(/^[0-9]+-/, ""),
  name,
  artifactWords: id.replace(/^[0-9]+-/, ""),
});

const withWorkspace = async <T>(
  callback: (rootDir: string) => Promise<T>,
): Promise<T> => {
  const rootDir = await mkdtemp(path.join(tmpdir(), "runner-tasks-"));
  try {
    return await callback(rootDir);
  } finally {
    rmSync(rootDir, { recursive: true, force: true });
  }
};

test("task savepoint helpers reuse pending artifacts and detect completed tasks", async () => {
  await withWorkspace(async (rootDir) => {
    const planName = "workflow-runner";
    const firstTask = testTask("01-backend-endpoints", "Add backend endpoints");
    const secondTask = testTask("02-web-surface", "Add web surface");
    const firstArtifact = path.join(
      rootDir,
      taskArtifactsRelativeDir(planName),
      "01-backend-endpoints-v1.md",
    );
    const secondArtifact = path.join(
      rootDir,
      taskArtifactsRelativeDir(planName),
      "02-web-surface-v1.md",
    );
    await mkdir(path.dirname(firstArtifact), { recursive: true });
    await writeFile(
      firstArtifact,
      `# Task Savepoint: 01-backend-endpoints

## Commit SHA

abc1234
`,
      "utf8",
    );
    await writeFile(
      secondArtifact,
      `# Task Savepoint: 02-web-surface

## Stage

reviewing

## Commit SHA

(pending)
`,
      "utf8",
    );

    assert.equal(taskArtifactCommitSha("## Commit SHA\n\nabc1234\n"), "abc1234");
    assert.equal(
      await currentTaskArtifactRelativePath(rootDir, planName, secondTask),
      ".ai/artifacts/workflow-runner/tasks/02-web-surface-v1.md",
    );
    assert.equal(
      await readTaskArtifactStage(
        rootDir,
        ".ai/artifacts/workflow-runner/tasks/02-web-surface-v1.md",
      ),
      "reviewing",
    );
    assert.equal(
      (await nextIncompleteTask(rootDir, planName, [firstTask, secondTask]))
        ?.id,
      "02-web-surface",
    );
  });
});

test("task artifact writers preserve pointer and final artifact shape", async () => {
  await withWorkspace(async (rootDir) => {
    const task = testTask("01-backend-endpoints", "Add backend endpoints");
    const context: WorkflowTaskContext = {
      task,
      stage: "implementing",
      artifactPath: ".ai/artifacts/workflow-runner/tasks/01-backend-endpoints-v1.md",
    };

    assert.equal(
      (await writeTaskStageArtifact({
        rootDir,
        planPath: ".ai/plans/workflow-runner.md",
        context,
      })).ok,
      true,
    );
    assert.equal(
      (await writeCurrentTaskPointer({
        rootDir,
        planName: "workflow-runner",
        planPath: ".ai/plans/workflow-runner.md",
        context,
        timestamp: "2026-07-19T00:00:00.000Z",
      })).ok,
      true,
    );

    const committedContext = { ...context, stage: "committed", commitSha: "abc1234" };
    assert.equal(
      (await writeTaskArtifact({
        rootDir,
        planPath: ".ai/plans/workflow-runner.md",
        context: committedContext,
        changedFiles: [".ai/scripts/workflow/runner.ts"],
        summaryLines: ["Moved task savepoint helpers."],
        validationSummary: "tasks.test.ts passed",
        reviewResult: "Review accepted task.",
        commitMessage: "refactor(workflow): extract task savepoints",
      })).ok,
      true,
    );

    const artifact = await readFile(
      path.join(rootDir, committedContext.artifactPath),
      "utf8",
    );
    assert.match(artifact, /## Commit SHA\s+abc1234/);
    assert.match(artifact, /Moved task savepoint helpers\./);

    const pointer = await readFile(
      path.join(
        rootDir,
        ".ai",
        "artifacts",
        "workflow-runner",
        "state",
        "current-task.md",
      ),
      "utf8",
    );
    assert.match(pointer, /Task ID: 01-backend-endpoints/);
    assert.match(pointer, /Commit SHA: \(pending\)/);
  });
});

test("task summary helpers parse shared summaries and write rollups", async () => {
  await withWorkspace(async (rootDir) => {
    const planName = "workflow-runner";
    const task = testTask("01-backend-endpoints", "Add backend endpoints");
    const artifactPath = path.join(
      rootDir,
      taskArtifactsRelativeDir(planName),
      "01-backend-endpoints-v1.md",
    );
    await mkdir(path.dirname(artifactPath), { recursive: true });
    await writeFile(
      artifactPath,
      `# Task Savepoint: 01-backend-endpoints

## Summary

* Added backend endpoints.

## Validation Evidence

tasks.test.ts passed

## Review Result

PASS

## Commit SHA

abc1234

## Commit Message

feat(api): add backend endpoints
`,
      "utf8",
    );

    const completed = await readCompletedTaskSavepoints({
      rootDir,
      planName,
      tasks: [task],
    });
    assert.equal(completed.ok, true);
    assert.equal(completed.completedTasks[0]?.commitSha, "abc1234");
    assert.equal(
      estimateBossSummaryPercent({
        tasks: [task],
        completedTasks: completed.completedTasks,
        finalStatus: "completed",
      }),
      100,
    );
    assert.deepEqual(
      extractSummaryLines("* first\n* second", "fallback"),
      ["first", "second"],
    );
    assert.equal(extractCommitSummarySubject("plain output", "fallback"), "fallback");

    assert.equal(
      (await writeExecutionSummary({
        rootDir,
        planName,
        planPath: ".ai/plans/workflow-runner.md",
        tasks: [task],
        completedTasks: completed.completedTasks,
        finalStatus: "completed",
      })).ok,
      true,
    );
    assert.equal(
      (await writeBossSummary({
        rootDir,
        planName,
        tasks: [task],
        completedTasks: completed.completedTasks,
        finalStatus: "completed",
      })).ok,
      true,
    );

    const executionSummary = await readFile(
      path.join(rootDir, ".ai", "artifacts", planName, "execution-summary.md"),
      "utf8",
    );
    assert.match(executionSummary, /Completed savepoints: 1\/1/);
    const bossSummary = await readFile(
      path.join(rootDir, ".ai", "artifacts", planName, "boss-summary.md"),
      "utf8",
    );
    assert.match(bossSummary, /^Workflow Runner \(100%\)/);
    assert.match(bossSummary, /Commit abc1234/);
  });
});

test("task progress labels preserve ellipsized task descriptions", () => {
  const task = testTask(
    "01-backend-prompt-search-guidance",
    "Update prompt search guidance...",
  );

  assert.equal(
    readableTaskProgressDescription(task),
    "Update prompt search guidance for backend prompt search guidance",
  );
  assert.match(
    formatTaskProgressLine({
      task,
      stage: "reviewing",
      detail: "staged 2 files",
      taskPosition: 1,
      taskTotal: 2,
      completedTasks: 0,
    }),
    /\[REVIEW\] Task 1 of 2[\s\S]*Review scope: 2 staged files/,
  );
});

test("task commit recovery does not reuse a commit recorded by another savepoint", async () => {
  const recovered = await readHeadTaskCommit({
    rootDir: "/repo",
    planName: "workflow-runner",
    planPath: ".ai/plans/workflow-runner.md",
    task: testTask("03-browser-recovery-bootstrap", "Route browser bootstrap"),
    expectedParentSha: "abc1234",
    recordedCommitShas: ["def5678de"],
    processRunner: async () => ({
      launched: true,
      stdout: [
        "def5678def5678def5678def5678def5678",
        "abc1234",
        "feat(web): route bootstrap",
      ].join("\n"),
      stderr: "",
      exitCode: 0,
    }),
  });

  assert.equal(recovered.ok, true);
  if (!recovered.ok) {
    return;
  }
  assert.equal(recovered.commit, undefined);
});
