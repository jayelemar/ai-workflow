# Create Plan (Template-Driven)

This prompt creates a structured implementation plan only.

---

## Instruction Loading

Read:

- `.codex/AGENTS.md`
- `.ai/instructions/shared/workflow-state.md`
- relevant `.ai/instructions/**/*.md`
- the spec file
- the user-journey artifact for user-facing work

Load:

- `.ai/prompts/superpowers.md`

Apply the superpowers advisory guidance for analysis and edge-case checks.

---

## Objective

Generate a complete implementation plan using the provided spec.

---

## Template Usage (MANDATORY)

Use template:

.ai/templates/plan.template.md

Rules:

- MUST follow template structure exactly
- MUST NOT remove, rename, or reorder sections
- MUST NOT omit any section
- ONLY fill in placeholders

---

## Scope Rules

- Spec is the single source of truth
- DO NOT redefine behavior
- DO NOT introduce behavior outside the spec
- User-journey artifacts describe how spec behavior moves through the existing product surface; they do not add behavior beyond the spec

---

## Spec Completeness Check (MANDATORY)

Before planning:

- verify all behaviors are defined
- verify all edge cases are clearly specified
- verify all decision branches are deterministic

If any behavior is:

- vague
- undefined
- ambiguous

→ STOP  
→ list missing or unclear spec definitions  
→ do NOT generate plan

---

## User Journey Artifact Check (MANDATORY)

Before planning, derive the plan name from the spec file and classify whether the work is user-facing.

User-facing work means a feature, bugfix, or change that affects a customer, admin, or operator screen, route, workflow, visible state, or user-triggered API behavior.

If the work is user-facing:

- required path: `.ai/artifacts/<plan-name>/user-journey.md`
- ensure the user-journey artifact exists before planning
- if the artifact is missing, automatically create it by applying `.ai/prompts/generate-user-flow.md` to the same spec and observed codebase paths
- if the artifact exists but is incomplete, stale, or inconsistent with the spec, automatically regenerate it by applying `.ai/prompts/generate-user-flow.md`
- read the user-journey artifact before planning, after any preflight create/regenerate step
- verify it was generated from the approved spec plus codebase inspection
- verify it does not invent desired behavior beyond the spec
- use it to create `.ai/artifacts/<plan-name>/implementation-map.md`

User-journey preflight rules:

- the preflight may only create or update `.ai/artifacts/<plan-name>/user-journey.md`
- it must follow `.ai/prompts/generate-user-flow.md`, including required sections, Markdown + Mermaid format, and spec-only desired behavior
- it must inspect the codebase only for existing routes, components, APIs, services, state, storage effects, and tests
- it must exclude `.ai/artifacts` from broad searches except the target artifact path
- it must not create a plan until the artifact exists and validates

If user-journey preflight cannot produce a valid artifact because the spec is incomplete, vague, ambiguous, not actually user-facing, or still inconsistent after regeneration:

→ STOP  
→ state the concrete user-journey preflight blocker  
→ do NOT generate plan

For non-user-facing work:

- no flow artifact is required
- in `.ai/artifacts/<plan-name>/implementation-map.md`, write exactly `N/A: <concrete reason>`
- the reason must explain why the change does not affect a screen, route, workflow, visible state, or user-triggered API behavior
- this is the only allowed `N/A` value in generated implementation-map artifacts

---

## Plan Requirements

Populate the template with:

---

### Plan Details

Write the plan details directly in the plan manifest's `## Phases` section.

`## Phases` MUST include:

- Preparation
- Implementation
- Validation

Each phase MUST include:

- Objective
- Ordered tasks (step-by-step, executable)
- Expected outcome

### Task Savepoints

Task savepoints are meaningful commit milestones for independently reviewable
chunks only. Use `[task:...]` only for coherent behavior/subsystem boundaries,
not every numbered checklist item.

Required task syntax:

`1. [task:01-readable-words] Do the first task`

Rules:

- Default a simple bugfix to one final-commit task without task IDs, even when
  the task includes red tests, implementation, and validation commands.
