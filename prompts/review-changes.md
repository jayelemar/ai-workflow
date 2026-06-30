# Review Changes (State-Machine Driven)

This prompt defines review-specific behavior only.

---

## Instruction Loading

Read:

* `.codex/AGENTS.md`
* `.ai/instructions/shared/workflow-state.md`
* `.ai/instructions/shared/testing.md` before running, skipping, or classifying validation
* the repo-relative `*.spec.md` path(s) listed under the plan's `## Spec` section (if any)
* the `.ai/artifacts/<plan-name>/product-flow.md` file listed under `## User Flow Artifact` when the plan is user-facing
* runner-owned context snapshot `.ai/artifacts/<plan-name>/state/context.md` as the primary current-state source
* Active Context Packet instruction files selected from `.ai/instructions/index.md`
* the full plan file only when exact plan edits are required or the snapshot is insufficient

Use the runner-provided Active Context Packet and index-selected instruction files only. Do not broadly load `.ai/instructions/**`.
Read the full plan only when exact plan edits are required or the snapshot is insufficient.
Do not load full historical sections unless the snapshot is insufficient.
Review remains quality-first even after a prior token spike: use the snapshot first, but keep fallback access to the full plan or exact event files whenever needed for correctness.

Load:

* `.ai/prompts/superpowers.md`

Apply the superpowers advisory guidance for analysis and edge-case checks.

---

## Plan Input (MANDATORY)

.ai/plans/<plan-name>.md

If not provided:

→ output `STOP`
→ state blocking reason (`plan file is required`)
→ do not proceed

---

## Diff Source (MANDATORY)

Review MUST be performed using only the runner-injected staged paths for the current plan. For plans with `## Ownership Scope`, the runner stages actual changed files resolved from `.ai/artifacts/<plan-name>/state/file-ownership.json`; otherwise it uses the legacy `## Files (MANDATORY)` paths.

Use the path-scoped staged diff command injected by `workflow-runner.ts`:

git diff --staged -- <plan-owned paths>

Use the path-scoped staged summary command injected by `workflow-runner.ts` before the full diff when you only need file status:

git diff --staged --name-status -- <plan-owned paths>

Do NOT use bare `git diff --staged` as the primary review source.

If the path-scoped staged diff is empty:

→ STOP (`no staged changes to review`)

If staged implementation paths do not match the expected changed-file inventory in `## Files (MANDATORY)`:

* classify the finding as a `file-list mismatch`
* do not repair the file list during review
* set `Status = active`
* set `Next Action = execute-plan`
* record the exact missing or extra path correction needed for execution to reconcile the changed-file inventory

---

## State Validation (CRITICAL)

Read:

## Status

Expected:

review

IF Status != review:

→ STOP (`plan must be in review state before reviewing`)

---

Read:

## Next Action

Expected:

review-plan

IF Next Action != review-plan:

→ STOP (`unexpected next action for review`)

---

## Isolation Assumption (MANDATORY)

Assume this review is plan-scoped.

Verify:

* path-scoped staged changes belong ONLY to this plan
* no unrelated hunks are included inside the plan-owned files

Ignore staged files outside the current plan path list.
Do not unstage, reset, modify, or otherwise alter unrelated files outside the current plan path list.
The runner may auto-unstage clearly unrelated staged hunks before review; review the remaining path-scoped staged diff only.

If unrelated changes remain after runner cleanup inside the path-scoped diff:

→ STOP (`non plan-scoped changes detected`)

### Cross-Plan Required Fixes

If review finds that a required fix needs a file outside the current plan path list:

* Determine whether that file is owned by another active plan or a live workflow-runner file lock.
* If the file is owned by another active plan, classify the finding as `plan dependency`.
* Record the required file path and owner plan path in the review issue.
* Do not approve the current plan.
* Do not expand the current review scope to include the other plan's file.
* Set `Status = active` and `Next Action = execute-plan` so the next execution run can update the plan into a `plan dependency` blocker with `Status = blocked` and `Next Action = unblock-plan`.

