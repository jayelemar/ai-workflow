Version: 2.0
Last Updated: 2026-07-20

# Workflow State Instructions

## Purpose

`workflowState` is sole persisted workflow-routing value. Runner-managed plan
manifests contain only `## Workflow State`; `workflow.json` contains only
`workflowState` for routing. Do not persist or require secondary state labels.

## Canonical State Matrix

`.ai/scripts/workflow/contracts/stage.ts` is executable source. This table is
machine-checked by `stage.test.ts`.

| Workflow State | Routed Stage |
| --- | --- |
| `draft-artifact-sync` | `sync-plan-artifacts` |
| `draft-validation` | `plan-validator` |
| `approved` | `execute-plan` |
| `active` | `execute-plan` |
| `blocked` | `unblock-plan` |
| `review` | `review-changes` |
| `reopening` | `reopen-plan` |
| `completed` | `commit-summary` |

## Persistence Rules

* Update manifest and `workflow.json` together before stage output.
* Reread both locations after every transition. Stop with exact mismatch if
  either cannot be written or states differ.
* `files.json`, file-ownership artifacts, event history, and logs do not own
  routing state.
* Manual plans remain outside runner state and do not need `workflowState`.
* Plans without a valid canonical `workflowState` stop before prompt launch.

## Allowed Transitions

* `draft-artifact-sync` → `draft-validation` or itself.
* `draft-validation` → `approved` or itself.
* `approved` → `active`, `review`, or `blocked` only through execution output.
* `active` → `active`, `review`, or `blocked`.
* `blocked` → `active` or itself.
* `review` → `active` or `completed`.
* `completed` → `reopening` when operator reopens plan.
* `reopening` → `active`.
* `completed` remains terminal after successful one-final-commit summary.

Task-savepoint `completed` summaries return to `active` while tasks remain;
after final aggregate summary they terminate at `completed` without another
aggregate commit.

## Recovery

Partial execute/review, failed-review, and blocked-validation recoveries repair
both persisted locations to one canonical state. On write error, stop and name
failed path. Recovery preserves event history, ownership safeguards, and task
savepoint behavior.

## Validation

* Every state resolves exactly one stage prompt, model, and reasoning level in
  `stage.ts`.
* State-machine prompts explicitly load this instruction.
* Prompts must never persist secondary workflow-routing fields.
