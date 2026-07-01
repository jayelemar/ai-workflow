## Plan Requirements (MANDATORY STRUCTURE)

The generated plan MUST follow this exact manifest structure.

---

# Plan: <plan-name>

## Workflow Content Rules

thin-plan-v2

---

## Status

draft

---

## Next Action

plan-validator

---

## Spec

.ai/specs/<spec-file>.spec.md

---

## Artifacts

* User journey: `.ai/artifacts/<plan-name>/user-journey.md` or `N/A: <concrete reason>`
* Implementation map: `.ai/artifacts/<plan-name>/implementation-map.md`
* Workflow state: `.ai/artifacts/<plan-name>/state/workflow.json`
* File ownership: `.ai/artifacts/<plan-name>/state/file-ownership.json`
* Files: `.ai/artifacts/<plan-name>/state/files.json`
* Context: `.ai/artifacts/<plan-name>/state/context.md`
* Events: `.ai/artifacts/<plan-name>/events/`

---

## Phases

### Preparation

* Objective: <preparation objective>
* Tasks:
  1. <step-by-step preparation task with concrete file paths where applicable>
* Expected outcome: <expected preparation outcome>

### Implementation

* Objective: <implementation objective>
* Tasks:
  1. <step-by-step implementation task with concrete file paths where applicable>
* Expected outcome: <expected implementation outcome>

### Validation

* Objective: <validation objective>
* Tasks:
  1. <tests or validation command with expected result>
* Expected outcome: <expected validation outcome>

---

## Workflow State Rules

See `.ai/instructions/shared/workflow-state.md`.

---

## Completion Condition

The task is complete ONLY when:

* plan details are visible in `## Phases`
* required runtime artifacts are saved under `.ai/artifacts/<plan-name>/`
* plan is saved to `.ai/plans/<plan-name>.md`

---

## Final Output

Return only:

Plan saved to .ai/plans/<plan-name>.md
