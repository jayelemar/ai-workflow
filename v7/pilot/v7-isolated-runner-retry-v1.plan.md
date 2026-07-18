# V7 Isolated Runner Retry v1 Plan

workflow: v7-isolated-runner-retry-v1

## Scope

Execute only the V7 lifecycle described by
`v7-isolated-runner-retry-v1.spec.md`. Keep all writes inside this pilot and
its dedicated V7 artifact root.

## Approved Artifacts

* Spec: `.ai/v7/pilot/v7-isolated-runner-retry-v1.spec.md`
* Plan: `.ai/v7/pilot/v7-isolated-runner-retry-v1.plan.md`
* Intake: `.ai/v7/pilot/v7-isolated-runner-retry-v1.intake-input.json`
* Review: `.ai/v7/pilot/v7-isolated-runner-retry-v1.review-result.json`
* Validation: `.ai/v7/pilot/v7-isolated-runner-retry-v1.validation-result.json`

## Stages

1. Create V7 HIGH lifecycle from fresh Feature Intake exact-session evidence.
2. Checkpoint Specification Generation, Plan Creation, and Plan Review;
   require `OKAY` for Plan Review.
3. Checkpoint Plan Setup, Plan Validation, Task Implementation, Task
   Verification, Task Review, Task Commit, and Completion Summary in order.
4. Verify report, hash chain, exact-session totals, and clean application
   working tree.

