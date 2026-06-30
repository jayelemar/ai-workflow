# Create Plan (Template-Driven)

This prompt creates a structured implementation plan only.

---

## Instruction Loading

Read:

- `.codex/AGENTS.md`
- `.ai/instructions/shared/workflow-state.md`
- relevant `.ai/instructions/**/*.md`
- the spec file
- the user-flow artifact for user-facing work

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
- User-flow artifacts describe how spec behavior moves through the existing product surface; they do not add behavior beyond the spec

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

## User-Flow Artifact Check (MANDATORY)

Before planning, derive the plan name from the spec file and classify whether the work is user-facing.

User-facing work means a feature, bugfix, or change that affects a customer, admin, or operator screen, route, workflow, visible state, or user-triggered API behavior.

If the work is user-facing:

- read the user-flow artifact before planning
- required path: `.ai/artifacts/<plan-name>/product-flow.md`
- verify the artifact exists
- verify it was generated from the approved spec plus codebase inspection
- verify it does not invent desired behavior beyond the spec
- use it to create `## Flow-to-File Mapping`

If the work is user-facing and the artifact is missing, incomplete, or inconsistent with the spec:

→ STOP  
→ state the missing or invalid artifact problem  
→ do NOT generate plan

For non-user-facing work:

- no flow artifact is required
- in `## User Flow Artifact`, write exactly `N/A: <concrete reason>`
- the reason must explain why the change does not affect a screen, route, workflow, visible state, or user-triggered API behavior
- this is the only allowed `N/A` value in generated plans

---

## Plan Requirements

Populate the template with:

---

### Phases

Must include:

- Preparation
- Implementation
- Validation

Each phase MUST include:

- Objective
- Ordered tasks (step-by-step, executable)
- Expected outcome

### Task Savepoints

Multi-step plans MUST enable task savepoints by giving every ordered phase task a stable task ID.

Required task syntax:

`1. [task:01-readable-words] Do the first task`

Rules:

- Use two-digit increasing numeric prefixes: `01`, `02`, `03`.
- Use lowercase readable words separated by hyphens after the numeric prefix.
- Keep task IDs stable after plan creation, even if task wording changes.
- Do not reuse a task ID.
- Single-step plans keep the existing final-commit behavior and do not require task IDs.
- Task savepoint artifacts will be written by the runner under `.ai/artifacts/<plan-name>/tasks/`.
- The runner will write the live task pointer at `.ai/artifacts/<plan-name>/state/current-task.md`.

---

### User Flow Artifact

Must include:

- `.ai/artifacts/<plan-name>/product-flow.md` for user-facing work
- `N/A: <concrete reason>` for non-user-facing work

---

## Phase-to-File Mapping (MANDATORY)

Each task MUST reference specific files where applicable.

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

## Flow-to-File Mapping (MANDATORY)

For user-facing work, map every user action from the user-flow artifact to applicable implementation and validation paths.

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

For non-user-facing work, write exactly the same `N/A: <concrete reason>` used in `## User Flow Artifact`.

If any user action cannot be mapped to implementation or validation coverage:

→ STOP  
→ state the missing mapping  
→ do NOT generate plan

---

## Files Section (MANDATORY)

Must include:

- Created files
- Modified files
- Deleted files

This section is the review and commit changed-file inventory. It should list the expected created, modified, and deleted file paths inferred from the request, spec, and codebase. It is reconciled after implementation by `execute-plan` from actual git changes.

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

- ALL files referenced in tasks MUST appear in the Files section
- ALL files in Files section MUST be referenced in at least one task

If mismatch exists:

→ regenerate the plan

---

## Ownership Scope (MANDATORY)

Add a concise `## Ownership Scope` section before `## Files (MANDATORY)`.

This section is the planning-time file ownership boundary. Prefer broad, stable entries that describe which files this plan may own:

- exact repo-relative files, for example `packages/supabase/src/generated.ts`
- directory globs ending in `/**`, for example `apps/admin/src/features/admin-ugc-templates/**`

Rules:

- MUST use repo-relative exact files or directory globs ending in `/**`
- MUST NOT use vague ownership like "service layer" or "related files"
- MUST NOT use hunk/chunk ownership
- Generated or shared files are owned as whole files until committed or released

---

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
- verify User Flow Artifact is present and valid
- verify Flow-to-File Mapping covers every user action for user-facing work
- verify Files section is complete
- verify Phase ↔ Files mapping is consistent

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