If the required fix needs a file outside the current plan path list and no owner plan can be identified:

→ STOP (`file outside plan scope`)

### File Ownership Releases

If the current plan contains `## File Ownership Releases` entries with `Status: transferred`:

* treat those files as no longer owned by the releasing plan
* reject the review for the releasing plan if the path-scoped diff includes a transferred file
* do not approve, stage, or validate released-file hunks for the releasing plan
* tell the operator to review the transferred file only under the `Released To` plan

If review validates a release entry itself, confirm that `Released To`, `Status: transferred`, and evidence are present. Missing release evidence is a CRITICAL issue.

---

## Source of Truth Priority

1. Spec (if exists)
2. User-flow artifact for user-facing plans
3. Path-scoped staged diff
4. Plan (reference only)

Spec remains authoritative. If the user-flow artifact conflicts with the spec, treat the spec as correct and mark the flow, plan, or implementation mismatch as a review issue.

---

## Review Scope

Analyze:

* changed files
* impacted modules
* shared logic
* dependencies
* user actions, visible states, failure branches, and acceptance scenarios from `.ai/artifacts/<plan-name>/product-flow.md` for user-facing plans

---

## Validation Areas

### 1. Correctness (PRIMARY)

If spec exists:

* ALL spec behaviors MUST be implemented
* NO behavior outside spec
* ALL edge cases handled

If mismatch:

→ mark as CRITICAL

---

### 1a. User-Flow Coverage (MANDATORY FOR USER-FACING PLANS)

For user-facing plans, read `.ai/artifacts/<plan-name>/product-flow.md` and compare it with the staged diff, validation evidence, and the plan's `## Flow-to-File Mapping`.

Check:

* each user action in the flow artifact is implemented by the staged diff or already covered by unchanged existing code referenced by the mapping
* every visible state in the flow artifact is represented in the implemented UI, API response, service behavior, or documented unchanged path
* every failure branch in the flow artifact is handled or explicitly deferred by spec-approved scope
* acceptance scenarios from the flow artifact have validation coverage through tests, focused checks, or an explicit deferred validation note when local proof is unavailable
* `## Flow-to-File Mapping` accurately points each user action to applicable UI route/component, API route, backend service/module, database/storage effect, and tests

If a user-facing flow step lacks implementation coverage or validation coverage:

→ mark as CRITICAL

If the staged diff implements behavior not present in the spec or product-flow artifact:

→ mark as CRITICAL

If the product-flow artifact conflicts with the spec:

→ mark as CRITICAL and state that the spec remains authoritative

---

### 2. Regression Risk

Check:

* existing functionality impact
* shared logic impact
* breaking changes

---

### 3. Rule Compliance

Validate against:

* `.codex/AGENTS.md`
* Active Context Packet instruction files selected from `.ai/instructions/index.md`

---

### 4. Scope Control

Ensure:

* no unrelated changes
* no scope expansion

---

### 5. Code Quality

Check:

* readability
* consistency
* justified complexity

---

### 6. Validation Evidence (MANDATORY)

Check:

* tests executed
* commands run
* results recorded

Rules:

* missing validation → WARNING
* risky change without validation → CRITICAL

---

## Severity Classification

### CRITICAL

* spec violation
* missing behavior
* incorrect logic
* breaking change
* high-risk change without validation

---

### WARNING

* missing validation evidence
* deviation from plan
* potential regression risk

---

### SUGGESTION

* readability improvement
* maintainability improvement

---

## Decision Logic (MANDATORY)

### IF any CRITICAL issues exist:

1. update:

## Status

active

## Next Action

execute-plan

2. add the next review entry.

If the plan already contains `## Review History`, append only:

### Review vX

* Summary: NEEDS FIX
* Evidence: .ai/artifacts/<plan-name>/events/review-vX.md
* Decision: active

