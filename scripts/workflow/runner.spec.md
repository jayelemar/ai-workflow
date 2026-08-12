# Spec: workflow-runner

## Goal

Keep the workflow runner aligned with repo-relative plan spec paths and the
canonical state machine.

## Current Behavior

- The workflow runner already owns the canonical `plan-validator` / `fix-plan`
  loop for draft plans and the normal `execute-plan` -> `review-plan` flow.
- The `manual-preview` prompt owns standalone ad hoc preview work and does not
  use plan state or workflow artifacts.
- The runner currently extracts spec paths from plan `## Spec` only when they
  match `.ai/specs/...`, which excludes workflow companion specs that live
  elsewhere in the repository.
- A failed commit-summary clean check currently resets the plan to
  `active + execute-plan`, making a manual rerun unnecessarily repeat execution
  and review before returning to the commit stage.

## Expected Behavior

- A plan `## Spec` section may list repo-relative `*.spec.md` paths.
- `.ai/specs/` remains the default location for ordinary feature and bug specs.
- `.ai/scripts/workflow/runner.spec.md` is a valid companion spec path for
  workflow-runner changes.
- `manual-preview` acts as a standalone ad hoc helper:
  - no plan file is required
  - no workflow state or `.ai/artifacts` are updated
  - the non-test diff approval gate still applies before writes
- When a commit-summary clean check finds plan-owned changes after a failed
  commit preflight, the runner unstages only those plan-owned paths, retains
  `completed + commit-summary`, and stops with the hook diagnostics. Once the
  failure is repaired, a manual rerun resumes the commit stage directly.

## Behavior

- IF a plan `## Spec` section contains repo-relative `*.spec.md` path entries,
  THEN the runner MUST include those paths anywhere it builds prompt context,
  snapshots, or other spec-path-derived artifacts.
- IF a plan `## Spec` section contains `.ai/scripts/workflow/runner.spec.md`,
  THEN the runner MUST treat it the same way it treats `.ai/specs/...`
  companion specs for prompt injection and snapshots.
- IF `manual-preview` is invoked for ad hoc work, THEN it MUST NOT require a
  plan file or update workflow state, plan status, or `.ai/artifacts`.

## Constraints

- Do not change workflow state machine values or runner CLI behavior.
- Keep execution and validation artifacts plus the workflow context snapshot
  compatible with `review-changes.md`.
- Do not bypass lint-staged, force the commit, or remove the normal iteration
  limit while recovering from a failed commit preflight.

## File Scope

- `.ai/prompts/manual-preview.md`
- `.ai/scripts/workflow/runner.ts`
- `.ai/scripts/workflow/runner/__tests__/integration/runner.test.ts`
- `.ai/instructions/shared/ai-workflow.md`
- `.ai/templates/plan.template.md`
- `.ai/wrappers/README.md`
- `.ai/README.md`

## Acceptance Criteria

- A plan that references `.ai/scripts/workflow/runner.spec.md` surfaces that
  spec path in runner-generated prompt context and workflow snapshots.
- Operator docs describe standalone manual preview invocation for ad hoc work
  and state that it does not use plan state or `.ai/artifacts`.
- A commit-preflight clean-check failure preserves `completed + commit-summary`
  and unstages only plan-owned paths, so the next runner invocation starts at
  commit-summary rather than replaying execution or review.

## Validation Expectations

- `pnpm exec prettier --check .ai/instructions .ai/changelogs .ai/wrappers .ai/README.md .ai/prompts`
- `pnpm exec tsx --test .ai/scripts/workflow/runner/__tests__/integration/runner.test.ts`
