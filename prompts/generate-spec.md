# Generate Spec

Create one finalized, deterministic behavior specification for work already
classified MEDIUM or HIGH. Run only when the user explicitly invokes this
prompt with a spec type and input. Do not plan or implement.

## Input Contract

```text
Spec type: feature-spec@1 | bugfix-spec@1
Name: <kebab-case name>
Classification: MEDIUM | HIGH
Request and decisions: <desired behavior, constraints, and acceptance evidence>
Bug evidence: <required for bugfix-spec@1; N/A for feature-spec@1>
```

If the type, class, desired behavior, or a material decision is missing, stop
and request only the missing input. Inspect the codebase to establish current
facts and constraints, never to invent desired behavior.

## Shared Rules

- Read `.ai/AGENTS.md`, `.ai/instructions/index.md`, and relevant routed
  instructions.
- Resolve roles, inputs, outputs, permissions, success paths, failures, edge
  cases, non-goals, compatibility constraints, and pass/fail acceptance
  criteria.
- Express behavior deterministically with exact IF/THEN rules where branching
  exists. Define every material branch.
- Keep implementation file scope and execution commands out of the spec unless
  the user provided them as non-negotiable constraints.
- Ask for explicit decisions when alternatives materially change behavior.
- Finalizing and saving the spec does not invoke flow artifacts or planning.

## Feature Contract

For `feature-spec@1`, save `.ai/specs/<name>.spec.md` with exactly these
top-level sections:

```md
# Feature: <name>

## Document Format

feature-spec@1

## Goal

## Actors and Permissions

## Inputs and Outputs

## Behavior

## Edge Cases and Failures

## Constraints and Non-Goals

## Acceptance Criteria

## Open Decisions
```

`Open Decisions` must be exactly `None` before the spec is finalized.

## Bugfix Contract and RCA Gate

For `bugfix-spec@1`, a root-cause analysis is mandatory. Evidence must establish
the observed failure, affected boundary, causal mechanism, and why the proposed
fix addresses that mechanism. Record rejected hypotheses when they materially
distinguish the root cause. A symptom, guess, temporal correlation, or desired
patch is not an RCA.

If evidence is insufficient, stop without saving the spec and return the exact
reproduction, log, state, diff, or environment evidence needed. Do not label an
operator assertion or an unverified production claim as evidence.

Save `.ai/specs/<name>.spec.md` with exactly these top-level sections:

```md
# Bugfix: <name>

## Document Format

bugfix-spec@1

## Goal

## Evidence

## Root Cause Analysis

## Rejected Hypotheses

## Current and Expected Behavior

## Actors and Permissions

## Inputs and Outputs

## Fix Behavior

## Edge Cases and Failures

## Constraints and Non-Goals

## Acceptance Criteria

## Open Decisions
```

`Evidence` and `Root Cause Analysis` must cite concrete inspected or supplied
evidence. `Open Decisions` must be exactly `None` before finalization.

## Validation

Before saving, verify the selected schema is exact, every acceptance criterion
maps to defined behavior, all material branches and failures are deterministic,
and no desired behavior was inferred from code. For `bugfix-spec@1`, also
verify every RCA conclusion is evidence-backed.

Manual token telemetry is optional and does not affect finalization.

## Final Response

Return exactly:

`Spec finalized at .ai/specs/<name>.spec.md [<spec-type>]`
