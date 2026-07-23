# `.ai` Nested Repository

This directory is a standalone Git repository for reusable AI workflow source
files.

Tracked workflow source:

- `AGENTS.md`
- `prompts/`
- `scripts/`
- `templates/`
- `wrappers/`
- `instructions/shared/`
- `changelogs/shared/`

Local-only directories that are intentionally excluded:

- `artifacts/`
- `plans/`
- `specs/`

Local-only instruction files that remain excluded by default:

- `instructions/index.md`
- `instructions/architecture.md`
- other project-specific instruction files
- project-specific changelog files

The parent repository continues to ignore `.ai/`, so this nested repository can
be versioned independently without changing the main repository's tracking
behavior.

Shared behavioral rules live in `.ai/AGENTS.md`. Keep `.codex/AGENTS.md` as
the project entrypoint that bootstraps the shared file and adds only minimal
local overrides when needed.

## Quick Start

Use this when you want to install the workflow in another repository and start
using it immediately.

From the target repository root:

1. Clone this workflow repository into `.ai/`.

```bash
git clone <your-ai-workflow-repo-url> .ai
```

2. Keep `.ai/` ignored by the parent repository unless you intentionally want
   to allowlist specific shared files.

```gitignore
.ai/
```

3. Add the Codex bootstrap file at `.codex/AGENTS.md`.

```md
@../.ai/AGENTS.md

# Local Project Rules

- Use `.ai/instructions/index.md` as the repository instruction routing entrypoint.
- Keep project-specific instruction routing and architecture guidance in `.ai/instructions/`.
- Treat `.ai/AGENTS.md` as the shared behavior source for projects using this workflow starter kit.
```

4. Install the parent repository prerequisites.

- Node `>=20`
- `pnpm`
- `tsx`
- `prettier`

Example:

```bash
pnpm add -D tsx prettier
```

5. Add local repository instruction routing files.

- `.ai/instructions/index.md`
- `.ai/instructions/architecture.md` when ownership is broad or cross-package
- other project-specific `.ai/instructions/*.md` files as needed

6. Verify the runner entry from the parent repository root.

```bash
pnpm exec tsx .ai/scripts/workflow/runner.ts --help
```

If `pnpm exec tsx ...` resolves and the runner entry responds, the workflow is
installed correctly.

## Health Check

Run this from the parent repository root when you want to verify the private
`.ai` workflow source and local-only boundaries:

```bash
node .ai/scripts/maintenance/health-check.mjs
node .ai/scripts/maintenance/health-check.mjs --runner-tests
node .ai/scripts/maintenance/health-check.mjs --full
```

The default check confirms that the parent repository contains `.ai/`, that the
parent Git ignore rules keep `.ai/` and local workflow data ignored, that the
required workflow source paths exist, and that the reusable workflow source
formats cleanly. It also verifies that the workflow runner entry responds to
`--help`.

`--runner-tests` adds the local workflow runner test command.
`--full` is an alias for the default check plus runner tests.

This is a private/local workflow-source health check. It intentionally does not
run the parent application test suite or every project validation command.

## Installation Model

The workflow assumes two repositories:

- the parent application repository
- the nested `.ai` repository that owns reusable workflow source

Recommended parent repository layout:

```text
<repo-root>/
  .ai/
  .codex/
    AGENTS.md
  package.json
```

Rules:

- run workflow commands from the parent repository root, not from inside `.ai`
- keep shared workflow source in the nested `.ai` Git repository
- keep local plans, specs, artifacts, and project-specific instructions local
  unless you intentionally want to publish them

## Publishing And Updating The `.ai` Repo

This directory is a normal nested Git repository. You can publish and update it
independently of the parent application repository.

Initial remote setup:

```bash
git -C .ai remote add origin <your-ai-workflow-repo-url>
git -C .ai branch -M main
git -C .ai push -u origin main
```

Daily update flow in a repository that already uses this workflow:

```bash
git -C .ai fetch origin
git -C .ai status --short
git -C .ai pull --ff-only
```

Typical publish flow after changing shared workflow source:

```bash
git -C .ai status --short
git -C .ai add <changed-files>
git -C .ai commit -m "<message>"
git -C .ai push
```

