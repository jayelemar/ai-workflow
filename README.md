# `.ai` Nested Repository

This standalone Git repository contains reusable AI workflow source. The
parent repository intentionally ignores `.ai/`; plans, specs, and artifacts
remain local unless explicitly published.

## Explicit Workflow

Every request uses one read-only classifier. Feature and bug intake include it;
use `select-workflow` directly for every other request type.

```text
request -> classify LOW | MEDIUM | HIGH

LOW    -> save compact plan -> execute <plan> -> validate + self-check
MEDIUM -> save spec -> save plan -> execute <plan> -> validate + automatic diff review
HIGH   -> save spec -> save plan + initial handoff -> /goal <description> <plan> -> task delegate/validate/review/commit
```

Specs and plans are saved artifacts, not approval gates. The explicit next
command authorizes the next stage. Classification uncertainty stops for the
exact missing decision; a class may escalate when new evidence requires it.

MEDIUM review evidence is saved at `.ai/artifacts/<plan-name>/review.md` with
status `Ready to complete`, `Fix required`, or `Blocked`. HIGH uses the
existing `/goal` task-level delegation, review, and commit protocol.

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

### HIGH task delegation

LOW and MEDIUM work are single-agent by default. During HIGH planning, every
task declares `Delegation: REQUIRED` or `Delegation: NONE`; execution must
follow that declaration exactly.

| Rule that applies to the task | Required role |
| --- | --- |
| Its scope depends on independent evidence across three or more source areas. | `investigator` |
| It is isolated from every other planned task, has no shared file ownership, and can be independently implemented and validated. | `builder` |
| It changes authentication, authorization, payments, secrets, migrations, destructive behavior, or an external security boundary. | `reviewer` |

Apply every matching role. If none apply, declare `Delegation: NONE` with the
reason. A required role must finish its bounded assignment before task review;
if it cannot run or its result is missing, the task is `Blocked`. Record the
role, bounded scope, and concise outcome in the HIGH handoff or task review
evidence. Do not create runner state or general-purpose subagent logs.

### Delegation terminal visibility

Codex's native `Interacted with …` and `Waiting for agents` entries are only
tool transport events. For every required delegated role, the root agent also
prints concise terminal milestones: dispatch (task, role, bounded scope, and
expected result), verified material progress or completion (phase, evidence or
changed paths, validation state, and next check), and the last known phase
before a continued wait. It does not repeat unchanged polling status, expose
private reasoning, or create a persisted log. These messages are visibility
only; they do not change the HIGH task protocol or add an approval gate.

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
