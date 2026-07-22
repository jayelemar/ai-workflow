import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

import { generateWorkflowContextSnapshot } from "./context-snapshot.ts";
import {
  generateWorkflowPrompt,
  shellPathspecs,
} from "./prompt.ts";

const stagePrompts = [
  "sync-plan-artifacts.md",
  "plan-validator.md",
  "execute-plan.md",
  "unblock-plan.md",
  "review-changes.md",
  "reopen-plan.md",
] as const;

test("runner stage prompts make event-only workflow writes mandatory", async () => {
  const prompts = await Promise.all(
    stagePrompts.map(async (name) => [
      name,
      await readFile(`.ai/prompts/${name}`, "utf8"),
    ] as const),
  );

  for (const [name, prompt] of prompts) {
    assert.match(prompt, /runner[- ]issued descriptor/i, name);
    assert.match(prompt, /(assigned event artifact|event artifact assigned)/i, name);
    assert.match(prompt, /Do not edit the plan manifest/i, name);
    assert.match(prompt, /runner.*(state|routing|blocker)/i, name);
    assert.doesNotMatch(prompt, /## Review History/i, name);
    assert.doesNotMatch(prompt, /## Reopen History/i, name);
  }
});

test("generated stage prompt injects the exact runner descriptor", () => {
  const prompt = generateWorkflowPrompt({
    promptPath: ".ai/prompts/execute-plan.md",
    planPath: ".ai/plans/example.md",
    planContent: "# Plan\n\n## Spec\n\n.ai/specs/example.spec.md\n",
    promptContent: "unused",
    stageDescriptor: `Runner-issued stage descriptor (authoritative):
- Stage: execution
- Source workflow state: active
- Reserved event version: 4
- Assigned event artifact: .ai/artifacts/example/events/execution-v4.md`,
  });

  assert.match(prompt, /Stage: execution/);
  assert.match(prompt, /Source workflow state: active/);
  assert.match(prompt, /execution-v4\.md/);
  assert.match(prompt, /Active Context Packet:/);
});

test("generated snapshot uses labeled context instead of manifest history", () => {
  const snapshot = generateWorkflowContextSnapshot({
    planName: "example",
    planPath: ".ai/plans/example.md",
    planContent: "# Plan\n\n## Workflow State\n\nactive\n",
    workflowState: {
      documentFormat: "workflow-state@1",
      planPath: ".ai/plans/example.md",
      workflowState: "active",
      latest: {
        review: {
          version: 2,
          outcome: "active",
          summary: "Fix required.",
          evidence: ".ai/artifacts/example/events/review-v2.md",
          unresolvedFindings: ["Repair the invalid workflow event."],
        },
      },
      history: [".ai/artifacts/example/events/review-v2.md"],
      unresolvedBlockers: ["Repair the invalid workflow event."],
      updatedAt: "2026-07-22T00:00:00.000Z",
    },
  });

  assert.match(snapshot, /## Generated Latest Review Context/);
  assert.match(snapshot, /## Generated Latest Event Context/);
  assert.match(snapshot, /## Generated Unresolved Findings/);
  assert.match(snapshot, /Repair the invalid workflow event\./);
  assert.doesNotMatch(snapshot, /## Review History/);
  assert.doesNotMatch(snapshot, /## Reopen History/);
});

test("generated snapshot never recovers a summary from forbidden inline history", () => {
  const snapshot = generateWorkflowContextSnapshot({
    planName: "artifact-state",
    planPath: ".ai/plans/artifact-state.md",
    planContent: `# Plan: Artifact state

## Workflow State

active

## Execution Log

* This forbidden section must not become generated context.
`,
  });

  assert.match(snapshot, /## Summary\n\(none\)/);
  assert.doesNotMatch(snapshot, /This forbidden section/);
});

test("workflow pathspec quoting remains scoped and shell-safe", () => {
  assert.equal(
    shellPathspecs(["src/a file.ts", "src/normal.ts"]),
    "'src/a file.ts' src/normal.ts",
  );
});
