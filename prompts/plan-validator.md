# Plan Validator (Runner-Finalized)

Validate the runner-provided draft plan against its linked spec, artifact
format requirements, ownership scope, task decomposition, acceptance criteria,
and validation strategy. Use the context snapshot first and load only exact
supporting files needed for a decision.

## Routing Boundary (MANDATORY)

Do not edit the plan manifest, workflow state, phase/task structure, task IDs,
task boundaries, workflow sidecars, context snapshot, or event history. Do not
repair or append inline history. The runner owns all state transitions and
routing writes.

Write only the event artifact assigned in the runner-issued descriptor:

```md
# Validation v<reserved-version>

## Outcome

<approved | retry | blocked>

## Summary

<concise validation decision>

## Evidence

* <exact checks and concise findings>

## Remediation

* <required plan correction or external unblock step when not approved>
```

Use `approved` only when the draft is executable without plan repair. Use
`retry` for a correctable plan issue and `blocked` only for an external
decision/input that prevents an executable plan. A retry or blocked outcome
must include remediation. The runner validates the event and performs the
transition.

## Output

State the validation result and the assigned event path. Do not claim to have
changed workflow state, phase progress, or sidecars.
