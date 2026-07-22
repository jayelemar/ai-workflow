# Reopen Plan (Runner-Finalized)

Analyze only the concrete post-completion findings supplied by the user or the
latest relevant event. This stage plans the remediation handoff; it does not
implement fixes, review changes, or create a commit summary.

## Routing Boundary (MANDATORY)

Do not edit the plan manifest, workflow state, phases, task IDs, task
boundaries, workflow sidecars, context snapshot, or any inline reopen/history
section. A reopen must not change the active plan's task boundaries. The
runner owns every state and history write.

Write only the event artifact assigned in the runner-issued descriptor:

```md
# Reopen v<reserved-version>

## Outcome

active

## Summary

<concise reopen decision>

## Evidence

* <exact findings and supporting evidence>

## Remediation

* <required fix>
* <required validation>
* <remaining risk>
```

`## Remediation` must contain the exact findings, required remediation,
validation, and risks needed by the next execution stage. If concrete findings
are absent, output `STOP`; do not create routing state as a fallback.

## Output

Report the reopen findings and assigned event path. Do not claim to have
changed workflow state, history, phases, or tasks.
