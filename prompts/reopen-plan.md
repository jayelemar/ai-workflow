# Reopen Plan (State-Machine Driven)

This prompt reopens a completed plan when post-completion bugs or regressions are found.

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

## Reopen Findings Input (MANDATORY)

Use the latest bug findings from one of:

* the user's current request
* the latest `## Review History` entry
* the latest `## Blockers` entry
* a clearly referenced issue report in the plan

If no concrete findings exist:

-> output `STOP`
-> state blocking reason (`reopen findings are required`)
-> do not proceed

---

## State Validation (CRITICAL)

Read:

## Status

### Already Reopened Fast Path

IF Status == active:

Read:

## Next Action

IF Next Action == execute-plan AND `## Reopen History` contains a latest reopen entry with `Decision: active`:

-> do not output `STOP`
-> do not edit the plan
-> output that the plan is already reopened
-> output the next step as `execute-plan`
-> end

IF Status == active and this fast path does not apply:

-> STOP (`plan is active but reopen handoff evidence is missing`)

---

Expected:

reopening

IF Status != reopening:

-> STOP (`plan must be in reopening state`)

---

Read:

## Next Action

Any value is allowed.

Do not STOP based on the current Next Action value.

---

## Reopen Scope

Analyze ONLY the concrete bug findings that caused reopening.

Do NOT:

* expand scope beyond the findings
* introduce speculative behavior
* remove previous validation, execution, review, or commit history
* mark the plan completed
* generate a commit summary

---

## Required Plan Updates

Update the plan with:

* `## Reopen History` entry
* required fixes
* missing or repeated validations
* unresolved risks
* implementation gaps
* phase/task updates needed to execute the fixes

Rules:

* preserve existing history sections
* append new history entries
* keep file ownership explicit
* keep fixes traceable to the reopen findings

---

## State Transition (MANDATORY)

After the plan is updated for the reopened work:

update:

## Status

active

## Next Action

execute-plan

---

## Reopen History (MANDATORY)

Append the next sequential reopen entry.

Before updating the plan, create `.ai/artifacts/<plan-name>/events/reopen-vX.md` with `# Reopen vX`, `## Summary`, and `## Evidence`.

If the plan already contains `## Reopen History`, append only:

### Reopen vX

* Summary:
* Decision: active
* Evidence: .ai/artifacts/<plan-name>/events/reopen-vX.md

Rules:

* Every reopen MUST append a new entry
* MUST NOT overwrite previous reopen entries
* Reopen versions MUST be sequential
* Reopen History entries may contain only `Summary`, `Decision`, and `Evidence`
* Put findings, required fixes, required validation, and detailed reopen reasoning in the reopen artifact
* MUST NOT duplicate the `## Reopen History` heading when it already exists
* MUST create `## Reopen History` only if the section is missing

---

## Output (MANDATORY)

Use this shared terminal-facing contract for non-review stages.

**Plan**

.ai/plans/<plan-name>.md

**Summary**

* REOPENED
* stage result/state line first
* at most 2-3 short high-signal bullets

**Key Details**

* findings used
* fixes added to the plan
* validation added to the plan

**Next**

Status:
active

Next Action:
execute-plan
