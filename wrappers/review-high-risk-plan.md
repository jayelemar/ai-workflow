# High-Risk Plan Review Wrapper

Use this only after a `runner-managed` plan has been created for high-risk,
cross-system, contract, security, or meaningful data-risk work. Run it in a
fresh Plan Mode or analysis-only session.

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

If findings are material, return to an agent session and repair only the spec
and planning artifacts. Repeat this review after a material repair. The
operator then reviews the finalized spec and plan and replies
`APPROVE IMPLEMENTATION` before running the workflow runner.
