# Review Changes (Runner-Finalized)

Review only the runner-staged, plan-owned diff boundary and the linked spec.
Use the generated review scope and context snapshot first.

- You must not spawn subagents.
- Do not broaden to unrelated changes or alter staging.
- Do not commit, amend, merge, rebase, reset, switch, checkout, cherry-pick,
  or otherwise move `HEAD`. The runner owns commits; review remains read-only
  except for the assigned event artifact.

## Instruction Loading

Read the runner-provided context first, then load only the review guidance that
applies to the staged scope:

- `.ai/instructions/shared/reasoning-quality.md`
- `.ai/instructions/shared/debugging.md`
- `.ai/instructions/shared/testing.md`
- `.ai/instructions/testing.md`
- `.ai/instructions/shared/flow-trace-artifacts.md` when the plan requires it

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

`active` is a normal nonterminal review result, not a blocked workflow. When
the review needs fixes, write `NEEDS FIX` in `## Summary` and return the event
path; do not emit a `STOP` directive in the final response. Reserve `STOP` for
an actual inability to write or validate the required event artifact.

## Output

Give a concise review conclusion and the assigned event path. Do not claim to
have updated workflow state, review history, or blockers.
