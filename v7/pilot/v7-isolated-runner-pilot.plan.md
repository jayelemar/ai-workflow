# V7 Isolated Runner Pilot Plan

workflow: v7-isolated-runner-pilot-v2

## Scope

Run only V7 lifecycle tooling under `.ai/v7`. Do not edit application files or
invoke `.ai/scripts/workflow-runner.ts`.

## Approved Artifacts

- Spec: `.ai/v7/pilot/v7-isolated-runner-pilot.spec.md`
- Plan: `.ai/v7/pilot/v7-isolated-runner-pilot.plan.md`

Deterministic Plan Review repairs may modify only these pilot artifacts and
`.ai/artifacts/v7-isolated-runner-pilot-v2/v7/`; they never modify foundation
planning artifacts or unrelated V7 sources.

## Stages

1. Use distinct dedicated read-only Codex sessions for Feature Intake,
   Specification Generation, Plan Creation, and Plan Review.
2. Require Plan Review final response `OKAY`; material HIGH,
   non-deterministic, no-progress, or repeated findings enter Decision Needed.
   A resolution requires a fresh dedicated Plan Review session.
3. After `OKAY`, use distinct dedicated read-only Codex sessions with positive
   exact token checkpoints for Plan Validation, Task Implementation, Task
   Verification, and Task Review.
4. Record zero-token lifecycle bookkeeping only for Plan Setup, Task Commit,
   and Completion Summary, each with a non-empty read-only-pilot reason.
5. Verify final V7 report, ledger hash chain, completion artifacts, token
   totals, and redaction.
