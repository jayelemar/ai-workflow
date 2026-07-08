# Review Quality (Stage 2 Quality Review)

This prompt defines stage-2 quality review behavior only.
It must not run unless stage-1 spec review already passed in the same `review + review-plan` workflow entry.

---

## Instruction Loading

Read:

* `.codex/AGENTS.md`
* `.ai/instructions/shared/workflow-state.md`
* `.ai/instructions/shared/testing.md` before running, skipping, or classifying validation
* the repo-relative `*.spec.md` path(s) listed under the plan's `## Spec` section (if any)
* the `.ai/artifacts/<plan-name>/user-journey.md` file listed under `## User Journey Artifact` when the plan is user-facing
* runner-owned context snapshot `.ai/artifacts/<plan-name>/state/context.md` as the primary current-state source
* Active Context Packet instruction files selected from `.ai/instructions/index.md`
* the full plan file only when exact plan edits are required or the snapshot is insufficient

Use the runner-provided Active Context Packet and index-selected instruction files only. Do not broadly load `.ai/instructions/**`.
Read the full plan only when exact plan edits are required or the snapshot is insufficient.
Do not load full historical sections unless the snapshot is insufficient.
If the runner provides a `Workflow token guardrail` note for this run, honor it as mandatory snapshot-first discipline without overriding the runner-injected path-scoped staged diff source, required specs, latest validation evidence, workflow state, spec-review pass evidence, or other correctness-critical review inputs.

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

## Spec Review Gate (MANDATORY)

This prompt must not run unless stage-1 spec review passed.

For thin-plan-v2 plans:

* read `.ai/artifacts/<plan-name>/state/workflow.json`
* require `latest.reviewSpec`
* require the latest spec-review evidence pointer to reference `review-spec-vX.md`
* require `latest.reviewSpec.decision = review`
* require `latest.reviewSpec.summary = SPEC PASS` or another explicit stage-1 pass summary

For legacy thin-plan-v1 plans:

* require the latest `## Review History` entry to reference `.ai/artifacts/<plan-name>/events/review-spec-vX.md`
* require that latest entry to record `Decision: review`

If stage-1 spec review pass evidence is missing:

→ output `STOP`
→ state blocking reason (`review-quality must not run unless stage-1 spec review passed`)

---

## Diff Source (MANDATORY)

Review MUST be performed using only the runner-injected staged paths for the current plan.

Workflow-runner owns review staging. When review fails and routes back to execution, remediation must tell the operator or next execution agent to fix the working tree and leave files unstaged, then rerun workflow-runner. Do not tell the operator to stage or restage review fixes; pre-staged files block the next review entry.

Use the path-scoped staged diff command injected by `workflow-runner.ts`:

git diff --staged -- <plan-owned paths>

Use the path-scoped staged summary command injected by `workflow-runner.ts` before the full diff when you only need file status:

git diff --staged --name-status -- <plan-owned paths>

Do NOT use bare `git diff --staged` as the primary review source.

If the path-scoped staged diff is empty:

→ STOP (`no staged changes to review`)

---

## State Validation (CRITICAL)

Read:

## Status

Expected:

review

IF Status != review:

→ STOP (`plan must remain in review state before quality review`)

---

Read:

## Next Action

Expected:

review-plan

IF Next Action != review-plan:

→ STOP (`unexpected next action for quality review`)

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

---

## Review Scope

### Task Savepoint Mode

If the runner injects `Task savepoint current task`:

* review ONLY the staged diff for that task ID and task name
* do not review or approve future `[task:...]` items
* if review fails, do not commit; set or keep `Status = active` and `Next Action = execute-plan`
* if review passes, route only the current task to `completed + commit-summary`

---

## Validation Areas

### 1. Regression Risk

Check:

* existing functionality impact
* shared logic impact
* breaking changes

If a regression risk is unacceptable or unmitigated:

→ mark as CRITICAL

---

### 2. Rule Compliance

Validate against:

* `.codex/AGENTS.md`
* Active Context Packet instruction files selected from `.ai/instructions/index.md`

If the staged diff violates repository rules or prompt contract requirements:

→ mark as CRITICAL

---

### 3. Code Quality

Check:

* readability
* consistency
* maintainability
* justified complexity

If the implementation is unsafe, confusing, or unjustifiably complex:

→ mark as CRITICAL

Actionable but low-risk improvements may be WARNING or SUGGESTION.

---

### 4. Validation Sufficiency

Check:

* tests executed
* commands run
* results recorded
* whether local proof is sufficient for the completed handoff

Rules:

* missing validation evidence → WARNING
* risky change without validation → CRITICAL
* final validation requires deployed, manual, or external code may still pass this stage only when the deferred validation note is explicit and the implementation is otherwise safe to commit

---

### 5. Scope Control

Ensure:

* no unrelated changes
* no scope expansion

---

## Severity Classification

### CRITICAL

* breaking change
* unacceptable regression risk
* repository rule violation
* unsafe maintainability or complexity issue
* high-risk change without validation

---

### WARNING

* missing validation evidence
* non-blocking regression risk note
* maintainability concern that does not block merge

---

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

2. create `.ai/artifacts/<plan-name>/events/review-quality-vX.md` with `# Review Quality vX`, `## Summary`, and `## Evidence`.

3. update `.ai/artifacts/<plan-name>/state/workflow.json` with `latest.reviewQuality`, mirror the compact quality-review result under `latest.review` for compatibility, append the quality-review artifact path to `history`, set `status`, `nextAction`, `unresolvedBlockers`, and refresh `updatedAt`.

4. reread the plan manifest and `.ai/artifacts/<plan-name>/state/workflow.json`; verify both show `active + execute-plan` before final output.

For legacy thin-plan-v1 plans only, append:

### Review vX

* Summary: NEEDS FIX
* Evidence: .ai/artifacts/<plan-name>/events/review-quality-vX.md
* Decision: active

---

### IF NO CRITICAL issues AND final validation requires deployed, manual, or external code:

Use this path when the implementation is safe to commit locally, but the final proof will be performed manually by the operator after commit, deploy, production access, external integration access, or another check outside the local reviewed workspace.

1. update the plan manifest:

## Status

completed

## Next Action

commit-summary

2. create `.ai/artifacts/<plan-name>/events/review-quality-vX.md` with `# Review Quality vX`, `## Summary`, and `## Evidence`, including the deferred validation note.

3. update `.ai/artifacts/<plan-name>/state/workflow.json` with `latest.reviewQuality.summary = SAFE - DEFERRED VALIDATION`, `latest.reviewQuality.decision = completed`, mirror the same compact result under `latest.review`, append the review evidence pointer to `history`, set `status`, `nextAction`, and refresh `updatedAt`.

4. reread the plan manifest and `.ai/artifacts/<plan-name>/state/workflow.json`; verify both show `completed + commit-summary` before final output.

5. do not create any extra plan section for this path. `commit-summary` records the local commit metadata. The operator performs the deferred validation manually after commit/deploy and reopens the plan if that check finds a required fix.

For legacy thin-plan-v1 plans only, append:

### Review vX

* Summary: SAFE - DEFERRED VALIDATION
* Evidence: .ai/artifacts/<plan-name>/events/review-quality-vX.md
* Decision: completed

---

### IF NO CRITICAL issues AND local/final validation is complete:

1. update the plan manifest:

## Status

completed

## Next Action

commit-summary

2. create `.ai/artifacts/<plan-name>/events/review-quality-vX.md` with `# Review Quality vX`, `## Summary`, and `## Evidence`.

3. update `.ai/artifacts/<plan-name>/state/workflow.json` with `latest.reviewQuality.summary = SAFE`, `latest.reviewQuality.decision = completed`, mirror the same compact result under `latest.review`, append the review evidence pointer to `history`, set `status`, `nextAction`, and refresh `updatedAt`.

4. reread the plan manifest and `.ai/artifacts/<plan-name>/state/workflow.json`; verify both show `completed + commit-summary` before final output.

Put optional warnings and suggestions in the review artifact.

For legacy thin-plan-v1 plans only, append:

### Review vX

* Summary: SAFE
* Evidence: .ai/artifacts/<plan-name>/events/review-quality-vX.md
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
* Fold regression risk, rule compliance, and code quality into `**Issues**` only when actionable.
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
