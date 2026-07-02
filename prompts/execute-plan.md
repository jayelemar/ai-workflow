# Execute Plan (State-Machine Driven)

This prompt defines execution-specific behavior only.

---

## Instruction Loading

Read:

* `.codex/AGENTS.md`
* `.ai/instructions/shared/workflow-state.md`
* `.ai/instructions/shared/testing.md` before running, skipping, or classifying validation
* the repo-relative `*.spec.md` path(s) listed under the plan's `## Spec` section (if any)
* runner-owned context snapshot `.ai/artifacts/<plan-name>/state/context.md` as the primary current-state source
* the plan file's `## Phases` section for preparation, implementation, validation tasks, and task savepoints
* `.ai/artifacts/<plan-name>/state/workflow.json` for current workflow state, latest event pointers, blockers, and compact history
* `.ai/artifacts/<plan-name>/state/files.json` for the changed-file inventory
* Active Context Packet instruction files selected from `.ai/instructions/index.md`
* the full plan file only when exact plan edits are required or the snapshot is insufficient

Use the runner-provided Active Context Packet and index-selected instruction files only. Do not broadly load `.ai/instructions/**`.
When resuming `active` + `execute-plan` after review feedback, use `## Latest Review Remediation Context` from the snapshot as the default fix list.
Read the full plan only when exact plan edits are required or the snapshot is insufficient.
Do not load `## Review History` by default; read the full plan only when exact plan edits or missing detail cannot be derived from the snapshot.
Do not load full historical sections unless the snapshot is insufficient.
If the runner provides an `Execute token guardrail` note for this run, treat it as mandatory context-loading discipline: stay snapshot-first, avoid broad artifact/history reads, and fall back only to the exact plan section or exact event file needed for the current fix.

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

## Pre-Execution Validation (MANDATORY)

### 1. Plan Readability

Ensure the plan contains:

* `## Status`
* `## Next Action`
* `## Artifacts`
* readable `## Phases`
* readable `.ai/artifacts/<plan-name>/state/workflow.json`
* readable `.ai/artifacts/<plan-name>/state/files.json`
* defined scope in `.ai/artifacts/<plan-name>/state/file-ownership.json`
* validation approach in `## Phases`

If missing:

→ STOP (`plan is incomplete`)

---

### 2. State Validation (CRITICAL)

Read:

## Status

---

### Allowed Execution States

* approved
* active

---

### State Handling

IF Status == approved:

* update Status → active
* keep Next Action → execute-plan
* begin execution from first phase

IF Status == active:

* resume execution from first incomplete phase

IF Status == blocked:

→ STOP (`plan is blocked; resolve blockers first`)

IF Status == review:

→ STOP (`plan awaiting review`)

IF Status == completed:

→ STOP (`plan already completed`)

IF Status == draft:

→ STOP (`plan not approved`)

---

Read:

## Next Action

Expected:

execute-plan

IF Next Action != execute-plan:

→ STOP (`unexpected next action for execution`)

---

### Execution End-State Constraint (CRITICAL)

Execution may start from `approved` or `active`.

Execution MUST end in exactly one of these states:

* `review` with `Next Action = review-plan`
* `active` with `Next Action = execute-plan`
* `blocked` with `Next Action = unblock-plan`

Execution MUST NOT end with:

* `Status = completed`
* `Next Action = commit-summary`

`active` is valid after an `execute-plan` run ONLY when implementation work remains and execution can continue from the next incomplete task.

Implementation defects, incomplete implementation tasks, missing tests for newly defined implementation tasks, or browser findings that require code changes MUST keep or set:

* `Status = active`
* `Next Action = execute-plan`

Do NOT mark a plan `blocked` when the next required action is code implementation already covered by the spec and plan.

### External Final Validation Deferral

If implementation work and local validation are complete, but the only unavailable validation is final browser/manual/deployed/external validation:

* record the pending browser/manual/deployed/external validation in the execution log and validation notes
* set `Status = review`
* set `Next Action = review-plan`
* review owns the completion decision
* must not transition directly to `commit-summary`
* do not mark the plan `blocked` solely because that final external validation is unavailable

---

### 3. Spec Alignment Check

If a spec exists:

* MUST read spec
* every behavior must trace to spec

If any plan step:

* introduces behavior not in spec
* omits required behavior
* relies on assumptions

→ STOP (`plan not aligned with spec`)

---

### 4. File Ownership Check

From artifacts:

* `.ai/artifacts/<plan-name>/state/file-ownership.json`
* `.ai/artifacts/<plan-name>/state/files.json`

