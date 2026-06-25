## Plan Requirements (MANDATORY STRUCTURE)

The generated plan MUST follow this exact structure.

---

# Plan: <plan-name>

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

---

## Validation History

(empty)

Rules:

* Every validation iteration MUST append a new entry
* MUST NOT overwrite previous validation entries
* Validation versions MUST be sequential

Example:

### Validation v1

* Result: NEEDS FIX
* Critical Issues:
* Warnings:

### Validation v2

* Result: APPROVED
* Critical Issues:
* Warnings:

---

## Review History

(empty)

Rules:

* Every review iteration MUST append a new entry
* MUST NOT overwrite previous reviews
* Review versions MUST be sequential

Example:

### Review v1

* Summary:
* Issues:
* Decision:

### Review v2

* Summary:
* Issues:
* Decision:

---

## Reopen History

(empty)

Rules:

* Every reopen iteration MUST append a new entry
* MUST NOT overwrite previous reopen entries
* Reopen versions MUST be sequential

Example:

### Reopen v1

* Summary:
* Findings:
* Required Fixes:
* Required Validation:
* Decision:

### Reopen v2

* Summary:
* Findings:
* Required Fixes:
* Required Validation:
* Decision:

---

## Blockers

(empty)

---

## Workflow State Rules

See `.ai/instructions/workflow-state.instructions.md`.

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
