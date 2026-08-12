Version: 3.0
Last Updated: 2026-08-13

# Flow Artifact Instructions

## Purpose

Define when a finalized MEDIUM or HIGH spec needs one explicitly invoked stage
that saves both the user journey and implementation map.

## Classification

- End-to-end flow artifacts are required for multi-step workflows, multi-route
  handoffs, multiple visible states or failure branches, or user-triggered API
  behavior whose ownership is not obvious from one component or service.
- They are not required for narrow copy, styling, single-component,
  single-state, or isolated validation-message changes with obvious ownership.
- A LOW request that needs end-to-end mapping must be reclassified before
  planning continues.

## Saved Artifacts

When required, `.ai/prompts/generate-flow-artifacts.md` creates both:

- `.ai/artifacts/<plan-name>/user-journey.md` using `user-journey@1`;
- `.ai/artifacts/<plan-name>/implementation-map.md` using
  `implementation-map@1`.

The finalized spec owns desired behavior. Repository inspection supplies only
current entry points, ownership, contracts, data effects, services, and tests.

The user journey must contain `Goal`, `Actors`, `Entry Points`, `User Flows`,
`Mermaid Diagram`, `States`, `Failures`, `Acceptance Scenarios`, and
`Open Decisions`.

The implementation map must contain:

- `Canonical Ownership`: one entry per journey action naming repository root
  and owned paths;
- `Contract and Data`: public/API contracts, state, persistence, migrations, or
  `None: <reason>`;
- `Services`: UI, application, backend, integration, and external-service
  boundaries, or `None: <reason>`;
- `Validation`: exact automated or manual evidence for each action and failure
  branch;
- `Open Decisions`: unresolved decisions, or exactly `None`.

Every journey action and acceptance scenario must map to ownership and
validation. The implementation map must not introduce actions absent from the
user journey.

## Planning and Review

- A plan records both artifact paths or records `N/A: <concrete reason>` for
  both when tracing is unnecessary.
- Plan tasks cover every mapped action, contract/data boundary, service, and
  validation responsibility.
- Review compares required artifacts with the finalized spec, actual diff, and
  validation evidence. When artifacts are `N/A`, review verifies the reason
  still fits the actual scope.

## Anti-Patterns

- Creating only one of the two required artifacts.
- Inventing desired behavior from current code.
- Using flow artifacts as workflow transition state.
