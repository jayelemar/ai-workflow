## Plan Requirements (MANDATORY STRUCTURE)

The generated plan MUST follow this exact structure.

---

# Plan: <plan-name>

## Workflow Content Rules

thin-plan-v1

Rules:

* Runtime artifacts for this plan belong under `.ai/artifacts/<plan-name>/`.
* Event artifacts belong under `.ai/artifacts/<plan-name>/events/<kind>-v<N>.md`.
* Every event artifact MUST include `# ...`, `## Summary`, and `## Evidence`.
* Keep workflow history entries under 512 bytes.
* Keep aggregate workflow history under 4 KB.
* Plan workflow entries may contain only `Summary`, exactly one of `Result`, `Decision`, or `Status`, and `Evidence`.
* Put detailed issue lists, fixes, validation output, blocker notes, and reopen notes in event artifacts.
* Do not paste artifact bodies or narrative workflow sections into the plan.

---

## Status

draft

Allowed values:

* draft
* approved
* active
* review
* reopening
* completed
* blocked

Rules:

* MUST always contain exactly one value
* MUST be updated only through workflow transitions
* MUST NOT use any value outside the allowed list

---

## Next Action

plan-validator

Allowed values:

* plan-validator
* fix-plan
* execute-plan
* unblock-plan
* review-plan
* reopen-plan
* commit-summary

Rules:

* MUST always contain exactly one value
* MUST represent the next workflow step
* MUST be updated whenever Status changes
* MUST NOT use any value outside the allowed list

---

## Spec

.ai/specs/<spec-file>.spec.md

Rules:

* MUST list repo-relative `*.spec.md` path entries
* Use `.ai/specs/` by default for ordinary feature or bug specs

---

## Phases

### Preparation

* Objective:
* Tasks:
  1.
  2.
* Expected Outcome:

---

### Implementation

* Objective:
* Tasks:
  1.
  2.
* Expected Outcome:

---

### Validation

* Objective:
* Tasks:
  1.
  2.
* Expected Outcome:

---

## Ownership Scope

* <exact file path or directory glob ending in /**>

---

## Files (MANDATORY)

### Created files

* <exact file path, or None if no created files>

### Modified files

* <exact file path, or None if no modified files>

### Deleted files

* <exact file path, or None if no deleted files>

Rules:

* MUST use concrete file paths
* MUST NOT append comments, conditions, or annotations to file-path bullets; use only the exact path value, except an inferred path may end with ` (assumed)`
* If a file section has no files, write exactly `* None`
* MUST NOT use `none`, `(none)`, `(None)`, `N/A`, or other placeholder variants in generated plans
* MUST NOT use vague terms like "service layer" or "module"
* If unknown, infer from spec and clearly state assumption

---

## Execution Log

(empty)

## Validation History

(empty)

## Review History

(empty)

## Reopen History

(empty)

## Blockers

(empty)

---

## Workflow State Rules

See `.ai/instructions/shared/workflow-state.md`.

Rules:

* MUST follow the canonical status values, next-action values, status transitions, mappings, and workflow loops defined there
* MUST NOT duplicate the full workflow state-machine rules in generated plans

---

## Rules

* MUST include ALL sections above
* MUST NOT omit any section
* MUST NOT invent behavior outside the spec
* MUST keep plan descriptive (no code)

---

## Completion Condition

The task is complete ONLY when:

* plan follows exact structure above
* plan is saved to:
  .ai/plans/<plan-name>.md

---

## Final Output

Return only:

Plan saved to .ai/plans/<plan-name>.md
