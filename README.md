# `.ai` Nested Repository

This directory is a standalone Git repository for reusable AI workflow source files.

Tracked directories:
- `prompts/`
- `scripts/`
- `templates/`
- `wrappers/`

Local-only directories that are intentionally excluded:
- `artifacts/`
- `changelogs/`
- `instructions/`
- `plans/`
- `specs/`

The parent repository continues to ignore `.ai/`, so this nested repository can be versioned independently without changing the main repository's tracking behavior.

Remote setup is intentionally out of scope for this local initialization. Add a remote later from inside `.ai` when the target GitHub repository is ready.

## Workflow Runner

Run plans from the parent repository root:

```bash
pnpm exec tsx .ai/scripts/workflow-runner.ts .ai/plans/<plan-name>.md
```

Use quiet terminal output when the workflow is noisy:

```bash
pnpm exec tsx .ai/scripts/workflow-runner.ts --compact .ai/plans/<plan-name>.md
```

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
