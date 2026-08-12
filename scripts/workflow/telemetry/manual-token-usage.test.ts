import assert from "node:assert/strict";
import { mkdtemp, mkdir, readFile, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";

import {
  appendManualTokenUsageCheckpoint,
  detectLatestSessionSnapshot,
  parseSessionTokenSnapshot,
  runManualTokenUsageCli,
} from "./manual-token-usage.ts";

type Workspace = {
  root: string;
  cleanup: () => Promise<void>;
};

const createWorkspace = async (): Promise<Workspace> => {
  const root = await mkdtemp(path.join(os.tmpdir(), "manual-token-usage-"));
  return {
    root,
    cleanup: () => rm(root, { recursive: true, force: true }),
  };
};

const sessionContent = ({
  sessionId,
  cwd,
  model = "gpt-5-codex",
  inputTokens,
  cachedInputTokens,
  outputTokens,
  reasoningOutputTokens,
  totalTokens,
  lastTotalTokens,
}: {
  sessionId: string;
  cwd: string;
  model?: string;
  inputTokens: number;
  cachedInputTokens: number;
  outputTokens: number;
  reasoningOutputTokens: number;
  totalTokens: number;
  lastTotalTokens: number;
}) =>
  [
    JSON.stringify({
      timestamp: "2026-07-09T00:00:00.000Z",
      type: "session_meta",
      payload: {
        id: sessionId,
        session_id: sessionId,
        timestamp: "2026-07-09T00:00:00.000Z",
        cwd,
      },
    }),
    JSON.stringify({
      timestamp: "2026-07-09T00:00:01.000Z",
      type: "turn_context",
      payload: {
        cwd,
        model,
      },
    }),
    JSON.stringify({
      timestamp: "2026-07-09T00:00:02.000Z",
      type: "event_msg",
      payload: {
        type: "token_count",
        info: {
          total_token_usage: {
            input_tokens: inputTokens,
            cached_input_tokens: cachedInputTokens,
            output_tokens: outputTokens,
            reasoning_output_tokens: reasoningOutputTokens,
            total_tokens: totalTokens,
          },
          last_token_usage: {
            input_tokens: 200,
            cached_input_tokens: 100,
            output_tokens: 25,
            reasoning_output_tokens: 5,
            total_tokens: lastTotalTokens,
          },
          model_context_window: 200000,
        },
      },
    }),
  ].join("\n");

test("parseSessionTokenSnapshot reads session totals and context usage", () => {
  const snapshot = parseSessionTokenSnapshot(
    sessionContent({
      sessionId: "session-1",
      cwd: "/repo",
      inputTokens: 1200,
      cachedInputTokens: 900,
      outputTokens: 180,
      reasoningOutputTokens: 20,
      totalTokens: 1380,
      lastTotalTokens: 230,
    }),
    "sessions/2026/07/09/session-1.jsonl",
    "/repo",
  );

  assert.deepEqual(snapshot, {
    sessionId: "session-1",
    sessionFilePath: "sessions/2026/07/09/session-1.jsonl",
    timestamp: "2026-07-09T00:00:02.000Z",
    model: "gpt-5-codex",
    totals: {
      inputTokens: 1200,
      cachedInputTokens: 900,
      uncachedInputTokens: 300,
      outputTokens: 180,
      reasoningOutputTokens: 20,
      totalTokens: 1380,
    },
    contextUsage: {
      contextWindowTokens: 200000,
      contextWindowUsedTokens: 230,
      contextWindowUsedPercent: "0.11",
    },
  });
});

test("detectLatestSessionSnapshot prefers the newest matching cwd", async () => {
  const workspace = await createWorkspace();
  try {
    const codexHome = path.join(workspace.root, ".codex");
    const sessionsDir = path.join(codexHome, "sessions", "2026", "07", "09");
    await mkdir(sessionsDir, { recursive: true });
    await writeFile(
      path.join(sessionsDir, "rollout-2026-07-09T00-00-00-old.jsonl"),
      sessionContent({
        sessionId: "old",
        cwd: "/repo",
        inputTokens: 100,
        cachedInputTokens: 80,
        outputTokens: 10,
        reasoningOutputTokens: 0,
        totalTokens: 110,
        lastTotalTokens: 50,
      }),
      "utf8",
    );
    await writeFile(
      path.join(sessionsDir, "rollout-2026-07-09T01-00-00-new.jsonl"),
      sessionContent({
        sessionId: "new",
        cwd: "/repo",
        inputTokens: 500,
        cachedInputTokens: 400,
        outputTokens: 60,
        reasoningOutputTokens: 5,
        totalTokens: 560,
        lastTotalTokens: 90,
      }),
      "utf8",
    );

    const snapshot = await detectLatestSessionSnapshot({
      codexHome,
      cwd: "/repo",
    });

    assert.equal(snapshot?.sessionId, "new");
    assert.equal(
      snapshot?.sessionFilePath,
      "sessions/2026/07/09/rollout-2026-07-09T01-00-00-new.jsonl",
    );
  } finally {
    await workspace.cleanup();
  }
});

test("appendManualTokenUsageCheckpoint appends stage deltas and skips duplicates", async () => {
  const workspace = await createWorkspace();
  try {
    const rootDir = path.join(workspace.root, "repo");
    const codexHome = path.join(workspace.root, ".codex");
    const sessionDir = path.join(codexHome, "sessions", "2026", "07", "09");
    await mkdir(rootDir, { recursive: true });
    await mkdir(sessionDir, { recursive: true });

    const sessionPath = path.join(
      sessionDir,
      "rollout-2026-07-09T02-00-00-session-1.jsonl",
    );

    await writeFile(
      sessionPath,
      sessionContent({
        sessionId: "session-1",
        cwd: rootDir,
        inputTokens: 1000,
        cachedInputTokens: 700,
        outputTokens: 120,
        reasoningOutputTokens: 20,
        totalTokens: 1120,
        lastTotalTokens: 250,
      }),
      "utf8",
    );

    const first = await appendManualTokenUsageCheckpoint({
      rootDir,
      planName: "manual-mode",
      stage: "spec",
      codexHome,
    });
    assert.equal(first.ok, true);
    assert.equal(first.status, "appended");
    if (first.ok && first.status === "appended") {
      assert.equal(first.entry.stageTotalTokens, 1120);
      assert.equal(first.entry.totalTokens, 1120);
    }

    await writeFile(
      sessionPath,
      sessionContent({
        sessionId: "session-1",
        cwd: rootDir,
        inputTokens: 1600,
        cachedInputTokens: 1100,
        outputTokens: 180,
        reasoningOutputTokens: 30,
        totalTokens: 1780,
        lastTotalTokens: 300,
      }),
      "utf8",
    );

    const second = await appendManualTokenUsageCheckpoint({
      rootDir,
      planName: "manual-mode",
      stage: "plan",
      codexHome,
    });
    assert.equal(second.ok, true);
    assert.equal(second.status, "appended");
    if (second.ok && second.status === "appended") {
      assert.equal(second.entry.stageInputTokens, 600);
      assert.equal(second.entry.stageCachedInputTokens, 400);
      assert.equal(second.entry.stageUncachedInputTokens, 200);
      assert.equal(second.entry.stageOutputTokens, 60);
      assert.equal(second.entry.stageReasoningOutputTokens, 10);
      assert.equal(second.entry.stageTotalTokens, 660);
      assert.equal(second.entry.totalTokens, 1780);
    }

    const duplicate = await appendManualTokenUsageCheckpoint({
      rootDir,
      planName: "manual-mode",
      stage: "plan",
      codexHome,
    });
    assert.equal(duplicate.ok, true);
    assert.equal(duplicate.status, "skipped");

    const ledgerPath = path.join(
      rootDir,
      ".ai",
      "artifacts",
      "manual-mode",
      "logs",
      "token-usage.jsonl",
    );
    const ledgerLines = (await readFile(ledgerPath, "utf8"))
      .trim()
      .split(/\r?\n/)
      .filter(Boolean);
    assert.equal(ledgerLines.length, 2);
  } finally {
    await workspace.cleanup();
  }
});

test("runManualTokenUsageCli prefers CODEX_HOME when --codex-home is omitted", async () => {
  const workspace = await createWorkspace();
  const originalCodexHome = process.env.CODEX_HOME;

  try {
    const rootDir = path.join(workspace.root, "repo");
    const codexHome = path.join(workspace.root, ".codex-adam");
    const sessionDir = path.join(codexHome, "sessions", "2026", "07", "09");
    await mkdir(rootDir, { recursive: true });
    await mkdir(sessionDir, { recursive: true });

    await writeFile(
      path.join(sessionDir, "rollout-2026-07-09T03-00-00-session-2.jsonl"),
      sessionContent({
        sessionId: "session-2",
        cwd: rootDir,
        inputTokens: 900,
        cachedInputTokens: 600,
        outputTokens: 100,
        reasoningOutputTokens: 10,
        totalTokens: 1000,
        lastTotalTokens: 180,
      }),
      "utf8",
    );

    process.env.CODEX_HOME = codexHome;

    let stdout = "";
    let stderr = "";
    const exitCode = await runManualTokenUsageCli(
      ["--plan", "manual-mode-env", "--stage", "spec", "--root-dir", rootDir],
      { write: (chunk: string) => void (stdout += chunk) },
      { write: (chunk: string) => void (stderr += chunk) },
    );

    assert.equal(exitCode, 0);
    assert.equal(stderr, "");
    assert.match(stdout, /Appended manual spec token checkpoint/);

    const ledgerPath = path.join(
      rootDir,
      ".ai",
      "artifacts",
      "manual-mode-env",
      "logs",
      "token-usage.jsonl",
    );
    const [line] = (await readFile(ledgerPath, "utf8"))
      .trim()
      .split(/\r?\n/)
      .filter(Boolean);
    const record = JSON.parse(line) as {
      sessionId: string;
      sessionFilePath: string;
    };
    assert.equal(record.sessionId, "session-2");
    assert.equal(
      record.sessionFilePath,
      "sessions/2026/07/09/rollout-2026-07-09T03-00-00-session-2.jsonl",
    );
  } finally {
    if (originalCodexHome === undefined) {
      delete process.env.CODEX_HOME;
    } else {
      process.env.CODEX_HOME = originalCodexHome;
    }
    await workspace.cleanup();
  }
});
