# Prompt-Driven AI Workflow

This `.ai` Git repository provides reusable prompts, instructions, templates,
and self-contained checks. The containing workspace may be a Git parent
checkout that ignores `.ai/` or an unversioned coordination root containing
multiple independent repositories.

## Installation

For a Git parent checkout, use the local `AGENTS.override.md` bootstrap for
Codex discovery:

```bash
# From .ai
pnpm setup:codex

# From the containing workspace
pnpm --dir .ai setup:codex
```

It creates this ignored workspace-root file:

```md
# Local Project AI Instructions

Read and follow `.ai/AGENTS.md` before starting work.
Use `.ai/instructions/index.md` to load only instructions relevant to the request.

## Code Review Rules

- Before approving changes, check that login and access control still work.
- Do not expose private client, user, or firm data.
- Run the relevant tests. If a test cannot be run, clearly say why.

## Parallel Work Rules

- Agents may research or review in parallel.
- Never have more than one agent edit the same file at the same time.
```

Setup uses the parent's repository-local Git exclude. It refuses conflicting
parent `AGENTS.md`, legacy `.codex/AGENTS.md`, fallback, or hook configurations.
In an unversioned coordination root, the utility intentionally stops before
mutation because no parent Git exclude exists; use an existing operator-managed
`AGENTS.override.md` with the exact content above. See
[Codex Agent Setup](docs/codex-agent.md).

## Workflow

Each arrow is a separate explicit invocation:

```text
LOW:    intake -> saved plan -> execute
MEDIUM: intake -> finalized spec -> saved plan -> execute
HIGH:   intake -> finalized spec -> saved plan + handoff -> /goal
```

Planning may create missing flow artifacts. Delivery remains an optional later
invocation. Copy-ready inputs are in [Workflow Usage](docs/workflow-usage.md).

## Current Contracts

- Specs: `feature-spec@1`, `bugfix-spec@1`
- Flow artifacts: `user-journey@1`, `implementation-map@1`
- Plan: `plan-manifest@3` with backward-compatible lineage,
  `review-strategy@2`, and a saved review budget
- MEDIUM review: `implementation-review@2`
- HIGH handoff: `goal-handoff@2`
- Worktree preparation report: `worktree-setup@1`, tied to its current plan

Contract owners:

- [Global invariants](AGENTS.md)
- [Stage sequence](instructions/shared/workflow-state.md)
- [Plan structure](templates/plan.template.md)
- [Formal and manual review loops](prompts/workflow/review-changes.md)
- [HIGH progress and commit evidence](prompts/workflow/goal-checkpoint.md)
- [Portable worktree setup](prompts/utilities/prepare-worktree.md)

Legacy generated artifacts remain untouched and cannot authorize execution or
resume; create a new plan under the current contracts.

Finalized specs are immutable. Replans reuse the predecessor's spec path only
for an exact content match and use a newly finalized, uniquely named spec for
any content change, including evidence-only revisions that preserve desired
behavior. This keeps every archived plan tied to the exact spec that governed
it.

Only root-level files under `.ai/plans/` are active. A replan keeps the stable
work-item identity, creates the next deterministic `-rN` plan, and archives its
predecessor as `.ai/artifacts/<predecessor>/superseded-plan.md`. Archived plans
remain evidence but cannot execute or resume. Existing plans without lineage
remain compatible revision-1 plans and are not migrated automatically.

## Repository Boundaries

Tracked reusable source is allowlisted by the nested `.ai/.gitignore`.
Project-local instructions, specs, plans, artifacts, logs, state, dependencies,
and historical generated files remain ignored and untracked. When a Git parent
checkout exists, it must not track `.ai/` paths.

## Local Cleanup

Preview before explicitly deleting ignored workflow records only:

```bash
pnpm cleanup:local
pnpm cleanup:local --apply
```

Use the canonical utility when cleanup must also remove task worktrees. It
lists dirty, locked, orphaned, or otherwise questionable task roots and waits
for an explicit `yes` or `no` before any deletion:

```text
Run `.ai/prompts/utilities/cleanup-workflow.md`.

Mode: apply
```

Git branches are retained. Use `Mode: preview` for a read-only inventory.

## Checks

The package requires Node `>=20.20.2` and pins its pnpm and test toolchain.

```bash
# From .ai
pnpm health
pnpm health:full

# From any other directory
node /absolute/path/to/.ai/scripts/maintenance/health-check.mjs
node /absolute/path/to/.ai/scripts/maintenance/health-check.mjs --full
```
