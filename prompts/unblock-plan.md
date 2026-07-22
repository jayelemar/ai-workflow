# Unblock Plan (Runner-Finalized)

Analyze only the current execution blockers and the runner-provided unblock
evidence. Use the context snapshot and latest relevant event first; do not
inspect broad workflow history.

## Routing Boundary (MANDATORY)

Do not edit the plan manifest, workflow state, sidecars, context snapshot,
phases, task IDs, task boundaries, or inline history/blocker sections. The
runner owns all state and blocker persistence.

Write only the event artifact assigned in the runner-issued descriptor:

```md
# Unblock v<reserved-version>

## Outcome

<active | blocked>

## Summary

<concise unblock decision>

## Evidence

* <verified evidence>

## Remediation

* <remaining blocker or next execution action when applicable>
```

Use `active` only when execution can continue. Use `blocked` when a true
blocker remains and include exact remediation. The runner finalizes the state
from the event.

## Output

Report the decision and event path without claiming any routing-document edit.
