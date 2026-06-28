# `.ai` Nested Repository

This directory is a standalone Git repository for reusable AI workflow source
files.

Tracked workflow source:

- `AGENTS.md`
- `prompts/`
- `scripts/`
- `templates/`
- `wrappers/`
- `instructions/shared/security.md`
- `instructions/shared/testing.md`
- `instructions/shared/workflow-state.md`
- `changelogs/security.changelog.md`
- `changelogs/testing.changelog.md`
- `changelogs/workflow-state.changelog.md`

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
pnpm exec tsx .ai/scripts/workflow-runner.ts --help
```

If `pnpm exec tsx ...` resolves and the runner entry responds, the workflow is
installed correctly.

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
- plan: the execution contract
- prompt: the stage-specific workflow controller
- runner: the post-plan state-machine driver
- snapshot: the compact current-state handoff file for follow-up stages

Default locations:

- ordinary feature and bug specs: `.ai/specs/<name>.spec.md`
- plans: `.ai/plans/<name>.md`
- prompts: `.ai/prompts/*.md`
- runner: `.ai/scripts/workflow-runner.ts`

Plan `## Spec` entries may also point to any repo-relative `*.spec.md` path
when a workflow companion spec belongs elsewhere, such as
`.ai/scripts/workflow-runner.spec.md`.

## Standard Workflow

Normal end-to-end flow:

1. Create a spec.
2. Create a plan.
3. Choose a post-plan path.
4. Let plan `Status` and `Next Action` drive every later stage.

### Create A Spec

Use the wrapper that matches the work:

- feature: `.ai/wrappers/generate-feature-spec.md`
- bugfix: `.ai/wrappers/generate-bugfix-spec.md`

Ordinary specs should live in `.ai/specs/`. If a workflow companion spec needs
to live elsewhere, keep the plan `## Spec` entry repo-relative.

### Create A Plan

Use:

```text
.ai/wrappers/create-plan.md
```

The generated plan should live at:

```text
.ai/plans/<plan-name>.md
```

### Choose A Post-Plan Path

You have two options:

- default runner path
- manual `preview-before-apply` path

## Workflow Runner

Default post-plan path:

```bash
pnpm exec tsx .ai/scripts/workflow-runner.ts .ai/plans/<plan-name>.md
```

Example:

```bash
pnpm exec tsx .ai/scripts/workflow-runner.ts .ai/plans/add-billing-retries.md
```

Quiet terminal mode:

```bash
pnpm exec tsx .ai/scripts/workflow-runner.ts --compact .ai/plans/<plan-name>.md
```

Runner expectations:

- the plan path must be exactly `.ai/plans/<plan-name>.md`
- run from the parent repository root
- `pnpm exec tsx ...` must resolve in the parent repository environment

### How The Runner Works

The runner reads the plan state machine and selects the next prompt from the
plan `Status` and `Next Action`.

Common stages:

- `draft + plan-validator`
- `draft + fix-plan`
- `approved + execute-plan`
- `active + execute-plan`
- `review + review-plan`
- `blocked + unblock-plan`
- `reopening + reopen-plan`
- `completed + commit-summary`

Default stage routing:

| Stage | Model | Reasoning |
| --- | --- | --- |
| `plan-validator` | `gpt-5.4` | `high` |
| `fix-plan` | `gpt-5.4` | `medium` |
| `execute-plan` | `gpt-5.5` | `high` |
| `unblock-plan` | `gpt-5.4` | `medium` |
| `review-changes` | `gpt-5.5` | `xhigh` |
| `reopen-plan` | `gpt-5.4` | `medium` |
| `commit-summary` | `gpt-5.3-codex-spark` | `medium` |
| `scope-cleanup` | `gpt-5.5` | `xhigh` |

Notes:

- `review-changes` remains the main correctness gate, so it keeps the
  highest-quality model and reasoning tier.
- `commit-summary` uses `gpt-5.3-codex-spark` because it is the cheapest
  low-risk stage: formatting the final commit subject and user-facing summary,
  not validating implementation correctness.
- `scope-cleanup` is not a visible workflow state, but the runner uses it
  before review and commit-summary cleanup decisions, so it has its own routing.

The runner writes a hot-path context snapshot for each plan:

```text
.ai/artifacts/<plan-name>/state/context.md
```

Prompts should use that snapshot as the primary current-state source. The full
plan remains the source of truth for exact history and edits.

Snapshot sections are intentionally compact and stage-aligned. Expect:

- `## Summary`
- `## Key Details`
- `## Validation`
- `## Review`
- `## Latest Review Remediation Context`

Workflow plans use `thin-plan-v1`. Versioned workflow history entries stay
short and point to event artifacts:

```text
.ai/artifacts/<plan-name>/events/<kind>-v<N>.md
```

Supported event kinds:

- `execution`
- `validation`
- `review`
- `unblock`
- `reopen`
- `deployment-validation`

Each event artifact must include:

```markdown
# <Event> v<N>

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

When the runner warns that a plan is too large, move bulky workflow detail into
event artifacts and keep only bounded summaries plus exact `Evidence:` paths in
the plan.

Non-review workflow stages share one terminal-facing output contract:

- `**Plan**`
- `**Summary**`
- `**Key Details**`
- optional `**Validation**`
- `**Next**`

`review-changes` remains the only specialized output shape.

## Preview Before Apply

Use this when you want exact non-test execution diffs previewed before they are
written.

Invoke it explicitly:

```text
Use '.ai/prompts/preview-before-apply.prompt.md'

Plan:
.ai/plans/<plan-name>.md
```

Behavior:

- `draft` plans run the same `plan-validator` / `fix-plan` preflight loop that
  the runner uses
- `approved` plans transition into `active + execute-plan` in the same
  invocation
- `active` plans resume the current execution step
- the approval gate starts only when execution is about to write a non-test
  file
- test-only writes may proceed without the non-test approval gate
- plan/spec repairs allowed during `draft` preflight do not require diff
  approval

Use it when:

- you want exact execution diffs before apply
- you want manual approval per execution step
- you still want runner-compatible execution and validation artifacts

Avoid it when:

- you just want the default automated workflow loop
- you do not need manual approval before non-test execution writes

## Day-To-Day Commands

Common commands from the parent repository root:

```bash
# Run the default workflow path
pnpm exec tsx .ai/scripts/workflow-runner.ts .ai/plans/<plan-name>.md

# Run the default workflow path with compact terminal output
pnpm exec tsx .ai/scripts/workflow-runner.ts --compact .ai/plans/<plan-name>.md

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

If `preview-before-apply` behaves unexpectedly:

- confirm the prompt was invoked explicitly with
  `Use '.ai/prompts/preview-before-apply.prompt.md'`
- confirm the plan is in `draft`, `approved`, or `active`
- confirm the plan `## Spec` section points to valid repo-relative
  `*.spec.md` files

If follow-up stages lose context:

- inspect `.ai/artifacts/<plan-name>/state/context.md`
- inspect the latest event artifacts under `.ai/artifacts/<plan-name>/events/`
- avoid broad `.ai/artifacts/**` reads unless you are debugging the current
  plan

## Next Workflow Optimization

Current priority:

- token pathology reduction in `workflow-runner.ts`

Prioritize these before runner module splitting:

- improve token-warning diagnostics. If the plan is small but stage input
  tokens are huge, identify likely stage/context/tool-output growth instead of
  only telling users to move plan detail into event artifacts
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

Secondary priority:

- runner module split: move snapshot generation, artifact validation,
  token-warning logic, and CLI parsing into focused modules so
  `workflow-runner.ts` stays easier to test and review

Manual cleanup:

- after a feature plan is completed and verified, delete its
  `.ai/artifacts/<plan-name>/` folder manually
- do not add runner automation for deleting or managing completed artifact
  folders
