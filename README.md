# Prompt-Driven AI Workflow

This nested `.ai` repository provides reusable prompts, behavioral guidance,
project instruction routing, templates, and self-contained checks. Workflow
authority stays in explicit user invocations and saved artifacts; there is no
runner, transition state, or sidecar authority.

## Installation

For automatic discovery, install the optional repository-root `AGENTS.md`
template documented in `.ai/docs/codex-agent.md`. Active prompts also load
`.ai/AGENTS.md` directly, so no tool-specific indirection file is required.

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
6. Explicitly execute LOW/MEDIUM with `execute <plan-file>` or HIGH with
   `/goal <exact-goal> <plan-file>`.

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
`.ai/instructions/index.md`. Shared baselines remain under
`.ai/instructions/shared/`.

## Optional Token Telemetry

Manual token telemetry remains available at
`.ai/scripts/workflow/telemetry/manual-token-usage.ts`. It is an optional
measurement utility, never a required workflow stage or transition.

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
