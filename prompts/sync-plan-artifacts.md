# Sync Plan Artifacts (State-Machine Driven)

This prompt reconciles planning artifacts after plan creation and before plan
validation.

It does NOT validate the plan.

It does NOT implement application code.

---

## Instruction Loading

Read:

* `.codex/AGENTS.md`
* `.ai/instructions/shared/workflow-state.md`
* the plan file
* read the spec from the repo-relative `*.spec.md` path(s)
* the repo-relative `*.spec.md` path(s) listed under the plan's `## Spec` section
* `.ai/artifacts/<plan-name>/user-journey.md` when present or required
* `.ai/artifacts/<plan-name>/implementation-map.md`
* `.ai/artifacts/<plan-name>/state/workflow.json`

---

## Plan Input (MANDATORY)

.ai/plans/<plan-name>.md

If not provided:

→ output `STOP`
→ state blocking reason (`plan file is required`)
→ do not proceed

---

## State Validation (MANDATORY)

Read:

## Status

Expected:

draft

IF Status != draft:

→ STOP (`plan must be in draft state`)

---

Read:

## Next Action

Expected:

sync-plan-artifacts

IF Next Action != sync-plan-artifacts:

→ STOP (`unexpected next action for artifact sync`)

---

## Objective

Reconcile the plan-owned `.ai` artifacts that validation depends on:

* the spec path(s) in `## Spec`
* `.ai/plans/<plan-name>.md`
* `.ai/artifacts/<plan-name>/user-journey.md`
* `.ai/artifacts/<plan-name>/implementation-map.md`
* `.ai/artifacts/<plan-name>/state/workflow.json`
* `.ai/artifacts/<plan-name>/state/file-ownership.json`
* `.ai/artifacts/<plan-name>/state/files.json`
* `.ai/artifacts/<plan-name>/state/context.md`
* `.ai/artifacts/<plan-name>/events/`

---

## Allowed Changes

You may create, regenerate, or repair only plan-owned workflow artifacts:

* `.ai/plans/<plan-name>.md`
* `.ai/artifacts/<plan-name>/user-journey.md`
* `.ai/artifacts/<plan-name>/implementation-map.md`
* `.ai/artifacts/<plan-name>/state/workflow.json`
* `.ai/artifacts/<plan-name>/state/file-ownership.json`
* `.ai/artifacts/<plan-name>/state/files.json`
* `.ai/artifacts/<plan-name>/state/context.md`
* `.ai/artifacts/<plan-name>/events/`

You must not edit app code, tests, migrations, generated files, configuration
files, or non-plan-owned artifacts.

Do not stage files or create commits.

---

## Sync Rules

Read the plan, spec, user-journey artifact, implementation map, and workflow
state before editing.

Repair missing, stale, or inconsistent planning artifacts when the correct
content can be derived from the approved spec, current plan, and observed
codebase paths without inventing product behavior.

For user-facing work:

* ensure `user-journey.md` exists and reflects only the spec plus observed
  codebase entry points
* ensure `implementation-map.md` maps every user-flow and acceptance-scenario
  action to concrete implementation and validation paths
* remove implementation-map rows that do not correspond to the user journey

For non-user-facing work:

* ensure the plan `## Artifacts` user journey entry records
  `N/A: <concrete reason>`
* ensure `implementation-map.md` contains exactly `N/A: <concrete reason>`

For thin-plan-v2 state:

* ensure `.ai/artifacts/<plan-name>/state/workflow.json` exists
* ensure `planPath` points to `.ai/plans/<plan-name>.md`
* preserve `latest`, `history`, and `unresolvedBlockers` when present
* do not use legacy top-level aliases such as `latestValidationSummary`,
  `latestValidationResult`, `latestValidationEvidence`, or
  `compactHistoryPointer`

---

## STOP Conditions

Output `STOP` and keep the plan in `draft + sync-plan-artifacts` when:

* the spec is incomplete, vague, ambiguous, or internally inconsistent
* the user journey cannot be repaired without a product decision
* the implementation map cannot be repaired without a product decision
* artifact inconsistencies cannot be resolved without inventing behavior beyond
  the spec
* repairing would require editing app code, tests, migrations, generated files,
  configuration files, or non-plan-owned artifacts

When stopping:

* state the concrete unresolved decision or artifact blocker
* do not transition to `plan-validator`
* keep both the plan manifest and workflow sidecar at:
  * Status = draft
  * Next Action = sync-plan-artifacts

---

## Success Transition

When sync succeeds:

1. update the plan manifest:
   * Status = draft
   * Next Action = plan-validator
2. update `.ai/artifacts/<plan-name>/state/workflow.json`:
   * `planPath` = `.ai/plans/<plan-name>.md`
   * `status` = `draft`
   * `nextAction` = `plan-validator`
   * preserve `latest`, `history`, and `unresolvedBlockers` when present
   * update `updatedAt`
3. reread both locations
4. verify both locations match `draft + plan-validator`

If parity cannot be verified:

→ output `STOP`
→ state the exact mismatch

---

## Final Output

Use this terminal contract:

**Plan**

* Plan: `.ai/plans/<plan-name>.md`

**Summary**

* stage result: `<ARTIFACTS SYNCED | STOP>`
* state set to `<draft + plan-validator | draft + sync-plan-artifacts>`

**Key Details**

* synced artifacts: `<list or N/A>`
* blockers: `<list or None>`

**Next**

Status: `draft`
Next Action: `<plan-validator | sync-plan-artifacts>`
