import assert from "node:assert/strict";
import { Writable } from "node:stream";
import test from "node:test";

import { COMMIT_SUMMARY_PROMPT_PATH } from "../contracts/stage.ts";
import {
  codexExecArgs,
  codexWorkEnvironment,
  processStdioForInput,
  writeProcessInput,
} from "./process.ts";
import type { CodexExecutionConfig } from "../config/codex.ts";

const executionConfig: CodexExecutionConfig = {
  model: "gpt-5.4",
  reasoning: "high",
};

test("process stdio uses stdin only when prompt input is present", () => {
  assert.deepEqual(processStdioForInput(""), ["ignore", "pipe", "pipe"]);
  assert.deepEqual(processStdioForInput("prompt"), ["pipe", "pipe", "pipe"]);
});

test("writeProcessInput ends stdin with the prompt and reports stdin errors", async () => {
  let written = "";
  let reportedError = "";
  const writable = new Writable({
    write(chunk, _encoding, callback) {
      written += chunk.toString();
      callback(new Error("write EPIPE"));
    },
  });

  writeProcessInput(writable, "prompt", (error) => {
    reportedError = error.message;
  });

  await new Promise<void>((resolve) => writable.on("close", resolve));

  assert.equal(written, "prompt");
  assert.equal(reportedError, "write EPIPE");
});

test("codexWorkEnvironment sets profile HOME and prepends the pinned node bin once", () => {
  assert.deepEqual(
    codexWorkEnvironment({ HOME: "/home/tester", PATH: "/usr/bin" }, "codex-work"),
    {
      HOME: "/home/tester",
      PATH: "/home/tester/.nvm/versions/node/v20.20.2/bin:/usr/bin",
      CODEX_HOME: "/home/tester/.codex-work",
    },
  );

  assert.equal(
    codexWorkEnvironment({
      HOME: "/home/tester",
      PATH: "/home/tester/.nvm/versions/node/v20.20.2/bin:/usr/bin",
    }).PATH,
    "/home/tester/.nvm/versions/node/v20.20.2/bin:/usr/bin",
  );
});

test("codexExecArgs adds git directory access only for commit summary prompts", () => {
  assert.deepEqual(
    codexExecArgs({
      executionConfig,
      promptPath: ".ai/prompts/execute-plan.md",
      prompt: "Execute",
      rootDir: "/repo",
    }),
    [
      "exec",
      "--json",
      "--model",
      "gpt-5.4",
      "-c",
      'model_reasoning_effort="high"',
      "Execute",
    ],
  );

  assert.deepEqual(
    codexExecArgs({
      executionConfig,
      promptPath: COMMIT_SUMMARY_PROMPT_PATH,
      prompt: "Commit",
      rootDir: "/repo",
    }),
    [
      "exec",
      "--json",
      "--model",
      "gpt-5.4",
      "-c",
      'model_reasoning_effort="high"',
      "--add-dir",
      "/repo/.git",
      "Commit",
    ],
  );
});
