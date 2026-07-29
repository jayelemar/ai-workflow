Version: 2.0
Last Updated: 2026-07-29

# Workflow Stage Instructions

## Authority

The explicit user invocation controls each stage. Saved specs, plans, current
Git state, validation evidence, and the required MEDIUM review artifact are
the only durable workflow context. No workflow manager, event journal, sidecar,
or state schema is a transition authority.

## Stage Matrix

| Class | Required saved inputs | Authorized execution | Completion evidence |
| --- | --- | --- | --- |
| LOW | compact plan | `execute <plan-file>` | scoped validation and self-check |
| MEDIUM | spec and plan | `execute <plan-file>` | validation and `review.md` |
| HIGH | spec and plan | `/goal <description> <plan-file>` | per-task validation, actual-diff review, and commits |

## Rules

- The classifier is read-only and must stop for unresolved uncertainty.
- Saving an artifact does not execute it. Only the next explicit invocation
  authorizes that stage.
- MEDIUM resumes from its saved spec, plan, review artifact, and Git state.
- A material discovery pauses work and returns to the correct planning stage;
  classification can only escalate until the original risk is resolved.
- `Ready to complete`, `Fix required`, and `Blocked` are the only MEDIUM
  review statuses. A fix reruns validation and review; a blocker records the
  exact required next action.

## Anti-Patterns

- Treating conversation output as a substitute for saved stage artifacts.
- Creating state files, event histories, sidecars, or handoffs to route LOW or
  MEDIUM work.
- Starting implementation from a plan before its explicit execution command.
