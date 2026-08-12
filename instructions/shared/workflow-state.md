Version: 3.0
Last Updated: 2026-08-13

# Workflow Stage Instructions

## Authority

The explicit user invocation controls each stage. Finalized specs, saved plans,
flow artifacts, Git state, validation evidence, and review/checkpoint artifacts
provide durable context only; none authorizes a transition by itself. There is
no workflow runner, transition state, event journal, or sidecar authority.

## Stage Matrix

| Class    | Read-only intake result                | Next explicitly invoked stage                                           | Planning                                                       | Explicit execution                |
| -------- | -------------------------------------- | ----------------------------------------------------------------------- | -------------------------------------------------------------- | --------------------------------- |
| `LOW`    | classification and repository evidence | explicitly invoke plan creation in Plan mode                            | save a compact `.ai/plans/<plan-name>.md` reference            | `execute <plan-file>`             |
| `MEDIUM` | classification and missing decisions   | invoke the spec prompt and finalize `feature-spec@1` or `bugfix-spec@1` | Plan mode saves `plan-manifest@2`                              | `execute <plan-file>`             |
| `HIGH`   | classification and missing decisions   | invoke the spec prompt and finalize `feature-spec@1` or `bugfix-spec@1` | Plan mode saves `plan-manifest@2` and the initial goal handoff | `/goal <description> <plan-file>` |

When the finalized MEDIUM/HIGH spec requires end-to-end tracing, explicitly
invoke the flow-artifact prompt before Plan mode. That single stage saves both
`user-journey@1` and `implementation-map@1`.

## Rules

- Intake is read-only and stops for unresolved classification or behavior
  decisions. It must not save the next artifact in the same invocation.
- LOW cannot execute from a conversational plan. Plan mode must save the plan
  file named by the later `execute <plan-file>` invocation.
- A saved or finalized artifact never starts the next stage. The user must
  explicitly invoke the spec, flow-artifact, planning, or execution stage.
- A material discovery returns work to the appropriate explicit stage.
  Classification escalates when newly established risk requires it.
- `Ready to complete`, `Fix required`, and `Blocked` are the only MEDIUM review
  statuses. An in-scope fix reruns required validation and review.
- HIGH execution reads each saved task and delegation decision before work.
  Required delegation, validation, actual-diff review, and one task-scoped
  commit remain mandatory under the HIGH commit protocol.
- HIGH planning creates `.ai/artifacts/<plan-name>/goal-handoff.md` as portable
  context. It does not authorize implementation or replace `/goal`.

## Anti-Patterns

- Creating a spec during read-only intake.
- Treating `saved`, `finalized`, or conversational agreement as execution
  authorization.
- Introducing runner selection, persisted transition state, event history,
  sidecars, or a pre-execution approval gate.
