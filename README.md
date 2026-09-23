# AI Repository Guidance

This nested `.ai` Git repository provides reusable Codex instructions, one
progressive change-workflow skill, independent utilities, and self-contained
health checks. It intentionally does not maintain a workflow state machine.

## Installation

For a Git parent checkout, install the local Codex discovery override:

```bash
# From .ai
pnpm setup:codex

# From the containing workspace
pnpm --dir .ai setup:codex
```

The ignored workspace-root `AGENTS.override.md` directs Codex to read
`.ai/AGENTS.md` and `.ai/instructions/index.md`. The `.ai` authority then loads
the nested change-workflow skill only when planning, Goal mode, or a controlled
boundary requires it. See [Codex Agent Setup](docs/codex-agent.md).

## Workflow

Use the smallest execution shape that fits the request:

```text
Direct:      request -> implement -> validate -> self-review -> report
Planned:     one living plan -> /goal -> validate -> self-review -> report
Controlled:  one living plan -> /goal -> validate -> independent review -> report
```

- Direct work creates no workflow artifact.
- Planned work uses one living Markdown plan.
- Controlled work applies only when a named authentication, authorization,
  payment, secret, migration, destructive, security, or trust contract changes.
- No path creates a status sidecar, flow map, review state, fingerprint, or plan
  revision archive.

The canonical workflow is
[change-workflow](.agents/skills/change-workflow/SKILL.md). Detailed plan and
review guidance is loaded from its references only when needed. See
[How the Workflow Works](docs/workflow-usage.md), including how to start the
next plan.

## Repository Instructions

`.ai/instructions/index.md` routes application work to the smallest applicable
set of project and shared instructions. Security, testing, accessibility,
delivery, and area conventions remain independent of workflow choice.

## Independent Utilities

Utilities under `prompts/utilities/` remain explicitly invoked actions rather
than workflow stages:

- AGENTS override setup
- agent-skill discovery
- instruction management
- worktree preparation
- commit organization
- pull-request preparation

None of these utilities authorizes implementation or delivery beyond the
user's request.

## Legacy Local Records

Ignored content under `artifacts/`, `logs/`, `plans/`, `specs/`, `state/`, and
`tmp/` may have been produced by the retired workflow. It is preserved and
cannot authorize new execution.

Preview explicit cleanup with:

```bash
pnpm cleanup:local
```

Apply cleanup only when the user has explicitly authorized deletion:

```bash
pnpm cleanup:local --apply
```

## Checks

The package requires Node `>=20.20.2` and pins pnpm and the test toolchain.

```bash
pnpm health
pnpm health:full
pnpm test:focused
```

The health check can also run by absolute path from another directory:

```bash
node /absolute/path/to/.ai/scripts/maintenance/health-check.mjs
node /absolute/path/to/.ai/scripts/maintenance/health-check.mjs --full
```

## Repository Boundary

The nested `.ai/.gitignore` allowlists reusable source. Project-local
instructions and living plans plus legacy local records remain ignored and
untracked. A Git parent checkout must not track `.ai` paths.
