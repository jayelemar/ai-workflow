import assert from "node:assert/strict";
import { readFile, readdir, rm, writeFile } from "node:fs/promises";
import {
  existsSync,
  mkdirSync,
  readFileSync,
  writeFileSync as nativeWriteFileSync,
} from "node:fs";
import { dirname, join } from "node:path";

import { runWorkflowRunner } from "../../runtime.ts";
import { workflowContextSnapshotRelativePath } from "../../plan/context-snapshot.ts";
import type { ProcessRunner } from "../../types.ts";
import { codexExecutionConfig, WORKFLOW_RUNNER_CODEX_FALLBACK_MODEL, WORKFLOW_RUNNER_CODEX_PROFILE } from "../../../config/codex.ts";
import { analyzeTokenUsageLedger } from "../../../telemetry/token-ledger.ts";
import {
  createThinPlanArtifactWriter,
  setupWorkflowWorkspace,
} from "./workspace.ts";
import {
  planWith,
  planWithEllipsizedTaskSavepoints,
  planWithFileScope,
  planWithTaskSavepoints,
  thinPlanManifest,
  writeWorkflowRunnerPlan,
} from "./runner-plan.ts";
import {
  writeWorkflowEventArtifact,
  writeWorkflowEventArtifactSync,
} from "./workflow-events.ts";

export {
  analyzeTokenUsageLedger,
  assert,
  codexExecutionConfig,
  createThinPlanArtifactWriter,
  dirname,
  existsSync,
  join,
  mkdirSync,
  readFile,
  readdir,
  rm,
  runWorkflowRunner,
  setupWorkflowWorkspace,
  thinPlanManifest,
  workflowContextSnapshotRelativePath,
  writeFile,
  writeWorkflowEventArtifact,
  writeWorkflowEventArtifactSync,
};
export type { ProcessRunner };
export {
  planWith,
  planWithEllipsizedTaskSavepoints,
  planWithFileScope,
  planWithTaskSavepoints,
  writeWorkflowRunnerPlan,
};

/**
 * Test agents commonly rewrite only the manifest. Keep the mutable workflow
 * sidecar in lock-step so integration fixtures model the canonical contract.
 */
