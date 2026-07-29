# `.ai` Nested Repository

This standalone Git repository contains reusable AI workflow source. The
parent repository intentionally ignores `.ai/`; plans, specs, and artifacts
remain local unless explicitly published.

## Explicit Workflow

Every request starts with the read-only `select-workflow` classifier.

```text
request -> classify LOW | MEDIUM | HIGH

LOW    -> save compact plan -> execute <plan> -> validate + self-check
MEDIUM -> save spec -> save plan -> execute <plan> -> validate + automatic diff review
HIGH   -> save spec -> save plan -> /goal <description> <plan> -> task validate/review/commit
```

Specs and plans are saved artifacts, not approval gates. The explicit next
command authorizes the next stage. Classification uncertainty stops for the
exact missing decision; a class may escalate when new evidence requires it.

MEDIUM review evidence is saved at `.ai/artifacts/<plan-name>/review.md` with
status `Ready to complete`, `Fix required`, or `Blocked`. HIGH uses the
existing `/goal` task-level review and commit protocol.

## How To Run A Request

### 1. Intake (read-only)

Run `.ai/prompts/select-workflow.md` with the request. It returns LOW, MEDIUM,
or HIGH and the exact next stage. If it cannot classify safely, provide the
specific missing decision it requests before continuing.

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

Then explicitly invoke:

```text
execute .ai/plans/<name>.md
```

Execution validates the implementation, reviews the actual diff automatically,
and saves `.ai/artifacts/<name>/review.md`.

### 4. HIGH

In the intake conversation, create the spec. Then switch to Plan mode to save
the plan. Switch to Agent mode and start the task workflow explicitly:

```text
/goal <description> .ai/plans/<name>.md
```

Each HIGH task is implemented, validated, reviewed against its actual diff,
and committed before the next task begins.

If execution reveals a material requirement, risk, dependency, or scope
change, pause work, update the relevant spec or plan, escalate when needed,
and resume only through the next explicit command.

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
