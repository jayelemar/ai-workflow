import assert from "node:assert/strict";
import test from "node:test";

import {
  codexOutputContainsStop,
  createCodexLiveOutputFormatter,
  formatCodexJsonlEventForTerminal,
} from "./codex-events.ts";
import { formatWorkflowProgressLine } from "./formatters.ts";
import { EXECUTE_PLAN_PROMPT_PATH } from "../../contracts/stage.ts";

const codexAgentMessageLine = (text: string): string =>
  JSON.stringify({
    type: "item.completed",
    item: { type: "agent_message", text },
  });

const codexCommandLine = ({
  command,
  output = "",
  exitCode = 0,
}: {
  command: string;
  output?: string;
  exitCode?: number;
}): string =>
  JSON.stringify({
    type: "item.completed",
    item: {
      type: "command_execution",
      command,
      status: "completed",
      exit_code: exitCode,
      aggregated_output: output,
    },
  });

const codexCommandStartedLine = (command: string): string =>
  JSON.stringify({
    type: "item.started",
    item: {
      type: "command_execution",
      command,
      status: "in_progress",
    },
  });

test("formatCodexJsonlEventForTerminal renders key codex JSONL events", () => {
  assert.equal(
    formatCodexJsonlEventForTerminal(
      JSON.stringify({ type: "thread.started", thread_id: "thread_123" }),
    ),
    "[codex] thread started thread_123\n\n",
  );
  assert.equal(
    formatCodexJsonlEventForTerminal(codexAgentMessageLine("Done")),
    "[agent]\nDone\n\n",
  );
  assert.equal(
    formatCodexJsonlEventForTerminal(
      JSON.stringify({
        type: "item.completed",
        payload: {
          type: "token_count",
          info: {
            last_token_usage: { total_tokens: 50 },
            model_context_window: 100,
          },
        },
      }),
    ),
    "[context] 50/100 tokens (50.00%)\n\n",
  );
});

test("codexOutputContainsStop ignores command output STOP but honors agent directives", () => {
  assert.equal(
    codexOutputContainsStop(
      codexCommandLine({
        command: "pnpm test",
        output: "STOP: command output should not count",
        exitCode: 1,
      }),
      "",
    ),
    false,
  );
  assert.equal(
    codexOutputContainsStop(codexAgentMessageLine("STOP: plan is blocked"), ""),
    true,
  );
});

test("createCodexLiveOutputFormatter flushes readable terminal output", () => {
  let stdout = "";
  let stderr = "";
  const formatter = createCodexLiveOutputFormatter({
    stdout: (chunk) => {
      stdout += chunk;
    },
    stderr: (chunk) => {
      stderr += chunk;
    },
  });

  formatter.stdout(`${codexCommandStartedLine("git status --short")}\n`);
  formatter.stderr("warning\n");

  assert.match(stdout, /Ran git status --short/);
  assert.equal(stderr, "warning\n");
});

test("formatWorkflowProgressLine reports stage, action, task, and iteration context", () => {
  assert.equal(
    formatWorkflowProgressLine({
      workflowState: "active",
      promptPath: EXECUTE_PLAN_PROMPT_PATH,
      model: "gpt-5.4",
      reasoning: "high",
      iteration: 2,
      maxIterations: 100,
    }),
    "\n\n[2/100] STAGE EXECUTE\nworkflowState: active\nmodel: gpt-5.4 | reasoning: high\n",
  );
});

test("formatWorkflowProgressLine supports a final-summary stage label", () => {
  assert.equal(
    formatWorkflowProgressLine({
      workflowState: "completed",
      promptPath: ".ai/prompts/commit-summary.md",
      stageLabel: "FINAL SUMMARY",
      model: "gpt-5.6-terra",
      reasoning: "medium",
      iteration: 8,
      maxIterations: 100,
    }),
    "\n\n[8/100] STAGE FINAL SUMMARY\nworkflowState: completed\nmodel: gpt-5.6-terra | reasoning: medium\n",
  );
});
