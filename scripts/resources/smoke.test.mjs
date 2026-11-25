import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import path from "node:path";
import test from "node:test";
import { runInNewContext } from "node:vm";

// Exercise the actual standalone entrypoint with native phases substituted.
// Importing smoke.mjs would run its CLI; evaluating only the entrypoint keeps
// failure-report coverage independent of Docker, Simulator, and fixture writes.
const source = await readFile(new URL("./smoke.mjs", import.meta.url), "utf8");
const entrypointStart = source.indexOf("\nlet fixture;");
assert.ok(entrypointStart >= 0, "Standalone smoke entrypoint must be present");
const entrypoint = source.slice(entrypointStart);
const primaryId = "11111111-1111-4111-8111-111111111111";
const composeId = "22222222-2222-4222-8222-222222222222";
const primaryWorkspace = "/tmp/primary-smoke";
const composeWorkspace = "/tmp/compose-smoke";

async function runSmoke(failure) {
  const reports = [];
  const errors = [];
  const process = { argv: [], env: {}, exitCode: 0 };
  await runInNewContext(`(async () => {${entrypoint}\n})()`, {
    assert,
    path,
    process,
    console: {
      log: (line) => reports.push(JSON.parse(line)),
      error: (line) => errors.push(JSON.parse(line)),
    },
    options: () => ({ provider: "docker", "--fixture-id": primaryId }),
    randomUUID: () => composeId,
    workspaceFixture: async (id, onCreated) => {
      const workspace = id === primaryId ? primaryWorkspace : composeWorkspace;
      onCreated(workspace);
      if (id === composeId && failure === "setup")
        throw new Error("Compose fixture setup failed");
      return {
        workspace,
        worktreeRoot: `${workspace}/.worktrees/selected-task`,
        app: `${workspace}/app`,
        root: { executionId: "root" },
        worktree: { executionId: "worktree" },
        excluded: { executionId: "excluded" },
      };
    },
    dockerSmoke: async () => {
      if (failure === "primary") throw new Error("Primary phase failed");
      return { checks: { standalone: true } };
    },
    dockerPortSmoke: async () => {
      if (failure === "assertion")
        throw new assert.AssertionError({
          message: "Compose assertion failed",
        });
      if (failure === "build" || failure === "startup")
        throw new Error(`Compose ${failure} failed`);
      return { checks: { compose: true } };
    },
    readAllManifests: async () => [{}, {}],
    stat: async (file) => {
      if (file.endsWith("/.ai/artifacts"))
        throw Object.assign(new Error("Absent"), { code: "ENOENT" });
      return {};
    },
    git: async () => "smoke-source\nsmoke-worktree",
    writeFile: async () => {},
  });
  return { reports, errors, exitCode: process.exitCode };
}

test("Compose failures report both canonical recovery workspaces and fixture IDs", async (t) => {
  for (const phase of ["setup", "build", "startup", "assertion"]) {
    await t.test(phase, async () => {
      const result = await runSmoke(phase);
      assert.equal(result.exitCode, 1);
      assert.equal(result.reports.length, 0);
      assert.equal(result.errors.length, 1);
      const error = result.errors[0];
      assert.equal(error.fixtureId, primaryId);
      assert.equal(error.evidence, primaryWorkspace);
      assert.deepEqual(error.compose, {
        fixtureId: composeId,
        evidence: composeWorkspace,
      });
      assert.equal(error.failed, true);
      assert.match(error.cleanup, /No automatic failure cleanup/);
    });
  }
});

test("primary smoke failures keep their original recovery output without a secondary fixture", async () => {
  const result = await runSmoke("primary");
  assert.equal(result.exitCode, 1);
  assert.equal(result.errors[0].fixtureId, primaryId);
  assert.equal(result.errors[0].evidence, primaryWorkspace);
  assert.equal(Object.hasOwn(result.errors[0], "compose"), false);
});

test("successful full smoke includes the secondary fixture identity with its evidence", async () => {
  const result = await runSmoke();
  assert.equal(result.exitCode, 0);
  assert.deepEqual(result.errors, []);
  assert.equal(result.reports.length, 1);
  assert.equal(result.reports[0].compose.fixtureId, composeId);
  assert.equal(result.reports[0].compose.evidence, composeWorkspace);
  assert.deepEqual(result.reports[0].compose.checks, { compose: true });
});
