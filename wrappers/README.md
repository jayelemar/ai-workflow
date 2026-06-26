# AI Workflow Wrappers

These files are reusable operator templates for calling the core workflow prompts.

Core prompts in `.ai/prompts/` define workflow behavior. Wrappers define the text to paste when starting a spec or plan task.

## Recommended Flow

1. Create a spec:
   - Feature: use `.ai/wrappers/generate-feature-spec.md`
   - Bugfix: use `.ai/wrappers/generate-bugfix-spec.md`
2. Create a plan:
   - Use `.ai/wrappers/create-plan.md`
3. Run the workflow runner:

```bash
pnpm exec tsx .ai/scripts/workflow-runner.ts .ai/plans/<plan-name>.md
```

Repeated review-remediation loops use the runner snapshot at `.ai/artifacts/<plan-name>/state/context.md` as the hot-path context. In particular, follow-up `execute-plan` runs should consume the snapshot's latest unresolved review findings first, while the live plan remains the source of truth for exact edits and history.
That snapshot is intentionally compact: prefer its `## Summary`, `## Key Details`, `## Validation`, `## Review`, and `## Latest Review Remediation Context` sections before opening the full plan or event artifacts.

Optional quiet mode:

```bash
pnpm exec tsx .ai/scripts/workflow-runner.ts --compact .ai/plans/<plan-name>.md
```

## Rules

- Keep desired behavior explicit.
- Use codebase inspection only for current observed behavior and implementation facts.
- Do not write "based on context" for goals, expected behavior, or known decisions.
- If a behavior decision is unknown, write `Unknown; ask me`.
- Exclude `.ai/artifacts` from broad searches unless reading the active snapshot, event evidence, or runner logs for the current plan.
- Non-review workflow stages should emit the shared terminal contract: `**Plan**`, `**Summary**`, `**Key Details**`, optional `**Validation**`, and `**Next**`.
