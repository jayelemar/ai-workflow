Version: 1.5
Last Updated: 2026-08-12

# AI Workflow Instructions

## Purpose

Define reusable implementation boundaries for workflow source under `.ai/`
without duplicating portable state, testing, reasoning, or flow-trace policy.

## Applies To

- `.ai/prompts/**`, `.ai/wrappers/**`, and `.ai/templates/**`.
- `.ai/scripts/workflow/**` and `.ai/scripts/maintenance/**`.
- Runner-managed plans and their local artifacts under `.ai/plans/**` and
  `.ai/artifacts/**`.

## Rules

- Run workflow commands from the parent repository root. Treat `.ai/` as its
  own workflow-source repository and keep local plans, specs, artifacts, and
  project-specific instructions out of shared workflow commits.
- Treat `.ai/scripts/workflow/contracts/stage.ts` and
  `shared/workflow-state.md` as the owners of stage selection and persisted
  workflow-state behavior. Reference them instead of restating route matrices
  or transitions.
- Keep stage orchestration in focused modules under
  `.ai/scripts/workflow/runner/`; keep stage prompt paths and model selection in
  `contracts/stage.ts`, ownership behavior in `ownership/`, telemetry in
  `telemetry/`, plan parsing and state artifacts in `runner/plan/`, task
  savepoints in `runner/tasks/`, review staging in `runner/review/`, runtime
  lifecycle in `runner/runtime/`, and terminal rendering in `runner/terminal/`.
- Use `thin-plan-v2` for new runner-managed plans. Keep execution history,
  changed-file inventory, ownership, and detailed state outside the manifest as
  enforced by `runner/thin-plan-v2.ts`.
- Keep `workflowState` routing in the plan manifest and
  `.ai/artifacts/<plan-name>/state/workflow.json`. Keep changed paths in
  `files.json`, edit authority in `file-ownership.json`, compact current context
  in `context.md`, and detailed history under `events/`.
- Treat `sync-plan-artifacts` as the post-plan/pre-validator sync for
  runner-managed draft plans. Keep transition details in
  `shared/workflow-state.md`.
- Keep tests beside their workflow ownership area using the existing
  `*.test.ts`, `*.integration.test.ts`, and `__tests__/` conventions. Follow
  `shared/testing.md` for test-layer and regression strategy.
- Follow `shared/flow-trace-artifacts.md` for user-journey and implementation-map
  requirements; do not copy that contract into stage prompts or local plans.

### Task Savepoint Contract

Apply this contract only to new or `draft` runner-managed plans. Manual plans
are not required to use task savepoints or commit guarantees. Never rewrite
task IDs, task boundaries, or runner artifacts for plans already in `active`,
`review`, `blocked`, or `completed` workflow state.

Two outcomes MUST be separate tasks when they are independently implementable
and validatable and have distinct reasons to review or revert. There is no
fixed savepoint count.

For multiple atomic outcomes, use this exact structure:

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

For one atomic outcome, use the same fields but omit the `[task:...]` ID and
retain the existing single final-commit behavior.

- Use unique stable two-digit IDs with lowercase hyphenated words only when
  multiple atomic outcomes exist.
- Titles MUST be imperative, describe one outcome, exclude file lists and
  workflow metadata, and contain a maximum 50 characters.
- `Depends on` may name only earlier task IDs and must not create a cycle.
- Exact focused tests, implementation, and regression coverage for one outcome
  MUST remain in the same task.
- Do not split tasks only by lifecycle phase, app layer, isolated red-test
  work, implementation-only work, validation-only work, or tiny checklist
  items.
- Each acceptance criterion MUST become fully satisfied in exactly one task.
  Inseparable criteria MAY share one task; independently achievable criteria
  MUST not.
- Tested foundations MAY be earlier tasks when independently validated and
  distinctly reviewable; use `None — prerequisite for <later task ID>` when
  they complete no acceptance criterion.
- Shared source, test, migration, or generated paths MAY appear in multiple
  ordered tasks. Count each unique expected commit path once per task.
- Expected directory ownership contributes every resolved concrete commit
  path. Paths marked `(assumed)` still count.
- Nine or more unique commit paths require
  `Size warning: More than 8 commit paths` and a concrete coupling rationale.
- When a safe split remains unresolved, record it in `Atomization warning`;
  otherwise use `Atomization warning: N/A`.
- Preparation and final aggregate validation MUST remain untagged and MUST NOT
  become task savepoints.

### Commit Boundaries

Use commit boundaries only when one accepted task must remain a single
execution and review savepoint but needs atomized history. A boundary entry:

- lists two to twelve dependency-ordered boundaries;
- assigns every plan-owned implementation path to exactly one boundary;
- keeps every boundary path within that task's plan-owned scope; and
- includes the focused tests required for its implementation.

Do not create boundary entries for manual plans, one-final-commit plans, or
final aggregate validation.

## Placement

- Put reusable stage routing contracts in `.ai/scripts/workflow/contracts/`.
- Put file-scope and concurrency ownership in `.ai/scripts/workflow/ownership/`.
- Put runner implementation in the matching focused subdirectory under
  `.ai/scripts/workflow/runner/`.
- Put reusable stage behavior in `.ai/prompts/` and thin invocation layers in
  `.ai/wrappers/`.
- Put versioned detailed events and task savepoints under
  `.ai/artifacts/<plan-name>/`; keep the plan manifest compact.
- Put portable policy in `.ai/instructions/shared/` and repository-specific
  routing or paths in project-local instruction files.

## Validation

- Run `pnpm exec tsx .ai/scripts/workflow/runner.ts --help` after changing the
  runner entry, CLI, or installation contract.
- Run `node .ai/scripts/maintenance/health-check.mjs` for shared workflow source
  shape, formatting, ignored-file boundaries, and runner startup.
- Run `node .ai/scripts/maintenance/health-check.mjs --runner-tests` for
  workflow-runner changes, or `--full` when maintenance and workflow test
  coverage are both required.
- Start with the narrowest affected `pnpm exec tsx --test <test-files>` command
  while iterating, then broaden according to `shared/testing.md`.

## Anti-Patterns

- Adding a second persisted routing field beside `workflowState`.
- Putting event history, file inventories, ownership state, or task savepoints
  back into a `thin-plan-v2` manifest.
- Duplicating stage routes from `contracts/stage.ts` or transitions from
  `shared/workflow-state.md` in another instruction.
- Splitting savepoints by frontend/backend layer, red/green test phase, or file
  type when they do not produce independently valid outcomes.
- Editing future task scope while the runner has injected a current task
  savepoint.
- Committing local project instructions, plans, specs, or artifacts to the
  shared `.ai` workflow repository by accident.
