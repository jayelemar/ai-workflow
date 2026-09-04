Version: 4.3
Last Updated: 2026-08-28

# Workflow Stage Instructions

## Authority

Only an explicit user invocation starts a stage. Saved specs, plans, flow
artifacts, handoffs, Git state, validation evidence, and reviews are durable
context, not transition authority.

## Stage Sequence

| Class    | Intake                   | Specification                    | Planning                                                                         | Execution                                                |
| -------- | ------------------------ | -------------------------------- | -------------------------------------------------------------------------------- | -------------------------------------------------------- |
| `LOW`    | Read-only classification | N/A                              | Explicitly create and save a compact plan                                        | Explicitly `execute <plan-file>`                         |
| `MEDIUM` | Read-only classification | Explicitly finalize a typed spec | Explicitly create required flow artifacts and save a plan                        | Explicitly `execute <plan-file>`                         |
| `HIGH`   | Read-only classification | Explicitly finalize a typed spec | Explicitly create required flow artifacts, save a plan, and initialize a handoff | Explicitly invoke the handoff's two-line `/goal` command |

Planning may create a missing required flow-artifact pair in the same explicit
invocation. Direct flow-artifact generation is also available but does not
start planning.

## Transition Rules

- Intake never writes the next-stage artifact.
- LOW never executes from a conversational plan.
- Finalizing or saving an artifact never starts the next stage.
- A material execution discovery returns to a newly invoked specification or
  planning stage. A qualifying correction under the table in `.ai/AGENTS.md`
  remains inside the already authorized execution stage.
- Replanning does not itself change classification. Planning reapplies the
  deterministic classifier, archives the predecessor only after the successor
  is valid, and leaves exactly one active plan revision for that work item.
- Review, checkpoint, and delivery actions remain part of their owning stage;
  none silently invokes delivery or another workflow stage.
- An explicit manual review may remediate an already implemented plan-owned
  diff, but it never starts an untouched plan or expands execution scope.

## Actionable Stops

- Whenever a workflow stage stops for a blocker, missing input, or required
  stage transition, its final response must state the exact blocker and then
  immediately provide `Do this next:` followed by the exact user action.
- When the action invokes another stage or resumes the current one, provide a
  complete copy-pasteable invocation with every currently known required input
  filled in. When an operator decision or external action must happen first,
  name that exact decision or action and include the invocation to resume.
- A durable `Next Action` or `Required Next Action` field follows the same
  contract. Do not reduce it to generic prose such as `return to planning`,
  `resolve the blocker`, or a request for the user to ask what to do next.
- Providing the invocation does not start or authorize that stage. The user
  must still invoke it explicitly.

## Superseded Plan Resolution

Only a root-level `.ai/plans/<name>.md` file is active. When an invocation
references a missing former active plan, inspect
`.ai/artifacts/<name>/superseded-plan.md` and the lineage of root-level active
plans. Treat it as superseded only when exactly one active plan has the same
work-item name and lists that archive in its ordered history. Return
`Superseded plan: <former path> -> <active path>`, then `Do this next:` and the
active plan's exact `execute` invocation for LOW/MEDIUM or validated two-line
`/goal` invocation for HIGH. Do not start it.

Missing, malformed, cyclic, duplicate, or ambiguous lineage is a blocker. Name
the conflicting paths and require an explicit create-plan repair; never choose
by modification time, filename sorting, or conversation recency.

## Anti-Patterns

- Creating a spec during intake.
- Treating `saved` or `finalized` as execution authorization.
- Introducing runner selection, persisted transition state, event history,
  sidecars, or a pre-execution approval gate.