Create `## Review History` only if the section is missing.

Before updating the plan, create `.ai/artifacts/<plan-name>/events/review-vX.md` with `# Review vX`, `## Summary`, and `## Evidence`.
Put all issue bullets, file references, remediation notes, missing validations, and unresolved risks in the review artifact.
Review History entries may contain only `Summary`, `Decision`, and `Evidence`.
Review History entries must stay under 512 bytes.
MUST NOT duplicate the `## Review History` heading when it already exists.

3. update plan with:

* required fixes
* missing validations
* unresolved risks
* implementation gaps

---

### IF NO CRITICAL issues AND final validation requires deployed, manual, or external code:

Use this path when the implementation is safe to commit locally, but the final proof will be performed manually by the operator after commit, deploy, production access, external integration access, or another check outside the local reviewed workspace.

1. update:

## Status

completed

## Next Action

commit-summary

2. add the next review entry.

If the plan already contains `## Review History`, append only:

### Review vX

Add a deferred validation note:

* Summary: SAFE - DEFERRED VALIDATION
* Evidence: .ai/artifacts/<plan-name>/events/review-vX.md
* Decision: completed

Create `## Review History` only if the section is missing.

Before updating the plan, create `.ai/artifacts/<plan-name>/events/review-vX.md` with `# Review vX`, `## Summary`, and `## Evidence`.
Put optional warnings, suggestions, and the specific deferred validation in the review artifact.

3. do not create any extra plan section or event artifact for this path. `commit-summary` records the local commit metadata. The operator performs the deferred validation manually after commit/deploy and reopens the plan if that check finds a required fix.

---

### IF NO CRITICAL issues AND local/final validation is complete:

1. update:

## Status

completed

## Next Action

commit-summary

2. add the next review entry.

If the plan already contains `## Review History`, append only:

### Review vX

* Summary: SAFE
* Evidence: .ai/artifacts/<plan-name>/events/review-vX.md
* Decision: completed

Create `## Review History` only if the section is missing.

Before updating the plan, create `.ai/artifacts/<plan-name>/events/review-vX.md` with `# Review vX`, `## Summary`, and `## Evidence`.
Put optional warnings and suggestions in the review artifact.

---

## Output (MANDATORY)

Keep output compact for terminal readability.

Rules:

* `**Summary**` starts with the stage result/state line, then at most 2-3 short high-signal bullets.
* If Summary is `NEEDS FIX` or `HIGH RISK`, `**Issues**` must include at least one issue bullet.
* If Summary is `NEEDS FIX` or `HIGH RISK`, do not rely on a plan-update summary alone; print the concrete conflict, defect, missing validation, or required fix in `**Issues**`.
* `**Issues**` must mirror the actionable review artifact findings so terminal output shows what needs to be fixed without opening the artifact file.
* Issue bullets must be one sentence each and actionable.
* Issue bullets must be self-contained and remediation-ready.
* Issue bullets must not rely on surrounding prose, earlier review versions, or shorthand like `same as above`.
* Do not use Review History for terminal-output summaries; keep detailed findings in the artifact.
* Issues: include all CRITICAL issues; include WARNING and SUGGESTION items only when actionable.
* Terminal issue bullets should focus on the problem details, not lead with file paths.
* File and line references should stay in the review artifact; use inline terminal refs only when needed to avoid ambiguity.
* Do not include long examples unless they are required to prove the issue.
* Do not output separate spec coverage or regression risk sections.
* Fold spec coverage and regression risk into `**Issues**` only when actionable.
* Keep `**Final Verdict**` exactly in the checkbox format below.

**Plan**

.ai/plans/<plan-name>.md

**Summary**

* SAFE
* NEEDS FIX
* HIGH RISK

**Issues**

* ...

**Final Verdict**

- [ ] safe to merge
- [ ] requires fixes
- [ ] block merge

**Next**

Status:

* active
* completed

Next Action:

* execute-plan
* commit-summary
