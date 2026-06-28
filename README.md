# `.ai` Nested Repository

This directory is a standalone Git repository for reusable AI workflow source files.

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

The parent repository continues to ignore `.ai/`, so this nested repository can be versioned independently without changing the main repository's tracking behavior.

Shared behavioral rules live in `.ai/AGENTS.md`. Keep `.codex/AGENTS.md` as the project entrypoint that bootstraps the shared file and adds only minimal local overrides when needed.

Remote setup is intentionally out of scope for this local initialization. Add a remote later from inside `.ai` when the target GitHub repository is ready.

## Use In Another Repo

From the target repository root:

1. Add this workflow repository as `.ai/`.

```bash
git clone <your-ai-workflow-repo-url> .ai
```

2. Keep `.ai/` ignored by the parent repository unless you intentionally want
   to allowlist specific shared files.

3. Add the Codex bootstrap file:

```text
.codex/AGENTS.md
```

```md
@../.ai/AGENTS.md

# Local Project Rules

- Use `.ai/instructions/index.md` as the repository instruction routing entrypoint.
- Keep project-specific instruction routing and architecture guidance in `.ai/instructions/`.
- Treat `.ai/AGENTS.md` as the shared behavior source for projects using this workflow starter kit.
```

4. Make sure the target repository can run the runner:

- Node `>=20`
- `pnpm`
- `tsx` available from the repo root, usually as a dev dependency

Example:

```bash
pnpm add -D tsx prettier
```

5. Add your local project instruction routing:

- `.ai/instructions/index.md`
- `.ai/instructions/architecture.md` when needed
- other project-specific `.ai/instructions/*.md` files for code ownership and architecture

## Workflow Runner

Run the workflow runner from the parent repository root:

```bash
pnpm exec tsx .ai/scripts/workflow-runner.ts .ai/plans/<plan-name>.md
```

Example:

```bash
pnpm exec tsx .ai/scripts/workflow-runner.ts .ai/plans/add-billing-retries.md
```

Use quiet terminal output when the workflow is noisy:

```bash
pnpm exec tsx .ai/scripts/workflow-runner.ts --compact .ai/plans/<plan-name>.md
```

The runner expects:

- the plan file to live at `.ai/plans/<plan-name>.md`
- execution from the repository root, not from inside `.ai/`
- a repository-local `package.json` environment where `pnpm exec tsx ...` works

Typical workflow:

1. Create a spec in `.ai/specs/` for ordinary feature or bug work, or use
   another repo-relative `*.spec.md` path when a workflow companion spec fits
   better.
2. Create a plan in `.ai/plans/`.
3. Choose one post-plan path:
   - Default: run the workflow runner.
   - Manual preview path: invoke `preview-before-apply` directly on the plan.
4. Let the plan status and next action drive the next stage.

Manual preview path:

```text
Use '.ai/prompts/preview-before-apply.prompt.md'

Plan:
.ai/plans/<plan-name>.md
```

Rules:

- `draft` plans self-run the `plan-validator` / `fix-plan` loop until they are
  ready for execution or STOP on a real blocker.
- `approved` and `active` plans enter execution immediately.
- The non-test diff approval gate begins only when execution is about to write
  a non-test file.

The runner writes a hot-path context snapshot for each plan:

```text
.ai/artifacts/<plan-name>/state/context.md
```

Prompts should use that snapshot as the primary current-state source. The full plan remains the source of truth for exact history and edits.
Snapshot sections are intentionally compact and stage-aligned: expect `## Summary`, `## Key Details`, `## Validation`, `## Review`, and `## Latest Review Remediation Context` rather than broad historical plan reads during normal workflow runs.

Workflow plans use `thin-plan-v1`. Versioned workflow history entries stay short and point to event artifacts:

```text
.ai/artifacts/<plan-name>/events/<kind>-v<N>.md
```

Supported event kinds are `execution`, `validation`, `review`, `unblock`, `reopen`, and `deployment-validation`.

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

When the runner warns that a plan is too large, move bulky workflow detail into event artifacts and keep only bounded summaries plus exact `Evidence:` paths in the plan.
Non-review workflow stages share one terminal-facing output contract: `**Plan**`, `**Summary**`, `**Key Details**`, optional `**Validation**`, and `**Next**`. `review-changes` remains the only specialized output shape.

## Next Workflow Optimization

Current priority:
- Token pathology reduction in `workflow-runner.ts`.

Prioritize these before runner module splitting:
- Improve token-warning diagnostics. If the plan is small but stage input tokens are huge, identify likely stage/context/tool-output growth instead of only telling users to move plan detail into event artifacts.
- Add per-turn token usage visibility when Codex exposes it, so one oversized turn can be found without treating the whole stage as one opaque number.
- Hard-cap captured command stdout/stderr in workflow summaries. Keep concise terminal summaries in runner output and write full logs to artifacts only when needed.
- Keep active prompts strict about context loading: use `.ai/artifacts/<plan-name>/state/context.md` first, open event artifacts only for needed evidence, and avoid broad `.ai/artifacts/**` reads.
- Split long execute/review stages earlier when cached input grows excessively, even when the plan is already thin.

Secondary priority:
- Runner module split: move snapshot generation, artifact validation, token-warning logic, and CLI parsing into focused modules so `workflow-runner.ts` stays easier to test and review.

Manual cleanup:
- After a feature plan is completed and verified, delete its `.ai/artifacts/<plan-name>/` folder manually.
- Do not add runner automation for deleting or managing completed artifact folders.
