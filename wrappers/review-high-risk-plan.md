# High-Risk Plan Review Wrapper

This review is mandatory after every `runner-managed` plan is created and
before its workflow runner starts. Also use it for a `manual` plan when the
work is high-risk, cross-system, contract, security, or meaningful data-risk.
Run it in a fresh Plan Mode or analysis-only session.

```text
Independent plan review only. Do not edit files or run a workflow.

Review:
- Spec: `.ai/specs/<slug>.spec.md`
- Plan: `.ai/plans/<slug>.md`

Check for missing or incorrect behavior, assumptions outside the spec,
permissions/security concerns, API or data-contract gaps, migration and
rollback risks, user-flow coverage, savepoint independence, and test gaps.

Return findings only. Return `OKAY` only when no material finding exists.
```

If findings are material, return to an Agent Mode session and repair only the
spec and planning artifacts. Repeat this review in a fresh Plan Mode or
analysis-only session after every material repair.

Do not run a `runner-managed` plan until the latest independent review returns
`OKAY`, then the operator reviews the finalized spec and plan and replies
`APPROVE IMPLEMENTATION`.