- Use task savepoints only when every task can pass, be reviewed, and be
  committed independently.
- Prefer no task IDs for simple fixes.
- Prefer 3-5 meaningful savepoints for larger multi-subsystem plans.
- Do not split tasks only by lifecycle phase, app layer, isolated red-test
  work, implementation-only work, validation-only work, or tiny checklist
  items.
- Use two-digit increasing numeric prefixes: `01`, `02`, `03`.
- Use lowercase readable words separated by hyphens after the numeric prefix.
- Keep task IDs stable after plan creation, even if task wording changes.
- Do not reuse a task ID.
- Single-step and simple bugfix plans keep the existing final-commit behavior
  and do not require task IDs.
- Task savepoint artifacts will be written by the runner under `.ai/artifacts/<plan-name>/tasks/`.
- The runner will write the live task pointer at `.ai/artifacts/<plan-name>/state/current-task.md`.

---

### Implementation Map Artifact

Must include:

- one `### User Action:` entry per user-journey action for user-facing work
- `N/A: <concrete reason>` for non-user-facing work

---

## Phase-to-File Mapping (MANDATORY)

Each task in the plan manifest's `## Phases` section MUST reference specific files where applicable.

Rules:

- Tasks MUST NOT be abstract
- Tasks MUST include concrete file paths when modifying or creating logic

Example:

GOOD:
- Update handler:
  apps/web/src/app/api/v1/.../route.ts

BAD:
- Update API logic

---

## Implementation Map Artifact (MANDATORY)

For user-facing work, map every user action from the user-journey artifact to applicable implementation and validation paths.

Write the mapping to `.ai/artifacts/<plan-name>/implementation-map.md`, not into the plan manifest.

Each user action MUST include:

- UI route/component
- API route
- backend service/module
- database/storage effect
- tests

Rules:

- Use concrete repo-relative paths where applicable.
- If a category is not applicable to a user action, write `None: <concrete reason>`.
- The tests entry must identify validation coverage for the action.
- Every user action in `## User Flows` and `## Acceptance Scenarios` of the flow artifact must appear in this mapping.
- The mapping must not include actions that do not appear in the flow artifact.

For non-user-facing work, write exactly `N/A: <concrete reason>` in `implementation-map.md`.

If any user action cannot be mapped to implementation or validation coverage:

→ STOP  
→ state the missing mapping  
→ do NOT generate plan

---

## Artifact State Files (MANDATORY)

Write `.ai/artifacts/<plan-name>/state/files.json` with:

- `created`
- `modified`
- `deleted`
- `changedFiles`
- `released`
- `headSha`
- workflow state

The `created`, `modified`, `deleted`, `changedFiles`, and `released` fields MUST be string arrays. Do not use legacy aliases such as `createdFiles`, `modifiedFiles`, or `deletedFiles`.

This artifact is the review and commit changed-file inventory. It should list the expected created, modified, and deleted file paths inferred from the request, spec, and codebase. It is reconciled after implementation by `execute-plan` from actual git changes.

Write `.ai/artifacts/<plan-name>/state/workflow.json` with:

- `planPath`
- `status`
- `nextAction`
- `latest`
- `history`
- unresolved blockers
- `updatedAt`

The initial `workflow.json` MUST use:

- `status`: `draft`
- `nextAction`: `plan-validator`
- `latest`: `{}`
- `history`: `[]`
- `unresolvedBlockers`: `[]`

Do not use legacy aliases such as `latestEvent`, `latestValidation`, `latestReview`, or `compactHistory`.

Write `.ai/artifacts/<plan-name>/state/file-ownership.json` with the planning-time ownership boundary and current workflow state.

It MUST be valid JSON with exactly the runner-required ownership fields:

