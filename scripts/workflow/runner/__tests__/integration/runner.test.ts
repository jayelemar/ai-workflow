import assert from "node:assert/strict";
import { readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";
import test from "node:test";

import { CODEX_SELECTED_MODEL_CAPACITY_MESSAGE } from "../../../config/codex.ts";
import { runWorkflowRunner } from "../../runtime.ts";
import { setupWorkflowWorkspace } from "../helpers/workspace.ts";
import {
  thinPlanManifest,
  writeWorkflowRunnerPlan,
} from "../helpers/runner-plan.ts";

const planArgument = ".ai/plans/artifact-state.md";
const syncPrompt = ".ai/prompts/sync-plan-artifacts.md";
const validatorPrompt = ".ai/prompts/plan-validator.md";

const setupRunner = async () => {
  const workspace = await setupWorkflowWorkspace({
    prefix: "workflow-runner-finalization-",
    directories: [".ai/plans", ".ai/prompts"],
    prompts: {
      "sync-plan-artifacts.md": "sync",
      "plan-validator.md": "validate",
    },
  });
  await writeWorkflowRunnerPlan(
    workspace.root,
    "artifact-state",
    thinPlanManifest("draft", "sync-plan-artifacts"),
  );
  return workspace;
};

const descriptorFromPrompt = (prompt: string) => {
  const version = /Reserved event version: (\d+)/.exec(prompt)?.[1];
  const eventPath = /Assigned event artifact: (\S+)/.exec(prompt)?.[1];
  assert.ok(version, "runner prompt must include a reserved event version");
  assert.ok(eventPath, "runner prompt must include an assigned event path");
  return { version: Number(version), eventPath };
};

const writeSyncEvent = async ({
  root,
  prompt,
}: {
  root: string;
  prompt: string;
}) => {
  const { version, eventPath } = descriptorFromPrompt(prompt);
  await writeFile(
    join(root, eventPath),
    `# Sync v${version}

## Outcome

ready

## Summary

Planning artifacts are ready for validation.

## Evidence

* Checked the linked spec and plan artifacts.
`,
    "utf8",
  );
};

test("runner accepts an event-only stage output and owns the resulting transition", async () => {
  const workspace = await setupRunner();
  try {
    const result = await runWorkflowRunner({
      rootDir: workspace.root,
      planName: planArgument,
      streamOutput: false,
      console: { log: () => {}, error: () => {} },
      processRunner: async (call) => {
        if (call.promptPath === syncPrompt) {
          await writeSyncEvent({ root: workspace.root, prompt: call.args.at(-1) ?? "" });
          return { launched: true, stdout: "sync complete", stderr: "", exitCode: 0 };
        }
        if (call.promptPath === validatorPrompt) {
          return { launched: true, stdout: "STOP", stderr: "", exitCode: 0 };
        }
        return { launched: true, stdout: "", stderr: "", exitCode: 0 };
      },
    });

    assert.equal(result.success, false);
    const manifest = await readFile(join(workspace.root, planArgument), "utf8");
    const workflow = JSON.parse(await readFile(
      join(workspace.root, ".ai/artifacts/artifact-state/state/workflow.json"),
      "utf8",
    ));
    assert.match(manifest, /## Workflow State\n\ndraft-validation/);
    assert.deepEqual(workflow.latest.sync, {
      version: 1,
      outcome: "ready",
      summary: "Planning artifacts are ready for validation.",
      evidence: ".ai/artifacts/artifact-state/events/sync-v1.md",
    });
    assert.deepEqual(workflow.history, [
      ".ai/artifacts/artifact-state/events/sync-v1.md",
    ]);
  } finally {
    await workspace.cleanup();
  }
});

test("runner rejects and restores a direct agent routing mutation", async () => {
  const workspace = await setupRunner();
  try {
    const original = await readFile(join(workspace.root, planArgument), "utf8");
    const result = await runWorkflowRunner({
      rootDir: workspace.root,
      planName: planArgument,
      streamOutput: false,
      console: { log: () => {}, error: () => {} },
      processRunner: async (call) => {
        if (call.promptPath === syncPrompt) {
          await writeSyncEvent({ root: workspace.root, prompt: call.args.at(-1) ?? "" });
          await writeFile(
            join(workspace.root, planArgument),
            original.replace("draft-artifact-sync", "draft-validation"),
            "utf8",
          );
        }
        return { launched: true, stdout: "sync complete", stderr: "", exitCode: 0 };
      },
    });

    assert.equal(result.success, false);
    assert.match(result.reason, /stage contract violation/i);
    assert.equal(await readFile(join(workspace.root, planArgument), "utf8"), original);
    const workflow = JSON.parse(await readFile(
      join(workspace.root, ".ai/artifacts/artifact-state/state/workflow.json"),
      "utf8",
    ));
    assert.equal(workflow.workflowState, "draft-artifact-sync");
    assert.deepEqual(workflow.latest, {});
  } finally {
    await workspace.cleanup();
  }
});

test("capacity retry reserves a fresh event descriptor before the next stage call", async () => {
  const workspace = await setupRunner();
  try {
    const prompts: string[] = [];
    let syncCalls = 0;
    await runWorkflowRunner({
      rootDir: workspace.root,
      planName: planArgument,
      streamOutput: false,
      console: { log: () => {}, error: () => {} },
      processRunner: async (call) => {
        if (call.promptPath === syncPrompt) {
          syncCalls += 1;
          prompts.push(call.args.at(-1) ?? "");
          if (syncCalls === 1) {
            await writeSyncEvent({ root: workspace.root, prompt: call.args.at(-1) ?? "" });
            return {
              launched: true,
              stdout: "",
              stderr: CODEX_SELECTED_MODEL_CAPACITY_MESSAGE,
              exitCode: 1,
            };
          }
          await writeSyncEvent({ root: workspace.root, prompt: call.args.at(-1) ?? "" });
          return { launched: true, stdout: "sync complete", stderr: "", exitCode: 0 };
        }
        if (call.promptPath === validatorPrompt) {
          return { launched: true, stdout: "STOP", stderr: "", exitCode: 0 };
        }
        return { launched: true, stdout: "", stderr: "", exitCode: 0 };
      },
    });

    assert.equal(syncCalls, 2);
    assert.match(prompts[0]!, /Reserved event version: 1/);
    assert.match(prompts[1]!, /Reserved event version: 2/);
    assert.match(prompts[1]!, /\.ai\/artifacts\/artifact-state\/state\/context\.md/);
    const workflow = JSON.parse(await readFile(
      join(workspace.root, ".ai/artifacts/artifact-state/state/workflow.json"),
      "utf8",
    ));
    assert.equal(workflow.latest.sync.version, 2);
  } finally {
    await workspace.cleanup();
  }
});
