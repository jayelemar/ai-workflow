# Plan: <plan-name>

## Document Format

plan-manifest@2

## Classification

LOW | MEDIUM | HIGH

## Spec

`.ai/specs/<name>.spec.md` | `N/A: LOW plans do not use a spec`

## Repositories

Repeat this entry for every Git repository the plan owns. Repository IDs must
be unique and roots must be explicit paths relative to the plan workspace.

### Repository: <repository-id>

- Root: `<git-repository-root>`
- Integration base: `<ref-or-commit>`
- Planned ownership: <repo-relative paths or bounded areas>

## Artifacts

- User journey: `.ai/artifacts/<plan-name>/user-journey.md` | `N/A: <concrete reason>`
- Implementation map: `.ai/artifacts/<plan-name>/implementation-map.md` | `N/A: <same concrete reason>`
- MEDIUM review: `.ai/artifacts/<plan-name>/review.md` | `N/A: not MEDIUM`
- HIGH-GOAL handoff: `.ai/artifacts/<plan-name>/goal-handoff.md` | `N/A: not HIGH`

## Scope

<bounded desired behavior, current constraints, and non-goals>

## Implementation

For LOW/MEDIUM, provide ordered steps. Each step names its repository ID,
owned paths, behavior, dependency, and exact validation. Cross-repository work
uses dependent steps.

1. <imperative outcome>
   * Repository: `<repository-id>`
   * Behavior: <one exact outcome>
   * Owned paths: <exact repo-relative paths>
   * Depends on: None | <earlier step>
   * Validation: `<exact command>` — <expected result>

For HIGH, replace the steps above with task entries. Every task belongs to
exactly one repository. Split cross-repository outcomes into dependent tasks.

### Task <number>: <imperative outcome>

- Repository: `<exactly-one-repository-id>`
- Behavior: <one exact outcome>
- Owned paths: <exact repo-relative paths>
- Depends on: None | <earlier task>
- Delegation: `REQUIRED` | `NONE`
- Required roles: `investigator`, `builder`, and/or `reviewer` | `N/A: NONE`
- Delegation rule and expected result: <matching rule and bounded deliverable>
- Agent runtime: <role-specific registry and bounded-context use> | `N/A: no delegated role`
- Implementation: <task-scoped steps>
- Validation: `<exact command>` — <expected result>
- Review evidence: <actual-diff review and required delegation outcome>
- Commit purpose: `<type>(<scope>): <summary>`

## Validation

1. `<exact command>` — <expected result>

## Completion Condition

<observable completed outcome>

## Final Output

`Plan saved to .ai/plans/<plan-name>.md [<classification>]`
