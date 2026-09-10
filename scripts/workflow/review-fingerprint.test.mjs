import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import {
  chmod,
  mkdtemp,
  mkdir,
  rename,
  rm,
  symlink,
  unlink,
  writeFile,
} from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { promisify } from "node:util";
import { fileURLToPath } from "node:url";

import {
  computeReviewFingerprint,
  parseReviewFingerprintArgs,
  runReviewFingerprint,
} from "./review-fingerprint.mjs";

const execFileAsync = promisify(execFile);
const helperPath = fileURLToPath(
  new URL("./review-fingerprint.mjs", import.meta.url),
);

const git = (root, args) =>
  execFileAsync("git", ["-C", root, ...args], { encoding: "utf8" });

const withRepository = async (callback) => {
  const root = await mkdtemp(path.join(os.tmpdir(), "review-fingerprint-"));
  try {
    await git(root, ["init", "--quiet"]);
    await writeFile(path.join(root, "owned.txt"), "owned baseline\n");
    await writeFile(path.join(root, "other.txt"), "other baseline\n");
    await mkdir(path.join(root, "owned"));
    await git(root, ["add", "."]);
    await git(root, [
      "-c",
      "user.name=Workflow Test",
      "-c",
      "user.email=workflow@example.test",
      "commit",
      "--quiet",
      "-m",
      "test: baseline",
    ]);
    const base = (await git(root, ["rev-parse", "HEAD"])).stdout.trim();
    await callback({ base, root });
  } finally {
    await rm(root, { force: true, recursive: true });
  }
};

const fingerprint = ({ base, ownedPaths = ["owned.txt"], root }) =>
  computeReviewFingerprint({
    integrationBase: base,
    ownedPaths,
    repositoryId: "app",
    repositoryRoot: root,
  });

test("fingerprints are stable and ignore changes outside plan ownership", async () => {
  await withRepository(async ({ base, root }) => {
    const initial = await fingerprint({ base, root });
    assert.deepEqual(await fingerprint({ base, root }), initial);

    await writeFile(path.join(root, "other.txt"), "unrelated change\n");
    assert.equal(
      (await fingerprint({ base, root })).planOwnedDigest,
      initial.planOwnedDigest,
    );

    await writeFile(path.join(root, "owned.txt"), "owned change\n");
    const changed = await fingerprint({ base, root });
    assert.notEqual(changed.planOwnedDigest, initial.planOwnedDigest);

    await git(root, ["add", "owned.txt"]);
    assert.equal(
      (await fingerprint({ base, root })).planOwnedDigest,
      changed.planOwnedDigest,
    );
    await git(root, [
      "-c",
      "user.name=Workflow Test",
      "-c",
      "user.email=workflow@example.test",
      "commit",
      "--quiet",
      "-m",
      "test: owned change",
    ]);
    const committed = await fingerprint({ base, root });
    assert.equal(committed.planOwnedDigest, changed.planOwnedDigest);
    assert.notEqual(committed.headSha, initial.headSha);
  });
});

test("fingerprints cover untracked names, content, modes, and tracked deletion", async () => {
  await withRepository(async ({ base, root }) => {
    const initial = await fingerprint({
      base,
      ownedPaths: ["owned", "owned.txt"],
      root,
    });
    let untracked = path.join(root, "owned/new.bin");
    await writeFile(untracked, Buffer.from([0, 1, 2, 3]));
    const withUntracked = await fingerprint({
      base,
      ownedPaths: ["owned.txt", "owned"],
      root,
    });
    assert.notEqual(withUntracked.planOwnedDigest, initial.planOwnedDigest);
    assert.equal(withUntracked.untrackedFileCount, 1);

    await chmod(untracked, 0o755);
    const executable = await fingerprint({
      base,
      ownedPaths: ["owned", "owned.txt"],
      root,
    });
    assert.notEqual(executable.planOwnedDigest, withUntracked.planOwnedDigest);

    await writeFile(untracked, Buffer.from([3, 2, 1, 0]));
    const differentContent = await fingerprint({
      base,
      ownedPaths: ["owned", "owned.txt"],
      root,
    });
    assert.notEqual(
      differentContent.planOwnedDigest,
      executable.planOwnedDigest,
    );

    const renamed = path.join(root, "owned/renamed.bin");
    await rename(untracked, renamed);
    untracked = renamed;
    const differentName = await fingerprint({
      base,
      ownedPaths: ["owned", "owned.txt"],
      root,
    });
    assert.notEqual(
      differentName.planOwnedDigest,
      differentContent.planOwnedDigest,
    );

    await unlink(untracked);
    await symlink("first-target", untracked);
    const symlinkTarget = await fingerprint({
      base,
      ownedPaths: ["owned", "owned.txt"],
      root,
    });
    await unlink(untracked);
    await symlink("second-target", untracked);
    const changedSymlinkTarget = await fingerprint({
      base,
      ownedPaths: ["owned", "owned.txt"],
      root,
    });
    assert.notEqual(
      changedSymlinkTarget.planOwnedDigest,
      symlinkTarget.planOwnedDigest,
    );

    await unlink(path.join(root, "owned.txt"));
    const deleted = await fingerprint({
      base,
      ownedPaths: ["owned", "owned.txt"],
      root,
    });
    assert.notEqual(deleted.trackedDiffDigest, initial.trackedDiffDigest);
  });
});

