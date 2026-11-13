import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import {
  chmod,
  mkdir,
  mkdtemp,
  readFile,
  rm,
  writeFile,
} from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";

import { workflowRoot } from "./health-check.mjs";

test("installed hooks stop failing commits and pushes and allow passing ones", async () => {
  const temporaryRoot = await mkdtemp(path.join(os.tmpdir(), "ai-git-hooks-"));
  const repository = path.join(temporaryRoot, "repository");
  const remote = path.join(temporaryRoot, "remote.git");
  const bin = path.join(temporaryRoot, "bin");
  const log = path.join(temporaryRoot, "commands.log");
  try {
    await mkdir(path.join(repository, ".husky"), { recursive: true });
    await mkdir(bin);
    for (const hook of ["pre-commit", "pre-push"]) {
      await writeFile(
        path.join(repository, ".husky", hook),
        await readFile(path.join(workflowRoot, ".husky", hook)),
      );
    }
    const pnpm = path.join(bin, "pnpm");
    await writeFile(
      pnpm,
      '#!/bin/sh\nprintf "%s\\n" "$*" >> "$HOOK_LOG"\nexit "$HOOK_RESULT"\n',
    );
    await chmod(pnpm, 0o755);
    const env = {
      ...process.env,
      PATH: `${bin}${path.delimiter}${process.env.PATH}`,
      GIT_CONFIG_GLOBAL: os.devNull,
      GIT_CONFIG_NOSYSTEM: "1",
      GIT_AUTHOR_NAME: "Hook Test",
      GIT_AUTHOR_EMAIL: "hooks@example.invalid",
      GIT_COMMITTER_NAME: "Hook Test",
      GIT_COMMITTER_EMAIL: "hooks@example.invalid",
      HUSKY: "1",
      HOOK_LOG: log,
      HOOK_RESULT: "0",
    };
    const run = (command, args, overrides = {}) =>
      spawnSync(command, args, {
        cwd: repository,
        env: { ...env, ...overrides },
        encoding: "utf8",
      });
    const success = (result) =>
      assert.equal(result.status, 0, result.stderr || result.stdout);

    success(run("git", ["init", "-b", "hook-test"]));
    success(
      run(process.execPath, [
        path.join(workflowRoot, "node_modules/husky/bin.js"),
      ]),
    );
    await writeFile(path.join(repository, "sample.txt"), "sample\n");
    success(run("git", ["add", "sample.txt"]));

    const rejectedCommit = run("git", ["commit", "-m", "test hooks"], {
      HOOK_RESULT: "1",
    });
    assert.notEqual(rejectedCommit.status, 0);
    assert.notEqual(run("git", ["rev-parse", "--verify", "HEAD"]).status, 0);
    assert.equal(await readFile(log, "utf8"), "health\n");

    success(run("git", ["commit", "-m", "test hooks"]));
    const head = run("git", ["rev-parse", "HEAD"]).stdout.trim();
    assert.ok(head);
    success(run("git", ["init", "--bare", remote]));
    success(run("git", ["remote", "add", "origin", remote]));

    const rejectedPush = run("git", ["push", "origin", "hook-test"], {
      HOOK_RESULT: "1",
    });
    assert.notEqual(rejectedPush.status, 0);
    assert.notEqual(
      run("git", [
        "--git-dir",
        remote,
        "rev-parse",
        "--verify",
        "refs/heads/hook-test",
      ]).status,
      0,
    );
    success(run("git", ["push", "origin", "hook-test"]));
    assert.equal(
      run("git", [
        "--git-dir",
        remote,
        "rev-parse",
        "refs/heads/hook-test",
      ]).stdout.trim(),
      head,
    );
    assert.equal(
      await readFile(log, "utf8"),
      "health\nhealth\nhealth:full\nhealth:full\n",
    );
  } finally {
    await rm(temporaryRoot, { recursive: true, force: true });
  }
});
