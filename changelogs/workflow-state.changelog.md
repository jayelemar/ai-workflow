# Workflow State Instruction Changelog

## v1.8 — 2026-06-30

* Removed `deployment-validation` from the canonical statuses, transitions, next-action mapping, and documented workflow loops.
* Clarified that deferred manual, deployed, or external validation records a review note, then proceeds through `completed + commit-summary`; later bugs reopen through `completed → reopening → active`.

## v1.1 — 2026-06-28

* Replaced the missing `workflow-runner.spec.md` reference with the live runner test file as the validation companion for workflow transitions.

## v1.0 — 2026-06-28

* Started tracking `workflow-state.md` as a shared workflow baseline.
* Moved the file to `.ai/instructions/shared/workflow-state.md`.
* Corrected validation references to the current shared path.
