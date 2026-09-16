Version: 3.2
Last Updated: 2026-09-16

# Reasoning Quality Instructions

## Purpose

Define the shared reasoning baseline for explicit workflow stages.

## Applies To

- `.ai/prompts/workflow/select-workflow.md`
- `.ai/prompts/workflow/generate-spec.md`
- `.ai/prompts/workflow/create-plan.md`
- `.ai/prompts/workflow/execute-plan.md`
- `.ai/prompts/workflow/review-changes.md`
- `.ai/prompts/workflow/goal-checkpoint.md`

## Rules

- Verify assumptions against the user request, spec when present, plan,
  codebase, actual diff, and validation evidence before treating them as facts.
- Stop for missing behavior decisions, unreadable required artifacts, or
  unresolved classification evidence; identify the exact missing input.
- Check implied edge cases: empty inputs, permission boundaries, state
  transitions, failed validation, out-of-scope files, repeated execution, and
  material scope discoveries.
- Keep behavior within the saved plan and spec. Classify execution discoveries
  only with the corrective-deviation decision table in `.ai/AGENTS.md`.
- Apply a proportionality check before adding a requirement, plan component,
  finding, or remediation: name its exact request/spec/invariant basis, the
  observed evidence or realistic threat, the smallest sufficient response, and
  why a simpler existing mechanism is insufficient. A hypothetical risk or
  architectural preference alone is not a requirement or blocking defect.
- Distinguish unnecessary implementation from spec-mandated complexity.
  Remove or simplify the former when doing so preserves behavior. Never relax
  the latter during planning, execution, or review; a change to its guarantee
  returns to the user-owned specification decision.
- Use actual implementation evidence for review. MEDIUM writes a complete
  status artifact; HIGH reviews every task before its commit. After all
  implementation, both classes require a fresh independent reviewer on the
  cumulative plan-owned diff and must clear blocking findings before
  completion.
- Trust a review report or completion claim only while its recomputed
  `review-input-fingerprint@1` evidence matches the reviewed plan-owned diff.
  Treat a changed audit-only HEAD with an unchanged base and plan-owned digest
  as unrelated repository movement, not review drift.
- For HIGH tasks, apply the saved delegation decision exactly. Do not invent
  ad-hoc delegation; a missing required result blocks the task.

## Validation

- Before final output, compare the claimed result with the actual diff,
  required validation, required review evidence, and the saved plan/spec.
- Confirm unrelated working-tree changes were preserved.

## Anti-Patterns

- Guessing a workflow class or product behavior.
- Using a pre-execution approval or review as a substitute for an explicit
  next-stage invocation.
- Claiming a review result without inspecting the implemented diff.
- Treating optional hardening, aesthetic simplification, or a different valid
  architecture as blocking remediation.
