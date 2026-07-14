# Operator-Gated Workflow

Created: 2026-07-14

## Purpose

Use the least expensive workflow that preserves enough evidence, planning,
review, and verification for the task risk. The operator, not the runner,
decides whether production evidence is sufficient and whether blast radius
requires a plan or runner-managed execution.

Do not start a spec, plan, or code change until this intake gate is complete.

## Bug Intake Gate

Before asking Codex for RCA, collect and provide:

- production URL/environment and time observed
- exact reproduction steps, inputs, and affected role
- expected behavior and actual behavior
- browser console errors
- relevant network request/response data
- relevant application or service logs
- screenshot or recording when visual behavior matters
- known affected users, routes, services, and data

Codex must first perform RCA only. It must not write a spec, plan, or code
until the operator approves a proposed fix direction.

Use this request:

```text
Bug intake and RCA only. Do not edit code, create a spec, create a plan, or run
the workflow. Inspect the supplied evidence and relevant code. Return ranked
root-cause hypotheses, recommended fixes, blast radius, affected files and
systems, required tests, and rollback risk. Stop for approval.
```

Production confirmation is an operator responsibility. Codex must not claim a
bug is reproduced in production unless the supplied evidence proves it.

## Bug Routing

After RCA approval, classify the work before implementation.

| Risk class | Signals | Required path |
| --- | --- | --- |
| Low | Isolated behavior; one or few files; no auth, database, public API, or shared contract | Direct implementation, targeted review, local verification |
| Medium | Multiple files; unclear regression risk; shared UI or service behavior | Bug spec, `manual` plan, operator plan approval, manual execution, targeted review, local verification |
| High | Auth, RLS, permissions, migration, payments, public API, multi-route flow, destructive data behavior, or broad customer impact | Bug spec, `runner-managed` plan, operator plan approval, harness execution, strong review, local verification and rollback check |

For medium or high-risk bugs, use existing wrappers in this order:

1. `.ai/wrappers/generate-bugfix-spec.md`
2. `.ai/wrappers/create-plan.md`, selecting `manual` or `runner-managed`
3. For `manual` only: `.ai/wrappers/manual-execute-plan.md`

Do not invoke `workflow-runner.ts` for low or medium work unless the operator
explicitly escalates it. `manual` retains `spec -> plan -> execute` discipline
without runner state, retry loops, or stage context rehydration.

## Feature Intake Gate

Before creating a feature spec, Codex interviews the operator until all
material behavior decisions are explicit:

- user stories and success criteria
- roles and permissions
- inputs, outputs, and state transitions
- failure, empty, loading, and edge states
- non-goals and compatibility constraints
- analytics, audit, privacy, security, or migration requirements

Use this request:

```text
Requirements interview only. Do not write a spec, plan, or code. Ask questions
until user stories, success criteria, permissions, failure states, edge cases,
and non-goals are deterministic. Stop when no material behavior decision is
unknown.
```

Then use:

1. `.ai/wrappers/generate-feature-spec.md`
2. `.ai/wrappers/create-plan.md`, selecting `manual` for ordinary work or
   `runner-managed` for high-risk or multi-route work
3. `.ai/wrappers/manual-execute-plan.md` when using `manual`

## Review Gates

The operator reviews every spec and plan before implementation.

Use an independent fresh Codex session for plan review only when the task is
high-risk, crosses systems, changes contracts, or has meaningful security/data
risk. Do not add this reviewer by default; it duplicates context and cost.

Use this request:

```text
Independent plan review only. Do not edit files. Review the named spec and plan
for missing behavior, incorrect assumptions, security issues, migration risk,
test gaps, and incorrect file scope. Return findings only. Return OKAY only if
no material finding exists.
```

Before merge, request code review, resolve material findings, and run the
smallest local validation that covers the changed behavior. For high-risk work,
also confirm rollback or recovery behavior.

## Routing Rules

- No code before evidence or requirements, Codex analysis, and operator
  approval.
- No harness by default. Use it only for explicit high-risk workflow control.
- No independent reviewer by default. Use it when its additional perspective
  outweighs duplicated context cost.
- Record the selected risk class and execution mode in the spec or plan so the
  routing decision can be audited with token usage later.

## Optimization Rationale

This policy prevents premature specs and plans from unconfirmed bug reports,
avoids runner overhead for narrow work, and reserves artifact synchronization,
state management, and repeated review stages for work where their control value
is greater than their token cost.

See `token-usage-optimization.md` for measured workflow costs and baseline
targets.
