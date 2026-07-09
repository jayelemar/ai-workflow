Version: 1.0
Last Updated: 2026-07-09

# Flow-Trace Artifact Instructions

## Purpose

Centralize the scope-classification, artifact-contract, and bounded preflight
rules for `.ai/artifacts/<plan-name>/user-journey.md` and
`.ai/artifacts/<plan-name>/implementation-map.md`.

## Applies To

- `.ai/prompts/create-plan.md`
- `.ai/prompts/sync-plan-artifacts.md`
- `.ai/prompts/plan-validator.md`
- `.ai/prompts/review-changes.md`
- any prompt or instruction that classifies whether a scope needs end-to-end
  flow mapping or validates mapped user-action coverage

## Rules

- User-facing work means a feature, bugfix, or change that affects a customer,
  admin, or operator screen, route, workflow, visible state, or user-triggered
  API behavior.
- Flow-trace artifacts are required only when the scope needs end-to-end flow
  mapping, such as:
  - multi-step workflows
  - multi-route handoffs or navigation changes
  - multiple visible states or failure branches that must be traced end-to-end
  - user-triggered API behavior whose ownership is not obvious from a single
    file or single state
- Flow-trace artifacts are not required when the scope is narrow even if it is
  user-facing, such as:
  - copy-only or content-only changes
  - styling or layout-only changes
  - single-component visual fixes
  - single-screen, single-state fixes with obvious ownership
  - isolated validation-message or affordance tweaks that do not change an
    end-to-end workflow
- Once a plan is written, the plan `## Artifacts` entries are the source of
  truth for whether flow-trace artifacts are required.

### Required Artifact Contract

When flow-trace artifacts are required:

- `user-journey.md` path:
  `.ai/artifacts/<plan-name>/user-journey.md`
- `implementation-map.md` path:
  `.ai/artifacts/<plan-name>/implementation-map.md`
- `user-journey.md` must be derived from the approved spec plus codebase
  inspection only and must not invent desired behavior beyond the spec
- `user-journey.md` must contain:
  - `## Goal`
  - `## Actors`
  - `## Entry Points`
  - `## User Flows`
  - `## Mermaid Diagram`
  - `## States`
  - `## Failures`
  - `## Acceptance Scenarios`
  - `## Open Decisions`
- `implementation-map.md` must include one `### User Action:` entry per action
  from the user journey's User Flows and Acceptance Scenarios
- each mapped user action must include applicable coverage for:
  - UI route/component
  - API route
  - backend service/module
  - database/storage effect
  - tests or explicit validation evidence
- when a category genuinely does not apply to an action, use
  `None: <concrete reason>`
- `implementation-map.md` must not contain actions that do not appear in the
  user journey

### Not-Required Artifact Contract

When flow-trace artifacts are not required:

- the plan `## Artifacts` entry for `User journey` must be exactly
  `N/A: <concrete reason>`
- `.ai/artifacts/<plan-name>/implementation-map.md` must be exactly
  `N/A: <concrete reason>`
- the concrete reason must explain why end-to-end flow mapping is unnecessary
  for the actual scope

### Create-Plan And Preview Preflight

During plan creation, and during any draft preflight that mirrors plan
creation:

1. derive the plan name from the spec path
2. classify the scope using this instruction
3. if flow-trace artifacts are required:
   - create or regenerate `user-journey.md` by applying
     `.ai/prompts/generate-user-flow.md` when the artifact is missing, stale,
     incomplete, or inconsistent with the spec
   - read the validated user journey before phase planning
   - derive or repair `implementation-map.md`
4. if flow-trace artifacts are not required:
   - write the required `N/A: <concrete reason>` values
5. before returning a draft plan, self-check that:
   - each `[task:..]` chunk can pass, be reviewed, and be committed
     independently
   - no lifecycle-only or red-test-only savepoints remain
   - each spec-required behavior, especially visible validation and
     failure-state behavior, is assigned to a concrete task
   - each implementation-map row has implementation and validation coverage
6. auto-correct missing action rows, bad savepoints, and under-scoped behavior
   ownership when possible
7. stop only when the preflight still cannot satisfy these rules without
   inventing behavior beyond the spec

### Sync Contract

During `sync-plan-artifacts`:

- edit only plan-owned `.ai/plans/<plan-name>.md` and
  `.ai/artifacts/<plan-name>/...` files
- if the plan requires flow-trace artifacts:
  - ensure `user-journey.md` exists and still reflects only the spec plus
    observed codebase entry points
  - ensure `implementation-map.md` covers every user action and remove rows
    that do not correspond to the user journey
- if the plan records `N/A: <concrete reason>`:
  - ensure `implementation-map.md` is exactly `N/A: <concrete reason>`
  - ensure the reason remains credible for the scope

### Validator And Review Contract

During validation and review:

- if the plan requires flow-trace artifacts, compare the user journey and
  implementation map against the plan, staged diff, and validation evidence
- each mapped user action, visible state, failure branch, and acceptance
  scenario must have implementation coverage, validation coverage, or an
  explicit spec-approved unchanged path
- if the plan records `N/A: <concrete reason>`, do not require flow-artifact
  review; instead verify that the reason still matches the actual scope
- the spec remains authoritative if it conflicts with the user journey

## Validation

- Prompts that depend on these rules must explicitly load
  `.ai/instructions/shared/flow-trace-artifacts.md`.
- Keep stage prompts focused on stage-specific behavior instead of duplicating
  the full rule set above.

## Anti-Patterns

- Requiring flow-trace artifacts for every user-facing change.
- Recording `N/A` when the work clearly needs end-to-end flow mapping.
- Mapping user actions that do not appear in the user-journey artifact.
- Treating the user-journey artifact as more authoritative than the spec.
- Repeating the same flow-trace policy block across multiple prompt files.
