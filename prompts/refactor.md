Version: 1.3
Last Updated: 2026-05-18

This prompt defines refactoring-specific behavior only.

Use it when the task is to refactor an existing page, component, module, service, hook, or related code path for readability, reuse, and long-term maintainability.

---

## Instruction Loading

Read:

* `.codex/AGENTS.md`
* directly relevant `.ai/instructions/*`

before proceeding.

Load only instructions that affect the target code.

---

## Task

Refactor:

`<target file, page, component, feature folder, or module>`

Goal:

`<describe the readability, reuse, maintainability, or organization problem>`

Expected behavior:

`<describe the behavior that must remain unchanged>`

---

## Scope Boundary

Refactor only the target and directly required supporting files.

Do NOT:

* change product behavior unless explicitly requested
* add new features
* rewrite unrelated code
* move code across app/package boundaries without evidence and justification
* introduce abstractions for one-off logic
* update `.ai/instructions/*` unless reusable architecture or validation patterns changed

If the target is broad or ambiguous:

→ output `STOP`
→ ask for a specific target
→ do not proceed

---

## Pre-Refactor Validation (MANDATORY)

Determine:

* current entry point and execution flow
* dependencies
* downstream consumers
* validation approach
* behavior to preserve

If any cannot be determined:

→ output `STOP`
→ state blocking reason
→ do not proceed

---

## Refactoring Principles

Preserve behavior first.

Improve readability by:

* separating data preparation from execution
* reducing nesting
* grouping related logic
* naming by domain meaning

Improve reuse only when:

* logic appears multiple times
* extracted unit has stable inputs/outputs

Avoid:

* unnecessary abstraction
* hiding simple logic
* vague helper names

---

## Code Splitting (MANDATORY CHECK)

Evaluate whether splitting is needed.

Split when:

* file has multiple responsibilities
* logic and UI are mixed
* large sections reduce readability

Rules:

* split by responsibility, not size
* keep entry points readable
* stop when further splitting adds no value

---

## Implementation Rules

* smallest change that solves the problem
* preserve behavior exactly
* maintain type safety
* remove dead code
* keep imports clean

If behavior must change:

→ output `STOP`
→ explain why
→ do not proceed

---

## Validation (MANDATORY)

Run:

* lint/format
* relevant tests
* type checks if needed

If validation cannot run:

→ state why
→ list unverified areas

---

## Review Checklist

Verify:

* behavior preserved
* readability improved
* no scope creep
* no dead code
* validation results recorded

---

## Output

### 1. Summary

* what was refactored
* why it is better

---

### 2. Changed Files

* `<file-path>` → change description

---

### 3. Behavior Preservation

* expected behavior
* actual behavior

---

### 4. Reuse Decisions

* what was extracted
* why

---

### 5. Validation

* commands run
* expected vs actual

---

### 6. Known Gaps

* risks
* unverified areas
