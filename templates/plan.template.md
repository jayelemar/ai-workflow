## Plan Requirements (MANDATORY STRUCTURE)

The generated plan MUST follow this exact manifest structure.

---

# Plan: <plan-name>

## Document Format

plan-manifest@1

## Workflow Content Rules

thin-plan

---

## Execution Mode

manual

---

<!-- Runner-managed plans only: include this block. Manual plans omit it. -->
## Workflow State

draft-artifact-sync

---

## Spec

.ai/specs/<spec-file>.spec.md

---

## Artifacts

* User journey: `.ai/artifacts/<plan-name>/user-journey.md` or `N/A: <concrete reason>`
* Implementation map: `.ai/artifacts/<plan-name>/implementation-map.md` or `N/A: <concrete reason>`
* Manual handoff: `.ai/artifacts/<plan-name>/manual-handoff.md` or `N/A: runner-managed execution`
* Goal handoff: `.ai/artifacts/<plan-name>/goal-handoff.md` or `N/A: not a HIGH-GOAL manual plan`
* Workflow state: `.ai/artifacts/<plan-name>/state/workflow.json` or `N/A: manual plan-bound execution`
* File ownership: `.ai/artifacts/<plan-name>/state/file-ownership.json` or `N/A: manual plan-bound execution`
* Files: `.ai/artifacts/<plan-name>/state/files.json` or `N/A: manual plan-bound execution`
* Context: `.ai/artifacts/<plan-name>/state/context.md` or `N/A: manual plan-bound execution`
* Events: `.ai/artifacts/<plan-name>/events/` or `N/A: manual plan-bound execution`

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

For a runner-managed plan with multiple atomic outcomes, replace the generic
implementation task above with ordered tasks using this exact structure:

```text
1. [task:NN-readable-words] <imperative title, maximum 50 characters>
   - Behavior: <one exact outcome>
   - Files: <exact repo-relative paths>
   - Validation: <exact runnable commands>
   - Depends on: None | <earlier task IDs>
   - Completes: <exact acceptance-criterion text> | None — prerequisite for <later task ID>
   - Coupling rationale: N/A | <exact reason the listed work cannot be split safely>
   - Size warning: N/A | More than 8 commit paths
   - Atomization warning: N/A | <exact unresolved split boundary>
```

For one atomic runner-managed outcome, use the same fields without a
`[task:...]` ID. Manual plans are not required to use this structure.

### Validation

* Objective: <validation objective>
* Tasks:
  1. <tests or validation command with expected result>
* Expected outcome: <expected validation outcome>

---

## Commit Boundaries

N/A: Each task savepoint produces one local commit.

For a runner-managed task that cannot safely become separate implementation and
review savepoints, but needs an atomized local commit history, replace `N/A`
with one entry per affected task using this exact structure:

```text
### [task:NN-readable-words]

1. **<coherent boundary name>** — `<exact repo-relative path>`,
   `<exact repo-relative path or narrowly scoped file group>`.
2. **<next coherent boundary name>** — `<exact repo-relative path>`.
```

Use this exception only after considering independent task savepoints first.
List two to twelve dependency-ordered boundaries. Each changed plan-owned path
must belong to exactly one boundary; a boundary may name a narrowly scoped
file group only when every matching file belongs together. Keep each boundary's
focused tests with its implementation. Do not add a final aggregate commit.

---

## Workflow State Rules

For runner-managed plans, see `.ai/instructions/shared/workflow-state.md`.

---

## Completion Condition

The task is complete ONLY when:

* plan details are visible in `## Phases`
* required artifacts for the selected execution mode are saved under `.ai/artifacts/<plan-name>/` or recorded as `N/A: manual plan-bound execution`
* plan is saved to `.ai/plans/<plan-name>.md`

---

## Final Output

Return only:

Plan saved to .ai/plans/<plan-name>.md
