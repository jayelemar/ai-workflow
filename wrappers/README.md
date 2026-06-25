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

Repeated review-remediation loops use the runner snapshot at `.ai/state/workflow-runner/<plan-name>.context.md` as the hot-path context. In particular, follow-up `execute-plan` runs should consume the snapshot's latest unresolved review findings first, while the live plan remains the source of truth for exact edits and history.

Optional quiet mode:

```bash
pnpm exec tsx .ai/scripts/workflow-runner.ts --compact .ai/plans/<plan-name>.md
```

## Rules

- Keep desired behavior explicit.
- Use codebase inspection only for current observed behavior and implementation facts.
- Do not write "based on context" for goals, expected behavior, or known decisions.
- If a behavior decision is unknown, write `Unknown; ask me`.
- Exclude `.ai/logs` from searches unless debugging historical runner output.
