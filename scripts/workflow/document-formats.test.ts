import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { promisify } from "node:util";
import test from "node:test";

import {
  DOCUMENT_FORMATS,
  validateDocumentFormat,
  validatePlanDocumentBundle,
} from "./document-formats.ts";
import { validateThinPlanContract } from "./runner/thin-plan.ts";
import { runWorkflowRunner } from "./runner/runtime.ts";

const execFileAsync = promisify(execFile);

const markdown = (title: string, format: string, sections: string[]): string =>
  `# ${title}\n\n## Document Format\n\n${format}\n\n${sections.map((section) => `${section}\n\ncontent`).join("\n\n")}\n`;

test("validates every current document format", () => {
  const documents: Array<[keyof typeof DOCUMENT_FORMATS, string | object]> = [
    ["featureSpec", markdown("Feature", "feature-spec@1", ["## Version", "## Goal", "## Inputs / Outputs", "## Behavior", "## Edge Cases", "## Constraints", "## Acceptance Criteria"])],
    ["planManifest", markdown("Plan", "plan-manifest@1", ["## Workflow Content Rules", "## Execution Mode", "## Spec", "## Artifacts", "## Phases"])],
    ["userJourney", markdown("Journey", "user-journey@1", ["## Goal", "## Actors", "## Entry Points", "## User Flows", "## Mermaid Diagram", "## States", "## Failures", "## Acceptance Scenarios", "## Open Decisions"])],
    ["implementationMap", markdown("Map", "implementation-map@1", ["## Source Versions", "### User Action: Test"])],
    ["manualHandoff", markdown("Handoff", "manual-handoff@1", ["## Plan", "## Repository State", "## Verified Progress", "## Decisions", "## Blockers", "## Next Action"])],
    ["goalHandoff", markdown("Goal Handoff", "goal-handoff@1", ["## Exact Goal", "## Spec", "## Plan", "## Repository State", "## Verified Progress", "## Decisions", "## Blockers", "## Next Action"])],
    ["workflowState", { documentFormat: "workflow-state@1", planPath: ".ai/plans/example.md", workflowState: "approved", latest: {}, history: [], unresolvedBlockers: [], updatedAt: "2026-01-01T00:00:00.000Z" }],
    ["fileOwnership", { documentFormat: "file-ownership@1", planPath: ".ai/plans/example.md", owns: [], released: [], resolvedFiles: [], changedFiles: [], headSha: "abc", updatedAt: "2026-01-01T00:00:00.000Z" }],
    ["filesState", { documentFormat: "files-state@1", created: [], modified: [], deleted: [], changedFiles: [], released: [], headSha: "abc" }],
  ];
  for (const [kind, content] of documents) assert.deepEqual(validateDocumentFormat(kind, content, `example-${kind}`), { ok: true });
});