Notes:

- commit shared workflow-source changes in the nested `.ai` repository, not the
  parent application repository
- keep `artifacts/`, `plans/`, `specs/`, and local instruction routing out of
  the shared workflow remote unless you intentionally want to version them

## Workflow Concepts

Main workflow artifacts:

- spec: the behavior contract
- manual handoff: the explicit portable checkpoint for a MEDIUM manual plan
- goal handoff: the portable companion checkpoint for HIGH-GOAL work
- user-journey artifact: the optional flow-trace contract generated from the
  approved spec plus codebase inspection when the scope needs end-to-end flow
  mapping
- plan: the execution contract
- prompt: the stage-specific workflow controller
- runner: the post-plan state-machine driver
- snapshot: the compact current-state handoff file for follow-up stages

Default locations:

- ordinary feature and bug specs: `.ai/specs/<name>.spec.md`
- user-journey artifacts for flow-trace-required work:
  `.ai/artifacts/<name>/user-journey.md`
- plans: `.ai/plans/<name>.md`
- manual handoffs: `.ai/artifacts/<name>/manual-handoff.md`
- goal handoffs: `.ai/artifacts/<goal-name>/goal-handoff.md`
- prompts: `.ai/prompts/*.md`
- runner: `.ai/scripts/workflow/runner.ts`

Plan `## Spec` entries may also point to any repo-relative `*.spec.md` path
when a workflow companion spec belongs elsewhere, such as
`.ai/scripts/workflow/runner.spec.md`.

## Workflow Selection

Start with the analysis-only selector:

```text
.ai/wrappers/select-workflow.md
```

It creates no files and returns the classification, selected path, concise
reason, and exact next action.

| Classification | Path | Durable continuity |
| --- | --- | --- |
| `LOW` | Simple session-local `/plan` | None. Do not create spec, plan, or workflow artifacts. |
| `MEDIUM` | Spec + manual plan | `.ai/artifacts/<plan-name>/manual-handoff.md`; refresh it explicitly before pausing, ending a session, or switching agent/provider. |
| `HIGH-GOAL` | Approved manual spec-and-plan package, then Codex `/goal` | `.ai/artifacts/<goal-name>/goal-handoff.md`; refresh it only before `/goal pause`, ending a session, or switching provider/account. |
| `HIGH-RUNNER` | Runner-managed path | Existing plan, context snapshot, event, review, and validation lifecycle. |

For HIGH work, the operator explicitly selects `HIGH-GOAL` or `HIGH-RUNNER`.
The selector explains the tradeoff but never overrides that choice.

`HIGH-GOAL` is Codex-only for the live `/goal`; its handoff is portable. Choose
a stable kebab-case `<goal-name>` when starting it. To resume, Codex restores
the saved `## Exact Goal` with `/goal`; other providers start by reading the
same handoff. Neither goal checkpoint nor resume writes runner state.

Deleting `.ai/artifacts/<plan-name>/` or `.ai/artifacts/<goal-name>/` removes
all local state for that work item. Artifacts stay local/ignored by default;
sync the relevant artifact directory separately when moving machines.

## Standard Workflow

Canonical lifecycle:

```text
spec -> optional user-journey artifact -> plan -> (manual execute | sync artifacts -> validator/runner)
```

Normal end-to-end flow:

1. Create a spec.
2. Create a user-journey artifact only when the scope requires end-to-end flow
   mapping.
3. Create a plan.
4. Choose a post-plan path.
5. Either continue manual execution in the same conversation or let the runner
   sync plan artifacts and drive every later stage.

### Create A Spec

Use the wrapper that matches the work:

- feature: `.ai/wrappers/generate-feature-spec.md`
- bugfix: `.ai/wrappers/generate-bugfix-spec.md`

Ordinary specs should live in `.ai/specs/`. If a workflow companion spec needs
to live elsewhere, keep the plan `## Spec` entry repo-relative.

### Create A User-Journey Artifact

For flow-trace-required work, this artifact is required, but `create-plan`
automatically creates or regenerates it when it is missing or invalid. To
inspect the flow before planning, use:

