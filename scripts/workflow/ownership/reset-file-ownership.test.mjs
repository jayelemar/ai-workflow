import assert from "node:assert/strict";
import { mkdir, mkdtemp, readFile, readdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";

import { resetFileOwnershipArtifact } from "./reset-file-ownership.mjs";

const createWorkspace = async () => {
  const root = await mkdtemp(join(tmpdir(), "reset-file-ownership-"));
  await mkdir(join(root, ".ai", "plans"), { recursive: true });
  await mkdir(join(root, ".ai", "artifacts", "example-plan", "state"), {
    recursive: true,
  });
  await writeFile(join(root, ".ai", "plans", "example-plan.md"), "# Plan\n");
  await writeFile(
    join(root, ".ai", "artifacts", "example-plan", "state", "file-ownership.json"),
    `${JSON.stringify(
      {
        planPath: ".ai/plans/example-plan.md",
        owns: ["src/owned.ts"],
        released: [],
        resolvedFiles: ["src/owned.ts"],
        changedFiles: ["src/owned.ts"],
        headSha: "abc123",
        updatedAt: "2026-07-06T20:49:49Z",
      },
      null,
      2,
    )}\n`,
  );

  return {
    root,
    cleanup: () => rm(root, { recursive: true, force: true }),
  };
};

test("reset requires explicit force and leaves artifact unchanged", async () => {
  const workspace = await createWorkspace();
  try {
    const result = await resetFileOwnershipArtifact({
      cwd: workspace.root,
      planPath: ".ai/plans/example-plan.md",
      force: false,
      now: () => "2026-07-07T00:00:00.000Z",
    });

    assert.equal(result.ok, false);
    assert.match(result.reason, /requires --force/);

    const artifact = JSON.parse(
      await readFile(
        join(workspace.root, ".ai", "artifacts", "example-plan", "state", "file-ownership.json"),
        "utf8",
      ),
    );
    assert.deepEqual(artifact.owns, ["src/owned.ts"]);
  } finally {
    await workspace.cleanup();
  }
});

test("reset writes empty ownership and backs up previous artifact", async () => {
  const workspace = await createWorkspace();
  try {
    const result = await resetFileOwnershipArtifact({
      cwd: workspace.root,
      planPath: ".ai/plans/example-plan.md",
      force: true,
      now: () => "2026-07-07T00:00:00.000Z",
    });

    assert.equal(result.ok, true);
    assert.match(result.backupPath, /file-ownership\.backup-20260707000000000Z\.json$/);

    const artifact = JSON.parse(
      await readFile(
        join(workspace.root, ".ai", "artifacts", "example-plan", "state", "file-ownership.json"),
        "utf8",
      ),
    );
    assert.deepEqual(artifact, {
      planPath: ".ai/plans/example-plan.md",
      owns: [],
      released: [],
      resolvedFiles: [],
      changedFiles: [],
      headSha: "abc123",
      updatedAt: "2026-07-07T00:00:00.000Z",
    });

    const stateFiles = await readdir(
      join(workspace.root, ".ai", "artifacts", "example-plan", "state"),
    );
    assert.equal(
      stateFiles.includes("file-ownership.backup-20260707000000000Z.json"),
      true,
    );
  } finally {
    await workspace.cleanup();
  }
});