test("HIGH-GOAL manual bundles require one goal handoff and no manual handoff", async () => {
  const root = await mkdtemp(join(tmpdir(), "goal-handoff-bundle-"));
  const planPath = ".ai/plans/example.md";
  const plan = `# Plan: example

## Document Format

plan-manifest@1

## Workflow Content Rules

manual

## Execution Mode

manual

## Spec

.ai/specs/example.spec.md

## Artifacts

* User journey: N/A: no end-to-end product flow.
* Implementation map: N/A: internal workflow package.
* Manual handoff: N/A: HIGH-GOAL uses the goal handoff.
* Goal handoff: .ai/artifacts/example/goal-handoff.md
* Workflow state: N/A: manual HIGH-GOAL.
* File ownership: N/A: manual HIGH-GOAL.
* Files: N/A: manual HIGH-GOAL.

## Phases

### Implementation

* Objective: Follow the approved manual package.
`;
  try {
    await Promise.all([
      mkdir(join(root, ".ai", "plans"), { recursive: true }),
      mkdir(join(root, ".ai", "specs"), { recursive: true }),
      mkdir(join(root, ".ai", "artifacts", "example"), { recursive: true }),
    ]);
    await Promise.all([
      writeFile(join(root, planPath), plan),
      writeFile(join(root, ".ai/specs/example.spec.md"), markdown("Example", "feature-spec@1", ["## Version", "## Goal", "## Inputs / Outputs", "## Behavior", "## Edge Cases", "## Constraints", "## Acceptance Criteria"])),
      writeFile(join(root, ".ai/artifacts/example/goal-handoff.md"), markdown("Goal Handoff", "goal-handoff@1", ["## Exact Goal", "## Spec", "## Plan", "## Repository State", "## Verified Progress", "## Decisions", "## Blockers", "## Next Action"]).replace("content", "Follow the approved spec.\n\n## Spec\n\n.ai/specs/example.spec.md\n\n## Plan\n\n.ai/plans/example.md")),
    ]);
    const valid = await validatePlanDocumentBundle({ rootDir: root, planPath, planName: "example", planContent: plan });
    assert.deepEqual(valid, { ok: true });
    const invalid = await validatePlanDocumentBundle({
      rootDir: root,
      planPath,
      planName: "example",
      planContent: plan.replace("N/A: HIGH-GOAL uses the goal handoff.", ".ai/artifacts/example/manual-handoff.md"),
    });
    assert.equal(invalid.ok, false);
    assert.match(invalid.ok ? "" : invalid.reason, /must mark manual handoff N\/A/);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("rejects missing, misplaced, mismatched, and future formats", () => {
  const missing = validateDocumentFormat("featureSpec", "# Feature\n\n## Version\n\n1", "missing.md");
  const misplaced = validateDocumentFormat("featureSpec", "# Feature\n\n## Version\n\n1\n\n## Document Format\n\nfeature-spec@1", "misplaced.md");
  const mismatch = validateDocumentFormat("workflowState", { documentFormat: "workflow-state@2", planPath: "x", workflowState: "approved", latest: {}, history: [], unresolvedBlockers: [], updatedAt: "now" }, "future.json");
  assert.equal(missing.ok, false);
  assert.equal(misplaced.ok, false);
  assert.equal(mismatch.ok, false);
});

test("normal runner validation rejects both retired thin-plan contracts", async () => {
  for (const contract of ["thin-plan-v1", "thin-plan-v2"]) {
    const result = await validateThinPlanContract({
      rootDir: process.cwd(),
      planName: "example",
      content: `# Plan\n\n## Workflow Content Rules\n\n${contract}\n`,
    });
    assert.equal(result.ok, false);
    assert.match(result.ok ? "" : result.reason, /unsupported/);
  }
});

const oldPlan = `# Plan: example

## Workflow Content Rules

thin-plan-v2

## Execution Mode

runner-managed

## Workflow State

draft-validation

## Spec

.ai/specs/example.spec.md

## Artifacts

* User journey: .ai/artifacts/example/user-journey.md
* Implementation map: .ai/artifacts/example/implementation-map.md
* Manual handoff: N/A: runner-managed execution
* Workflow state: .ai/artifacts/example/state/workflow.json
* File ownership: .ai/artifacts/example/state/file-ownership.json
* Files: .ai/artifacts/example/state/files.json

## Phases

### Implementation

* Objective: Test migration.
`;

const writeDraftBundle = async (root: string, workflowState = "draft-validation") => {
  await Promise.all([
    mkdir(join(root, ".ai", "plans"), { recursive: true }),
    mkdir(join(root, ".ai", "specs"), { recursive: true }),
    mkdir(join(root, ".ai", "artifacts", "example", "state"), { recursive: true }),
  ]);
  await Promise.all([
    writeFile(join(root, ".ai", "plans", "example.md"), oldPlan.replace("draft-validation", workflowState)),
    writeFile(join(root, ".ai", "specs", "example.spec.md"), "# Feature: Example\n\n## Version\n\n1\n\n## Goal\n\nTest\n\n## Inputs / Outputs\n\nNone\n\n## Behavior\n\nTest\n\n## Edge Cases\n\nNone\n\n## Constraints\n\nNone\n\n## Acceptance Criteria\n\nPass\n"),
    writeFile(join(root, ".ai", "artifacts", "example", "user-journey.md"), "# User Journey\n\n## Goal\n\nTest\n\n## Actors\n\nUser\n\n## Entry Points\n\nTest\n\n## User Flows\n\nTest\n\n## Mermaid Diagram\n\nflowchart TD\n\n## States\n\nTest\n\n## Failures\n\nNone\n\n## Acceptance Scenarios\n\nPass\n\n## Open Decisions\n\nNone\n"),
    writeFile(join(root, ".ai", "artifacts", "example", "implementation-map.md"), "# Implementation Map\n\n## Source Versions\n\nN/A: migration fixture.\n"),
    writeFile(join(root, ".ai", "artifacts", "example", "state", "workflow.json"), `${JSON.stringify({ planPath: ".ai/plans/example.md", workflowState, latest: {}, history: [".ai/artifacts/example/events/validation-v1.md"], unresolvedBlockers: [], updatedAt: "2026-01-01T00:00:00.000Z" })}\n`),
    writeFile(join(root, ".ai", "artifacts", "example", "state", "file-ownership.json"), `${JSON.stringify({ planPath: ".ai/plans/example.md", owns: ["src/example.ts"], released: [], resolvedFiles: ["src/example.ts"], changedFiles: ["src/example.ts"], headSha: "abc", updatedAt: "2026-01-01T00:00:00.000Z" })}\n`),
    writeFile(join(root, ".ai", "artifacts", "example", "state", "files.json"), `${JSON.stringify({ created: [], modified: ["src/example.ts"], deleted: [], changedFiles: ["src/example.ts"], released: [], headSha: "abc" })}\n`),
  ]);
};

test("migrates only a draft bundle, preserves state pointers, and is idempotent", async () => {
  const root = await mkdtemp(join(tmpdir(), "document-format-migration-"));
  try {
    await writeDraftBundle(root);
    const script = join(process.cwd(), ".ai", "scripts", "workflow", "migrate-document-formats.ts");
    const tsx = join(process.cwd(), "node_modules", ".bin", "tsx");
    const dryRun = await execFileAsync(tsx, [script, "--plan", ".ai/plans/example.md"], { cwd: root });
    assert.match(dryRun.stdout, /Migration preview/);
    assert.match(await readFile(join(root, ".ai", "plans", "example.md"), "utf8"), /thin-plan-v2/);
    await execFileAsync(tsx, [script, "--plan", ".ai/plans/example.md", "--apply"], { cwd: root });
    const plan = await readFile(join(root, ".ai", "plans", "example.md"), "utf8");
    const workflow = JSON.parse(await readFile(join(root, ".ai", "artifacts", "example", "state", "workflow.json"), "utf8"));
    assert.match(plan, /## Document Format\s*\n\s*plan-manifest@1/);
    assert.match(plan, /thin-plan(?!-v)/);
    assert.equal(workflow.documentFormat, "workflow-state@1");
    assert.deepEqual(workflow.history, [".ai/artifacts/example/events/validation-v1.md"]);
    const valid = await validatePlanDocumentBundle({ rootDir: root, planPath: ".ai/plans/example.md", planName: "example", planContent: plan });
    assert.equal(valid.ok, true);
    const beforeRepeat = await readFile(join(root, ".ai", "plans", "example.md"), "utf8");
    await execFileAsync(tsx, [script, "--plan", ".ai/plans/example.md", "--apply"], { cwd: root });
    assert.equal(await readFile(join(root, ".ai", "plans", "example.md"), "utf8"), beforeRepeat);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("refuses completed plans and reports a migration command for a stale bundle", async () => {
  const root = await mkdtemp(join(tmpdir(), "document-format-completed-"));
  try {
    await writeDraftBundle(root, "completed");
    const script = join(process.cwd(), ".ai", "scripts", "workflow", "migrate-document-formats.ts");
    const tsx = join(process.cwd(), "node_modules", ".bin", "tsx");
    await assert.rejects(
      execFileAsync(tsx, [script, "--plan", ".ai/plans/example.md", "--apply"], { cwd: root }),
      /refusing to migrate completed plan/,
    );
    const result = await validatePlanDocumentBundle({ rootDir: root, planPath: ".ai/plans/example.md", planName: "example", planContent: oldPlan });
    assert.equal(result.ok, false);
    assert.match(result.ok ? "" : result.reason, /migrate-document-formats\.ts --plan \.ai\/plans\/example\.md --apply/);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("runner preflight stops before an agent launch when a bundle is stale", async () => {
  const root = await mkdtemp(join(tmpdir(), "document-format-runner-preflight-"));
  try {
    await writeDraftBundle(root);
    let launches = 0;
    const result = await runWorkflowRunner({
      argv: [".ai/plans/example.md"],
      rootDir: root,
      console: { log: () => {}, error: () => {} },
      processRunner: async () => {
        launches += 1;
        return { launched: true, stdout: "", stderr: "", exitCode: 0 };
      },
    });
    assert.equal(result.success, false);
    assert.equal(launches, 0);
    assert.match(result.reason, /migrate-document-formats\.ts --plan \.ai\/plans\/example\.md --apply/);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});
