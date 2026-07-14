Version: 1.16
Last Updated: 2026-07-14

# Workflow State Instructions

## Purpose

Define the canonical plan workflow state machine: plan statuses, next actions, allowed transitions, and workflow loops.

## Applies To

- `.ai/templates/plan.template.md`
- `.ai/prompts/create-plan.md`
- `.ai/prompts/sync-plan-artifacts.md`
- `.ai/prompts/plan-validator.md`
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
* Do not duplicate workflow `status` or `nextAction` in `.ai/artifacts/<plan-name>/state/files.json` or `.ai/artifacts/<plan-name>/state/file-ownership.json`; those files are inventory and ownership sidecars only.
* Any workflow prompt that updates either location MUST update both locations before final output.
* After every state transition, the prompt MUST reread both locations and verify the values match.
* If the values do not match, repair the mismatch before final output; if repair is not possible, STOP with the exact mismatch.
* Do not rely on the runner's post-run mismatch check as the first parity verification.
* During normal prompt reads, treat `.ai/artifacts/<plan-name>/state/context.md`
  plus the latest relevant event pointer in `.ai/artifacts/<plan-name>/state/workflow.json`
  as the hot path; do not inspect workflow `history` unless a historical
  failure investigation needs it.

Allowed Status Values:

* draft
* approved
* active
* review
* reopening
* completed
* blocked

Allowed Next Action Values:

* sync-plan-artifacts
* plan-validator
* execute-plan
* unblock-plan
* review-plan
* reopen-plan
* commit-summary

Allowed Status Transitions:

draft
→ sync-plan-artifacts
→ plan-validator
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
→ sync-plan-artifacts for new plans created by `create-plan`
→ plan-validator for existing draft plans that already passed artifact sync or predate this stage

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

Sync Plan Artifacts Loop

Artifact sync completed:

Status = draft
Next Action = plan-validator

Artifact sync found an unresolved spec gap, artifact inconsistency, or product decision:

Status = draft
Next Action = sync-plan-artifacts

Artifact sync rules:

* `sync-plan-artifacts` is valid only as `draft + sync-plan-artifacts`
* The prompt MUST reconcile the plan manifest and `.ai/artifacts/<plan-name>/state/workflow.json`
* The prompt may create or repair only plan-owned `.ai/plans/<plan-name>.md` and `.ai/artifacts/<plan-name>/...` files
* The prompt MUST NOT edit application code, tests, migrations, generated files, or non-plan-owned artifacts
* Validation begins only after artifact sync transitions to `draft + plan-validator`
* Existing plans already at `draft + plan-validator` remain valid and must not be migrated solely for this stage

---

Validation Preflight

Validation stopped after bounded repair pass:

Status = draft
Next Action = plan-validator

Validation passed:

Status = approved
Next Action = execute-plan

Validation rules:

* `plan-validator` is valid only as `draft + plan-validator`
* The prompt may perform one bounded repair pass for plan defects and explicitly allowed minor spec repairs
* The prompt MUST NOT introduce new behavior, make major spec decisions, or continue repairing after the bounded pass
* If a major spec decision, unresolved blocker, or non-repairable issue remains, the prompt MUST output `STOP` and keep `draft + plan-validator`
* The only successful validation handoff is `approved + execute-plan`
* Existing plans at `draft + fix-plan` are invalid and require manual reset to `draft + plan-validator` if the operator wants to rerun validation

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

Review implementation note:

* Public entry remains `review + review-plan`.
* The runner executes one combined harness review through `.ai/prompts/review-changes.md`.
Review system boundary:

* Public entry remains `review + review-plan`.
* The harness review loop is the review system for runner-managed review.
* The runner must not automatically add a separate subagent or plugin review
  system.
* This boundary does not add a status value, next-action value, or state
  transition.
* The combined harness review may approve `completed + commit-summary` or return to `active + execute-plan`.

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
