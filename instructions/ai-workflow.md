Version: 1.1
Last Updated: 2026-07-15

# AI Workflow Instructions

## Purpose

Define workflow planning rules for `.ai/` plans, prompts, runner scripts, and
workflow artifacts.

## Applies To

- `.ai/plans/*.md`
- `.ai/artifacts/**`
- `.ai/prompts/*.md`
- `.ai/scripts/workflow-runner.ts`
- `.ai/scripts/workflow-runner.test.ts`
- `.ai/templates/plan.template.md`
- `.ai/wrappers/README.md`
- `.ai/README.md`

## Rules

- Keep thin-plan-v2 manifests small: plan details live in `## Phases`, while
  workflow history and evidence live under `.ai/artifacts/<plan-name>/`.
- Use `.ai/instructions/shared/workflow-state.md` as the state-machine source
  for statuses, next actions, and allowed transitions.
- Use Active Context Packet paths from the runner and index-selected
  instruction files only. Do not broadly load `.ai/instructions/**`.
- Keep `.ai/` artifacts out of implementation commits unless the plan itself
  explicitly owns workflow files.
- Write execution, validation, review, unblock, and commit evidence to
  `.ai/artifacts/<plan-name>/events/`.
- Keep `.ai/artifacts/<plan-name>/state/workflow.json` in parity with the
  plan manifest `## Status` and `## Next Action` values.

## Artifact Sync

- New draft plans may enter `draft + sync-plan-artifacts` before validation.
- Treat `sync-plan-artifacts` as the post-plan/pre-validator sync stage for
  user-journey artifacts, implementation maps, workflow state, file ownership,
  and files sidecars.
- A resolved artifact sync transitions to `draft + plan-validator`.
- An unresolved artifact gap remains `draft + sync-plan-artifacts` until the
  required plan-owned artifact is corrected.

## Task Savepoints

Apply this contract only to new or `draft` runner-managed plans. Manual plans
are not required to use the commit-savepoint structure or commit guarantees.
Never rewrite task IDs, task boundaries, or runner artifacts for plans already
in `active`, `review`, `blocked`, or `completed` status.

Two outcomes MUST be separate tasks when they are independently implementable
and validatable and have distinct reasons to review or revert. There is no
fixed task count or preferred savepoint count.

For multiple atomic outcomes, use this exact structure under
`### Implementation`:

```text
1. [task:NN-readable-words] <imperative title, maximum 50 characters>
   - Behavior: <one exact outcome>
   - Files: <exact repo-relative paths>
   - Validation: <exact runnable commands>
   - Depends on: None | <earlier task IDs>
   - Completes: <exact acceptance-criterion text> | None — prerequisite for <later task ID>
   - Coupling rationale: N/A | <exact reason the listed work cannot be split safely>
   - Size warning: N/A | More than 8 commit paths
   - Atomization warning: N/A | <exact unresolved split boundary>
```

For one atomic outcome, use the same fields, omit the `[task:...]` ID, and
retain the existing single final-commit behavior.

Rules:

- IDs MUST be unique, stable, two-digit, lowercase, and hyphenated.
- Titles MUST be imperative, describe one outcome, exclude file lists and
  workflow metadata, and contain a maximum 50 characters.
- `Depends on` may name only earlier task IDs and must not create a cycle.
- Every intermediate dependent commit MUST pass its declared validation.
- Exact focused validation commands, implementation, and regression coverage
  for one outcome MUST remain in the same task.
- Do not split tasks only by lifecycle phase, app layer, isolated red-test
  work, implementation-only work, validation-only work, or tiny checklist
  items.
- Tested foundations MAY be earlier tasks when independently validated and
  distinctly reviewable; use `None — prerequisite for <later task ID>` when
  they complete no acceptance criterion.
- Each acceptance criterion MUST become fully satisfied in exactly one task.
  Inseparable criteria MAY share one task; independently achievable criteria
  MUST not.
- Shared source, test, migration, or generated paths MAY appear in multiple
  ordered tasks. Count each unique expected commit path once per task.
- Expected directory ownership contributes every resolved concrete commit
  path. Paths marked `(assumed)` still count.
- Ignore `.ai/` paths excluded from implementation commits when calculating
  task size. Nine or more unique commit paths require `Size warning: More than
  8 commit paths` plus concrete `Coupling rationale`; eight or fewer require
  `Size warning: N/A`.
- A clear broad-task split MUST be rewritten during the bounded repair pass.
  An uncertain split remains executable with concrete `Coupling rationale`,
  an exact `Atomization warning`, and normal operator approval. Otherwise use
  `Atomization warning: N/A`.
- Do not use generic coupling wording such as `related changes` or `same
  feature`.
- Preparation and final aggregate validation MUST remain untagged and MUST NOT
  become commit savepoints.
- Task savepoint artifacts will be written by the runner under
  `.ai/artifacts/<plan-name>/tasks/`.
- The runner will write the live task pointer at
  `.ai/artifacts/<plan-name>/state/current-task.md`.

## Validation

- Validate workflow prompt or script changes with `.ai/scripts/health-check.mjs`
  or the relevant `.ai/scripts/*.test.*` tests.
- Verify task-savepoint wording contains no lifecycle-only, implementation-only,
  validation-only, red tests-only, or tiny checklist savepoints.
- Verify every task savepoint can pass, be reviewed, and be committed
  independently.