Rules:

* entries MUST be repo-relative exact files or directory globs ending in `/**`
* no vague references
* ownership is file-level only; do not use hunk/chunk ownership
* generated or shared files are owned as whole files until committed or released

The runner reads `.ai/artifacts/<plan-name>/state/file-ownership.json` and `.ai/artifacts/<plan-name>/state/files.json` for thin-plan-v2 plans. Treat runner-reported artifact conflicts as authoritative.

If unclear:

→ STOP (`file scope unclear`)

---

### 5. Codebase Alignment

If plan contradicts codebase reality:

→ STOP (`plan/codebase mismatch`)

---

## Execution

### Task Savepoint Mode

If the runner injects `Task savepoint current task`:

* implement ONLY that task ID and task name
* validate only the current task's changed behavior plus directly affected regressions
* do not start the next `[task:...]` item
* keep `.ai/` artifacts out of git commits
* when the current task is implemented and validated, set `Status = review` and `Next Action = review-plan`
* if implementation or validation fails, keep the same task active, record the failure, and do not route to `commit-summary`

### Phase Execution Rules

For each phase:

* implement ONLY defined tasks
* DO NOT expand scope
* DO NOT introduce behavior outside spec
* preserve existing behavior unless required

---

### Multi-Agent Execution Rules

Use sub-agents when plan-owned file scope is explicit and non-conflicting.

Sub-agents MAY be used only when file ownership is explicit and non-conflicting.

Before dispatching sub-agents:

* assign each sub-agent a concrete file ownership set
* ensure every assigned file is plan-owned
* ensure no two sub-agents are assigned the same file
* tell each sub-agent not to edit outside its assigned files
* tell each sub-agent not to revert or rewrite unrelated worktree changes

If two sub-agents need the same file:

→ execute those tasks sequentially or in the main agent

If a sub-agent modifies a file outside its assigned ownership set:

→ STOP (`sub-agent modified unassigned file`)

If a sub-agent reports that required work needs a file outside the plan-owned paths:

→ STOP (`file outside plan scope`)

### Cross-Plan File Dependency

If required execution or bugfix work needs a file outside the current plan-owned paths:

* First determine whether the file is owned by another active plan or by a live workflow-runner file lock.
* If the file is owned by another active plan, treat this as a `plan dependency`, not as a generic file-scope failure.
* Do NOT keep executing both plans in parallel.
* Update the current plan to `Status = blocked` and `Next Action = unblock-plan`.
* Add a blocker with:
  * `Type: plan dependency`
  * the required file path
  * the owner plan path
  * evidence that the file is owned by another active plan
  * the required action: complete the owner plan or release the shared file ownership
* STOP.

If no owner plan path can be identified:

→ STOP (`file outside plan scope`)

### File Ownership Releases

If the current plan owns a file that another blocked plan needs, the current plan MAY transfer that file before the whole plan is complete only when:

* all current-plan work for that file is complete
* validation evidence for that file-specific work is documented
* remaining current-plan phases can continue without editing that file

To transfer the file, append or update:

## File Ownership Releases

### Release vX

* File: exact/repo-relative/path.ts
* Released By: .ai/plans/current-plan.md
* Released To: .ai/plans/dependent-plan.md
* Evidence: concrete validation or review evidence
* Status: transferred

After `Status: transferred`, the releasing plan must not edit, stage, review, or commit the released file again. If the releasing plan later needs the released file, STOP and create a new `plan dependency` on the current owner plan.

---

### Phase Tracking (MANDATORY)

Update the plan's `## Phases` task state only when task wording or completion notes need correction.

---

### Execution Log (MANDATORY)

Before updating the plan, create the next sequential execution artifact:

```text
.ai/artifacts/<plan-name>/events/execution-vX.md
```

The artifact must include:

```markdown
# Execution vX

## Summary

<short execution summary>

## Evidence

<commands, outputs, files changed, or blockers that support the plan entry>
```

Then update `.ai/artifacts/<plan-name>/state/workflow.json` with runner-readable thin-plan-v2 state: preserve `planPath`, set `status` and `nextAction`, write the compact execution event under `latest.execution`, append the execution artifact path to `history`, set `unresolvedBlockers` to active blocker strings or `[]`, and refresh `updatedAt`.

Wording rules:

* Workflow event state may contain only compact summary, state/result/decision, and evidence pointer fields.
* Put command output, detailed file notes, blocker explanations, validation output, and reasoning in the artifact.
* Do not record reasoning narration, wait-state updates, or artifact body text in the plan manifest.
* Artifact state updates should state what changed, what was validated, and remaining action.