```text
.ai/wrappers/generate-user-flow.md
```

The generated artifact should live at:

```text
.ai/artifacts/<plan-name>/user-journey.md
```

User-facing work means a feature, bugfix, or change that affects a customer,
admin, or operator screen, route, workflow, visible state, or user-triggered API
behavior.

Flow-trace artifacts are required only when the scope needs end-to-end flow
mapping, such as multi-step workflows, multi-route handoffs, multiple visible
states or failure branches, or user-triggered API behavior whose ownership is
not obvious from a single file or single state.

For non-user-facing work and narrow user-facing work that does not need
end-to-end flow mapping, skip this stage. The plan must record
`N/A: <concrete reason>` for the user journey entry in `## Artifacts` and in
`.ai/artifacts/<plan-name>/implementation-map.md`.

### Create A Plan

Use:

```text
.ai/wrappers/create-plan.md
```

The generated plan should live at:

```text
.ai/plans/<plan-name>.md
```

When the work requires flow-trace artifacts, this wrapper first ensures
`.ai/artifacts/<plan-name>/user-journey.md` exists and validates against the
spec. If it is missing or stale, the wrapper applies
`.ai/prompts/generate-user-flow.md` automatically before writing the plan.

`create-plan` also auto-preflights flow-trace-required plan authoring before
returning the draft:

- repair or regenerate `.ai/artifacts/<plan-name>/user-journey.md`
- derive or repair `.ai/artifacts/<plan-name>/implementation-map.md`
- rewrite invalid savepoints into independently passable chunks
- verify each spec-required behavior is owned by a concrete task
- STOP only when those checks still cannot be satisfied without inventing
  behavior beyond the spec

Choose an execution mode when you create the plan:

- `manual` for `spec -> plan -> execute` in one conversation without
  runner-managed workflow state
- `runner-managed` for the harness path

In `runner-managed` mode, new draft plans start at `draft-artifact-sync`.
The sync stage records an event-only artifact-consistency decision; the runner
validates that event and moves the canonical state to `draft-validation` only
when the package is ready.

Before invoking the runner, review every `runner-managed` plan with
`.ai/wrappers/review-high-risk-plan.md` in a fresh Plan Mode or analysis-only
session. Repair material findings in Agent Mode and repeat the independent
review until it returns `OKAY`. The operator must then review the finalized
spec and plan and reply `APPROVE IMPLEMENTATION`.

In `manual` mode, keep the spec and plan discipline but do not create
runner-only state artifacts just to continue execution. Ordinary manual work
uses `.ai/artifacts/<plan-name>/manual-handoff.md`. HIGH-GOAL work starts only
after the spec and manual plan are approved and uses exactly
`.ai/artifacts/<goal-name>/goal-handoff.md`; it must not create a manual
handoff. During manual execution, the spec, plan, and current Git state remain
authoritative.

### Choose A Post-Plan Path

You have two options:

- manual execution in the same conversation
- default runner path

## Workflow Runner

Default post-plan path:

```bash
pnpm exec tsx .ai/scripts/workflow/runner.ts .ai/plans/<plan-name>.md
```

Example:

```bash
pnpm exec tsx .ai/scripts/workflow/runner.ts .ai/plans/add-billing-retries.md
```

One-off Codex profile override:

```bash
pnpm exec tsx .ai/scripts/workflow/runner.ts --profile codex-personal .ai/plans/<plan-name>.md
```

Runner expectations:

- the latest independent review of the finalized spec and plan returned
  `OKAY`
- the operator replied `APPROVE IMPLEMENTATION` after that review
- the plan path must be exactly `.ai/plans/<plan-name>.md`
- run from the parent repository root
- `pnpm exec tsx ...` must resolve in the parent repository environment

### How The Runner Works

The runner reads the canonical `## Workflow State`, issues a stage descriptor,
and finalizes state only from that descriptor's validated event artifact.

Common stages:

- `draft-artifact-sync -> sync-plan-artifacts`
- `draft-validation -> plan-validator`
- `approved` or `active -> execute-plan`
- `review -> review-changes`
- `blocked -> unblock-plan`
- `reopening -> reopen-plan`
- `completed -> commit-summary`

