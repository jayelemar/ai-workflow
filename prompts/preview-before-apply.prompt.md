# Preview Before Apply (Manual Post-Plan Controller)

This prompt defines an explicit manual post-plan path for draft, approved, or
active plans when the operator wants preview-gated execution writes.

It has two internal phases:

1. draft preflight validation/fix
2. preview-gated execution

It does NOT replace the workflow runner default.

It does NOT activate from a keyword or mode switch.

---

## Instruction Loading

Read:

* `.codex/AGENTS.md`
* `.ai/instructions/shared/workflow-state.md`
* `.ai/instructions/shared/testing.md`
* `.ai/instructions/index.md`
* the routed domain instruction files selected from `.ai/instructions/index.md` for the current plan step's code paths
* the repo-relative `*.spec.md` path(s) listed under the plan's `## Spec` section (if any)
* the full plan file

Load:

* `.ai/prompts/superpowers.md`

Use superpower skills:

* analyze

Do not broadly load `.ai/instructions/**` beyond the routed files required for
the current preflight or execution work.

---

## Plan Input (MANDATORY)

.ai/plans/<plan-name>.md

If not provided:

→ output `STOP`
→ state blocking reason (`plan file is required`)
→ do not proceed

---

## Invocation Contract

This prompt is valid only when invoked explicitly as:

```text
Use '.ai/prompts/preview-before-apply.prompt.md'
```

Treat this as a manual post-plan controller. The normal default path after plan
approval remains:

```text
pnpm exec tsx .ai/scripts/workflow-runner.ts .ai/plans/<plan-name>.md
```

If the operator intends to use the normal review flow afterward, this manual
execution path MUST keep the plan artifacts and workflow context snapshot
compatible with `review-changes.md`.

---

## State Validation (MANDATORY)

Read:

## Status

Allowed entry states:

* draft
* approved
* active

IF Status == draft:

* keep `Status = draft`
* require `Next Action = plan-validator` or `Next Action = fix-plan`
* enter the draft preflight loop

IF Status == approved:

* update Status → active
* keep Next Action → execute-plan
* enter execution in the same invocation

IF Status == active:

* resume from the current incomplete execution step

IF Status is any other value:

→ STOP (`plan is not in a supported manual preview state`)

---

Read:

## Next Action

IF Status == draft:

Allowed:

* plan-validator
* fix-plan

IF `Next Action` is any other value:

→ STOP (`unexpected next action for draft preflight`)

IF Status == approved or Status == active:

Expected:

execute-plan

IF `Next Action` != execute-plan:

→ STOP (`unexpected next action for execution`)

---

## Draft Preflight Loop (MANDATORY)

If the input plan is `draft`, mirror the workflow runner semantics for
`plan-validator.md` and `fix-plan.md` until one of these terminal conditions is
reached:

* the plan becomes `approved`
* a real blocking issue requires `STOP`

Loop rules:

* follow the plan's current `Status` and `Next Action` after each preflight update
* use `plan-validator.md` only when the plan is `draft + plan-validator`
* use `fix-plan.md` only when the plan is `draft + fix-plan`
* apply the same spec-origin handling as the runner path:
  * `MINOR SPEC REPAIR` may update only the exact allowed spec file and sections
  * plan-only overreach, omissions, file-scope issues, or reusable codebase contracts should be fixed without escalating to the user
  * `MAJOR SPEC DECISION REQUIRED`, missing user authority, or any non-fixable blocker MUST output `STOP`
* keep validation findings, plan edits, and allowed spec repairs aligned with the latest validation artifact/history
* once the plan becomes `approved`, continue in the same invocation by transitioning to `active + execute-plan`

Preflight write rules:

* plan edits made during draft preflight do NOT require a diff preview or approval gate
* allowed spec repairs made during draft preflight do NOT require a diff preview or approval gate
* the preview approval gate starts only when the prompt is about to write a non-test execution file

---

## Step Scope (MANDATORY)

During execution, handle exactly one current plan step at a time.

Rules:

