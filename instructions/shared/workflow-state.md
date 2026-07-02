Version: 1.9
Last Updated: 2026-07-02

# Workflow State Instructions

## Purpose

Define the canonical plan workflow state machine: plan statuses, next actions, allowed transitions, and workflow loops.

## Applies To

- `.ai/templates/plan.template.md`
- `.ai/prompts/create-plan.md`
- `.ai/prompts/plan-validator.md`
- `.ai/prompts/fix-plan.md`
- `.ai/prompts/execute-plan.md`
- `.ai/prompts/unblock-plan.md`
- `.ai/prompts/review-changes.md`
- `.ai/prompts/fix-review.md`
- `.ai/prompts/reopen-plan.md`
- `.ai/prompts/commit-summary.md`
- `.ai/scripts/workflow-runner.ts`
- `.ai/scripts/workflow-runner.test.ts`
- `.ai/plans/*.md`

## Rules

Thin-plan-v2 state parity:

* The plan manifest `## Status` and `## Next Action` values and `.ai/artifacts/<plan-name>/state/workflow.json` `status` and `nextAction` values are one logical state.
* Any workflow prompt that updates either location MUST update both locations before final output.
* After every state transition, the prompt MUST reread both locations and verify the values match.
* If the values do not match, repair the mismatch before final output; if repair is not possible, STOP with the exact mismatch.
* Do not rely on the runner's post-run mismatch check as the first parity verification.

Allowed Status Values:

* draft
* approved
* active
* review
* reopening
* completed
* blocked

Allowed Next Action Values:

* plan-validator
* fix-plan
* execute-plan
* unblock-plan
* review-plan
* reopen-plan
* commit-summary

Allowed Status Transitions:

draft
→ draft
→ approved

approved
→ active

active
→ review

active
→ blocked

blocked
→ active

review
→ active

review
→ completed

completed
→ reopening

reopening
→ active

---

Status → Next Action Mapping

draft
→ plan-validator

approved
→ execute-plan

active
→ execute-plan

blocked
→ unblock-plan

review
→ review-plan

reopening
→ reopen-plan

completed
→ commit-summary

---

Validation Loop

Validation failed:

Status = draft
Next Action = fix-plan

Validation passed:

Status = approved
Next Action = execute-plan

---

Fix Plan Loop

Fix completed:

Status = draft
Next Action = plan-validator

---

Execution Loop

Execution completed:

Status = review
Next Action = review-plan

Execution completed with implementation and local validation done, but final browser/manual/deployed/external validation pending:

Status = review
Next Action = review-plan

Execution still has implementation work that can proceed:

Status = active
Next Action = execute-plan

Execution blocked:

Status = blocked
Next Action = unblock-plan

Execution rules:

* Execution MUST NOT set Status = completed
* Execution MUST NOT set Next Action = commit-summary
* Completed status is available ONLY through the Review Loop
* Execute may hand off to Review with pending final browser/manual/deployed/external validation, and Review owns the completion decision
* Implementation defects, incomplete implementation tasks, or validation findings that require code changes already covered by the spec and plan are not execution blockers; they keep or return the plan to `active + execute-plan`

---

Unblock Loop

Blocker resolved:

Status = active
Next Action = execute-plan

---

Review Loop

Review found issues:

Status = active
Next Action = execute-plan

Review passed:

Status = completed
Next Action = commit-summary

Completed `commit-summary` is the terminal safe-to-merge path. It creates the local plan-scoped commit and runner success represents that no further next action is required.

Review safe but final validation requires deployed, manual, or external code:

Status = completed
Next Action = commit-summary

Record a deferred validation note in Review History. The operator handles that validation manually after commit/deploy. If the manual check finds a required fix, reopen the plan through `completed → reopening → active`.

---

Reopen Loop

Post-completion bugs found:

Status = reopening
Next Action = reopen-plan

Reopen accepted:

Status = active
Next Action = execute-plan

## Placement

- Keep canonical workflow state-machine rules in this file.
- Keep `.ai/templates/plan.template.md` as a structural template that references this file instead of embedding the full state-machine rules.
- State-machine prompts MUST explicitly read this file in their Instruction Loading sections.
- Do not rewrite existing `.ai/plans/*.md` files solely to remove historical embedded workflow-state rules.

## Validation

- Verify this file has `Version` and `Last Updated` headers.
- Verify `.ai/templates/plan.template.md` contains a `## Workflow State Rules` section that references this file.
- Verify every state-machine prompt explicitly loads `.ai/instructions/shared/workflow-state.md`.
- Verify status values, next-action values, prompt routes, and workflow transitions stay aligned with `.ai/scripts/workflow-runner.ts` and `.ai/scripts/workflow-runner.test.ts`.

## Anti-Patterns

- Duplicating the full workflow state-machine rules in templates, prompts, or generated plans.
- Introducing new statuses, next actions, routes, or loop transitions outside this instruction, the runner spec, and the runner implementation.
- Allowing execution to set `completed + commit-summary` directly.
- Treating historical `.ai/plans/*.md` files as migration targets for documentation-only state-rule moves.
