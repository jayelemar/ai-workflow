# Fix Plan (State-Machine Driven)

This prompt updates an existing plan using findings from the latest validation.

It does NOT generate a new plan.

It does NOT perform validation.

---

## Instruction Loading

Read:

* `.codex/AGENTS.md`
* `.ai/instructions/workflow-state.md`
* the plan file
* the latest validation findings
* `.ai/specs/<feature>.spec.md` (if exists)
* relevant codebase files named by the spec or plan when the latest validation finding questions contract, shape, rendering, or file scope

---

## Plan Input (MANDATORY)

.ai/plans/<plan-name>.md

If not provided:

→ output `STOP`
→ state blocking reason (`plan file is required`)
→ do not proceed

---

## Validation Input (MANDATORY)

Use the most recent validation result from:

## Validation History

If no validation findings exist:

→ STOP (`validation findings required`)
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

fix-plan

IF Next Action != fix-plan:

→ STOP (`unexpected next action for plan fixing`)

---

## Scope

Fix ONLY:

* CRITICAL issues
* WARNING issues
* spec-origin issues from the latest validation entry marked exactly `MINOR SPEC REPAIR`
* misclassified spec-origin issues that can be resolved by narrowing the plan to existing codebase contracts or by removing invented behavior without changing the spec

reported by the most recent validation.

Do NOT:

* introduce new behavior
* expand scope
* modify the spec unless the latest validation finding is marked exactly `MINOR SPEC REPAIR`
* redesign the implementation
* create a new plan

---

## Spec Alignment (MANDATORY)

If a spec exists:

* spec remains the source of truth
* plan changes MUST remain aligned to the spec

If a validation issue truly originates from the spec and the latest validation finding is NOT marked exactly `MINOR SPEC REPAIR`:

→ STOP (`major or unclassified spec issue requires user decision before plan can be fixed`)

---

## Codebase Reclassification Check (MANDATORY)

Before stopping on `MAJOR SPEC DECISION REQUIRED`, inspect the relevant existing codebase files named by the spec or plan.

If the latest validation finding can be resolved by any of the following, treat it as a fixable plan issue and continue:

* removing behavior the plan invented beyond the spec
* narrowing file scope or validation scope back to the spec
* reusing an existing codebase contract/type/rendering path that already exists in spec-scoped files
* replacing an invented data shape/API contract with an existing compatible contract already present in the codebase
* adding spec-required coverage that the plan omitted
* reusing an existing sibling contract for a new spec-required section of an existing document/API surface
* including a supporting type/contract file only because an in-scope owner file needs that already-decided shape carried through existing code

Rules:

* This reclassification does NOT allow spec edits unless the finding is explicitly `MINOR SPEC REPAIR`.
* This reclassification does NOT allow new product behavior.
* This reclassification is allowed only when the plan can be corrected without asking the user to choose between multiple valid product behaviors.
* Reusing an existing sibling item contract is allowed when it does not add behavior beyond the spec and the reused contract already represents the same kind of item in that document/API surface.
* Adding a supporting type/contract file to the plan is allowed when the file only mirrors a spec-required shape that must flow through an already in-scope owner file.

If the latest validation finding is marked `MAJOR SPEC DECISION REQUIRED`, STOP only when the issue still requires user authority after this codebase reclassification check.

If a spec-origin validation finding is unclassified:

→ STOP (`unclassified spec issue requires user decision before plan can be fixed`)

If a `MINOR SPEC REPAIR` finding lacks exact allowed spec sections:

→ STOP (`minor spec repair requires exact allowed spec sections`)

If a `MINOR SPEC REPAIR` would require behavior not already decided in the existing spec:

→ STOP (`minor spec repair cannot introduce undecided behavior`)

---

## Minor Spec Repair Rules

Spec edits are allowed ONLY when the latest validation history entry points to an evidence artifact and that latest validation artifact:

* marks the issue exactly as `MINOR SPEC REPAIR`
* lists the exact spec file that may be edited
* lists the exact spec section(s) that may be edited
* describes the exact repair permitted for each named section

When allowed:

1. edit only the named spec file and named spec section(s) from the latest validation artifact
2. make only the exact repair permitted by the latest validation artifact
3. do not add new behavior, changed business logic, product decisions, API/data-shape decisions, or edge-case rules
4. update the plan only if needed to align with the repaired spec text
5. return to `draft + plan-validator`

---

## Fix Rules

For each validation issue:

1. identify affected section(s)
2. update only the required plan content
3. preserve existing approved content where possible
4. when applicable, replace invented plan behavior with the existing compatible codebase contract instead of asking for a new spec decision

Rules:

* keep modifications minimal
* maintain phase structure
* maintain file coverage
* maintain traceability

---

## Post-Fix Validation

Verify:

* all referenced validation issues were addressed
* no new assumptions were introduced
* plan structure remains valid
* phase-to-file mapping remains valid

If verification fails:

→ STOP (`plan fix incomplete`)

---

## State Transition (MANDATORY)

After fixes are applied:

update:

## Status

draft

## Next Action

plan-validator

---

## Plan Update (MANDATORY)

Update:

* affected phases
* files section (if required)
  * if a file section has no files, write exactly `* None`
  * do NOT write `none`, `(none)`, `(None)`, `N/A`, or other placeholder variants
* assumptions (if applicable)
* validation-related corrections

Do NOT:

* modify Validation History
* remove previous validation entries

---

## Output (MANDATORY)

Use this shared terminal-facing contract for non-review stages.

**Plan**

.ai/plans/<plan-name>.md

**Summary**

* PLAN UPDATED
* stage result/state line first
* at most 2-3 short high-signal bullets

**Key Details**

* issue addressed
* affected section(s)
* changes made

**Next**

Status:
draft

Next Action:
plan-validator

---
