# Reasoning Quality Instruction Changelog

## v1.2 - 2026-07-14

* Removed the retired split-review prompt from the shared workflow prompt scope.

## v1.1 - 2026-07-09

* Added snapshot-plus-latest-relevant-event guidance for runner-managed stages
  and marked workflow-history reads as a token-wasting anti-pattern during
  normal runs.

## v1.0 - 2026-07-09

* Added native shared reasoning-quality guidance for workflow prompts, including
  assumption checks, edge-case analysis, tradeoff notes, scope discipline, and
  workflow gate preservation.