test("the integration base and ownership set are fingerprint inputs", async () => {
  await withRepository(async ({ base, root }) => {
    await writeFile(path.join(root, "owned.txt"), "owned change\n");
    await git(root, ["add", "owned.txt"]);
    await git(root, [
      "-c",
      "user.name=Workflow Test",
      "-c",
      "user.email=workflow@example.test",
      "commit",
      "--quiet",
      "-m",
      "test: second base",
    ]);
    const nextBase = (await git(root, ["rev-parse", "HEAD"])).stdout.trim();
    const originalBase = await fingerprint({ base, root });
    const updatedBase = await fingerprint({ base: nextBase, root });
    assert.notEqual(originalBase.planOwnedDigest, updatedBase.planOwnedDigest);

    const expandedOwnership = await fingerprint({
      base,
      ownedPaths: ["other.txt", "owned.txt"],
      root,
    });
    assert.notEqual(
      expandedOwnership.planOwnedDigest,
      originalBase.planOwnedDigest,
    );
  });
});

test("unsafe or incomplete CLI input is rejected without exposing content", async () => {
  assert.match(parseReviewFingerprintArgs([]).error, /required/);
  assert.match(
    parseReviewFingerprintArgs([
      "--repository-id",
      "app",
      "--repository-root",
      ".",
      "--integration-base",
      "HEAD",
      "--owned-path",
      "../secret",
    ]).ownedPaths[0],
    /\.\.\/secret/,
  );

  await withRepository(async ({ base, root }) => {
    await assert.rejects(
      fingerprint({ base, ownedPaths: ["../secret"], root }),
      /escapes the repository/,
    );
    await assert.rejects(
      fingerprint({ base, ownedPaths: [":(glob)**"], root }),
      /unsafe plan-owned path/,
    );
    await assert.rejects(
      fingerprint({ base, ownedPaths: ["owned/*.js"], root }),
      /unsafe plan-owned path/,
    );

    await writeFile(path.join(root, "owned.txt"), "private review content\n");
    const output = [];
    const result = await runReviewFingerprint({
      args: [
        "--repository-id",
        "app",
        "--repository-root",
        root,
        "--integration-base",
        base,
        "--owned-path",
        "owned.txt",
      ],
      output: (line) => output.push(line),
    });
    assert.equal(result.ok, true, output.join("\n"));
    assert.doesNotMatch(output.join("\n"), /private review content/);
    assert.match(output.join("\n"), /review-input-fingerprint@1/);
  });
});

test("Git environment overrides cannot redirect fingerprint evidence", async () => {
  await withRepository(async ({ base, root }) => {
    const { stdout } = await execFileAsync(
      process.execPath,
      [
        helperPath,
        "--repository-id",
        "app",
        "--repository-root",
        root,
        "--integration-base",
        base,
        "--owned-path",
        "owned.txt",
      ],
      {
        encoding: "utf8",
        env: {
          ...process.env,
          GIT_DIR: path.join(root, "missing-git-directory"),
          GIT_INDEX_FILE: path.join(root, "missing-index"),
          GIT_WORK_TREE: path.join(root, "missing-worktree"),
        },
      },
    );

    const result = JSON.parse(stdout);
    assert.equal(result.baseSha, base);
    assert.equal(result.repositoryId, "app");
  });
});
