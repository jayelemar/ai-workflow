# Plan: <plan-name>

## Document Format

plan-manifest@1

## Classification

LOW | MEDIUM | HIGH

## Spec

`.ai/specs/<spec-file>.spec.md` | `N/A: LOW plans do not use a spec`

## Artifacts

* User journey: `.ai/artifacts/<plan-name>/user-journey.md` | `N/A: <concrete reason>`
* Implementation map: `.ai/artifacts/<plan-name>/implementation-map.md` | `N/A: <concrete reason>`
* MEDIUM review: `.ai/artifacts/<plan-name>/review.md` | `N/A: not MEDIUM`
* HIGH-GOAL handoff: `.ai/artifacts/<plan-name>/goal-handoff.md` | `N/A: not HIGH`

## Scope

<bounded behavior and non-goals>

## Implementation

1. <ordered executable step with concrete paths>

## Validation

1. `<exact command>` — <expected result>

## Completion Condition

<observable completed outcome>

## HIGH-GOAL Task Protocol

`N/A: not HIGH` | For every HIGH task, provide:

### Task <number>: <outcome>

* Scope and owned files: <bounded paths and behavior>
* Delegation: `REQUIRED` | `NONE`
* Required roles: `investigator`, `builder`, and/or `reviewer` | `N/A: NONE`
* Delegation rule and expected result: <exact matching rule and bounded deliverable>
* Terminal visibility: for `REQUIRED`, the root agent announces role dispatch,
  verified material milestones or completion, and the last known phase before
  a continued wait; include task, role, bounded scope, evidence or changed
  paths, validation state, and next check. Do not repeat transport events or
  create a durable progress log. For `NONE`, `N/A: no delegated role`.
* Implementation: <task-scoped steps>
* Validation: `<exact command>` — <expected result>
* Review evidence: <actual-diff review and required delegation outcome>
* Commit purpose: `<type>(<scope>): <summary>`

Use `REQUIRED` for every applicable rule: independent evidence across three or
more source areas requires an `investigator`; an implementation isolated from
every other planned task with no shared file ownership requires a `builder`;
and authentication, authorization, payments, secrets, migrations, destructive
behavior, or external security boundaries require a `reviewer`. Use `NONE`
only when no rule applies, and state why. A required role that cannot run or
does not produce its bounded result blocks the task.

## Final Output

`Plan saved to .ai/plans/<plan-name>.md`
