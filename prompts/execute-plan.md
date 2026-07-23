# Execute Plan (Runner-Finalized)

Implement the approved plan from the runner-provided Active Context Packet.
The runner-issued stage descriptor is the only authority for this stage's
event version, event path, and source state.

## Read Scope

Read the context snapshot first, then only the linked spec, the plan sections,
and the latest event artifacts needed for the current work. Do not read or
search workflow history broadly.

Work only in plan-owned implementation scope. Preserve unrelated working-tree
changes. In task-savepoint mode, implement and validate only the injected
current task plus the smallest directly required compatibility repair.

## Routing Boundary (MANDATORY)

Do not edit the plan manifest, `## Workflow State`, `## Phases`, task IDs,
task boundaries, `workflow.json`, `files.json`, `file-ownership.json`, the
context snapshot, or any workflow history/blocker section. Do not create an
inline history or blocker section. The runner owns all routing, state,
history, blocker, and task-progress persistence.

You may edit implementation files and run focused validation. At the end,
write only the exact event artifact assigned in the runner-issued descriptor.

Do not run `git add`, `git restore --staged`, `git reset`, or otherwise modify
the Git index. Leave every implementation change unstaged: the workflow-runner
owns staging and performs it only for the review boundary.

It must contain exactly this compact structure:

```md
# Execution v<reserved-version>

## Outcome

<review-ready | active | blocked>

## Summary

<concise result>

## Evidence

* <commands, results, changed-file summary, or exact evidence pointers>

## Remediation

* <required next action when blocked; omit this section otherwise>
```

Choose `review-ready` only when the current implementation scope and required
local validation are complete. Choose `active` when planned implementation
work remains. Choose `blocked` only for a true external or missing-input
blocker; include exact remediation. Do not infer a state transition from a
terminal response: the runner validates the event and finalizes it.

If the current task cannot become `review-ready` because it needs an
undeclared prerequisite outside its injected `Files` boundary (for example a
forward-only migration, database contract, generated type, or independently
deployed compatibility change), do **not** output `STOP`. Write the assigned
event with outcome `blocked`, state the exact missing prerequisite in
`## Summary`, and put the separate prerequisite plan or implementation action
in `## Remediation`. This preserves the task boundary while allowing the
runner to persist a resumable blocked handoff instead of reporting a generic
workflow failure.

If the latest unblock event says that a previously external prerequisite is
complete and the current task's scoped code calls that completed contract,
treat it as a satisfied dependency. Cite the unblock event in `## Evidence`;
do not block again merely because the prerequisite's files remain outside the
current task boundary.

If a required broad validation command fails only in paths outside the current
task boundary and its errors do not reference current-task code, do not expand
scope to repair unrelated code or block this task solely for that baseline
failure. Run the narrowest applicable focused build, typecheck, and tests;
record the broad failure as deferred validation evidence. Block only when the
failure implicates the current task or no focused validation can cover it.

## Output

Report the implementation and validation performed, then name the assigned
event artifact. Do not report that you updated workflow state or history.
