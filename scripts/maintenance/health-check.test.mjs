import assert from "node:assert/strict";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

import {
  parseHealthCheckArgs,
  runHealthCheck,
  workflowRoot,
} from "./health-check.mjs";

test("health check accepts only default, full, and help modes", () => {
  assert.deepEqual(parseHealthCheckArgs([]), { full: false });
  assert.deepEqual(parseHealthCheckArgs(["--full"]), { full: true });
  assert.deepEqual(parseHealthCheckArgs(["--help"]), {
    help: true,
    full: false,
  });
  assert.match(
    parseHealthCheckArgs(["--runner-tests"]).error,
    /Unknown option/,
  );
});

test("health check root is derived from the script location", () => {
  const expectedRoot = path.resolve(
    path.dirname(fileURLToPath(import.meta.url)),
    "../..",
  );
  assert.equal(workflowRoot, expectedRoot);
});

test("help is independent of the caller working directory", async () => {
  const output = [];
  const result = await runHealthCheck({
    args: ["--help"],
    commandExecutor: async () => {
      throw new Error("help must not run commands");
    },
    stdout: (message) => output.push(message),
    stderr: (message) => output.push(message),
  });

  assert.equal(result.ok, true);
  assert.equal(result.root, workflowRoot);
  assert.match(output.join("\n"), /health-check\.mjs \[--full\]/);
});

test("health implementation uses no shell or command substitution", async () => {
  const sourcePath = path.join(
    workflowRoot,
    "scripts/maintenance/health-check.mjs",
  );
  const source = await import("node:fs/promises").then(({ readFile }) =>
    readFile(sourcePath, "utf8"),
  );

  assert.doesNotMatch(source, /shell:\s*true/);
  assert.doesNotMatch(source, /\$\(find/);
  assert.match(source, /"scripts",/);
  assert.match(source, /md\|mjs\|ts\|json\|yaml/);
});
