# V7 Isolated Runner Retry v1

workflow: v7-isolated-runner-retry-v1

## Goal

Run one fresh HIGH-risk, read-only V7 lifecycle after the legacy benchmark
completion fix. Prove V7 remains isolated from application and legacy-runner
state.

## Scope

* Run only `.ai/v7/workflow-runner.ts` lifecycle commands.
* Permit writes only to this pilot's files and
  `.ai/artifacts/v7-isolated-runner-retry-v1/v7/`.
* Do not edit application code, tests, database files, active prompts, V7
  runner source, or `.ai/scripts/workflow-runner.ts`.

## Lifecycle Contract

* Every Codex-backed stage uses one fresh, dedicated read-only session with
  exact positive token evidence.
* Plan Review must return `OKAY` from its own fresh session.
* Plan Setup, Task Commit, and Completion Summary use zero-token records with
  non-empty reasons.
* Complete stages in order: Feature Intake, Specification Generation, Plan
  Creation, Plan Review, Plan Setup, Plan Validation, Task Implementation,
  Task Verification, Task Review, Task Commit, Completion Summary.
* Bind this spec and its plan to the created V7 revision before checkpointing.

## Acceptance Criteria

* V7 report is completed and hash chain is verified.
* Eight Codex-backed stages have distinct exact session IDs and positive token
  totals.
* Three bookkeeping stages have valid zero-token reasons.
* No application working-tree path changes.