* define the current step as the next incomplete numbered task in `## Phases`
* do not combine multiple numbered tasks into one approval cycle
* finish or block the current step before moving to the next step
* when a step has only test work or validation work remaining, that work may be completed in the same run without extra approval

---

## Test-First Allowance

The following do NOT require separate approval before writing or running:

* test files and test-only fixtures
* test code changes in existing test files
* test commands
* validation commands selected under `.ai/instructions/shared/testing.md`

Treat test-only paths according to existing repository conventions, including:

* `*.test.*`
* `*.spec.*`
* `__tests__/`
* other clearly test-only directories already used by the repository

If a file mixes test-only content with production behavior or shared runtime
behavior, treat it as a non-test file.

---

## Non-Test Write Approval Gate (MANDATORY)

This gate applies only after draft preflight has finished and the plan is in
execution.

Before any write to a non-test file:

1. prepare the exact patch for the current step
2. present a human-readable approval preview first, using contextual code snippets that show the change in place
3. identify the current plan step and the exact non-test files affected
4. show a compact edited-file summary for the current step as a full-line clickable file link whose label is in the form `MOD path/to/file.tsx (+A -D)` or `NEW path/to/file.tsx (+A -D)` before the code preview
5. STOP and wait for explicit operator approval

Rules:

* do not write the non-test file before approval
* approval applies only to the current plan step
* do not treat prior approval as permission for later steps
* if the patch changes after approval, show the new linked file summary and readable preview, then wait again
* if test-only edits are needed to support the preview, those may be written before approval
* draft-preflight plan/spec edits are outside this approval gate when they follow the preflight rules above
* lead with the linked edited-file summary, then the file path and a short change map before showing code
* use the same linked summary style for code files, test files, plan files, context snapshots, and artifact files touched in the current run
* format each summary line as a clickable markdown file link whose entire label is the summary text, for example `[MOD src/file.tsx (+12 -3)](/abs/path/src/file.tsx)`
* use `MOD`, `NEW`, or `DEL` in the summary label as appropriate for the file state in the current step
* prefer fenced code blocks using the real file language such as `tsx`, `ts`, `js`, `jsx`, `sql`, `css`, or `md`
* show surrounding code so the operator can see where the change lands in the file, similar to an in-place editor view
* use short inline markers such as `// new`, `// changed`, or `/* new */` only where they help pinpoint the exact edited lines
* it is acceptable to collapse unrelated unchanged sections with concise placeholders such as `...rest of code`
* do not include raw diff output or patch text unless the operator explicitly asks to see it

When waiting for approval, the primary review surface must be the linked
edited-file summary plus the contextual code preview.

---

## Out-of-Scope File Gate (MANDATORY)

Use the plan's `## Files (MANDATORY)` section as the non-test ownership
boundary.

If the current step requires a non-test file outside that boundary:

→ STOP (`non-test file outside plan scope`)
→ state the exact file path
→ require a plan update before continuing

Do not silently expand plan scope during manual execution.

This gate does NOT block draft-preflight edits to the plan itself or allowed
minor spec repairs.

---

## Implementation Rules

For the current step only:

* implement only behavior already covered by the spec and plan
* preserve existing behavior unless the spec or plan requires a change
* do not introduce unrelated refactors
* use the smallest validation that gives confidence for the current step

If the codebase contradicts the plan or spec in a way that prevents safe
execution:

→ STOP (`plan/codebase mismatch`)

---

## Artifact Compatibility (MANDATORY)

Manual work using this prompt MUST maintain a review-compatible artifact
trail under:

```text
.ai/artifacts/<plan-name>/
```

### Draft Preflight Responsibilities

During `draft` preflight:

* keep `## Validation History` current through the normal `plan-validator` / `fix-plan` loop
* keep any allowed plan/spec repairs traceable to the latest validation findings
* do not use the execution diff approval gate for those preflight plan/spec writes
* refresh the workflow context snapshot after each plan update so later review-compatible stages read current state

### Execution Artifacts

Before updating the plan for execution progress, create the next sequential
execution artifact:

```text
.ai/artifacts/<plan-name>/events/execution-vX.md
```

The artifact must include:

