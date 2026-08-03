# Workflow Wrappers

Wrappers provide compact inputs for the explicit workflow:

1. `feature-intake.md` and `bug-intake-rca.md` — read-only intake plus the
   universal LOW/MEDIUM/HIGH classification for features and bugs.
2. `select-workflow.md` — the same read-only classification for other work.
3. `generate-*-spec.md` — MEDIUM/HIGH spec stage in the intake conversation.
4. `create-plan.md` — LOW compact plan or MEDIUM/HIGH plan in Plan mode; HIGH
   also creates its initial goal handoff.
5. `execute-plan.md` — explicit `execute <plan-file>` for LOW or MEDIUM.
6. `resume-goal.md` and `goal-checkpoint.md` — HIGH-GOAL continuity.

There is no wrapper for approval, preview, user-supplied handoff, or persisted
progress updates. HIGH planning creates its required initial handoff as a
portable checkpoint; `/goal` remains the execution gate. MEDIUM review is
automatic after implementation; HIGH task review happens inside `/goal` before
each task commit. HIGH planning records required subagent delegation per task;
execution blocks when required evidence is missing. During required
delegation, the root agent emits ephemeral terminal milestones under the HIGH
task protocol; those messages are not a workflow artifact or a stage gate.
