# Fix Review (State-Machine Driven)

This prompt updates the plan using findings from the latest review.

It does NOT perform implementation.

It does NOT perform review.

It prepares the plan for the next execution cycle.

---

## Instruction Loading

Read:

* `.codex/AGENTS.md`
* `.ai/instructions/shared/workflow-state.md`
* the plan file
* the latest review findings
* the repo-relative `*.spec.md` path(s) listed under the plan's `## Spec` section (if any)

---

## Plan Input (MANDATORY)

.ai/plans/<plan-name>.md

If not provided:

→ output `STOP`
→ state blocking reason (`plan file is required`)
→ do not proceed

---

## Review Input (MANDATORY)

Use the most recent review result from:

## Review History

If no review findings exist:

→ STOP (`review findings required`)
→ do not proceed

---

## State Validation (MANDATORY)

Read:

## Status

Expected:

active

Read:

## Next Action

Expected:

execute-plan

If the latest review result does not require fixes:

→ STOP (`latest review does not require corrective action`)

---

## Scope

Update ONLY what is necessary to address findings from the latest review.

Allowed:

* update plan tasks
* update validation tasks
* update execution notes
* update file coverage if required
* add clarification needed for implementation

Do NOT:

* modify the spec
* create a new plan
* redesign approved behavior
* introduce new requirements
* remove previous review history
* remove previous validation history

---

## Review Issue Processing

For each review issue:

1. identify affected phase(s)
2. identify affected file(s)
3. update plan sections required to resolve the issue
4. maintain traceability to review findings

Rules:

* changes MUST be minimal
* changes MUST remain aligned with the spec
* changes MUST remain aligned with previous approved scope

---

## Plan Update (MANDATORY)

Update:

* relevant phases
* relevant tasks
* relevant file references
* validation activities if required

Preserve:

* Validation History
* Review History
* Execution Log
* Blockers

Wording rules:

* Corrective plan updates must be limited to issue, affected section, and action taken.
* Do not add reasoning narration to review-fix plan updates.

---

## Post-Update Verification

Verify:

* every review issue has a corresponding plan update
* no new behavior was introduced
* no scope expansion occurred
* plan remains executable

If verification fails:

→ STOP (`review fixes incomplete`)

---

## State Transition (MANDATORY)

After plan updates are complete:

update:

## Status

active

## Next Action

execute-plan

---

## Output (MANDATORY)

Use this shared terminal-facing contract for non-review stages.

**Plan**

.ai/plans/<plan-name>.md

**Summary**

* PLAN UPDATED
* stage result/state line first
* at most 2-3 short high-signal bullets

**Key Details**

* issue
* affected section(s)
* action taken

Keep each addressed issue concise: issue, affected section, and action taken only.

**Next**

Status:
active

Next Action:
execute-plan