```markdown
# Execution vX

## Summary

<short execution summary>

## Evidence

<commands, outputs, files changed, approvals, blockers, or other proof>
```

Then append the matching thin plan entry under `## Execution Log`:

```markdown
### Execution vX

* Summary:
* Result: completed | partial | blocked
* Evidence: .ai/artifacts/<plan-name>/events/execution-vX.md
```

### Validation Artifacts

Whenever validation runs or is explicitly deferred, create the next sequential
validation artifact:

```text
.ai/artifacts/<plan-name>/events/validation-vX.md
```

The artifact must include:

```markdown
# Validation vX

## Summary

<short validation summary>

## Evidence

<commands run, result details, failures, or deferred-risk notes>
```

Then append the matching thin plan entry under `## Validation History`:

```markdown
### Validation vX

* Summary:
* Result: PASS | NEEDS FIX | DEFERRED
* Evidence: .ai/artifacts/<plan-name>/events/validation-vX.md
```

### Context Snapshot

After each plan update, refresh:

```text
.ai/artifacts/<plan-name>/state/context.md
```

The snapshot must stay compatible with the `review-changes.md` expectation that
it is the primary current-state source. At minimum it must reflect the latest
plan content using these sections:

```markdown
# Workflow Context Snapshot: <plan-name>
## Plan Path
## Current State
## Spec Paths
## Plan-Owned Files
## Summary
## Key Details
## Validation
## Review
## Latest Review Remediation Context
## Active Blockers
```

Rules:

* keep the snapshot aligned with the latest plan `Status`, `Next Action`,
  owned files, latest execution summary, latest validation summary, latest
  review summary, and active blockers
* use `(none)` or `(none recorded)` for snapshot sections that do not yet have
  content
* do not rely on historical runner logs to reconstruct current state
* if the snapshot cannot be updated, STOP before handing off to review

---

## Plan Progress Updates (MANDATORY)

Keep plan progress, `## Status`, and `## Next Action` aligned with
`.ai/instructions/shared/workflow-state.md`.

At minimum after each run:

* record the completed or partial execution progress for the current step in
  `## Execution Log`
* record validation results in `## Validation History` when validation runs
* keep the execution and validation event artifacts in sync with those plan
  entries
* refresh the workflow context snapshot after updating the plan
* keep `Status = active` and `Next Action = execute-plan` while implementation
  work remains
* set `Status = blocked` and `Next Action = unblock-plan` only for true
  execution blockers
* set `Status = review` and `Next Action = review-plan` only after all planned
  execution work is complete and local validation for plan-owned changes is done

Execution using this prompt MUST NOT set:

* `Status = completed`
* `Next Action = commit-summary`

Keep inline history concise and consistent with the thin-plan rules already used
by the plan template. Put detailed evidence in the artifact files instead of the
plan body.

---

## Validation

Before marking a step complete:

* run the smallest relevant validation for the current step
* classify skipped validation or deferred validation explicitly
* keep browser/manual/deployed/external validation deferred to review when local
  implementation work is otherwise complete

If validation finds more implementation work already covered by the plan:

* keep `Status = active`
* keep `Next Action = execute-plan`

If validation cannot proceed because of a true blocker:

* follow the blocked transition

---

## Output Contract

Use one of these outcomes only:

### 1. Approval Required

Use when a non-test write is ready but not yet approved.

**Plan**

.ai/plans/<plan-name>.md

**Summary**

* APPROVAL REQUIRED
* current plan step identified
* no non-test files were written

**Key Details**

* step being executed
* exact non-test files that would change

**Patch Preview**

```diff
<exact patch>
```

**Next**

Status:

* active

Next Action:

* execute-plan

Waiting for Approval:

* yes

### 2. Execution Update

Use after a step completes, remains active, or becomes blocked without waiting
for non-test approval.

**Plan**

.ai/plans/<plan-name>.md

**Summary**

* ACTIVE | REVIEW READY | BLOCKED
* current step result

**Key Details**

* work completed or blocker found
* files or tests affected

**Validation**

* commands run
* result or deferral note

**Next**

Status:

* active
* review
* blocked

Next Action:

* execute-plan
* review-plan
* unblock-plan
