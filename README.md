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
- `logs/`
- `plans/`
- `specs/`
- `state/`

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
.ai/state/workflow-runner/<plan-name>.context.md
```

Prompts should use that snapshot as the primary current-state source. The full plan remains the source of truth for exact history and edits.

For completed or near-completed old plans that have become too large, compact resolved history into an archive:

```bash
pnpm exec tsx .ai/scripts/workflow-runner.ts --compact-plan .ai/plans/<plan-name>.md
```

Plan compaction:
- preserves the first full history archive at `.ai/artifacts/plan-history/<plan-name>.history.md`
- rewrites the active plan with current state and latest relevant history only
- refreshes the context snapshot without carrying stale token-warning data forward
- does not launch Codex

Use plan compaction when the runner warns that a plan is over 100 KB, or when a completed/review/deployment-validation plan is dominated by old execution, validation, review, or reopen history.

## Next Workflow Optimization

Add a compaction recommendation guard to normal runner output.

When the runner detects a plan over 100 KB, it should print the exact follow-up command:

```bash
pnpm exec tsx .ai/scripts/workflow-runner.ts --compact-plan .ai/plans/<plan-name>.md
```

Expected behavior:
- report whether the current plan status is eligible for compaction
- eligible statuses: `active`, `review`, `deployment-validation`, and `completed`
- explain why compaction is unavailable for ineligible statuses
- keep normal workflow runs read-only with respect to compaction; do not mutate the plan unless `--compact-plan` is used explicitly

This keeps the recovery path visible when a workflow becomes pathological without adding automatic plan mutation to ordinary execution.

Next-tier follow-ups:
- Token ledger rollups: keep latest run detail, summarize older token history, and prevent obsolete high-token runs from dominating current workflow context.
- Runner module split: move snapshot generation, plan compaction, token-warning logic, and CLI parsing into focused modules so `workflow-runner.ts` stays easier to test and review.
- Plan lifecycle cleanup command: add one explicit command that compacts the plan, refreshes the snapshot, verifies plan size/token warnings, and reports the before/after context footprint.
