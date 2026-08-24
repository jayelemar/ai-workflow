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

## Review Strategy

- Format: `review-strategy@1`
- Security-sensitive surfaces: <boundaries requiring adversarial review | `N/A: <concrete reason>`>
- Root-cause classes: <failed invariants reviewers must assess as grouped defect families | `N/A: <same concrete reason>`>
- Adversarial matrix: <applicable direct, alias, reassignment, computed/destructured, invocation-wrapper, reflection/mutation, container/member, encoding/normalization, and environment/process-control variants | `N/A: <same concrete reason>`>
- Mutation or property testing: <required automated variant coverage and cheapest valid test layer | `N/A: <concrete reason>`>
- Architectural fallback: <closed-form, allowlist, isolation, or redesign required if a root-cause class survives two fresh review rounds | `N/A: <concrete reason>`>
- External evidence: <operator, staging, credential, device, or service validation kept separate from code-review clearance | `N/A: no external evidence required`>

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
- Review evidence: <actual-diff review, required delegation outcome, and any
  provider-to-consumer internal contract this task supplies or consumes>
- Commit purpose: `<type>(<scope>): <summary>`

## Validation

1. `<exact command>` — <expected result>

## Completion Condition

<observable completed outcome>

## Final Output

`Plan saved to .ai/plans/<plan-name>.md [<classification>]`
