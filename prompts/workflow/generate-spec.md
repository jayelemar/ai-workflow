# Generate Spec

Create one finalized, deterministic behavior specification for work already
classified MEDIUM or HIGH. Run only when the user explicitly invokes this
prompt with a spec type and input. Do not plan or implement.

## Input Contract

```text
Spec type: feature-spec@1 | bugfix-spec@1
Supersedes: N/A | .ai/specs/<current-spec-name>.spec.md
Classification: MEDIUM | HIGH
Request and decisions: <desired behavior, constraints, and acceptance evidence>
Bug evidence: <required for bugfix-spec@1; N/A for feature-spec@1>
```

`Supersedes` is required. Use `Supersedes: N/A` for an initial spec. For a
content revision or an idempotent exact-match invocation, provide exactly one
readable current finalized spec under `.ai/specs/`. Reject unsafe paths and a
missing, malformed, unreadable, or non-regular predecessor; never use such an
artifact as revision lineage.

If the type, class, desired behavior, or a material decision is missing, stop
and request only the missing input. Inspect the codebase to establish current
facts and constraints, never to invent desired behavior.

## Filename Confirmation Gate

Finalized spec paths are immutable. Before creating any spec file, ask the user
to select its filename and show one suggested filename that is short and
specific. Write nothing before receiving the user's explicit filename
selection. A filename included in the initial invocation is only a naming
preference and never counts as the required selection; the selection must be a
direct reply to the filename question during this invoked stage. Use that
preference as the suggestion only when it satisfies every naming and collision
rule below.

Ask only after every non-filename input, decision, schema rule, and applicable
RCA gate is complete enough to produce the final content. Construct all
semantic spec content in memory before suggesting a name. Render the schema's
`<name>` from the selected filename stem; for an exact-predecessor comparison,
render it from the predecessor's stem. For an initial spec, derive two to five
kebab-case words, with a maximum of 48 characters before `.spec.md`. Choose the
shortest name that remains specific to the requested behavior, normally an
action plus its distinguishing object. Exclude generic filler such as
`feature`, `bugfix`, `spec`, `update`, `change`, or `misc`.

The suggestion must resolve to an unused path. If the shortest natural initial
name is occupied, add the shortest distinguishing request term that still fits
the limits. If no unused specific variant remains, append the lowest available
integer starting at `2`, shortening earlier words as needed to keep the stem at
48 characters or fewer.

Treat every non-exact requested content revision—including evidence,
root-cause analysis, rejected hypotheses, constraints, or acceptance criteria
changes that preserve desired behavior—as creation of a new immutable spec and
apply this filename confirmation gate.

For a changed spec with `Supersedes`, derive the suggestion from its predecessor:
start at revision `2` after an unrevisioned predecessor or at `<N+1>` after
`<base>-rN`, then increment until `.ai/specs/<base>-rN.spec.md` does not exist.
Use that first unused candidate. The inherited base may exceed the initial-name
length or word limits; do not rename established lineage merely to shorten it.

If the predecessor is an exact valid match for the requested complete content,
leave it byte-unchanged, reuse its path as `<final-spec-path>`, return the normal
final response, and do not ask for a filename because no file will be created.
Otherwise return exactly this filename question and stop without writing:

```text
Spec filename required before creation.
Suggested filename: `<suggested-name>.spec.md`
Reply with `Use <suggested-name>.spec.md` to accept, or `Use <other-safe-kebab-case-name>.spec.md`.
```

Accept only a direct reply in that form whose filename is a basename ending in
`.spec.md` and whose stem is safe kebab-case. Resolve it only under `.ai/specs/`.
If the reply does not match this form, repeat the same filename question and
suggestion and write nothing.
If the selected path does not exist, save the candidate content there and use
it as `<final-spec-path>`. If it contains the exact valid spec requested, leave
its bytes unchanged and reuse it as `<final-spec-path>`. If the selected path
already contains a different valid spec, preserve it and ask again with a new
unused suggestion; do not modify, replace, or delete it. If it exists but is
unreadable, malformed, or not a regular file, also preserve it and ask again
with a new unused suggestion. Never modify, replace, or delete an existing spec
path.

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
  requires a newly invoked specification stage and a newly confirmed unused
  filename; planning then records the resulting immutable spec path.
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
no desired behavior was inferred from code, the filename was explicitly
selected after the required question, and the output path is either new or
contains an exact valid match that will remain byte-unchanged. For
`bugfix-spec@1`, also verify every RCA conclusion is evidence-backed. An exact
predecessor reuse is exempt only from the filename-selection check because it
does not create a file.

## Final Response

Finalizing the spec stops before planning. Return the finalized path and a
complete planning invocation; providing it does not invoke or authorize the
planning stage.

For an initial spec, or for a content revision with no active predecessor plan,
return exactly:

````text
Spec finalized at <final-spec-path> [<spec-type>]

Do this next:
```text
Use `.ai/wrappers/create-plan.md`.

Plan name: <resolved-name>
Supersedes: N/A
Classification: <classification>
Spec: <final-spec-path>
Flow artifacts: AUTO
```
````

When a content revision has exactly one active predecessor plan whose `## Spec`
references the supplied `Supersedes` spec, use that plan as
`<current-active-plan-path>` and return exactly:

````text
Spec finalized at <final-spec-path> [<spec-type>]

Do this next:
```text
Use `.ai/wrappers/create-plan.md`.

Plan name: AUTO
Supersedes: <current-active-plan-path>
Classification: <classification>
Spec: <final-spec-path>
Flow artifacts: AUTO
```
````
