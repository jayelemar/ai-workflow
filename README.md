# AI Repository Guidance

This nested `.ai` Git repository provides reusable Codex instructions, one
combined planning/execution skill, independent utility skills, and self-contained
health checks. It intentionally does not maintain a workflow state machine.

## Installation

For a Git parent checkout, explicitly request local setup, then run:

```bash
# From .ai
pnpm setup:codex

# From the containing workspace
pnpm --dir .ai setup:codex
```

The ignored workspace-root `AGENTS.override.md` explicitly directs Codex to
read an existing root `AGENTS.md` first, then `.ai/AGENTS.md` and
`.ai/instructions/index.md`. Root guidance is preserved. Custom overrides with
the documented active routing block are retained byte-for-byte; incompatible
custom targets stop setup with a routing explanation. Only the exact previous
generated template is upgraded automatically. The `.ai` authority then loads
the nested `ai-build` skill when planning, Goal mode, or a controlled boundary
requires it. Setup also creates four relative links under project-root
`.agents/skills/`, pointing to the same project's canonical `.ai` skills.
It creates a real project-root `.codex/` directory and copies
`.ai/.codex/config.toml` there so trusted project-root sessions can load the
same defaults. Identical existing configs are reused; differing configs are
preserved and stop setup before writes. Only the generated links, override,
and config file receive exact local Git excludes; custom skills, other
`.codex/` files, and tracked ignore files are preserved. Restart Codex after
setup. See [Codex Agent Setup](docs/codex-agent.md).

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
[AI Build](.agents/skills/ai-build/SKILL.md). Detailed plan and
review guidance is loaded from its references only when needed. See
[How the Workflow Works](docs/workflow-usage.md), including how to start the
next plan.

## Repository Instructions

`.ai/instructions/index.md` routes application work to the smallest applicable
set of project, shared, and application-type instructions. Select guidance by
affected code and capabilities, combining application types when needed.
Security, testing, accessibility, delivery, and area conventions remain
independent of workflow choice.

Reusable guidance lives under `instructions/shared/`, `instructions/mobile/`,
`instructions/desktop/`, `instructions/web/`, and `instructions/server/`.
Shared files hold cross-platform principles; application-type files hold their
specific requirements. Framework guidance nests under its application type,
including Electron QA and security review under `instructions/desktop/electron/`.
Load shared policies only when relevant to the task.

The router and everything under `instructions/local/` remain ignored.
Workspace architecture belongs in `instructions/local/architecture.md`;
current desktop paths, commands, and harness conventions belong in
`instructions/local/desktop.md`. These ordinary instructions are loaded through
the index and have no skill metadata or native discovery links.

## Skills and Utilities

Skills support normal matching requests and explicit `$skill-name` invocation:

| Skill                                                          | Purpose                                                            | Example request                                        |
| -------------------------------------------------------------- | ------------------------------------------------------------------ | ------------------------------------------------------ |
| [AI Build](.agents/skills/ai-build/SKILL.md)                   | Create or execute one living plan, implement, validate, and review | `$ai-build Follow .ai/plans/example-change.md`         |
| [AI Worktree Setup](.agents/skills/ai-worktree-setup/SKILL.md) | Prepare native worktrees with independent local context            | `$ai-worktree-setup plan: .ai/plans/example-change.md` |
| [AI Commit](.agents/skills/ai-commit/SKILL.md)                 | Propose coherent groups and create authorized local commits        | `$ai-commit Prepare commits for these changes`         |
| [AI PR](.agents/skills/ai-pr/SKILL.md)                         | Preview a PR and publish after approval                            | `$ai-pr Base: AUTO`                                    |

For example, “save a plan”, “follow this plan”, “prepare worktrees”, “organize
these commits”, and “prepare a pull request” select the corresponding skill.
Selection grants no additional staging, commit, publication, dependency
installation, or cleanup authority. Skills do not automatically chain actions.
Worktree preparation, commits, and pull requests use the canonical skills
directly; their former utility prompts have been removed.

Local setup, read-only skill discovery, instruction management, and selected
worktree cleanup remain [independent prompts](prompts/README.md). Setup is an
explicit invocation; it never installs global skills or user configuration.

## Legacy Local Records

Ignored content under `artifacts/`, `logs/`, `specs/`, `state/`, and `tmp/` may
have been produced by the retired workflow. It is preserved and cannot
authorize new execution. Legacy cleanup excludes the entire `plans/` tree,
including hidden, nested, and linked entries, regardless of plan status.
Preflight rejects managed roots reachable through plan links before any
mutation, including root aliases and links through external directories.
Case-variant aliases to missing managed roots are also rejected conservatively
so applying cleanup cannot turn a dangling plan link into a managed directory.

Preview explicit cleanup with:

```bash
pnpm cleanup:local
```

Apply cleanup only when the user has explicitly authorized deletion:

```bash
pnpm cleanup:local --apply
```

For plan deletion, use the separate
[plan worktree cleanup utility](prompts/worktree-cleanup.md):

```text
Run `.ai/prompts/worktree-cleanup.md`.
plan: .ai/plans/<plan-name>.md
```

Replace the selector with `all-plans: true` only for deliberately requested
bulk cleanup, including active plans. With no selector, the utility only
inventories plans and shows examples; it offers no deletion confirmation.
Selected cleanup requires complete inspection and exact `PROCEED` confirmation;
`CANCEL` preserves data. Unselected plans, their worktrees and records, and
every Git branch are preserved.

## Checks

The package requires Node `>=20.20.2` and pins pnpm and the test toolchain.
Health checks require the tracked `.codex/config.toml`, validate its TOML syntax
and documented field types, and check nested instruction routes for existing
contained files. These are static checks, not proof of model availability,
account permissions, or client support. The TOML parser is a pinned development
dependency; parser errors never print configuration excerpts.

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
`instructions/index.md`, all of `instructions/local/`, living plans, and legacy
local records remain ignored and untracked. The five reusable instruction roots
remain tracked, including nested platform and framework guidance. A Git parent
checkout must not track `.ai` paths.
