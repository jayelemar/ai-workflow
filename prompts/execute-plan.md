# Execute Plan (State-Machine Driven)

This prompt defines execution-specific behavior only.

---

## Instruction Loading

Read:

* `.codex/AGENTS.md`
* `.ai/instructions/shared/workflow-state.md`
* `.ai/instructions/shared/reasoning-quality.md`
* `.ai/instructions/shared/debugging.md` before diagnosing failed implementation or validation
* `.ai/instructions/shared/testing.md` before running, skipping, or classifying validation
* the repo-relative `*.spec.md` path(s) listed under the plan's `## Spec` section (if any)
* runner-owned context snapshot `.ai/artifacts/<plan-name>/state/context.md` as the primary current-state source
* the plan file's `## Phases` section for preparation, implementation, validation tasks, and task savepoints
* `.ai/artifacts/<plan-name>/state/workflow.json` for current workflow state, the latest relevant event pointer, and unresolved blockers
* `.ai/artifacts/<plan-name>/state/files.json` for the changed-file inventory
* Active Context Packet instruction files selected from `.ai/instructions/index.md`
* the full plan file only when exact plan edits are required or the snapshot is insufficient

Use the runner-provided Active Context Packet and index-selected instruction files only. Do not broadly load `.ai/instructions/**`.
When resuming `active` + `execute-plan` after review feedback, use `## Latest Review Remediation Context` from the snapshot as the default fix list.
Read the full plan only when exact plan edits are required or the snapshot is insufficient.
Do not load `## Review History` by default; read the full plan only when exact plan edits or missing detail cannot be derived from the snapshot.
Do not load full historical sections unless the snapshot is insufficient.
Do not inspect workflow `history` during normal runs; use the snapshot and the latest relevant event pointer first, then open only that exact event artifact when specific evidence is needed.
If the runner provides a `Workflow token guardrail` note for this run, treat it as mandatory context-loading discipline: stay snapshot-first, avoid broad artifact/history reads, and fall back only to the exact plan section or exact event file needed for the current execution without skipping required spec, validation, workflow state, or correctness-critical reads.

Apply the shared reasoning-quality and debugging guidance for assumption
validation, edge-case checks, root-cause analysis, and scope discipline.

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

* `## Workflow State`
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

## Workflow State

---

### Allowed Execution States

* `approved`
* `active`

---

### State Handling

IF Workflow State == `approved`:

* update Workflow State → `active`
* begin execution from first phase

IF Workflow State == `active`:

* resume execution from first incomplete phase

IF Workflow State == `blocked`:

→ STOP (`plan is blocked; resolve blockers first`)

IF Workflow State == `review`:

→ STOP (`plan awaiting review`)

IF Workflow State == `completed`:

→ STOP (`plan already completed`)

IF Workflow State starts with `draft-`:

→ STOP (`plan not approved`)

---


### Execution End-State Constraint (CRITICAL)

Execution may start from `approved` or `active`.

Execution MUST end in exactly one of these states:

* `review`
* `active`
* `blocked`

When handing off, update the plan manifest and
`.ai/artifacts/<plan-name>/state/workflow.json` together using one exact
`workflowState` above. Reread both values before final output; never leave a
manifest/sidecar mismatch.

Execution MUST NOT end with:

* `completed`

`active` is valid after an `execute-plan` run ONLY when implementation work remains and execution can continue from the next incomplete task.

Implementation defects, incomplete implementation tasks, missing tests for newly defined implementation tasks, or browser findings that require code changes MUST keep or set:

* `workflowState = active`

Do NOT mark a plan `blocked` when the next required action is code implementation already covered by the spec and plan.

### External Final Validation Deferral

If implementation work and local validation are complete, but the only unavailable validation is final browser/manual/deployed/external validation:

* record the pending browser/manual/deployed/external validation in the execution log and validation notes
* set `workflowState = review`
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
* when the current task is implemented and validated, set `workflowState = review`
* if implementation or validation fails, keep the same task active, record the failure, and do not route to `commit-summary`

