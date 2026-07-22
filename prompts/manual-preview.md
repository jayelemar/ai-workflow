# Manual Preview

Use this prompt for standalone ad hoc work when the operator wants to see a
contextual code preview before non-test files are changed.

This prompt is not a workflow stage. It does not require a plan file, does not
read or update workflow state, does not create or update `.ai/artifacts`, and
does not update `## Workflow State`.

Manual preview does not read or update workflow state.
Manual preview does not update `## Workflow State`.

---

## Instruction Loading

Read:

* `.codex/.AGENTS.md`
* `.ai/instructions/index.md`
* `.ai/instructions/shared/reasoning-quality.md`
* `.ai/instructions/shared/debugging.md` before diagnosing failed preview or validation behavior
* the routed domain instruction files selected from `.ai/instructions/index.md`
  for the target files or requested change
* `.ai/instructions/shared/testing.md` before adding, changing, deleting, or
  selecting validation for tests

Apply shared reasoning-quality and debugging guidance for assumption
validation, edge-case checks, root-cause analysis, and scope discipline.

Do not broadly load `.ai/instructions/**` beyond the routed files required for
the requested change.

---

## Input Contract

The request must identify either:

* the target file paths, or
* a requested behavior specific enough to discover the target files safely

If the target or requested behavior is unclear:

→ output `STOP`
→ state blocking reason (`manual preview target or requested change is required`)
→ ask for the missing target or behavior
→ do not proceed

---

## Test-First Allowance

The following do NOT require separate approval before writing or running:

* test files and test-only fixtures
* test code changes in existing test files
* test commands
* validation commands selected under `.ai/instructions/shared/testing.md`

Treat test-only paths according to existing repository conventions, including:

* `*.test.*`
* `*.spec.*`
* `__tests__/`
* other clearly test-only directories already used by the repository

If a file mixes test-only content with production behavior or shared runtime
behavior, treat it as a non-test file.

---

## Non-Test Write Approval Gate

Before any write to a non-test file:

1. prepare the exact patch for the requested change
2. present a human-readable approval preview first, using contextual code
   snippets that show the change in place
3. identify the exact non-test files affected
4. STOP and wait for explicit operator approval

Rules:

* do not write the non-test file before approval
* approval applies only to the previewed patch
* if the patch changes after approval, show the updated readable preview, then
  wait again
* if test-only edits are needed to support the preview, those may be written
  before approval
* lead with the file path and a short change map before showing code
* prefer fenced code blocks using the real file language such as `tsx`, `ts`,
  `js`, `jsx`, `sql`, `css`, or `md`
* show surrounding code so the operator can see where the change lands in the
  file, similar to an in-place editor view
* add visible comments that are minimal, meaningful preview comments next to
  changed lines or blocks when showing preview code so the edits are easier to
  see
* prefer one concise explanatory comment per changed block over repeated
  line-by-line labels
* avoid marker-only comments such as `// new`, `// changed`, `/* new */`, or
  `<!-- changed -->` unless no clearer short comment exists
* remove preview-only comments before applying the actual file unless the
  operator explicitly asks to keep them
* it is acceptable to collapse unrelated unchanged sections with concise
  placeholders such as `...rest of code`
* do not include raw diff output or patch text unless the operator explicitly
  asks to see it

When waiting for approval, the primary review surface must be the contextual
code preview.
Preview comments should make the changed lines or blocks easier to see.

---

## Implementation Rules

For the requested change only:

* preserve existing behavior unless the request requires a change
* do not introduce unrelated refactors
* use the smallest validation that gives confidence

If the codebase contradicts the request in a way that prevents safe execution:

→ STOP (`request/codebase mismatch`)

---

## Validation

Before reporting applied work:

* run the smallest relevant validation
* classify skipped validation or deferred validation explicitly
* state any manual, browser, deployed, or external validation that remains

If validation finds more implementation work already covered by the request,
continue only after showing any new non-test patch preview that would be needed.

---

## Output Contract

Use one of these outcomes only:

### 1. Approval Required

Use when a non-test write is ready but not yet approved.

**Summary**

* APPROVAL REQUIRED
* no non-test files were written

**Key Details**

* requested change
* exact non-test files that would change

**Code Preview**

```tsx
function something() {
  ...
  const something2 =
  ...
}

...rest of code
```

**Next**

Waiting for Approval:

* yes

### 2. Manual Update

Use after approved work is applied, validation runs, validation is deferred, or
a blocker is found.

**Summary**

* APPLIED | BLOCKED
* manual preview result

**Key Details**

* files changed or blocker found
* approval source or approval summary

**Validation**

* commands run
* result or deferral note

**Next**

* no workflow state was updated
