# Workflow Wrappers

Wrappers provide compact inputs for the explicit workflow:

1. `select-workflow.md` — read-only LOW/MEDIUM/HIGH classification.
2. `generate-*-spec.md` — MEDIUM/HIGH spec stage in the intake conversation.
3. `create-plan.md` — LOW compact plan or MEDIUM/HIGH plan in Plan mode.
4. `execute-plan.md` — explicit `execute <plan-file>` for LOW or MEDIUM.
5. `resume-goal.md` and `goal-checkpoint.md` — HIGH-GOAL continuity.

There is no wrapper for approval, preview, handoff, or progress updates.
MEDIUM review is automatic after implementation; HIGH task review happens
inside `/goal` before each task commit.