#### Compatibility Regression Carve-Out

If the current task changes a shared contract, service invariant, schema,
payload shape, generated type, or backend enforcement rule, and an existing
call site from a later task would submit invalid data or otherwise become
broken because of the current task:

* fix the smallest compatibility path needed to keep existing behavior
  non-broken
* keep the edit narrowly tied to the current task's contract change
* add focused regression coverage for that compatibility path
* do not implement the later task's full feature surface, UI replacement,
  visual redesign, workflow expansion, or unrelated behavior
* do not output `STOP` solely because the minimal compatibility edit touches a
  file named in a later `[task:...]` item
* when review feedback identifies a missing backend RPC, migration, generated
  database type, database regression test, or compatibility call-site repair
  required to uphold the current task's invariant, including an access/security invariant, treat it as this
  compatibility repair
* if such a file is absent from either the current plan ownership or changed-
  file inventory artifact and no active owner plan claims it, add the exact
  file to both artifacts and continue
* do not output `STOP` solely because the required minimal backend contract
  repair touches a migration, generated database contract file, or database
  test outside the original current-task file list

Example: if a service task makes restricted channel payloads require
department/member targets, and the existing legacy create-channel UI can still
submit restricted saves with empty targets, the service task must patch that
legacy path to avoid invalid payloads. The full restricted-target UI remains
owned by the later UI task.

### Phase Execution Rules

For each phase:

* implement ONLY defined tasks
* DO NOT expand scope
* DO NOT introduce behavior outside spec
* preserve existing behavior unless required

---

### Cross-Plan File Dependency

If required execution or bugfix work needs a file outside the current plan-owned paths:

* First determine whether the file is owned by another active plan.
* If the edit qualifies under Compatibility Regression Carve-Out and the file
  is unowned, claim the exact file in the current plan's ownership/inventory
  artifacts and continue instead of stopping.
* If the file is owned by another active plan, treat this as a `plan dependency`, not as a generic file-scope failure.
* Do NOT keep executing both plans in parallel.
* Update the current plan to `workflowState = blocked`.
* Create an execution event artifact that records a blocker with:
  * `Type: plan dependency`
  * the required file path
  * the owner plan path
  * evidence that the file is owned by another active plan
  * the required action: complete the owner plan or release the shared file ownership
* Update `.ai/artifacts/<plan-name>/state/workflow.json` with `workflowState: "blocked"`, `latest.execution`, appended `history`, and `unresolvedBlockers`.
* MUST NOT add inline `## Blockers` to thin-plan-v2 manifests.
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

