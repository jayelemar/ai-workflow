# Generate Spec

Create one finalized, deterministic behavior specification for work already
classified MEDIUM or HIGH. Run only when the user explicitly invokes this
prompt with a spec type and input. Do not plan or implement.

## Input Contract

```text
Spec type: feature-spec@1 | bugfix-spec@1
Name: <kebab-case name> | AUTO
Supersedes: N/A | .ai/specs/<current-spec-name>.spec.md
Classification: MEDIUM | HIGH
Request and decisions: <desired behavior, constraints, and acceptance evidence>
Bug evidence: <required for bugfix-spec@1; N/A for feature-spec@1>
```

`Name` and `Supersedes` are required. Use an explicit safe kebab-case name with
`Supersedes: N/A` for an initial spec or an idempotent exact-match invocation.
Accept `Name: AUTO` only with one readable current finalized spec under
`.ai/specs/` named by `Supersedes`. For AUTO, start at revision `2` after an
unrevisioned predecessor or at `<N+1>` after `<base>-rN`, then increment until
`.ai/specs/<base>-rN.spec.md` does not exist. Use that first unused candidate;
an occupied AUTO candidate is skipped, never treated as an output collision.
Reject an explicit name combined with `Supersedes`, `AUTO` without a valid
predecessor, unsafe paths, and explicit output collisions.

If the type, class, desired behavior, or a material decision is missing, stop
and request only the missing input. Inspect the codebase to establish current
facts and constraints, never to invent desired behavior.

The candidate output path is `.ai/specs/<resolved-name>.spec.md`. Finalized spec
paths are immutable. For an explicit name, inspect whether that path exists. If
it contains the exact valid spec requested by this invocation, leave its bytes
unchanged, use that path as `<final-spec-path>`, and return the normal final
response; planning may reuse that exact path. If it contains a different valid
finalized spec, do not modify, replace,
or delete it. Treat every non-exact requested content revision—including
evidence, root-cause analysis, rejected hypotheses, constraints, or acceptance
criteria changes that preserve desired behavior—the same way: stop with `Do
this next:` followed by a complete copy-pasteable invocation of this prompt
using `Name: AUTO`, the colliding valid spec path under `Supersedes`, and every
other supplied input unchanged. Only this prompt resolves the successor name.

If an explicit output path exists but is unreadable, malformed, or not a
regular file, preserve it and stop with the exact blocker. Resolve a new unused
explicit kebab-case name in this prompt and provide the complete retry
invocation under `Do this next:` with `Supersedes: N/A` and every other supplied
input unchanged. Never use a malformed artifact as an AUTO predecessor. These
rules keep predecessor plans tied to the exact valid spec they were created
from.

For `Name: AUTO`, compare the requested complete content with the predecessor.
If it is an exact valid match, leave the predecessor byte-unchanged, reuse its
path as `<final-spec-path>`, and return the normal final response. Otherwise
save the new immutable spec only at the resolved unused successor path, use it
as `<final-spec-path>`, and never modify the predecessor. For a new explicit
name, use its saved candidate path as `<final-spec-path>`.

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
- Never update a finalized spec in place. Any requested spec-content change
  requires a newly invoked specification stage with a new unused name;
  planning then records the resulting immutable spec path.
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
no desired behavior was inferred from code, and the output path is either new
or contains an exact valid match that will remain byte-unchanged. For
`bugfix-spec@1`, also verify every RCA conclusion is evidence-backed.

## Final Response

Return exactly:

`Spec finalized at <final-spec-path> [<spec-type>]`
