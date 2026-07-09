Version: 1.0
Last Updated: 2026-07-09

# Debugging Instructions

## Purpose

Define the shared debugging baseline for workflow prompts and implementation
work.

## Applies To

- Bugfix plans
- Failed workflow stages
- Failed tests, lint, formatting, build, or validation commands
- Review remediation
- Prompt or runner behavior that differs from the documented workflow contract

## Rules

- Identify the failing observable behavior before changing code.
- Compare against known-good behavior from the spec, tests, current prompt
  contract, existing implementation, or prior passing validation.
- Form one concrete hypothesis at a time and choose the smallest check that can
  confirm or reject it.
- Change one cause at a time when practical, then rerun the smallest relevant
  validation.
- Preserve failure evidence in the plan, event artifact, or final summary when
  the workflow prompt requires it.
- After three consecutive failed fix attempts for the same symptom, STOP and
  report the repeated symptom, attempted fixes, current evidence, and the next
  information needed.

## Validation

- For bug fixes or behavior changes, confirm or add a failing regression test
  before implementation whenever the repository has a practical test layer for
  the behavior.
- Verify the original failure mode is covered by the final validation command.
- If validation cannot run, state the environment blocker, residual risk, and
  the smallest command that should be run later.

## Anti-Patterns

- Editing first and searching for a theory afterward.
- Fixing multiple independent causes in one pass without isolating the failing
  signal.
- Treating a different failure as proof that the original issue is fixed.
- Continuing speculative fixes after repeated failures without stopping for
  better evidence.
