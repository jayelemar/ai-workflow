# Prompt-Driven AI Workflow

This nested `.ai` repository provides reusable prompts, behavioral guidance,
project instruction routing, templates, and self-contained checks. Workflow
authority stays in explicit user invocations and saved artifacts; there is no
runner, transition state, or sidecar authority.

## Installation

Use the local `AGENTS.override.md` bootstrap for automatic Codex discovery.
Run either supported command:

From `.ai`:

```bash
pnpm setup:agents-override
```

From the project root:

```bash
pnpm --dir .ai setup:agents-override
```

The command creates this exact ignored project-root file:

```md
# Local Project AI Instructions

Read and follow `.ai/AGENTS.md` before starting work.
Use `.ai/instructions/index.md` to load only instructions relevant to the request.
```

It also adds `/AGENTS.override.md` to the repository-local Git exclude. Before
either managed target changes, setup refuses any parent-root `AGENTS.md` entry,
legacy `.codex/AGENTS.md`, its matching fallback, or manual-token hook conflict.
Resolve those local conflicts explicitly, then rerun the utility. See
`.ai/docs/codex-agent.md` for setup and compatibility details. Active prompts
continue to load `.ai/AGENTS.md` directly.

## Explicit Workflow

1. Run `.ai/prompts/select-workflow.md` for read-only LOW/MEDIUM/HIGH intake.
2. For LOW, explicitly invoke `.ai/prompts/create-plan.md` and save
   `.ai/plans/<plan-name>.md`. Keeping a conversational plan is not enough.
3. For MEDIUM/HIGH, explicitly invoke `.ai/prompts/generate-spec.md` to finalize
   `feature-spec@1` or `bugfix-spec@1`.
4. Explicitly invoke `.ai/prompts/create-plan.md`. It determines
   whether end-to-end tracing is required, reuses a complete pair or creates
   missing `user-journey@1` and `implementation-map@1` artifacts, then saves
   `plan-manifest@2`.
5. Optionally invoke `.ai/prompts/generate-flow-artifacts.md` directly before
   planning when the pair is useful as a standalone deliverable.
6. Explicitly execute LOW/MEDIUM with `execute <plan-file>` or HIGH with the
   returned two-line `/goal <exact-goal>` plus `plan: <plan-file>` invocation.

See [Workflow Usage](docs/workflow-usage.md) for Codex mode selection and
copy-ready invocations for every workflow class.

Saving or finalizing an artifact does not invoke the next stage. There is no
preview, plan approval, validator, or persisted progress gate.

## Contracts

- `.ai/AGENTS.md` owns behavior, scope, transparency, and validation rules.
- `.ai/instructions/shared/workflow-state.md` owns the explicit stage sequence.
- `.ai/prompts/generate-spec.md` owns both typed spec schemas and the mandatory
  evidence-backed bug RCA gate.
- `.ai/prompts/generate-flow-artifacts.md` owns both flow artifact schemas;
  create-plan applies it when required artifacts are missing.
- `.ai/templates/plan.template.md` owns `plan-manifest@2`, including explicit
  Git repository roots and integration-base refs.
- `.ai/prompts/review-changes.md` owns the mandatory independent MEDIUM/HIGH
  whole-plan review, priority gate, and fresh-review remediation loop.
- `.ai/prompts/goal-checkpoint.md` owns the reusable HIGH task delegation,
  per-task review, validation, commit protocol, and final-review remediation
  commits.
- `.ai/config/agent-models.toml` locks the reviewer model and reasoning effort
  used by every final review round.
- Wrappers under `.ai/wrappers/` are input adapters only.

## Repository Boundaries

The parent project ignores `.ai/`. The nested `.ai/.gitignore` allowlists
shared source and keeps project-local instructions, specs, plans, artifacts,
logs, state, dependencies, and historical generated files ignored and
untracked. Git history is the authority for tracked instruction history; this
repository does not maintain instruction changelogs.

Project-local instruction routing begins at ignored
`.ai/instructions/index.md`. All reusable instructions, including canonical
workflow guidance, remain under `.ai/instructions/shared/`; other immediate
Markdown files under `.ai/instructions/` are project-local and ignored.

## Local Record Cleanup

Use the explicit preview-first cleanup utility for ignored workflow records:

```bash
pnpm cleanup:local
pnpm cleanup:local --apply
```

Preview lists the exact targets and makes no changes. Apply removes every entry
under `artifacts/`, `logs/`, `plans/`, `specs/`, `state/`, and `tmp/`, including
active records; invoke it only when that deletion is intended.

## Self-Contained Checks

The private package requires Node `>=20.20.2` and pins `pnpm@10.34.4`,
`prettier@3.9.6`, and `tsx@4.23.12`.

From `.ai`:

```bash
pnpm health
pnpm health:full
```

From any other working directory:

```bash
node /absolute/path/to/.ai/scripts/maintenance/health-check.mjs
node /absolute/path/to/.ai/scripts/maintenance/health-check.mjs --full
```

The checks resolve the nested repository from the script location, validate
canonical paths and references, enforce ignore/untracked boundaries, check
active workflow Markdown and script formatting, and run focused or full tests
without shell command substitution.
