# Select Workflow

Classify a requested change before creating a spec, plan, artifact, or code
change. This is an analysis-only operator gate.

## Strict Constraints

- Do not create, modify, or delete files.
- Do not create a spec, plan, artifact, runner state, or `/goal`.
- Do not invoke the workflow runner or begin implementation.
- You may inspect the request and repository read-only evidence needed to
  classify the scope.

## Fixed Taxonomy

| Classification | Path | Exact next action |
| --- | --- | --- |
| `LOW` | Simple session-local `/plan` | Start `/plan` in this session; create no durable workflow artifacts. |
| `MEDIUM` | Spec + manual plan | Create a spec, then use `create-plan` with `Execution mode: manual`. |
| `HIGH-GOAL` | Codex `/goal` path | Start `/goal` with the approved objective and a stable kebab-case goal name. |
| `HIGH-RUNNER` | Runner-managed path | Create a spec, use `create-plan` with `Execution mode: runner-managed`, complete review and approval, then invoke the runner. |

Classify as `LOW` only when the work is narrow, well understood, and safe to
keep session-local. Classify as `MEDIUM` when it needs durable behavior and
execution intent but not runner-managed lifecycle control. Classify as HIGH
when the work is long, exploratory, high-risk, cross-system, or benefits from
durable control.

For HIGH work, the operator must explicitly choose `HIGH-GOAL` or
`HIGH-RUNNER`. Explain the tradeoff, but do not choose or override it:

- `HIGH-GOAL` is for long or exploratory Codex work that benefits from `/goal`;
  its portable companion is `goal-handoff.md`.
- `HIGH-RUNNER` is for the existing durable state-machine lifecycle with plan,
  context snapshot, events, review, and validation artifacts.

If the request is HIGH and the operator has not selected one of those paths,
STOP and ask: `For this HIGH work, choose HIGH-GOAL or HIGH-RUNNER.`

## Required Output

Return exactly these four lines:

```text
Classification: LOW | MEDIUM | HIGH-GOAL | HIGH-RUNNER
Selected path: <path from the fixed taxonomy>
Reason: <concise evidence-based reason>
Next action: <the exact next action from the fixed taxonomy>
```

## Input

Target:
<requested work>

For HIGH work, operator selection:
`HIGH-GOAL` or `HIGH-RUNNER`
