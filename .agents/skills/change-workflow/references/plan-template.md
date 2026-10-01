# Living Plan Reference

Use one plan only when planning materially improves complex, ambiguous,
cross-cutting, controlled, or long-running work. Omit sections that do not help
the task.

## Template

```md
# <Outcome>

Mode: standard | controlled

## Goal

<Observable result and definition of done.>

## Boundaries and Non-Goals

- In scope: <repositories, components, and behavior>
- Preserve: <compatibility, security, data, and unrelated work>
- Out of scope: <explicit exclusions>

## Decisions

- <Material decision and concise rationale>

## Tasks and Progress

- [ ] <Outcome-oriented task with ownership and validation>

## Validation

- Required: `<exact command or bounded check>` — <observable result>
- Optional: `<check>` — <value and deferral rule>

## Discoveries

- None.

## Outcome

Pending.
```

## Planning rules

- Derive desired behavior from the user; use the codebase only for current
  facts and constraints.
- Map every required outcome to implementation ownership and sufficient
  validation.
- Add environment, migration, rollback, security, or cross-repository detail
  only when the changed boundary requires it.
- Keep tasks independently understandable and ordered by dependency.
- Update progress, discoveries, decisions, validation, and outcome in this file
  during execution.
- Ask before proceeding when a discovery changes user-visible behavior,
  permissions, destructive scope, external mutation, or repository ownership.
- Do not create a second status or review-state artifact.
- After saving the plan, report its exact path and output this ready-to-copy
  execution prompt without starting it:

  ```text
  /goal Implement <exact-plan-path>. Preserve its boundaries, keep the plan updated, run every required validation, and finish only when its definition of done is proven.
  ```

- For a controlled plan, also require completion of the plan's independent
  final review before finishing.
