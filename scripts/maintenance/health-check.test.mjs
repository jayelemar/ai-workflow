import assert from "node:assert/strict";
import test from "node:test";

import { parseHealthCheckArgs } from "./health-check.mjs";

test("health check accepts only the simplified full-test option", () => {
  assert.deepEqual(parseHealthCheckArgs([]), { full: false });
  assert.deepEqual(parseHealthCheckArgs(["--full"]), { full: true });
  assert.match(parseHealthCheckArgs(["--legacy-tests"]).error, /Unknown option/);
});