export const writeFileSync: typeof nativeWriteFileSync = ((file, data, options) => {
  const planMatch = typeof file === "string"
    ? file.match(/^(.*)\/\.ai\/plans\/([^/]+)\.md$/)
    : undefined;
  const normalizedData = planMatch && typeof data === "string"
    ? data.replaceAll("artifact-state", planMatch[2])
    : data;
  nativeWriteFileSync(file, normalizedData, options);
  if (typeof file !== "string" || typeof normalizedData !== "string") return;
  const match = planMatch;
  const workflowState = normalizedData.match(/## Workflow State\s*\n\s*([^\s]+)/)?.[1];
  if (!match || !workflowState) return;
  const workflowPath = join(
    match[1],
    ".ai",
    "artifacts",
    match[2],
    "state",
    "workflow.json",
  );
  if (!existsSync(workflowPath)) return;
  try {
    const workflow = JSON.parse(readFileSync(workflowPath, "utf8")) as Record<string, unknown>;
    nativeWriteFileSync(
      workflowPath,
      `${JSON.stringify({
        ...workflow,
        documentFormat: "workflow-state@1",
        workflowState: workflowState.replace(/^`|`$/g, ""),
      }, null, 2)}\n`,
      "utf8",
    );
  } catch {
    // Tests that deliberately write malformed state keep control of it.
  }
}) as typeof nativeWriteFileSync;
export {
  WORKFLOW_RUNNER_CODEX_FALLBACK_MODEL,
  WORKFLOW_RUNNER_CODEX_PROFILE,
};

export const PROMPTS = {
  "sync-plan-artifacts.md": "SYNC PLAN ARTIFACTS PROMPT",
  "plan-validator.md": "PLAN VALIDATOR PROMPT",
  "execute-plan.md": "EXECUTE PLAN PROMPT",
  "unblock-plan.md": "UNBLOCK PLAN PROMPT",
  "review-changes.md": "REVIEW CHANGES PROMPT",
  "scope-cleanup.md": "SCOPE CLEANUP PROMPT",
  "reopen-plan.md": "REOPEN PLAN PROMPT",
  "commit-summary.md": "COMMIT SUMMARY PROMPT",
};

export const CODEX_COMMAND = WORKFLOW_RUNNER_CODEX_PROFILE;
export const CODEX_EXEC_LABEL = `${CODEX_COMMAND} exec`;
export const CODEX_HOME_SUFFIX = `/.${CODEX_COMMAND}`;
export const OVERRIDE_CODEX_PROFILE = "codex-personal";
export const OVERRIDE_CODEX_EXEC_LABEL = `${OVERRIDE_CODEX_PROFILE} exec`;
export const OVERRIDE_CODEX_HOME_SUFFIX = `/.${OVERRIDE_CODEX_PROFILE}`;

export const writeThinPlanArtifacts = createThinPlanArtifactWriter("runner");


export const ownershipReleaseSection = (
  file: string,
  releasedTo = ".ai/plans/dependent-plan.md",
) => `## File Ownership Releases

### Release v1

* File: ${file}
* Released By: .ai/plans/current-plan.md
* Released To: ${releasedTo}
* Evidence: current-plan file-specific validation passed
* Status: transferred
`;

export const ownershipScopeSection = (entries: string[]) => `## Ownership Scope

${entries.map((entry) => `* ${entry}`).join("\n")}
`;

export const setupWorkspace = () =>
  setupWorkflowWorkspace({
    prefix: "workflow-runner-",
    directories: [".ai/plans", ".ai/prompts"],
    prompts: PROMPTS,
  });

export const writePlan = writeWorkflowRunnerPlan;

export const tokenCountLine = (usedTokens: number, contextWindowTokens: number) =>
  JSON.stringify({
    type: "event_msg",
    payload: {
      type: "token_count",
      info: {
        last_token_usage: {
          total_tokens: usedTokens,
        },
        model_context_window: contextWindowTokens,
      },
    },
  });

export const turnCompletedUsageDetailLine = ({
  inputTokens,
  cachedInputTokens,
  outputTokens,
  reasoningOutputTokens,
}: {
  inputTokens: number;
  cachedInputTokens: number;
  outputTokens: number;
  reasoningOutputTokens: number;
}) =>
  JSON.stringify({
    type: "turn.completed",
    usage: {
      input_tokens: inputTokens,
      cached_input_tokens: cachedInputTokens,
      output_tokens: outputTokens,
      reasoning_output_tokens: reasoningOutputTokens,
    },
  });

export const callTriples = (calls: Parameters<ProcessRunner>[0][]) =>
  calls.map((call) => [call.command, call.args[0] ?? "", call.promptPath]);

export const assertCallSubsequence = (
  calls: Parameters<ProcessRunner>[0][],
  expected: string[][],
) => {
  const actual = callTriples(calls);
  let cursor = 0;
  for (const item of actual) {
    if (
      cursor < expected.length &&
      item.length === expected[cursor].length &&
      item.every((value, index) => value === expected[cursor][index])
    ) {
      cursor += 1;
    }
  }
  assert.equal(
    cursor,
    expected.length,
    `missing call subsequence ${JSON.stringify(expected)} in ${JSON.stringify(actual)}`,
  );
};

export const writeFileOwnershipArtifact = async (
  root: string,
  planName: string,
  artifact: Record<string, unknown>,
) => {
  const artifactPath = join(
    root,
    ".ai",
    "artifacts",
    planName,
    "state",
    "file-ownership.json",
  );
  mkdirSync(dirname(artifactPath), { recursive: true });
  await writeFile(artifactPath, JSON.stringify(artifact, null, 2), "utf8");
  if (typeof artifact.workflowState === "string") {
    await writeFile(
      join(dirname(artifactPath), "workflow.json"),
      `${JSON.stringify(
        {
          planPath: artifact.planPath,
          workflowState: artifact.workflowState,
          latest: {},
          history: [],
          unresolvedBlockers: [],
          updatedAt: artifact.updatedAt,
        },
        null,
        2,
      )}\n`,
      "utf8",
    );
  }
  return artifactPath;
};

export const writeArtifactStateFile = async (
  root: string,
  planName: string,
  fileName: string,
  content: string,
) => {
  const artifactPath = join(
    root,
    ".ai",
    "artifacts",
    planName,
    "state",
    fileName,
  );
  mkdirSync(dirname(artifactPath), { recursive: true });
  await writeFile(artifactPath, content, "utf8");
  return artifactPath;
};

export const planArg = (planName: string) => `.ai/plans/${planName}.md`;

export const readTokenUsageLedger = async (root: string, planName: string) => {
  const content = await readFile(
    join(root, ".ai", "artifacts", planName, "logs", "token-usage.jsonl"),
    "utf8",
  );
  return content
    .trim()
    .split("\n")
    .filter(Boolean)
    .map((line) => JSON.parse(line) as Record<string, unknown>);
};

export const readFailureDebugLedger = async (root: string, planName: string) => {
  const content = await readFile(
    join(root, ".ai", "artifacts", planName, "logs", "failure.jsonl"),
    "utf8",
  );
  return content
    .trim()
    .split("\n")
    .filter(Boolean)
    .map((line) => JSON.parse(line) as Record<string, unknown>);
};

export const assertFailureMetadata = (
  log: string,
  expected: {
    kind: string;
    reason: RegExp;
    nextSuggestedAction: RegExp;
  },
) => {
  assert.match(log, new RegExp(`failureKind: ${expected.kind}`));
  assert.match(log, expected.reason);
  assert.match(log, expected.nextSuggestedAction);
};

export const collectConsole = () => {
  const lines: string[] = [];
  return {
    lines,
    console: {
      log: (message: string) => lines.push(message),
      error: (message: string) => lines.push(message),
    },
  };
};

export const runnerReturning =
  (
    result: Awaited<ReturnType<ProcessRunner>>,
    onRun?: (call: Parameters<ProcessRunner>[0]) => Promise<void> | void,
  ): ProcessRunner =>
  async (call) => {
    await onRun?.(call);
    if (
      call.command === "git" &&
      call.args[0] === "status" &&
      call.args[1] === "--short"
    ) {
      return { launched: true, stdout: "", stderr: "", exitCode: 0 };
    }
    return result;
  };

export const codexAgentMessageLine = (text: string) =>
  JSON.stringify({
    type: "item.completed",
    item: {
      id: "item_agent",
      type: "agent_message",
      text,
    },
  });

export const commitSummaryOutput = ({
  planPath,
  subject,
  summaryLines,
}: {
  planPath: string;
  subject: string;
  summaryLines: string[];
}) =>
  [
    "**Plan**",
    `\`${planPath}\``,
    "",
    "**Summary**",
    "* COMMIT CREATED",
    "* All staged plan-owned files were committed.",
    "",
    "**Key Details**",
    subject,
    ...summaryLines.map((line) => `-- ${line}`),
    "",
    "**Next**",
    "Status: `completed`",
  ].join("\n");

export const codexCommandOutputLine = (text: string, command = "pnpm test") =>
  JSON.stringify({
    type: "item.completed",
    item: {
      id: "item_command",
      command,
      type: "command_execution",
      aggregated_output: text,
      exit_code: 0,
      status: "completed",
    },
  });

export const codexCommandStartedLine = (command = "pnpm test") =>
  JSON.stringify({
    type: "item.started",
    item: {
      id: "item_command",
      command,
      type: "command_execution",
      aggregated_output: "",
      exit_code: null,
      status: "in_progress",
    },
  });
export const JEST_FAILED_COMMAND =
  "/bin/bash -lc 'pnpm --dir apps/backend exec jest --config jest.config.js --runTestsByPath test/onboarding/document-content-generator.service.spec.ts --runInBand -t \"widens unmapped suffixless\"'";
