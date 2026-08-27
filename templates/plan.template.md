# Plan: <plan-name>

## Document Format

plan-manifest@3

## Classification

LOW | MEDIUM | HIGH

## Spec

`.ai/specs/<name>.spec.md` | `N/A: LOW plans do not use a spec`

## Repositories

Repeat for every Git repository. IDs are unique and roots are explicit paths
relative to the plan workspace.

### Repository: <repository-id>

- Root: `<git-repository-root>`
- Integration base: `<ref-or-commit>`
- Planned ownership: <repo-relative paths or bounded areas>

## Artifacts

- User journey: `.ai/artifacts/<plan-name>/user-journey.md` | `N/A: <reason>`
- Implementation map: `.ai/artifacts/<plan-name>/implementation-map.md` | `N/A: <same reason>`
- MEDIUM review: `.ai/artifacts/<plan-name>/review.md` | `N/A: not MEDIUM`
- HIGH handoff: `.ai/artifacts/<plan-name>/goal-handoff.md` | `N/A: not HIGH`

## Scope

<bounded desired behavior, current constraints, and non-goals>

## Review Strategy

- Format: `review-strategy@2`
- Sensitive-boundary trigger: <named boundary and deterministic trigger | `None: no named sensitive boundary`>
- Targeted checks: <checks for the named boundary | compact correctness and changed-boundary regression checks>
- Architectural fallback: <specific isolation, allowlist, closed-form enforcement, reducer/state arbiter/owning-hook redesign, or other bounded redesign to carry into replanning if one root-cause family remains blocking in two fresh rounds; required for a named sensitive boundary or asynchronous UI state with multiple independent writers | `N/A: no named sensitive boundary or asynchronous multi-writer state surface`>
- External evidence: <operator, staging, credential, device, or service evidence | `N/A: no external evidence required`>

Include this subsection only when `Sensitive-boundary trigger` names a boundary:

### Sensitive Boundary Detail

- Root-cause families: <failed invariants to group across fresh rounds>
- Adversarial matrix: <applicable direct, alias, reassignment, computed/destructured, invocation-wrapper, reflection/mutation, container/member, encoding/normalization, and environment/process-control variants>
- Mutation or property testing: <automated variant coverage and cheapest valid layer>

## Review Budget

- Fresh rounds: <`1` | `2` | `3` | `N/A: LOW uses self-check`>
- Selection reason: <exact deterministic budget rule>

## Implementation

For LOW, use only the minimum ordered steps needed to name ownership, outcome,
and validation. For MEDIUM, include dependencies and contracts as applicable.

1. <imperative outcome>
   - Repository: `<repository-id>`
   - Owned paths: <exact repo-relative paths>
   - Validation: `<exact command>` — <expected result>

For HIGH, replace the steps with task entries. Every task belongs to exactly
one repository; split cross-repository outcomes into dependent tasks.

### Task <number>: <imperative outcome>

- Repository: `<exactly-one-repository-id>`
- Behavior: <one exact outcome>
- Owned paths: <exact repo-relative paths>
- Depends on: None | <earlier task and callable internal contract>
- Delegation: `REQUIRED` | `NONE`
- Required roles: `investigator`, `builder`, and/or `reviewer` | `N/A: NONE`
- Delegation result: <bounded expected evidence | `N/A: NONE`>
- Implementation: <task-scoped steps>
- Validation: `<exact command>` — <expected result>
- Review evidence: <actual-diff and provider-to-consumer evidence>
- Commit purpose: `<type>(<scope>): <summary>`

## Validation

1. `<exact command>` — <expected result>

## Completion Condition

<observable completed outcome>

## Final Output

`Plan saved to .ai/plans/<plan-name>.md [<classification>]`