<compact evidence: command, result, evidence path, file/change summary, short excerpt only when needed, blocker/risk note, or deferred validation note>
```

Then update `.ai/artifacts/<plan-name>/state/workflow.json` with runner-readable thin-plan-v2 state: preserve `planPath`, set `workflowState`, write the compact execution event under `latest.execution`, append the execution artifact path to `history`, set `unresolvedBlockers` to active blocker strings or `[]`, and refresh `updatedAt`.

Wording rules:

* Workflow event state may contain only compact summary, state/result/decision, and evidence pointer fields.
* Event artifacts use compact evidence by default: record the command, result, evidence path, file/change summary, a short excerpt only when needed, and any blocker, risk, or deferred validation note.
* Keep correctness-critical blocker explanations, validation failures, and file notes specific enough for review without pasting broad raw output.
* Event artifacts must not include full raw stdout/stderr bodies, full raw diffs, or raw Codex event streams.
* Do not use broad historical `.ai/artifacts/**` searches for execution evidence; open exact current-plan event artifacts only when the snapshot or workflow state points to them and specific evidence is needed.
* Do not record reasoning narration, wait-state updates, or artifact body text in the plan manifest.
* Artifact state updates should state what changed, what was validated, and remaining action.

---

## Blocking (MANDATORY)

IF execution cannot proceed:

This applies ONLY to true execution blockers, such as missing required clarification, missing required inputs, external service access, auth/runtime setup that prevents current implementation work, or file scope conflicts.

It does NOT apply when implementation tasks remain and can be performed by continuing `execute-plan`.

1. update:

## Workflow State

blocked

2. create an execution event artifact with the blocker details:

* Type:
* Description:
* Impact:
* Required Action:
* Owner:
* Evidence:
* Next Step:

3. update `.ai/artifacts/<plan-name>/state/workflow.json` with runner-readable thin-plan-v2 state: preserve `planPath`, set `workflowState` to `blocked`, write compact `latest.execution`, append the execution artifact path to `history`, set `unresolvedBlockers` to active blocker strings, and refresh `updatedAt`.

4. MUST NOT add inline `## Blockers` to thin-plan-v2 manifests.

5. STOP

---

## Resume Logic

Execution may resume ONLY if:

* Workflow State == `active`
* blockers are resolved AND documented

---

## Completion Gate

IF all phases are complete:

* perform Post-Execution Validation before changing the plan to review

IF all phases are complete AND local Post-Execution Validation is confirmed AND only browser/manual/deployed/external validation remains unavailable:

* follow External Final Validation Deferral

IF all phases are complete AND Post-Execution Validation is confirmed:

update:

## Workflow State

review

IF any phase remains incomplete:

* keep or set `workflowState = active`
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
* continue with `workflowState = review` when implementation and local plan-owned validation are complete
* IF validation cannot be confirmed because local runtime setup, auth state, external service access, or operator-controlled database state must change before the validation can run against current code:
  * follow Blocking rules
  * set `workflowState = blocked`
  * record exact unblock evidence required
  * do not keep `workflowState = active` when no further implementation work can make validation proceed
  * persist the blocked state before outputting `STOP`; do not rely on the
    runner to infer this transition from terminal output
* IF validation cannot be confirmed because implementation tasks remain or a validation finding requires code changes already covered by the spec and plan:
  * keep or set `workflowState = active`
  * record the failed or incomplete validation as implementation follow-up work
  * end the current run with `validation found implementation work; continue execute-plan`
* ELSE follow Blocking rules
* STOP (`validation incomplete`)

Post-Execution Validation MUST NOT set:

* `workflowState = completed`

---

## Plan Update (MANDATORY)

Update the plan with:

* `## Workflow State` only when workflow state changes

Update artifacts with:

* created, modified, deleted, changedFiles, released, and headSha in `.ai/artifacts/<plan-name>/state/files.json`
* blockers encountered, validation results, latest event pointers under `latest`, and compact event path history in `.ai/artifacts/<plan-name>/state/workflow.json`
* ownership changes and releases in `.ai/artifacts/<plan-name>/state/file-ownership.json`
* deviations and evidence in event artifacts under `.ai/artifacts/<plan-name>/events/`

Reconcile `.ai/artifacts/<plan-name>/state/files.json` after implementation to the actual created, modified, and deleted plan-owned paths before moving to `workflowState = review`. `files.json` is the changed-file inventory for review and commit, not the ownership authority.

Do not write workflow routing fields into `files.json` or `file-ownership.json`. `workflowState` belongs only in the plan manifest and `.ai/artifacts/<plan-name>/state/workflow.json`.

Keep workflow state entries concise: compact summary, one state field, and evidence pointer only.
Detailed validation evidence belongs in `.ai/artifacts/<plan-name>/events/validation-vX.md`, with only the latest validation pointer under `latest.validation` in `.ai/artifacts/<plan-name>/state/workflow.json`.

---

## Output (MANDATORY)

Use this shared terminal-facing contract for non-review stages.

Rules:

* `**Summary**` starts with the stage result/state line, then at most 2-3 short high-signal bullets.
* `**Key Details**` carries the important human-readable substance for the stage.
* `**Validation**` should stay compact and usually prefer compact result labels or artifact paths over detailed inline diagnostics.
* `**Next**` must always use one explicit `Workflow State:` line.

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

Workflow State: `review`, `active`, or `blocked`
