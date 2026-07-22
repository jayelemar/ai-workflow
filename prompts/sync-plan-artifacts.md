# Sync Plan Artifacts (Runner-Finalized)

Inspect the draft plan, linked spec, and required planning artifacts for
consistency. Do not implement application code or broaden into implementation.
Use the Active Context Packet and context snapshot first.

## Routing Boundary (MANDATORY)

Do not edit the plan manifest, workflow state, workflow sidecars, context
snapshot, phases, task IDs, task boundaries, or event history. The runner
owns all routing writes and creates the canonical state artifacts. Do not
create or repair runner state as part of this stage.

Write only the event artifact assigned in the runner-issued descriptor:

```md
# Sync v<reserved-version>

## Outcome

<ready | retry>

## Summary

<concise artifact consistency result>

## Evidence

* <exact checked artifacts and concise result>

## Remediation

* <required correction when retry is used>
```

Use `ready` only when the existing artifact package is ready for validation.
Use `retry` for a concrete planning-artifact defect and include remediation.
The runner validates the event and performs any state transition.

## Output

Report the result and assigned event path. Do not claim routing or artifact
state updates.