---

## Blocking (MANDATORY)

IF execution cannot proceed:

This applies ONLY to true execution blockers, such as missing required clarification, missing required inputs, external service access, auth/runtime setup that prevents current implementation work, or file scope conflicts.

It does NOT apply when implementation tasks remain and can be performed by continuing `execute-plan`.

1. update:

## Status

blocked

## Next Action

unblock-plan

2. add:

## Blockers

### Blocker N

* Type:
* Description:
* Impact:
* Required Action:
* Owner:
* Evidence:
* Next Step:

3. STOP

---

## Resume Logic

Execution may resume ONLY if:

* Status == active
* blockers are resolved AND documented

---

## Completion Gate

IF all phases are complete:

* perform Post-Execution Validation before changing the plan to review

IF all phases are complete AND local Post-Execution Validation is confirmed AND only browser/manual/deployed/external validation remains unavailable:

* follow External Final Validation Deferral

IF all phases are complete AND Post-Execution Validation is confirmed:

update:

## Status

review

## Next Action

review-plan

IF any phase remains incomplete:

* keep or set `Status = active`
* keep or set `Next Action = execute-plan`
* update the incomplete phase, execution log, and next implementation task clearly
* end the current run with `execution incomplete; continue execute-plan`

---

## Post-Execution Validation (MANDATORY)

Validate:

* spec alignment
* correctness of changes
* impacted areas
* tests / runtime behavior (if applicable)

If validation cannot be confirmed:

* IF validation cannot be confirmed only because final browser/manual/deployed/external validation is unavailable after implementation and local validation are complete:
  * follow External Final Validation Deferral
  * STOP (`external final validation deferred to review`)
* IF a validation command fails only on files outside the current plan scope, and the current plan's implementation plus plan-owned validation is otherwise confirmed:
  * do not block the active plan solely for that reason
  * record the validation as deferred or out-of-scope with the exact command, failing files, and remaining risk
  * continue with `Status = review` and `Next Action = review-plan` when implementation and local plan-owned validation are complete
* IF validation cannot be confirmed because implementation tasks remain or a validation finding requires code changes already covered by the spec and plan:
  * keep or set `Status = active`
  * keep or set `Next Action = execute-plan`
  * record the failed or incomplete validation as implementation follow-up work
  * end the current run with `validation found implementation work; continue execute-plan`
* ELSE follow Blocking rules
* STOP (`validation incomplete`)

Post-Execution Validation MUST NOT set:

* Status = completed
* Next Action = commit-summary

---

## Plan Update (MANDATORY)

Update the plan with:

* `## Status` and `## Next Action` only when workflow state changes

Update artifacts with:

* created, modified, deleted, changedFiles, released, headSha, and workflow state in `.ai/artifacts/<plan-name>/state/files.json`
* blockers encountered, validation results, latest event pointers under `latest`, and compact event path history in `.ai/artifacts/<plan-name>/state/workflow.json`
* ownership changes and releases in `.ai/artifacts/<plan-name>/state/file-ownership.json`
* deviations and evidence in event artifacts under `.ai/artifacts/<plan-name>/events/`

Reconcile `.ai/artifacts/<plan-name>/state/files.json` after implementation to the actual created, modified, and deleted plan-owned paths before moving to `Status = review`. `files.json` is the changed-file inventory for review and commit, not the ownership authority.

Keep workflow state entries concise: compact summary, one state field, and evidence pointer only.
Detailed validation evidence belongs in `.ai/artifacts/<plan-name>/events/validation-vX.md`, with only the latest validation pointer under `latest.validation` in `.ai/artifacts/<plan-name>/state/workflow.json`.

---

## Output (MANDATORY)

Use this shared terminal-facing contract for non-review stages.

Rules:

* `**Summary**` starts with the stage result/state line, then at most 2-3 short high-signal bullets.
* `**Key Details**` carries the important human-readable substance for the stage.
* `**Validation**` should stay compact and usually prefer compact result labels or artifact paths over detailed inline diagnostics.
* `**Next**` must always use explicit `Status:` and `Next Action:` lines.

**Plan**

.ai/plans/<plan-name>.md

**Summary**

* REVIEW READY | ACTIVE | BLOCKED
* stage result/state line first
* at most 2-3 short high-signal bullets

**Key Details**

* key actions performed
* major changes
* important notes

**Validation**

* tests executed
* results
* known limitations (if any)

**Next**

Status:

* review
* active
* blocked

Next Action:

* execute-plan
* unblock-plan
* review-plan
