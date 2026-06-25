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

## Next Workflow Optimization

Next-tier follow-ups:
- Token ledger rollups: keep latest run detail, summarize older token history, and prevent obsolete high-token runs from dominating current workflow context.
- Runner module split: move snapshot generation, artifact validation, token-warning logic, and CLI parsing into focused modules so `workflow-runner.ts` stays easier to test and review.
- Artifact lifecycle cleanup command: refresh the snapshot, verify plan size/token warnings, and report the current artifact footprint.