- `planPath`: string
- `status`: allowed workflow status string
- `nextAction`: allowed workflow next-action string
- `owns`: string array of repo-relative exact file paths or directory globs ending in `/**`
- `released`: string array; use `[]` during initial plan creation
- `resolvedFiles`: string array of concrete repo-relative files expected to be changed by the plan
- `changedFiles`: string array matching the initial expected changed-file inventory from `files.json`
- `headSha`: current `git rev-parse HEAD` string
- `updatedAt`: ISO timestamp string

Write `.ai/artifacts/<plan-name>/state/context.md` with an initial runner context snapshot.

It MUST:

- exist before returning from create-plan
- identify the plan path, spec path, workflow status, next action, and required artifact paths
- state that no validation, execution, review, or blocker events exist yet for a new plan
- be concise because the runner uses it as a warm context packet

Create `.ai/artifacts/<plan-name>/events/` as a directory before returning from create-plan.

The directory may be empty for a new draft plan, but it MUST exist because thin-plan-v2 validation treats it as a required artifact.
- `updatedAt`: ISO timestamp string

Rules:

- MUST use `owns`; MUST NOT use `ownedPaths`, `owned`, `paths`, or other alias keys.
- MUST use repo-relative exact files or directory globs ending in `/**`.
- MUST NOT use vague ownership like "service layer" or "related files".
- MUST NOT use hunk/chunk ownership.
- For exact-file ownership, include the same file paths in `owns`, `resolvedFiles`, and `changedFiles`.
- For directory-glob ownership, keep the glob in `owns` and list concrete expected files in `resolvedFiles` and `changedFiles`.
- Generated or shared files are owned as whole files until committed or released.
- Keep `released` empty at initial plan creation unless a prior ownership transfer has already been recorded.

Do not add inline `## Flow-to-File Mapping`, `## Implementation Map`, workflow history, blockers, ownership, or `## Files (MANDATORY)` sections to the plan manifest.

Rules:

- MUST use concrete file paths
- MUST NOT append comments, conditions, or annotations to file bullets; use only the exact path value, except an inferred path may end with `(assumed)`
- If a file section has no files, write exactly `* None`
- MUST NOT write `none`, `(none)`, `(None)`, `N/A`, or other placeholder variants in generated plans
- MUST NOT use vague terms
- If exact paths are unclear:
  - infer from spec
  - mark with "(assumed)"

---

## File Coverage Enforcement (MANDATORY)

- ALL files referenced in `## Phases` tasks MUST appear in `.ai/artifacts/<plan-name>/state/files.json`
- ALL files in `.ai/artifacts/<plan-name>/state/files.json` MUST be referenced in at least one `## Phases` task

If mismatch exists:

→ regenerate the plan

## Plan Name Derivation (MANDATORY)

Derive the plan name from the spec file:

- remove path
- remove `.spec.md`

Example:

.ai/specs/credit-balance.spec.md  
→ credit-balance

Use for:

- file:
  .ai/plans/<plan-name>.md
- title:
  # Plan: <plan-name>

---

## Strict Constraints

- The finalized plan is documentation only; no application code, tests, routes, or generated files are changed.
- DO NOT write or modify application code
- DO NOT generate diffs or patches
- DO NOT perform implementation
- DO NOT go beyond plan creation

---

## Validation (MANDATORY)

Before completing:

- verify all template sections exist
- verify `## Status` is present
- verify all Phases are complete
- verify User Journey Artifact is present and valid
- verify `.ai/artifacts/<plan-name>/implementation-map.md` covers every user action for user-facing work
- verify `.ai/artifacts/<plan-name>/state/files.json` is complete
- verify Phase ↔ files artifact mapping is consistent

If any requirement fails:

→ regenerate the plan

---

## Completion Condition

The task is complete ONLY when:

1. the plan follows the template exactly
2. spec is fully defined (no ambiguity)
3. all required sections are present
4. file coverage is complete and consistent
5. the file is saved to:

.ai/plans/<plan-name>.md

After that, STOP.

---

## INPUT

Spec file:
<repo-relative path>.spec.md

Default:
.ai/specs/<spec-file>.spec.md

---

## Final Output

Return only:

Plan saved to .ai/plans/<plan-name>.md
