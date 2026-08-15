Version: 2.0
Last Updated: 2026-07-29

# Reasoning Quality Instructions

## Purpose

Define the shared reasoning baseline for explicit workflow stages.

## Applies To

- `.ai/prompts/select-workflow.md`
- `.ai/prompts/generate-spec.md`
- `.ai/prompts/create-plan.md`
- `.ai/prompts/execute-plan.md`
- `.ai/prompts/review-changes.md`
- `.ai/prompts/goal-checkpoint.md`

## Rules

- Verify assumptions against the user request, spec when present, plan,
  codebase, actual diff, and validation evidence before treating them as facts.
- Stop for missing behavior decisions, unreadable required artifacts, or
  unresolved classification evidence; identify the exact missing input.
- Check implied edge cases: empty inputs, permission boundaries, state
  transitions, failed validation, out-of-scope files, repeated execution, and
  material scope discoveries.
- Keep scope within the saved plan and spec. A material discovery pauses work
  and returns to the correct explicit stage instead of being absorbed silently.
- Use actual implementation evidence for review. MEDIUM writes a complete
  status artifact; HIGH reviews every task before its commit. After all
  implementation, both classes require a fresh independent reviewer on the
  cumulative plan-owned diff and must clear blocking findings before
  completion.
- For HIGH tasks, apply the saved delegation decision exactly. Do not invent
  an ad-hoc delegation during execution; a material discovery updates the
  plan, and a missing required delegation result blocks the task.

## Validation

- Before final output, compare the claimed result with the actual diff,
  required validation, required review evidence, and the saved plan/spec.
- Confirm unrelated working-tree changes were preserved.

## Anti-Patterns

- Guessing a workflow class or product behavior.
- Using a pre-execution approval or review as a substitute for an explicit
  next-stage invocation.
- Claiming a review result without inspecting the implemented diff.
