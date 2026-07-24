import assert from "node:assert/strict";
import { once } from "node:events";
import { mkdtemp, rm, symlink } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Writable } from "node:stream";
import test from "node:test";

import { COMMIT_SUMMARY_PROMPT_PATH } from "../contracts/stage.ts";
import {
  CODEX_BINARY_COMMAND,
  CODEX_TURN_COMPLETION_GRACE_MS,
  codexExecArgs,
  codexWorkEnvironment,
  defaultProcessRunner,
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

test("process stdin helper attaches an error handler before writing input", async () => {
  const writable = new Writable({
    write(_chunk, _encoding, callback) {
      callback(new Error("write EPIPE"));
    },
  });
  const error = once(writable, "error");

  writeProcessInput(writable, "prompt");

  assert.equal(writable.listenerCount("error") >= 2, true);
  const [caught] = await error;
  assert.match(String(caught), /write EPIPE/);
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

test("Codex stages finish after emitting turn.completed but lingering", async () => {
  const binDir = await mkdtemp(join(tmpdir(), "workflow-codex-"));
  try {
    await symlink(process.execPath, join(binDir, CODEX_BINARY_COMMAND));
    const startedAt = Date.now();
    const result = await defaultProcessRunner({
      command: "codex-work",
      binaryCommand: CODEX_BINARY_COMMAND,
      args: [
        "-e",
        `process.stdout.write(JSON.stringify({ type: "turn.completed" }) + "\\n"); setInterval(() => {}, 1_000);`,
      ],
      cwd: process.cwd(),
      input: "",
      promptPath: ".ai/prompts/scope-cleanup.md",
      env: { ...process.env, PATH: `${binDir}:${process.env.PATH ?? ""}` },
    });

    assert.equal(result.launched, true);
    if (!result.launched) {
      return;
    }
    assert.equal(result.exitCode, 0);
    assert.match(result.stdout, /"type":"turn.completed"/);
    assert.ok(Date.now() - startedAt < CODEX_TURN_COMPLETION_GRACE_MS + 3_000);
  } finally {
    await rm(binDir, { force: true, recursive: true });
  }
});
