# Generate Flow Artifacts

Create both canonical flow artifacts for a finalized MEDIUM or HIGH spec. Run
only when the user explicitly invokes this prompt. This stage does not plan or
implement.

## Input

```text
Spec: .ai/specs/<name>.spec.md
Classification: MEDIUM | HIGH
```

Read `.ai/AGENTS.md`, the finalized spec,
`.ai/instructions/shared/flow-trace-artifacts.md`,
`.ai/instructions/shared/reasoning-quality.md`, and project instructions routed
by `.ai/instructions/index.md`. Inspect code only for current facts.

If the scope does not require end-to-end flow artifacts, stop and return the
concrete `N/A` reason to record later in the plan. If behavior is incomplete,
stop with the exact missing spec decision.

## User Journey

Save `.ai/artifacts/<name>/user-journey.md` using this schema:

```md
# <journey title>

## Document Format

user-journey@1

## Goal

## Actors

## Entry Points

## User Flows

## Mermaid Diagram

## States

## Failures

## Acceptance Scenarios

## Open Decisions
```

Use Markdown and Mermaid only. Tie desired outcomes to the finalized spec and
entry points to observed repository paths. `Open Decisions` must be exactly
`None` before saving.

## Implementation Map

Save `.ai/artifacts/<name>/implementation-map.md` using this schema:

```md
# Implementation Map: <name>

## Document Format

implementation-map@1

## Canonical Ownership

### User Action: <exact action from user journey>

- Repository: <declared Git repository root candidate>
- UI/entry ownership: <paths or None: reason>
- API ownership: <paths or None: reason>

## Contract and Data

### User Action: <same exact action>

- Public/internal contracts: <paths and symbols or None: reason>
- State and persistence: <paths/effects or None: reason>
- Migration or compatibility boundary: <details or None: reason>

## Services

### User Action: <same exact action>

- Application/backend services: <paths or None: reason>
- External integrations: <boundary or None: reason>

## Validation

### User Action: <same exact action>

- Automated: <exact test ownership and command>
- Manual/external: <check or None: reason>

## Open Decisions

None
```

Create one complete mapping for every user action and acceptance scenario.
Never add an action absent from the user journey. Use `None: <concrete reason>`
only when a category genuinely does not apply.

## Validation and Final Response

Verify both files exist, use their exact document formats and section order,
map every flow and failure branch, contain no invented desired behavior, and
end with no open decisions.

Return exactly:

`Flow artifacts saved to .ai/artifacts/<name>/ [user-journey@1, implementation-map@1]`