Default stage routing:

| Stage | Model | Reasoning |
| --- | --- | --- |
| `sync-plan-artifacts` | `gpt-5.6-luna` | `medium` |
| `plan-validator` | `gpt-5.5` | `medium` |
| `execute-plan` | `gpt-5.5` | `high` |
| `unblock-plan` | `gpt-5.6-luna` | `medium` |
| `review-changes` | `gpt-5.6-sol` | `xhigh` |
| `reopen-plan` | `gpt-5.6-luna` | `medium` |
| `commit-summary` | `gpt-5.5` | `medium` |
| `scope-cleanup` | `gpt-5.6-terra` | `high` |

Notes:

- `review-changes` is the runner's review stage; it writes only its assigned
  review event, and the runner persists the outcome.
- The runner runs one combined harness review through `review-changes`.
- Harness prompts use native `.ai/instructions/shared/*` guidance for reasoning,
  debugging, testing, and workflow state. Additional review, when desired, is a
  separate manual decision outside the default runner review path.
- `commit-summary` uses `gpt-5.5` with medium reasoning. It remains a
  low-risk formatting stage: final commit subject and user-facing summary, not
  implementation correctness validation.
- `scope-cleanup` is not a visible workflow state, but the runner uses it
  before review and commit-summary cleanup decisions, so it has its own routing.

The runner writes a hot-path context snapshot for each plan:

```text
.ai/artifacts/<plan-name>/state/context.md
```

Baseline snapshot-first guidance means runner-driven prompts should use that
snapshot as the primary current-state source. The manifest remains the source
of truth for plan edits; finalized event artifacts and `workflow.json` are the
source for exact workflow history and evidence. Prompts may open only exact
event, state, validation, blocker, or diff evidence when the snapshot is
insufficient for correctness.

Threshold crossings add stronger workflow token guardrail guidance for guarded
stages. That escalation is prompt guidance, not a hard block, and it preserves
required spec reads, path-scoped staged diffs, workflow state, validation
evidence, blocker evidence, and other correctness-critical inputs.

Snapshot sections are intentionally compact and stage-aligned. Expect:

- `## Summary`
- `## Key Details`
- `## Generated Latest Validation Context`
- `## Generated Latest Review Context`
- `## Generated Remediation Context`

New workflow plans use `thin-plan`. Existing malformed history is never
repaired by a normal run; use the explicit workflow-artifact migration only
when its proof requirements are met. Versioned workflow history entries are
runner-written pointers to event artifacts:

```text
.ai/artifacts/<plan-name>/events/<kind>-v<N>.md
```

Supported event kinds:

- `execution`
- `validation`
- `review`
- `unblock`
- `reopen`

Each event artifact must include:

```markdown
# <Event> v<N>

## Outcome

<stage-specific outcome>

## Summary

<short summary>

## Evidence

<commands, output excerpts, files, or findings that support the plan entry>
```

Runner-owned runtime files are written under the plan artifact root:

```text
.ai/artifacts/<plan-name>/logs/runner.log
.ai/artifacts/<plan-name>/logs/token-usage.jsonl
.ai/artifacts/<plan-name>/logs/failure.jsonl
.ai/artifacts/<plan-name>/state/context.md
```

Token usage warnings are advisory only. They help surface oversized stages, but
they do not stop an otherwise successful workflow stage from continuing.

The `token-usage.jsonl` ledger is measurement data. Keep it compact and
append-only so workflow changes can be evaluated instead of guessed.

Manual `spec -> plan -> execute` work can append to the same ledger format.
If repo-local Codex hooks are enabled and trusted, tracked manual wrappers and
prompts can do this automatically after successful stage completion.

Manual fallback:

```bash
pnpm exec tsx .ai/scripts/workflow/telemetry/manual-token-usage.ts --plan <plan-name> --stage spec
pnpm exec tsx .ai/scripts/workflow/telemetry/manual-token-usage.ts --plan <plan-name> --stage plan
pnpm exec tsx .ai/scripts/workflow/telemetry/manual-token-usage.ts --plan <plan-name> --stage execute
```

