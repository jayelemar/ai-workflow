# Spec: workflow-runner

## Goal

Keep the workflow runner and the manual `preview-before-apply` path aligned so
plans can reference repo-relative spec files consistently and manual preview can
handle draft preflight plus preview-gated execution without drifting from the
runner state machine.

## Current Behavior

- The workflow runner already owns the canonical `plan-validator` / `fix-plan`
  loop for draft plans and the normal `execute-plan` -> `review-plan` flow.
- The manual `preview-before-apply` prompt currently assumes execution-only
  entry and only describes `approved` and `active` plans.
- The runner currently extracts spec paths from plan `## Spec` only when they
  match `.ai/specs/...`, which excludes workflow companion specs that live
  elsewhere in the repository.

## Expected Behavior

- A plan `## Spec` section may list repo-relative `*.spec.md` paths.
- `.ai/specs/` remains the default location for ordinary feature and bug specs.
- `.ai/scripts/workflow-runner.spec.md` is a valid companion spec path for
  workflow-runner changes.
- `preview-before-apply` acts as a manual post-plan controller:
  - `draft` runs the same validation/fix preflight loop the runner uses
  - `approved` and `active` enter execution immediately
  - the non-test diff approval gate begins only for execution writes
- Draft preflight plan/spec repairs remain allowed without preview approval only
  when they follow existing `plan-validator` / `fix-plan` rules.

## Behavior

- IF a plan `## Spec` section contains repo-relative `*.spec.md` path entries,
  THEN the runner MUST include those paths anywhere it builds prompt context,
  snapshots, or other spec-path-derived artifacts.
- IF a plan `## Spec` section contains `.ai/scripts/workflow-runner.spec.md`,
  THEN the runner MUST treat it the same way it treats `.ai/specs/...`
  companion specs for prompt injection and snapshots.
- IF `preview-before-apply` is invoked with a `draft` plan, THEN it MUST loop
  through `plan-validator` and `fix-plan` semantics until the plan either
  reaches `approved` or STOPs for a real blocker.
- IF draft preflight detects a `MINOR SPEC REPAIR`, THEN only the exact allowed
  spec file and sections MAY be repaired without preview approval.
- IF draft preflight detects a `MAJOR SPEC DECISION REQUIRED`, missing user
  authority, or another non-fixable blocker, THEN `preview-before-apply` MUST
  STOP before execution begins.
- IF the plan reaches `approved` during manual preflight, THEN the same
  invocation MUST transition into `active + execute-plan`.
- IF execution is about to write a non-test file, THEN `preview-before-apply`
  MUST show the exact diff and wait for explicit approval before applying it.
- IF the write is only to tests or test-only fixtures, THEN the execution
  preview gate MUST NOT apply.

## Constraints

- Do not change the workflow state machine values or default runner path.
- Do not require approval previews for draft-preflight plan/spec repairs.
- Do not allow draft preflight to introduce new behavior beyond existing
  `plan-validator` / `fix-plan` semantics.
- Keep execution and validation artifacts plus the workflow context snapshot
  compatible with `review-changes.md`.

## File Scope

- `.ai/prompts/preview-before-apply.prompt.md`
- `.ai/scripts/workflow-runner.ts`
- `.ai/scripts/workflow-runner.test.ts`
- `.ai/instructions/ai-workflow.md`
- `.ai/templates/plan.template.md`
- `.ai/wrappers/README.md`
- `.ai/README.md`

## Acceptance Criteria

- A plan that references `.ai/scripts/workflow-runner.spec.md` surfaces that
  spec path in runner-generated prompt context and workflow snapshots.
- The preview prompt contract explicitly accepts `draft`, `approved`, and
  `active` plans and documents the integrated preflight loop.
- Operator docs describe direct preview invocation on `draft`, `approved`, or
  `active` plans and state that draft plans self-run validation/fix first.
- The approval gate is documented as execution-only and not applicable to
  allowed draft-preflight plan/spec repairs.

## Validation Expectations

- `pnpm exec prettier --check .ai/instructions .ai/changelogs .ai/wrappers .ai/README.md .ai/prompts`
- `pnpm exec tsx --test .ai/scripts/workflow-runner.test.ts`
- Manual inspection of `.ai/prompts/preview-before-apply.prompt.md` to confirm
  the draft preflight loop, STOP rules, and execution-only approval gate.
