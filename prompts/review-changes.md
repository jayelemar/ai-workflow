# Review Changes (Combined Harness Review)

This prompt defines the single default combined harness review for the
runner-managed `review + review-plan` workflow entry.

The review must validate spec correctness, user-journey coverage, validation
evidence, regression risk, rule compliance, scope control, and code quality in
one pass. It must not hand off to `review-quality.md` during normal successful
review.

---

## Instruction Loading

Read:

* `.codex/AGENTS.md`
* `.ai/instructions/shared/workflow-state.md`
* `.ai/instructions/shared/reasoning-quality.md`
* `.ai/instructions/shared/debugging.md` when classifying failures or review remediation risk
* `.ai/instructions/shared/testing.md` before running, skipping, or classifying validation
* the repo-relative `*.spec.md` path(s) listed under the plan's `## Spec` section (if any)
* the `.ai/artifacts/<plan-name>/user-journey.md` file listed under `## User Journey Artifact` when the plan is user-facing
* `.ai/artifacts/<plan-name>/implementation-map.md` when the plan is user-facing
* runner-owned context snapshot `.ai/artifacts/<plan-name>/state/context.md` as the primary current-state source
* Active Context Packet instruction files selected from `.ai/instructions/index.md`
* the full plan file only when exact plan edits are required or the snapshot is insufficient

Use the runner-provided Active Context Packet and index-selected instruction
files only. Do not broadly load `.ai/instructions/**`.
Read the full plan only when exact plan edits are required or the snapshot is
insufficient.
Do not load full historical sections unless the snapshot is insufficient.
If the runner provides a `Workflow token guardrail` note for this run, honor it
as mandatory snapshot-first discipline without overriding the runner-injected
path-scoped staged diff source, required specs, latest validation evidence,
workflow state, or other correctness-critical review inputs.

Apply shared reasoning-quality guidance for edge-case checks and scope
discipline.
This harness review stage must not spawn subagents, load plugin skills, or run
a separate review system.

---

## Plan Input (MANDATORY)

.ai/plans/<plan-name>.md

If not provided:

-> output `STOP`
-> state blocking reason (`plan file is required`)
-> do not proceed

---

## Diff Source (MANDATORY)

Review MUST be performed using only the runner-injected staged paths for the
current plan. For thin-plan-v2 plans, the runner stages paths from
`.ai/artifacts/<plan-name>/state/files.json` and checks
`.ai/artifacts/<plan-name>/state/file-ownership.json`; legacy thin-plan-v1
plans may still use inline file sections.

Workflow-runner owns review staging. When review fails and routes back to execution, remediation must tell the operator or next execution agent to fix the working tree and leave files unstaged, then rerun workflow-runner. Do not tell the operator to stage or restage review fixes; pre-staged files block the next review entry.

Use the path-scoped staged diff command injected by `workflow-runner.ts`:

git diff --staged -- <plan-owned paths>

Use the path-scoped staged summary command injected by `workflow-runner.ts`
before the full diff when you only need file status:

git diff --staged --name-status -- <plan-owned paths>

Do NOT use bare `git diff --staged` as the primary review source.

If the path-scoped staged diff is empty:

-> STOP (`no staged changes to review`)

If staged implementation paths do not match the expected changed-file inventory in `.ai/artifacts/<plan-name>/state/files.json`:

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

-> STOP (`plan must be in review state before reviewing`)

---

Read:

## Next Action

Expected:

review-plan

IF Next Action != review-plan:

-> STOP (`unexpected next action for review`)

---

## Isolation Assumption (MANDATORY)

Assume this review is plan-scoped.

Verify:

* path-scoped staged changes belong ONLY to this plan
* no unrelated hunks are included inside the plan-owned files

Ignore staged files outside the current plan path list.
Do not unstage, reset, modify, or otherwise alter unrelated files outside the
current plan path list.
The runner may auto-unstage clearly unrelated staged hunks before review; review the remaining path-scoped staged diff only.

If unrelated changes remain after runner cleanup inside the path-scoped diff:

-> STOP (`non plan-scoped changes detected`)

### Cross-Plan Required Fixes

If review finds that a required fix needs a file outside the current plan path
list:

* Determine whether that file is owned by another active plan or a live workflow-runner file lock.
* If the file is owned by another active plan, classify the finding as `plan dependency`.
* Record the required file path and owner plan path in the review issue.
* Do not approve the current plan.
* Do not expand the current review scope to include the other plan's file.
* Set `Status = active` and `Next Action = execute-plan` so the next execution run can update the plan into a `plan dependency` blocker with `Status = blocked` and `Next Action = unblock-plan`.

If the required fix needs a file outside the current plan path list and no owner
plan can be identified:

-> STOP (`file outside plan scope`)