The workflow runner does not backfill pre-runner planning turns. If you want
apples-to-apples totals across manual and runner-managed work, record the
manual `spec` and `plan` checkpoints either through the repo-local hooks or
explicitly with the script.

When the runner warns that a plan is too large, move bulky workflow detail into
event artifacts and keep only bounded plan summaries plus exact artifact paths.

Non-review workflow stages share one terminal-facing output contract:

- `**Plan**`
- `**Summary**`
- `**Key Details**`
- optional `**Validation**`
- `**Next**`

`review-changes` remains the only specialized output shape.

## Manual Preview

Use this for standalone ad hoc work when you want a contextual code preview
before non-test files are changed and you do not want to bind the work to a
workflow plan.

Invoke it explicitly:

```text
Use '.ai/prompts/manual-preview.md'

Target:
<describe the target files and requested change>
```

Behavior:

- no plan file is required
- workflow state, plan status, and `.ai/artifacts` are not read or updated
- target files or requested behavior must be clear enough to prepare a
  contextual code preview
- non-test writes wait for explicit approval before apply
- test-only writes and validation commands may proceed without the non-test
  approval gate

Use it when:

- you want ad hoc manual work previewed without creating or updating a plan
- you want a small prompt that does not load the planned workflow controller

Avoid it when:

- the work needs plan state, file ownership boundaries, or review-compatible
  workflow artifacts

## Day-To-Day Commands

Common commands from the parent repository root:

```bash
# Run the default workflow path
pnpm exec tsx .ai/scripts/workflow/runner.ts .ai/plans/<plan-name>.md

# Run the default workflow path with a one-off Codex profile override
pnpm exec tsx .ai/scripts/workflow/runner.ts --profile codex-personal .ai/plans/<plan-name>.md

# List local workflow files, including ignored ones
rg --files -uu .ai

# Inspect the latest snapshot for a plan
sed -n '1,220p' .ai/artifacts/<plan-name>/state/context.md
```

Useful nested repo commands:

```bash
# See shared workflow-source changes
git -C .ai status --short

# Pull workflow-source updates
git -C .ai pull --ff-only

# Push workflow-source updates
git -C .ai push
```

## Troubleshooting

If the runner does not start:

- confirm you are running from the parent repository root
- confirm the plan path is `.ai/plans/<plan-name>.md`
- confirm `pnpm exec tsx` resolves locally
- confirm `.codex/AGENTS.md` exists and points at `.ai/AGENTS.md`

If `manual-preview` behaves unexpectedly:

- confirm the prompt was invoked explicitly with
  `Use '.ai/prompts/manual-preview.md'`
- confirm the request identifies target files or a concrete behavior to change
- confirm no plan state or `.ai/artifacts` updates were expected

If follow-up stages lose context:

- inspect `.ai/artifacts/<plan-name>/state/context.md`
- inspect the latest event artifacts under `.ai/artifacts/<plan-name>/events/`
- avoid broad `.ai/artifacts/**` reads unless you are debugging the current
  plan

## Workflow Optimization Priorities

The executable façade remains `.ai/scripts/workflow/runner.ts`. Runtime
lifecycle, terminal formatting, ownership, review, telemetry, and task
savepoint concerns live behind focused workflow modules.

Current priority:

- token pathology reduction across workflow stages

Prioritize:

- improve token-warning diagnostics. If the plan is small but stage input
  tokens are huge, identify likely stage/context/tool-output growth without
  moving the plan's implementation details out of the plan file
- add per-turn token usage visibility when Codex exposes it, so one oversized
  turn can be found without treating the whole stage as one opaque number
- hard-cap captured command stdout/stderr in workflow summaries. Keep concise
  terminal summaries in runner output and write full logs to artifacts only
  when needed
- keep active prompts strict about context loading: use
  `.ai/artifacts/<plan-name>/state/context.md` first, open event artifacts only
  for needed evidence, and avoid broad `.ai/artifacts/**` reads
- split long execute/review stages earlier when cached input grows excessively,
  even when the plan is already thin

Manual cleanup:

- after a feature plan is completed and verified, delete its
  `.ai/artifacts/<plan-name>/` folder manually
- do not add runner automation for deleting or managing completed artifact
  folders
