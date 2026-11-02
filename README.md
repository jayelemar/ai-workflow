# AI Repository Guidance

This nested `.ai` Git repository provides reusable Codex instructions, planning
and execution skills, independent utilities, and self-contained health checks.
[AGENTS.md](AGENTS.md) owns behavior and action boundaries.

## Setup

Only after explicitly requesting local setup, run from the containing Git
workspace:

```bash
rtk proxy corepack pnpm@10.34.4 --dir .ai setup:codex
```

Restart Codex from the trusted project root afterward. The utility preserves
root guidance, installs project-local routing, four skill links, and a config
snapshot. See [Codex Agent Setup](docs/codex-agent.md) for exact paths, conflict
handling, active routing, and native discovery verification. No global skills
or user configuration are installed.

## Workflow

| Work type          | Use when                                                                                                                                | Artifact        | Review                   |
| ------------------ | --------------------------------------------------------------------------------------------------------------------------------------- | --------------- | ------------------------ |
| Direct             | The outcome is bounded and understood                                                                                                   | None            | Self-review              |
| Standard planned   | Work is complex, ambiguous, cross-cutting, or lengthy                                                                                   | One living plan | Self-review              |
| Controlled planned | Authentication, authorization, payments, secrets, migrations, destructive behavior, or another named security or trust boundary changes | One living plan | Independent final review |

All paths inspect, implement, validate, and report. The canonical
[AI Build skill](.agents/skills/ai-build/SKILL.md) owns execution, required
evidence, and completion. Its [plan reference](.agents/skills/ai-build/references/plan-template.md)
owns plan creation; its [review checklist](.agents/skills/ai-build/references/review-checklist.md)
owns controlled review. No workflow state machine or companion status artifacts
are maintained. Skills do not automatically chain actions or grant delivery,
installation, or cleanup authority.

Useful invocations:

```text
Fix the duplicate receipt import. Preserve existing authorization and run the focused receipt tests.

$ai-build Save a plan for the requested change.

/goal Implement .ai/plans/example-change.md. Preserve its boundaries, keep the plan updated, run every required validation, and finish only when its definition of done is proven.

$ai-worktree-setup plan: .ai/plans/example-change.md

$ai-commit Prepare commits for these changes.

$ai-pr Base: AUTO
```

For controlled work, require independent final review in the Goal prompt.
Prepare worktrees after saving the plan and before starting its Goal; use the
preparation result's prompt with its explicit worktree paths. Finish or stop the
current Goal before starting another. Give each new outcome its own plan,
restate still-applicable decisions, and reference that new plan explicitly.

## Skills and Utilities

| Skill                                                          | Purpose                                               |
| -------------------------------------------------------------- | ----------------------------------------------------- |
| [AI Build](.agents/skills/ai-build/SKILL.md)                   | Plan, implement, validate, and review                 |
| [AI Worktree Setup](.agents/skills/ai-worktree-setup/SKILL.md) | Prepare native worktrees and independent task context |
| [AI Commit](.agents/skills/ai-commit/SKILL.md)                 | Organize and create authorized local commits          |
| [AI PR](.agents/skills/ai-pr/SKILL.md)                         | Preview a PR and publish after exact-preview approval |

Skills match ordinary requests and explicit `$skill-name` invocation. Local
setup, read-only skill discovery, instruction management, and selected worktree
cleanup remain [independent prompts](prompts/README.md).

## Instructions and Repository Boundary

The ignored `instructions/index.md` routes only relevant guidance by affected
code and capabilities, combining application types for mixed work. Portable
principles live in `instructions/shared/`; reusable application guidance lives
in `mobile/`, `desktop/`, `web/`, and `server/`, with framework guidance nested
under its application type. Project paths, commands, and ownership belong in
ignored `instructions/local/`, including `local/architecture.md` and
`local/desktop.md`. These are ordinary instructions, without skill metadata or
discovery links.

The nested `.gitignore` allowlists reusable source, including all five reusable
instruction roots. The router, local instructions, living plans, and legacy
records remain ignored and untracked. A Git parent must not track `.ai` paths.

## Cleanup

Ignored legacy records cannot authorize execution. Preserve them unless cleanup
is explicitly requested. Preview legacy cleanup from `.ai` with
`rtk proxy pnpm cleanup:local`; use `--apply` only with explicit deletion
authority. Its [implementation](scripts/maintenance/cleanup-local.mjs) owns
containment checks and excludes the entire `plans/` tree, including linked,
hidden, and nested entries.

For selected plans, use [Clean Plan Worktrees and Records](prompts/worktree-cleanup.md):

```text
Run `.ai/prompts/worktree-cleanup.md`.
plan: .ai/plans/<plan-name>.md
```

That utility owns inventory, exact confirmation, reinspection, and branch
retention. Deliberate `all-plans: true` includes active plans. With no selector,
it only inventories and shows examples.

## Checks

The independent package requires Node `>=20.20.2` and pins its toolchain. From
the containing workspace:

```bash
rtk proxy corepack pnpm@10.34.4 --dir .ai health
rtk proxy corepack pnpm@10.34.4 --dir .ai health:full
rtk proxy corepack pnpm@10.34.4 --dir .ai test:focused
```

Health can also run anywhere with
`rtk proxy node /absolute/path/to/.ai/scripts/maintenance/health-check.mjs`
(add `--full` for full checks). It validates tracked source, contained
instruction routes, and `.codex/config.toml` syntax and documented field types
using a pinned TOML parser; errors omit config excerpts. Static checks do not
prove model availability, account permission, or client support.
