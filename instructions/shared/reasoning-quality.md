Version: 1.2
Last Updated: 2026-07-14

# Reasoning Quality Instructions

## Purpose

Define the shared reasoning baseline for workflow prompts without depending on
external skill prompts or plugin-specific paths.

## Applies To

- `.ai/prompts/create-plan.md`
- `.ai/prompts/sync-plan-artifacts.md`
- `.ai/prompts/plan-validator.md`
- `.ai/prompts/execute-plan.md`
- `.ai/prompts/review-changes.md`
- `.ai/prompts/fix-review.md`
- `.ai/prompts/unblock-plan.md`
- `.ai/prompts/reopen-plan.md`
- `.ai/prompts/plan-preview-before-apply.md`
- `.ai/prompts/manual-preview.md`
- `.ai/prompts/generate-user-flow.md`
- `.ai/scripts/workflow-runner.ts`

## Rules

- Validate assumptions against the spec, plan, codebase, and evidence before
  treating them as facts.
- Check edge cases that are implied by the changed behavior, including empty
  inputs, permission boundaries, state transitions, failed validation,
  out-of-scope files, and repeated workflow runs.
- Prefer the smallest change that satisfies the plan and preserves existing
  contracts.
- State important tradeoffs when there is more than one plausible approach, then
  choose the approach that best fits the current workflow state and file scope.
- Keep scope discipline: do not introduce behavior outside the spec, plan,
  prompt stage, or runner-owned file boundary.
- Do not bypass STOP rules, validation requirements, staged-diff boundaries,
  workflow state transitions, file ownership rules, user approval gates, or
  prompt-specific read requirements.
- Do not load `think`, `analyze`, or `edge-cases` as filesystem skills; this
  file is the reusable reasoning contract.

## Validation

- Before final output, compare the claimed result with the actual diff,
  workflow state, validation evidence, and prompt-specific completion criteria.
- For review stages, ensure findings are grounded in the path-scoped staged
  diff, required specs, user-journey artifacts when applicable, and the latest
  validation evidence.
- For execution stages, ensure plan-owned files, tests, and state transitions
  match the current task or plan stage before moving forward.
- For runner-managed stages, prefer the snapshot plus the latest relevant event
  pointer before opening additional artifact history.

## Anti-Patterns

- Treating a plausible interpretation as confirmed without checking the source
  document or code.
- Expanding scope to fix unrelated issues discovered during workflow execution.
- Replacing explicit workflow gates with informal judgment.
- Using broad instruction or artifact reads when the Active Context Packet or
  snapshot provides the required source.
- Inspecting workflow `history` during normal runs when the snapshot and latest
  relevant event pointer already provide the required evidence path.
