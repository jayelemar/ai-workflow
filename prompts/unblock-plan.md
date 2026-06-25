# Unblock Plan (State-Machine Driven)

This prompt resolves a blocked execution state or advances deployment validation when blocker-resolution or deployment evidence is available.

It does NOT implement fixes.

It does NOT perform review.

It does NOT generate a commit summary.

---

## Instruction Loading

Read:

* `.codex/AGENTS.md`
* `.ai/instructions/workflow-state.instructions.md`
* `.ai/specs/<feature>.spec.md` (if exists)
* Active Context Packet instruction files selected from `.ai/instructions/index.instructions.md`
* the plan file

Use the runner-provided Active Context Packet and index-selected instruction files only. Do not broadly load `.ai/instructions/*`.

Load:

* `.ai/prompts/superpowers.md`

Use superpower skills:

* analyze

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
* the latest `## Blockers` entry
* the user's current request
* documented runtime or validation evidence already appended to the plan

Manual browser validation evidence MUST include:

* route or URL checked
* viewport or device state when relevant
* expected result
* actual result
* date/time or clearly current run context

If a blocker describes implementation work that can be performed by continuing `execute-plan` and that work is already covered by the spec and plan:

* reclassify it as active implementation work
* do not require blocker-resolution evidence before execution can continue
* preserve validation-only blockers that do not prevent implementation

If a blocker is `Type: plan dependency`:

* require evidence that the owner plan reached `completed + commit-summary`, that the owner plan is stable at `deployment-validation + unblock-plan` with a recorded commit in its deployment-validation artifact, OR that the owner plan released the shared file ownership
* evidence MUST identify the owner plan and the shared file path
* do not unblock from a `plan dependency` using only an assumption that the owner plan is inactive
* a `deployment-validation + unblock-plan` owner plan with a recorded commit in its deployment-validation artifact is stable dependency evidence because dependent plans can build on that local commit while push, deploy, and final validation remain pending
* if the evidence proves the dependency is resolved, mark the blocker resolved and allow the normal `blocked -> active` transition
* if the evidence is missing or incomplete, keep the plan blocked with `Next Action = unblock-plan`

For released shared file ownership, valid evidence MUST include a `## File Ownership Releases` entry from the owner plan with:

* `File:` matching the shared file path
* `Released By:` naming the owner plan
* `Released To:` naming this dependent plan
* `Status: transferred`
* concrete validation or review evidence

When unblocking from a transferred release, add the released file to its own `## Files (MANDATORY)` path list before transitioning to `active + execute-plan`. After the transition, this plan owns the transferred file.

If Status is `deployment-validation`, use deployment-validation evidence from:

* push evidence
* deployment evidence
* final validation evidence
* the runner-provided `Unblock evidence note`
* documented validation evidence already appended to the plan

Deployment-validation evidence MUST identify what happened and the concrete source, such as the branch pushed, deployment URL, deployment status, route checked, external system checked, expected result, actual result, and date/time or clearly current run context.

If no concrete new deployment-validation evidence is available:

-> output `STOP`
-> state blocking reason (`deployment-validation evidence is required`)
-> do not update the plan
-> MUST NOT return success without changing the plan

After classifying blockers, if any remaining execution blocker requires user clarification, product decision, external service access, auth state, runtime setup, or manual browser validation and no concrete resolution evidence is available:

-> output `STOP`
-> state blocking reason (`blocker resolution evidence is required`)
-> do not transition the plan

---

## State Validation (CRITICAL)

Read:

## Status

Expected:

* blocked
* deployment-validation

IF Status is neither `blocked` nor `deployment-validation`:

-> STOP (`plan must be blocked or in deployment-validation before unblocking`)

---

Read:

## Next Action

Expected:

* unblock-plan
* execute-plan (legacy blocked plans only)

IF Status is `blocked` and Next Action is neither `unblock-plan` nor `execute-plan`:

-> STOP (`unexpected next action for unblocking`)

IF Status is `deployment-validation` and Next Action is not `unblock-plan`:

-> STOP (`unexpected next action for deployment validation`)

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

For `deployment-validation`, analyze ONLY push, deploy, and final validation evidence. Do not implement fixes, perform review, create commits, push automatically, or generate the final completion summary.

---

## Required Plan Updates

If the blocker is resolved:

* mark the resolved blocker with `* Status: resolved`
* append evidence under the blocker or under a new `## Unblock History` entry
* preserve unresolved blockers
* keep file ownership unchanged unless the blocker evidence proves the plan already owns the needed files
* keep fixes traceable to the blocker

If any unresolved execution blocker remains:

-> output `STOP`
-> keep Status blocked
-> keep or set Next Action unblock-plan

---

## Deployment Validation Updates

Apply this section ONLY when the plan starts as:

## Status

deployment-validation

## Next Action

unblock-plan

If push or deploy evidence is present but final validation evidence is missing:

* update the latest deployment-validation artifact with `Push Status` and `Deployment Status` from the supplied evidence
* keep `Status: pending`
* keep:

## Status

deployment-validation

## Next Action

unblock-plan

If final validation evidence passes:

* update the latest deployment-validation artifact with final validation evidence, expected result, actual result, `Push Status`, and `Deployment Status`
* set `Status: passed`
* transition to `completed + commit-summary`

If final validation evidence fails:

* update the latest deployment-validation artifact with the failure evidence and failed expected vs actual behavior
* set `Status: failed`
* transition to `reopening + reopen-plan`

Rules:

* Preserve the recorded commit in the deployment-validation artifact.
* Do not remove prior deployment-validation entries.
* Deployment Validation plan entries may contain only `Summary`, `Status`, and `Evidence`.
* Append or update the latest deployment-validation entry with traceable evidence.
* If concrete new push or deploy evidence is incomplete but still traceable, keep `deployment-validation + unblock-plan`.
* If evidence is incomplete because no concrete new deployment-validation evidence is available, output `STOP` with reason `deployment-validation evidence is required`.

---

## State Transition (MANDATORY)

When Status is `blocked` and all execution blockers are resolved, documented, or reclassified as active implementation work:

update:

## Status

active

## Next Action

execute-plan

---

## Unblock History (MANDATORY)

Append the next sequential unblock entry.

Before updating the plan, create `.ai/artifacts/<plan-name>/events/unblock-vX.md` with `# Unblock vX`, `## Summary`, and `## Evidence`.

If the plan already contains `## Unblock History`, append only:

### Unblock vX

* Summary:
* Evidence: .ai/artifacts/<plan-name>/events/unblock-vX.md
* Decision: active | blocked

Rules:

* Every unblock run that changes the plan MUST append a new entry
* MUST NOT overwrite previous unblock entries
* Unblock versions MUST be sequential
* Unblock History entries may contain only `Summary`, `Decision`, and `Evidence`
* Put resolved blocker lists, remaining blocker lists, deployment evidence, and detailed unblock reasoning in the unblock artifact
* MUST NOT duplicate the `## Unblock History` heading when it already exists
* MUST create `## Unblock History` only if the section is missing

---

## Output (MANDATORY)

### Plan

.ai/plans/<plan-name>.md

---

### Unblock Summary

* evidence used
* blockers resolved
* blockers remaining

---

### State Transition

blocked -> active

or:

blocked -> blocked

or:

deployment-validation -> deployment-validation

or:

deployment-validation -> completed

or:

deployment-validation -> reopening

---

### Next Step

Run:

execute-plan

or:

unblock-plan

or:

commit-summary

or:

reopen-plan
