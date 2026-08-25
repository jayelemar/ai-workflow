Version: 4.0
Last Updated: 2026-08-25

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
- Review, checkpoint, and delivery actions remain part of their owning stage;
  none silently invokes delivery or another workflow stage.

## Anti-Patterns

- Creating a spec during intake.
- Treating `saved` or `finalized` as execution authorization.
- Introducing runner selection, persisted transition state, event history,
  sidecars, or a pre-execution approval gate.
