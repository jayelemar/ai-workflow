# Unblock Plan (State-Machine Driven)

This prompt resolves a blocked execution state when blocker-resolution evidence is available.

It does NOT implement fixes.

It does NOT perform review.

It does NOT generate a commit summary.

---

## Instruction Loading

Read:

* `.codex/AGENTS.md`
* `.ai/instructions/shared/workflow-state.md`
* `.ai/instructions/shared/reasoning-quality.md`
* `.ai/instructions/shared/debugging.md`
* runner-owned context snapshot `.ai/artifacts/<plan-name>/state/context.md` as the primary current-state source
* the repo-relative `*.spec.md` path(s) listed under the plan's `## Spec` section (if any)
* Active Context Packet instruction files selected from `.ai/instructions/index.md`
* the plan file

Read the full plan only when exact plan edits are required or the snapshot is insufficient.
Do not load full historical sections unless the snapshot is insufficient.
Do not inspect workflow `history` during normal unblock runs; use the snapshot,
unresolved blockers, and the latest relevant event pointer first, then open
only that exact event artifact when specific evidence is needed.
Preserve exact unblock evidence reads for unresolved blockers, workflow state, event evidence, and user-provided unblock evidence.
Use the runner-provided Active Context Packet and index-selected instruction files only. Do not broadly load `.ai/instructions/**`.

Apply shared reasoning-quality and debugging guidance for evidence checks,
root-cause validation, and safe workflow transitions.

---

## Plan Input (MANDATORY)

.ai/plans/<plan-name>.md

If not provided:

-> output `STOP`
-> state blocking reason (`plan file is required`)
-> do not proceed

---

## Unblock Evidence Input

Use blocker-resolution evidence from:

* the runner-provided `Unblock evidence note`
* unresolved blockers and the latest relevant event pointer in `.ai/artifacts/<plan-name>/state/workflow.json`
* the user's current request
* the exact event artifact referenced by the latest relevant event pointer when that evidence is needed

These unresolved blockers, workflow state, and event evidence remain correctness-critical inputs even when the context snapshot is available.

Manual browser validation evidence MUST include:

* route or URL checked
* viewport or device state when relevant
* expected result
* actual result
* date/time or clearly current run context

If a blocker describes implementation work that can be performed by continuing `execute-plan` and that work is already covered by the spec and plan, or qualifies under Execute Plan's Local E2E Authentication and Harness Recovery:

* reclassify it as active implementation work
* do not require blocker-resolution evidence before execution can continue
* preserve validation-only blockers that do not prevent implementation

For a local browser auth, mail, origin, session, or storage bootstrap blocker,
do not require the operator to provide an authenticated browser session when
existing local E2E infrastructure may provide or repair one. Reclassify the
plan as `active` so `execute-plan` can perform its bounded recovery check.

If the unblock evidence proves the current runtime/setup blocker is resolved but a new validation failure appears in plan-owned code, tests, migrations, or artifacts:

* clear the resolved runtime/setup blocker
* reclassify the new failure as active implementation work when it is covered by the spec and plan
* transition to `active`
* record the exact failing validation command and observed failure in the unblock artifact
* do not keep the stale runtime/setup blocker as the active blocked reason

After classifying blockers, if any remaining execution blocker requires user clarification, product decision, external service access, auth state, runtime setup, or manual browser validation and no concrete resolution evidence is available:

-> output `STOP`
-> state blocking reason (`blocker resolution evidence is required`)
-> do not transition the plan
-> MUST NOT return success without changing the plan

---

## State Validation (CRITICAL)

Read:

## Workflow State

Expected: `blocked`

IF Workflow State is not `blocked`:

-> STOP (`plan must be blocked before unblocking`)

---


## Unblock Scope

Analyze ONLY blockers currently preventing execution.

Do NOT:

* expand implementation scope
* introduce behavior outside the spec or plan
* remove previous validation, execution, review, or commit history
* mark the plan reviewed or completed
* generate a commit summary
* perform implementation work

---

## Required Plan Updates

If the blocker is resolved:

* create `.ai/artifacts/<plan-name>/events/unblock-vX.md` with the resolved blocker evidence
* update `.ai/artifacts/<plan-name>/state/workflow.json` with `latest.unblock`, appended `history`, and remaining `unresolvedBlockers`
* preserve unresolved blockers
* when the latest review has `decision: active` with `NEEDS FIX` or `HIGH RISK`
  and no later execution or validation has remediated it, preserve its
  `unresolvedFindings` as active implementation work. If that field is absent,
  copy the exact `## Issues` bullets from the review artifact. Resolving a
  Docker, auth, or other runtime blocker does not resolve those review findings.
  Never set `unresolvedBlockers` to `[]` in that state.
* keep file ownership unchanged unless the blocker evidence proves the plan already owns the needed files
* keep fixes traceable to the blocker
* MUST NOT add inline `## Blockers` to thin-plan-v2 manifests
* MUST NOT add inline `## Unblock History` to thin-plan-v2 manifests

If any unresolved execution blocker remains:

-> output `STOP`
-> keep `workflowState = blocked`

---

## State Transition (MANDATORY)

When Workflow State is `blocked` and all execution blockers are resolved, documented, or reclassified as active implementation work:

update:

## Workflow State

active

---

## Unblock Artifact State (MANDATORY)

Before updating the plan, create `.ai/artifacts/<plan-name>/events/unblock-vX.md` with `# Unblock vX`, `## Summary`, and `## Evidence`.

Then update `.ai/artifacts/<plan-name>/state/workflow.json` with runner-readable thin-plan-v2 state:

* preserve `planPath`
* set `workflowState` to `active` or keep it `blocked`
* write compact `version`, `result`, `summary`, and `evidence` fields under `latest.unblock`
* append `.ai/artifacts/<plan-name>/events/unblock-vX.md` to `history`
* set `unresolvedBlockers` to active blocker strings, or `[]` only when no
  runtime blocker and no latest unremediated failed-review finding remains
* refresh `updatedAt`

Rules:

* Every unblock run that changes the plan MUST append a new entry
* MUST NOT overwrite previous unblock entries
* Unblock versions MUST be sequential
* `latest.unblock` may contain only compact `version`, `result`, `summary`, and `evidence`
* Put resolved blocker lists, remaining blocker lists, and detailed unblock reasoning in the unblock artifact
* MUST NOT add inline `## Blockers` to thin-plan-v2 manifests
* MUST NOT add inline `## Unblock History` to thin-plan-v2 manifests

---

## Output (MANDATORY)

Use this shared terminal-facing contract for non-review stages.

**Plan**

.ai/plans/<plan-name>.md

**Summary**

* ACTIVE | STILL BLOCKED
* stage result/state line first
* at most 2-3 short high-signal bullets

**Key Details**

* evidence used
* blockers resolved
* blockers remaining

**Next**

Workflow State: `active` or `blocked`
