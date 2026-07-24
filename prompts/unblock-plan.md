# Unblock Plan (Runner-Finalized)

Analyze only the current execution blockers and the runner-provided unblock
evidence. Use the context snapshot and latest relevant event first; do not
inspect broad workflow history.

This is a workflow decision stage, not a database implementation stage. Do not
load provider or database implementation skills solely because the blocker
mentions them; use the routed workflow guidance and the supplied evidence.

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

Before classifying an alleged out-of-scope prerequisite as still blocked,
re-read the current task's `Files` line in the current plan. If the plan now
explicitly owns every remediation path (for example a newly declared
forward-only migration and its regression), treat the prerequisite as in
scope and record `active`; do not rely on a stale context snapshot or an
earlier review's ownership wording.

## Validation-timeout recovery (MANDATORY)

When the sole blocker is that a declared focused validation command reached an
undersized timeout without reporting a test result, do not leave the workflow
blocked merely because earlier evidence is unavailable to this stage. Re-run
that exact declared command once from this unblock stage with a bounded timeout
of at least ten minutes (unless the plan specifies a longer limit). Record its
full result in the assigned unblock event. If it passes, use `active` so the
next execution stage can finalize the task; if it reports a concrete failure,
use `active` with that failure as the next execution repair target; use
`blocked` only when the re-run again cannot produce a result and process
evidence establishes an external environment issue.

## Output

Report the decision and event path without claiming any routing-document edit.
