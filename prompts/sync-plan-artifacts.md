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
* `.ai/instructions/shared/flow-trace-artifacts.md`
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

## Workflow State

Expected: `draft-artifact-sync`

IF Workflow State != `draft-artifact-sync`:

→ STOP (`plan must be in draft state`)

---

Read:


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

Read the plan, spec, workflow state, and any flow artifacts required by the
plan `## Artifacts` section before editing.

Apply the sync contract from
`.ai/instructions/shared/flow-trace-artifacts.md`.

Repair missing, stale, or inconsistent planning artifacts when the correct
content can be derived from the approved spec, current plan, and observed
codebase paths without inventing product behavior.

For thin-plan state:

* ensure `.ai/artifacts/<plan-name>/state/workflow.json` exists
* set its root `documentFormat` to `workflow-state@1`; preserve all other state fields
* set root `documentFormat` to `file-ownership@1` in `file-ownership.json` and `files-state@1` in `files.json`
* ensure Markdown core artifacts declare their current `## Document Format` immediately after the title
* ensure `planPath` points to `.ai/plans/<plan-name>.md`
* preserve `latest`, `history`, and `unresolvedBlockers` when present
* do not use legacy top-level aliases such as `latestValidationSummary`,
  `latestValidationResult`, `latestValidationEvidence`, or
  `compactHistoryPointer`

---

## STOP Conditions

Output `STOP` and keep the plan in `draft-artifact-sync` when:

* the spec is incomplete, vague, ambiguous, or internally inconsistent
* a required flow-trace artifact cannot be repaired without a product decision
* artifact inconsistencies cannot be resolved without inventing behavior beyond
  the spec
* repairing would require editing app code, tests, migrations, generated files,
  configuration files, or non-plan-owned artifacts

When stopping:

* state the concrete unresolved decision or artifact blocker
* do not transition to `plan-validator`
* keep both the plan manifest and workflow sidecar at `workflowState: draft-artifact-sync`

---

## Success Transition

When sync succeeds:

1. update the plan manifest `## Workflow State` to `draft-validation`
2. update `.ai/artifacts/<plan-name>/state/workflow.json`:
   * `planPath` = `.ai/plans/<plan-name>.md`
   * `workflowState` = `draft-validation`
   * preserve `latest`, `history`, and `unresolvedBlockers` when present
   * update `updatedAt`
3. reread both locations
4. verify both locations match `workflowState: draft-validation`

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
* workflow state set to `<draft-validation | draft-artifact-sync>`

**Key Details**

* synced artifacts: `<list or N/A>`
* blockers: `<list or None>`

**Next**

Workflow State: `<draft-validation | draft-artifact-sync>`
