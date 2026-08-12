# Create Plan (Template-Driven)

This prompt creates a structured implementation plan only.

---

## Protected-Branch Guard (MANDATORY)

Before resolving execution mode, reading the spec, or creating or modifying any
file, run:

`git rev-parse --abbrev-ref HEAD`

If the command fails or returns no branch name:

→ STOP
→ state: `could not determine current git branch before creating plan`
→ do NOT read planning inputs or create, modify, or delete any files

If the branch is exactly `main`, `master`, `dev`, `development`, or `staging`:

→ STOP
→ state: `plan creation blocked on protected branch <branch>`
→ do NOT read planning inputs or create, modify, or delete any files

Detached `HEAD` and branches not listed above may continue.

---

## Instruction Loading

Read:

- `.codex/AGENTS.md`
- `.ai/instructions/shared/ai-workflow.md`
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

For `runner-managed` plans, new draft plans MUST start at
`workflowState = draft-artifact-sync` in both manifest and workflow sidecar.

The workflow runner performs `sync-plan-artifacts` after plan creation and
before `plan-validator`.

For `manual` plans, set `## Workflow State` to
`N/A: manual plan-bound execution`; do not create routing state artifacts.
After saving either a `manual` or `runner-managed` plan, append the plan token
checkpoint. This records pre-run planning usage in the same ledger the runner
will continue to use:

`pnpm exec tsx .ai/scripts/workflow/telemetry/manual-token-usage.ts --plan <plan-name> --stage plan`

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

Apply this contract only to new or `draft` runner-managed plans. Manual plans
are not required to use the commit-savepoint structure or commit guarantees.
Never rewrite task IDs, task boundaries, or runner artifacts for plans already
in `active`, `review`, `blocked`, or `completed` workflow state.

Two outcomes MUST be separate tasks when they are independently implementable
and validatable and have distinct reasons to review or revert. There is no
fixed savepoint count.

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

For one atomic outcome, use the same fields but omit the `[task:...]` ID and
retain the existing single final-commit behavior.

Rules:

- Use unique stable two-digit IDs with lowercase hyphenated words only when
  multiple atomic outcomes exist.
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
  8 commit paths` and a concrete coupling rationale. Eight or fewer use
  `Size warning: N/A`.
- If a valid split remains uncertain after bounded repair, keep the task
  executable, explain the fallback in `Coupling rationale`, record the exact
  unresolved boundary in `Atomization warning`, and continue to normal
  operator approval. Otherwise use `Atomization warning: N/A`.
- Do not use generic coupling wording such as `related changes` or `same
  feature`.
- Preparation and final aggregate validation MUST remain untagged and MUST NOT
  become commit savepoints.
- Task savepoint artifacts will be written by the runner under `.ai/artifacts/<plan-name>/tasks/`.
- The runner will write the live task pointer at `.ai/artifacts/<plan-name>/state/current-task.md`.

### Commit Boundaries

The default is exactly one local commit for each reviewed task savepoint. First
split independently implementable and validatable outcomes into separate task
savepoints. Do not use commit boundaries merely because a task touches multiple
apps, layers, or tests.

When one accepted task must remain a single execution and review savepoint, but
the operator needs an atomized commit history, add `## Commit Boundaries` after
`## Phases` using the plan template's exact structure. Add an entry only for
that task ID and only when all of these are true:

- the task has a concrete `Coupling rationale` and, when applicable, its
  `Size warning` or `Atomization warning` explains why separate task
  savepoints would be misleading or unsafe;
- it lists two to twelve dependency-ordered boundaries;
- every changed plan-owned implementation path belongs to exactly one
  boundary, and every boundary path is within that task's plan-owned scope;
- a file group is narrow and intentional, never a catch-all for unrelated
  paths; and
- each boundary includes the focused tests required for its implementation.

Do not create a boundary entry for manual plans, one-final-commit plans, or
final aggregate validation. The runner reviews the complete task before its
boundaries are committed, creates one local commit per listed boundary, and
creates no aggregate commit afterward.

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
- `workflowState`
- `latest`
- `history`
- unresolved blockers
- `updatedAt`

The initial `workflow.json` MUST use:

- `workflowState`: `draft-artifact-sync`
- `latest`: `{}`
- `history`: `[]`
- `unresolvedBlockers`: `[]`

Do not use legacy aliases such as `latestEvent`, `latestValidation`, `latestReview`, or `compactHistory`.

For a plan named `<plan-name>`, write this complete initial shape, replacing
only `updatedAt` with the current ISO timestamp:

```json
{
  "planPath": ".ai/plans/<plan-name>.md",
  "workflowState": "draft-artifact-sync",
  "latest": {},
  "history": [],
  "unresolvedBlockers": [],
  "updatedAt": "<ISO timestamp>"
}
```

Before returning, reread and validate this file. A sidecar containing only
`workflowState` is incomplete and must be repaired before the runner starts.

Write `.ai/artifacts/<plan-name>/state/file-ownership.json` with the planning-time ownership boundary.

It MUST be valid JSON with exactly the runner-required ownership fields:

- `planPath`: string
- `owns`: string array of repo-relative exact file paths or directory globs ending in `/**`
- `released`: string array; use `[]` during initial plan creation
- `resolvedFiles`: string array of concrete repo-relative files expected to be changed by the plan
- `changedFiles`: string array matching the initial expected changed-file inventory from `files.json`
- `headSha`: current `git rev-parse HEAD` string
- `updatedAt`: ISO timestamp string

Do not write workflow routing fields into `file-ownership.json`. `workflowState` belongs only in the plan manifest and `workflow.json`.

Write `.ai/artifacts/<plan-name>/state/context.md` with an initial runner context snapshot.

It MUST:

- exist before returning from create-plan
- identify the plan path, spec path, workflow state, and required artifact paths
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
- for `runner-managed` mode, verify `## Workflow State` is present
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
