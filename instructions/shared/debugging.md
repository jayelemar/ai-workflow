Version: 1.2
Last Updated: 2026-07-29

# Debugging Instructions

## Purpose

Define the shared debugging baseline for repository investigation and
implementation work.

## Applies To

- Bug investigations and living plans
- Failed tests, lint, formatting, build, or validation commands
- Review remediation
- Instruction or skill behavior that differs from documented expectations

## Rules

- Identify the failing observable behavior before changing code.
- Compare against known-good behavior from the request, living plan, tests,
  current implementation, or prior passing validation.
- Form one concrete hypothesis at a time and choose the smallest check that can
  confirm or reject it.
- Change one cause at a time when practical, then rerun the smallest relevant
  validation.
- Preserve material failure evidence in the living plan when present or in the
  final summary.
- After three consecutive failed fix attempts for the same symptom, STOP and
  report the repeated symptom, attempted fixes, current evidence, and the next
  information needed.

## Validation

- Follow `shared/testing.md` for regression-test policy and test-layer
  selection before implementation.
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
