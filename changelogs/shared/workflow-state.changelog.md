# Workflow State Instruction Changelog

## v2.0 — 2026-07-20

* Replaced persisted `status` plus `nextAction` routing with canonical
  `workflowState` only, with contract-parity coverage and rejection of legacy
  routing fields.

## v1.21 — 2026-07-19

* Added a machine-checked runner route matrix, documented the legacy blocked
  route, and aligned task-savepoint and aggregate commit-summary semantics with
  the current runner.

## v1.20 — 2026-07-18

* Documented deterministic completion for declared artifact-only thin plans with
  no committable paths.

## v1.19 — 2026-07-16

* Required execute stages to persist a blocked runtime-validation handoff before
  `STOP`; documented the narrow thin-plan-v2 recovery condition.

## v1.18 — 2026-07-16

* Clarified that unblocking a runtime or setup failure preserves any latest
  unremediated failed-review findings while execution resumes.

## v1.17 — 2026-07-15

* Added resumable handling for lint-staged, hook, and local commit failures,
  including plan-scoped unstaging without replaying execution and review.

## v1.16 — 2026-07-14

* Removed the retired split-review compatibility route; `review + review-plan`
  always runs the combined `review-changes` stage.

## v1.15 — 2026-07-09

* Added the snapshot-plus-latest-relevant-event hot path and clarified that
  workflow `history` is for historical investigations, not normal prompt runs.

## v1.14 — 2026-07-09

* Updated the review boundary to forbid separate subagent or plugin review
  systems without depending on external prompt-layer skill terminology.

## v1.13 — 2026-07-09

* Replaced the normal split review loop with one combined harness review through
  `review-changes`, while keeping `review-quality` as a legacy resume path for
  in-flight split reviews with existing spec-pass evidence.

## v1.12 — 2026-07-09

* Documented the review system boundary: `review + review-plan` stays in the
  existing harness review loop and must not automatically add Superpowers
  subagent review.

## v1.11 — 2026-07-09

* Removed `fix-plan` as a supported next action and documented existing
  `draft + fix-plan` plans as invalid until manually reset.
* Collapsed draft validation repair into one bounded `plan-validator` preflight
  that either approves `approved + execute-plan` or stops at
  `draft + plan-validator`.

## v1.10 — 2026-07-06

* Added `sync-plan-artifacts` as the automatic `draft` next action for new
  plans before `plan-validator`.
* Documented the sync loop, allowed artifact-only scope, and compatibility for
  existing `draft + plan-validator` plans.

## v1.9 — 2026-07-02

* Added a thin-plan-v2 state parity rule requiring prompts to update and reread both the plan manifest and `workflow.json` after every state transition.

## v1.8 — 2026-06-30

* Removed `deployment-validation` from the canonical statuses, transitions, next-action mapping, and documented workflow loops.
* Clarified that deferred manual, deployed, or external validation records a review note, then proceeds through `completed + commit-summary`; later bugs reopen through `completed → reopening → active`.

## v1.1 — 2026-06-28

* Replaced the missing `workflow-runner.spec.md` reference with the live runner test file as the validation companion for workflow transitions.

## v1.0 — 2026-06-28

* Started tracking `workflow-state.md` as a shared workflow baseline.
* Moved the file to `.ai/instructions/shared/workflow-state.md`.
* Corrected validation references to the current shared path.