### File Ownership Releases

If the current plan contains `## File Ownership Releases` entries with
`Status: transferred`:

* treat those files as no longer owned by the releasing plan
* reject the review for the releasing plan if the path-scoped diff includes a transferred file
* do not approve, stage, or validate released-file hunks for the releasing plan
* tell the operator to review the transferred file only under the `Released To` plan

If review validates a release entry itself, confirm that `Released To`,
`Status: transferred`, and evidence are present. Missing release evidence is a
CRITICAL issue.

---

## Source of Truth Priority

1. Spec (if exists)
2. User-journey artifact for user-facing plans
3. Path-scoped staged diff
4. Plan (reference only)

Spec remains authoritative. If the user-journey artifact conflicts with the
spec, treat the spec as correct and mark the flow, plan, or implementation
mismatch as a review issue.

---

## Review Scope

### Task Savepoint Mode

If the runner injects `Task savepoint current task`:

* review ONLY the staged diff for that task ID and task name
* verify the current task's validation evidence before approving it
* do not review or approve future `[task:...]` items
* if review fails, do not commit; set or keep `Status = active` and `Next Action = execute-plan`
* if review passes, route only the current task to `completed + commit-summary`

Analyze:

* changed files
* impacted modules
* shared logic
* dependencies
* user actions, visible states, failure branches, and acceptance scenarios from `.ai/artifacts/<plan-name>/user-journey.md` for user-facing plans

---

## Validation Areas

### 1. Correctness (PRIMARY)

If spec exists:

* ALL spec behaviors MUST be implemented
* NO behavior outside spec
* ALL edge cases handled

If mismatch:

-> mark as CRITICAL

### 1a. User Journey Coverage (MANDATORY FOR USER-FACING PLANS)

For user-facing plans, read `.ai/artifacts/<plan-name>/user-journey.md` and
`.ai/artifacts/<plan-name>/implementation-map.md`, then compare them with the
staged diff and validation evidence.

Check:

* each user action in the flow artifact is implemented by the staged diff or already covered by unchanged existing code referenced by the mapping
* every visible state in the flow artifact is represented in the implemented UI, API response, service behavior, or documented unchanged path
* every failure branch in the flow artifact is handled or explicitly deferred by spec-approved scope
* acceptance scenarios from the flow artifact have validation coverage through tests, focused checks, or explicit local evidence
* `.ai/artifacts/<plan-name>/implementation-map.md` accurately points each user action to applicable UI route/component, API route, backend service/module, database/storage effect, and tests

If a user-facing flow step lacks implementation coverage or validation
coverage:

-> mark as CRITICAL

If the staged diff implements behavior not present in the spec or user-journey
artifact:

-> mark as CRITICAL

If the user-journey artifact conflicts with the spec:

-> mark as CRITICAL and state that the spec remains authoritative

### 2. Regression Risk

Check:

* existing functionality impact
* shared logic impact
* breaking changes

If a regression risk is unacceptable or unmitigated:

-> mark as CRITICAL

### 3. Rule Compliance

Validate against:

* `.codex/AGENTS.md`
* Active Context Packet instruction files selected from `.ai/instructions/index.md`

If the staged diff violates repository rules or prompt contract requirements:

-> mark as CRITICAL

### 4. Code Quality

Check:

* readability
* consistency
* maintainability
* justified complexity

If the implementation is unsafe, confusing, or unjustifiably complex:

-> mark as CRITICAL

Actionable but low-risk improvements may be WARNING or SUGGESTION.

### 5. Validation Sufficiency

Check:

* tests executed
* commands run
* results recorded
* acceptance coverage for the intended behavior
* whether local proof is sufficient for the completed handoff

Rules:

* missing validation evidence for a claimed implemented behavior -> WARNING
* risky behavior change without validation evidence -> CRITICAL
* final validation requires deployed, manual, or external code may still pass only when the deferred validation note is explicit and the implementation is otherwise safe to commit

### 6. Scope Control

Ensure:

* no unrelated changes
* no scope expansion

---

## Severity Classification

### CRITICAL

* spec violation
* missing behavior
* incorrect logic
* file-list mismatch
* user-journey implementation gap
* user-journey validation gap
* breaking change
* unacceptable regression risk
* repository rule violation
* unsafe maintainability or complexity issue
* high-risk behavior change without validation evidence

### WARNING

* missing validation evidence for a low-risk claimed behavior
* deviation from plan-owned validation intent
* non-blocking regression risk note
* maintainability concern that does not block merge

### SUGGESTION

* readability improvement
* maintainability improvement

---

## Decision Logic (MANDATORY)

Thin-plan-v2 state parity rule:

* Every branch below that changes workflow state MUST update both the plan manifest `## Status` / `## Next Action` and `.ai/artifacts/<plan-name>/state/workflow.json` `status` / `nextAction`.
* After writing the review artifact and workflow state, reread both files before final output.
* If the plan manifest and workflow sidecar do not show the same `status + nextAction`, repair the mismatch before final output.
* If the mismatch cannot be repaired, output `STOP` with the exact manifest values and workflow sidecar values.

### IF any CRITICAL issues exist:

1. update the plan manifest:

## Status

active

## Next Action

execute-plan

2. add the next review entry.

Write `.ai/artifacts/<plan-name>/events/review-vX.md`, then update
`.ai/artifacts/<plan-name>/state/workflow.json` with runner-readable
thin-plan-v2 state: preserve `planPath`, set `status` and `nextAction`, write
the compact combined review event under `latest.review`, append the review
artifact path to `history`, set `unresolvedBlockers`, and refresh `updatedAt`.

For legacy thin-plan-v1 plans only, if the plan already contains
`## Review History`, append only:

### Review vX

* Summary: NEEDS FIX
* Evidence: .ai/artifacts/<plan-name>/events/review-vX.md
* Decision: active

Create `## Review History` only if the section is missing in a legacy
thin-plan-v1 plan.

Before updating the plan, create
`.ai/artifacts/<plan-name>/events/review-vX.md` with `# Review vX`,
`## Summary`, and `## Evidence`.
Put all issue bullets, file references, remediation notes, missing validations, and unresolved risks in the review artifact.
Review event artifacts use compact evidence: record the relevant command,
result, evidence path, short excerpt only when needed, actionable issue bullets,
file references, remediation notes, missing validations, unresolved risk notes,
and deferred validation notes when applicable.
Event artifacts must not include full raw stdout/stderr bodies, full raw diffs,
or raw Codex event streams.
Do not paste raw log dumps or full unscoped diffs into review artifacts; cite
the path-scoped diff command and include only the small excerpt needed to prove
the issue.
Review state entries may contain only compact `Summary`, `Decision`, and `Evidence` pointer fields.
Do not duplicate the `## Review History` heading in thin-plan-v2 manifests.

3. update plan with:

* required fixes
* missing validations
* unresolved risks
* implementation gaps

4. reread the plan manifest and `.ai/artifacts/<plan-name>/state/workflow.json`; verify both show `active + execute-plan` before final output.

---

### IF NO CRITICAL issues AND final validation requires deployed, manual, or external code:

Use this path when the implementation is safe to commit locally, but the final
proof will be performed manually by the operator after commit, deploy,
production access, external integration access, or another check outside the
local reviewed workspace.

1. update the plan manifest:

## Status

completed

## Next Action

commit-summary

2. create `.ai/artifacts/<plan-name>/events/review-vX.md` with `# Review vX`,
`## Summary`, and `## Evidence`, including the deferred validation note.

3. update `.ai/artifacts/<plan-name>/state/workflow.json` with
`latest.review.summary = SAFE - DEFERRED VALIDATION`,
`latest.review.decision = completed`, the review evidence pointer, appended
`history`, status, nextAction, and updatedAt.

4. reread the plan manifest and `.ai/artifacts/<plan-name>/state/workflow.json`; verify both show `completed + commit-summary` before final output.

5. do not create any extra plan section for this path. `commit-summary` records the local commit metadata. The operator performs the deferred validation manually after commit/deploy and reopens the plan if that check finds a required fix.

For legacy thin-plan-v1 plans only, append:

### Review vX

* Summary: SAFE - DEFERRED VALIDATION
* Evidence: .ai/artifacts/<plan-name>/events/review-vX.md
* Decision: completed

---

### IF NO CRITICAL issues AND local/final validation is complete:

Review passed:

Status = completed
Next Action = commit-summary

1. update the plan manifest:

## Status

completed

## Next Action

commit-summary

2. create `.ai/artifacts/<plan-name>/events/review-vX.md` with `# Review vX`,
`## Summary`, and `## Evidence`.

3. update `.ai/artifacts/<plan-name>/state/workflow.json` with
`latest.review.summary = SAFE`, `latest.review.decision = completed`, the
review evidence pointer, appended `history`, status, nextAction, and updatedAt.

4. reread the plan manifest and `.ai/artifacts/<plan-name>/state/workflow.json`; verify both show `completed + commit-summary` before final output.

Put optional warnings and suggestions in the review artifact.

For legacy thin-plan-v1 plans only, append:

### Review vX

* Summary: SAFE
* Evidence: .ai/artifacts/<plan-name>/events/review-vX.md
* Decision: completed

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
* Fold spec coverage, regression risk, rule compliance, validation sufficiency, and code quality into `**Issues**` only when actionable.
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
