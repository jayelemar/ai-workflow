# Create Plan (Template-Driven)

This prompt creates a structured implementation plan only.

---

## Instruction Loading

Read:

- `.codex/AGENTS.md`
- `.ai/instructions/shared/reasoning-quality.md`
- `.ai/instructions/shared/flow-trace-artifacts.md`
- relevant `.ai/instructions/**/*.md`
- the spec file
- the user-journey artifact when flow-trace artifacts are required for the scope

Read `.ai/instructions/shared/workflow-state.md` only for
`runner-managed` mode.

Apply the shared reasoning-quality guidance for assumption validation,
edge-case checks, tradeoff notes, and scope discipline.

---

## Objective

Generate a complete implementation plan using the provided spec.

## Execution Mode (MANDATORY)

Choose exactly one execution mode before planning:

- `manual`
- `runner-managed`

If the operator does not explicitly specify a mode:

→ STOP  
→ ask: `Which execution mode should create-plan use: manual or runner-managed?`  
→ do NOT read the spec  
→ do NOT create, modify, or delete any files

Mode rules:

- `manual` means create a spec, create a plan, and execute in the same
  conversation without invoking the workflow runner.
- `runner-managed` means create a plan that will continue through
  `sync-plan-artifacts`, `plan-validator`, and later runner-managed stages.
- Both modes MUST use the same spec discipline, flow-artifact gating rules,
  implementation-map requirements, and concrete phase planning quality.
- Only `runner-managed` mode may require runner-only workflow state artifacts.

For `runner-managed` plans, new draft plans MUST start at:

- Status = draft
- Next Action = sync-plan-artifacts

This is the `draft + sync-plan-artifacts` state.

The workflow runner performs `sync-plan-artifacts` after plan creation and
before `plan-validator`.

For `manual` plans, keep the plan manifest structure but do not require
runner-managed workflow state before execution.
After saving a manual plan, append the manual token checkpoint:

`pnpm exec tsx .ai/scripts/manual-token-usage.ts --plan <plan-name> --stage plan`

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

## Flow Artifact Gating Check (MANDATORY)

Before planning:

- confirm execution mode has already been explicitly selected
- derive the plan name from the spec file
- apply `.ai/instructions/shared/flow-trace-artifacts.md` to classify whether
  the scope is flow-trace-required
- if flow-trace artifacts are required, complete the create-plan preflight from
  that shared instruction before finalizing `## Phases`
- if flow-trace artifacts are not required, write the exact
  `N/A: <concrete reason>` values required by that shared instruction

---

## Flow-Trace Plan Authoring Preflight (MANDATORY)

When flow-trace artifacts are required, run the create-plan preflight from
`.ai/instructions/shared/flow-trace-artifacts.md`.

That preflight owns user-journey regeneration, implementation-map repair,
savepoint self-checks, behavior-ownership coverage, and the required
auto-correction before the draft plan is returned.

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

Follow `.ai/instructions/shared/flow-trace-artifacts.md` for the exact
`implementation-map.md` contract.

Write the mapping to `.ai/artifacts/<plan-name>/implementation-map.md`, not
into the plan manifest.

If any user action cannot be mapped to implementation or validation coverage:

→ STOP  
→ state the missing mapping  
→ do NOT generate plan

---

## Runner-Managed Artifact State Files (CONDITIONAL)

These artifact-state files are required only for `runner-managed` mode.

If execution mode is `manual`:

- do NOT create or update `.ai/artifacts/<plan-name>/state/files.json`
- do NOT create or update `.ai/artifacts/<plan-name>/state/workflow.json`
- do NOT create or update `.ai/artifacts/<plan-name>/state/file-ownership.json`
- do NOT create or update `.ai/artifacts/<plan-name>/state/context.md`
- do NOT create or update `.ai/artifacts/<plan-name>/events/`
- in the plan manifest `## Artifacts` section, write exactly:
  - `* Workflow state: \`N/A: manual plan-bound execution\``
  - `* File ownership: \`N/A: manual plan-bound execution\``
  - `* Files: \`N/A: manual plan-bound execution\``
  - `* Context: \`N/A: manual plan-bound execution\``
  - `* Events: \`N/A: manual plan-bound execution\``
- do not require `sync-plan-artifacts`, `plan-validator`, or runner snapshots
  before continuing into manual execution

If execution mode is `runner-managed`, create the following artifacts exactly as
specified below.

Write `.ai/artifacts/<plan-name>/state/files.json` with:

- `created`
- `modified`
- `deleted`
- `changedFiles`
- `released`
- `headSha`

The `created`, `modified`, `deleted`, `changedFiles`, and `released` fields MUST be string arrays. Do not use legacy aliases such as `createdFiles`, `modifiedFiles`, or `deletedFiles`.

This artifact is the review and commit changed-file inventory. It should list the expected created, modified, and deleted file paths inferred from the request, spec, and codebase. It is reconciled after implementation by `execute-plan` from actual git changes.

Do not write workflow state into `files.json`. Workflow state belongs only in the plan manifest and `workflow.json`.

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
- `nextAction`: `sync-plan-artifacts`
- `latest`: `{}`
- `history`: `[]`
- `unresolvedBlockers`: `[]`

Do not use legacy aliases such as `latestEvent`, `latestValidation`, `latestReview`, or `compactHistory`.

Write `.ai/artifacts/<plan-name>/state/file-ownership.json` with the planning-time ownership boundary.

It MUST be valid JSON with exactly the runner-required ownership fields:

- `planPath`: string
- `owns`: string array of repo-relative exact file paths or directory globs ending in `/**`
- `released`: string array; use `[]` during initial plan creation
- `resolvedFiles`: string array of concrete repo-relative files expected to be changed by the plan
- `changedFiles`: string array matching the initial expected changed-file inventory from `files.json`
- `headSha`: current `git rev-parse HEAD` string
- `updatedAt`: ISO timestamp string

Do not write `status` or `nextAction` into `file-ownership.json`. Workflow state belongs only in the plan manifest and `workflow.json`.

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

## Runner-Managed File Coverage Enforcement (CONDITIONAL)

For `runner-managed` mode:

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
- verify any flow-trace artifacts required by the plan are present and valid
- for `runner-managed` mode, verify `.ai/artifacts/<plan-name>/state/files.json` is complete
- for `runner-managed` mode, verify Phase ↔ files artifact mapping is consistent

If any requirement fails:

→ regenerate the plan

---

## Completion Condition

The task is complete ONLY when:

1. the plan follows the template exactly
2. spec is fully defined (no ambiguity)
3. all required sections are present
4. for `runner-managed` mode, file coverage is complete and consistent
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
