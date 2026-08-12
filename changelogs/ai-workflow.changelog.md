# AI Workflow Instruction Changelog

## v1.5 — 2026-08-12

* Restored the canonical task-savepoint, commit-boundary, and draft artifact
  sync contracts in the relocated shared instruction.

## v1.4 — 2026-08-12

* Moved the workflow instruction into `instructions/shared/`, updated all
  consumers to the shared path, and removed repository-specific wording.

## v1.3 — 2026-08-12

* Recreated the missing local workflow instructions from the current runner,
  thin-plan-v2, task-savepoint, artifact ownership, and validation contracts.

## v1.2 — 2026-07-19

* Added required placement and anti-pattern sections; delegated workflow-state
  and flow-trace ownership to their canonical shared instructions.

## v1.1 — 2026-07-15

* Replaced fixed-count savepoint guidance with behavior-atomic runner task
  structure, dependency, acceptance ownership, size warning, and bounded
  fallback rules.

## v1.0 — 2026-07-07

* Added thin-plan-v2 workflow artifact, task savepoint, and validation rules.
