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
* the repo-relative `*.spec.md` path(s) listed under the plan's `## Spec` section (if any)
* Active Context Packet instruction files selected from `.ai/instructions/index.md`
* the plan file

Use the runner-provided Active Context Packet and index-selected instruction files only. Do not broadly load `.ai/instructions/**`.

Load:

* `.ai/prompts/superpowers.md`

Apply the superpowers advisory guidance for analysis and edge-case checks.

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
* unresolved blockers in `.ai/artifacts/<plan-name>/state/workflow.json`
* the user's current request
* documented runtime or validation evidence in `.ai/artifacts/<plan-name>/events/`

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

* require evidence that the owner plan reached `completed + commit-summary` with no uncommitted changes for the shared file OR that the owner plan released the shared file ownership
* evidence MUST identify the owner plan and the shared file path
* the runner-owned `.ai/artifacts/<owner-plan>/state/file-ownership.json` conflict check is authoritative for whether a completed owner plan is still dirty
* do not unblock from a `plan dependency` using only an assumption that the owner plan is inactive
* if the evidence proves the dependency is resolved, mark the blocker resolved and allow the normal `blocked -> active` transition
* if the evidence is missing or incomplete, keep the plan blocked with `Next Action = unblock-plan`

### File Ownership Releases

For released shared file ownership, valid evidence MUST include a File Ownership Releases entry in the owner plan's `.ai/artifacts/<owner-plan>/state/file-ownership.json` with:

* `File:` matching the shared file path
* `Released By:` naming the owner plan
* `Released To:` naming this dependent plan
* `Status: transferred`
* concrete validation or review evidence

When unblocking from a transferred release, add the released file to this plan's `.ai/artifacts/<plan-name>/state/file-ownership.json` ownership state and to `.ai/artifacts/<plan-name>/state/files.json` if it already has changed content for this plan. After the transition, this plan owns the transferred file.

After classifying blockers, if any remaining execution blocker requires user clarification, product decision, external service access, auth state, runtime setup, or manual browser validation and no concrete resolution evidence is available:

-> output `STOP`
-> state blocking reason (`blocker resolution evidence is required`)
-> do not transition the plan
-> MUST NOT return success without changing the plan

---

## State Validation (CRITICAL)

Read:

## Status

Expected:

* blocked

IF Status is not `blocked`:

-> STOP (`plan must be blocked before unblocking`)

---

Read:

## Next Action

Expected:

* unblock-plan
* execute-plan (legacy blocked plans only)

IF Next Action is neither `unblock-plan` nor `execute-plan`:

-> STOP (`unexpected next action for unblocking`)

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
* Put resolved blocker lists, remaining blocker lists, and detailed unblock reasoning in the unblock artifact
* MUST NOT duplicate the `## Unblock History` heading when it already exists
* MUST create `## Unblock History` only if the section is missing

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

Status:

* active
* blocked

Next Action:

* execute-plan
* unblock-plan
