# Review Changes (Runner-Finalized)

Review only the runner-staged, plan-owned diff boundary and the linked spec.
Use the generated review scope and context snapshot first. Do not spawn
subagents, do not broaden to unrelated changes, and do not alter staging.

## Routing Boundary (MANDATORY)

Do not edit the plan manifest, workflow state, workflow sidecars, context
snapshot, task IDs, task boundaries, phases, or any inline review/history/
blocker section. Review findings and remediation belong only in the assigned
event artifact. The runner alone writes state, latest records, history, and
blockers.

Write only the event artifact assigned in the runner-issued descriptor:

```md
# Review v<reserved-version>

## Outcome

<completed | active>

## Summary

<SAFE, SAFE - DEFERRED VALIDATION, NEEDS FIX, or HIGH RISK>

## Evidence

* <path-scoped commands and concise proof>

## Remediation

* <each required fix, missing validation, unresolved risk, and owner-facing next action when outcome is active>
```

Use `completed` only when no required code fix remains. Use `active` for every
required fix or unresolved review risk, and include one or more actionable
remediation bullets. Do not put findings in the plan or sidecar. The runner
uses this event to move the workflow and exposes failed-review remediation to
the next execution stage.

## Output

Give a concise review conclusion and the assigned event path. Do not claim to
have updated workflow state, review history, or blockers.
