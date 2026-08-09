# `.ai` Nested Repository

This standalone Git repository contains reusable AI workflow source. The
parent repository intentionally ignores `.ai/`; plans, specs, and artifacts
remain local unless explicitly published.

## Workflow Quick Reference

This README is navigation, not a second workflow contract. Use the canonical
sources below for exact rules:

- Classification: `.ai/prompts/select-workflow.md`
- Stage authority and saved artifacts: `.ai/instructions/shared/workflow-state.md`
- Planning: `.ai/prompts/create-plan.md`
- LOW and MEDIUM execution: `.ai/prompts/execute-plan.md`
- HIGH checkpoint and task commits: `.ai/prompts/goal-checkpoint.md`
- Actual-diff review: `.ai/prompts/review-changes.md`
- HIGH task delegation structure: `.ai/templates/plan.template.md`

Start with `select-workflow` for a new request that defines or changes product,
implementation, or planning scope. Feature and bug intake include it; use the
prompt directly for other such requests.

Run utility and workflow-continuation prompts directly when their own
preconditions are met. These include `commit-organizer`, `plan-progress`,
`goal-checkpoint`, and `resume-goal`; they inspect, organize, or continue
existing work and do not classify new scope or authorize implementation.

```text
request -> classify LOW | MEDIUM | HIGH

LOW    -> save compact plan -> execute <plan> -> validate + self-check
MEDIUM -> save spec -> save plan -> execute <plan> -> validate + automatic diff review
HIGH   -> save spec -> save plan + initial handoff -> /goal <description> <plan> -> task delegate/validate/review/commit
```

Specs and plans are saved artifacts, not approval gates. The explicit next
command authorizes the next stage. Classification uncertainty stops for the
exact missing decision; a class may escalate when new evidence requires it.

MEDIUM review evidence and HIGH task delegation, review, and commit rules are
defined by the canonical sources above.

## How To Run A Request

### 1. Intake (read-only)

For a feature, run `.ai/wrappers/feature-intake.md`; for a bug, regression, or
incident, run `.ai/wrappers/bug-intake-rca.md`. Each includes the exact
`select-workflow` classification rules and returns the intake result plus the
four-line classification output. For documentation, refactors, tooling,
research, maintenance, or any other request, run
`.ai/prompts/select-workflow.md` directly. If classification cannot be made
safely, provide the specific missing decision it requests before continuing.

### 2. LOW

Switch to Plan mode and use `.ai/prompts/create-plan.md` to save a compact
plan at `.ai/plans/<name>.md`. Then switch to Agent mode and explicitly invoke:

```text
execute .ai/plans/<name>.md
```

LOW execution runs scoped validation and an actual-diff self-check. It creates
no spec or separate review artifact.

### 3. MEDIUM

In the intake conversation, create `.ai/specs/<name>.spec.md` with
`.ai/prompts/generate-spec.md`. Then switch to Plan mode and create
`.ai/plans/<name>.md` with `.ai/prompts/create-plan.md`. Switch to Agent mode
and explicitly invoke:

```text
execute .ai/plans/<name>.md
```

Execution validates the implementation, reviews the actual diff automatically,
and saves `.ai/artifacts/<name>/review.md`.

### 4. HIGH

In the intake conversation, create the spec. Then switch to Plan mode to save
the plan and its required initial handoff at
`.ai/artifacts/<name>/goal-handoff.md`. The handoff records verified
pre-execution state and does not authorize work. Switch to Agent mode and
start the task workflow explicitly:

```text
/goal <description> .ai/plans/<name>.md
```

Each HIGH task is implemented, validated, reviewed against its actual diff,
and committed before the next task begins.

### HIGH delegation

The saved HIGH plan declares whether delegation is required for each task.
Use the plan template for the role-selection rubric and the goal checkpoint
for the token-efficient role runtime, execution, terminal-visibility, and
commit protocol. Do not use this README as an alternate delegation rule set.

Runtime roles map to capability tiers in
`.ai/config/agent-models.toml`. This registry is the only `.ai` source that
locks exact model IDs. The goal checkpoint enforces the role mapping,
reasoning effort, bounded fork size, and fail-closed behavior.

Check official OpenAI guidance for newer tier models without changing files:

```bash
rtk node .ai/scripts/models/update-agent-models.mjs
```

When an update is reported, run the representative checks in
`.ai/config/agent-model-evals.md`. Apply only after those checks pass:

```bash
rtk node .ai/scripts/models/update-agent-models.mjs --apply --eval-approved
```

Apply updates the registry and project `.codex/config.toml`. Start a new Codex
session for the parent runtime change, then refresh active HIGH handoffs. The
updater fails when official guidance does not confirm both capability tiers;
it never silently switches models.

### Delegation terminal visibility

Required roles retain their bounded scope and required evidence in the saved
plan and checkpoint. Native agent messages are transport events, not the
required terminal milestones or a durable progress log; use the goal
checkpoint for the exact visibility rules.

## Installation

From the parent repository root, keep `.ai/` ignored and create a minimal
`.codex/AGENTS.md` that references `.ai/AGENTS.md` and
`.ai/instructions/index.md`. Install Node 20+, pnpm, tsx, and prettier.

## Health Check

Run from the parent repository root:

```bash
node .ai/scripts/maintenance/health-check.mjs
node .ai/scripts/maintenance/health-check.mjs --full
```

The check verifies required workflow sources, local-only boundaries, formatting,
and focused workflow contract tests. It does not run the parent application
test suite.

## Local-Only Data

`artifacts/`, `plans/`, and `specs/` are ignored by the nested repository.
Historical plans/specs and selected flow evidence may retain legacy wording;
they are reference material rather than active workflow source.
