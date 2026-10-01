---
name: change-workflow
description: Plan and execute repository changes with proportional validation and review. Use when the user asks to create or follow a saved implementation plan, invokes Goal mode with a plan, requests long-running or cross-cutting work, or changes authentication, authorization, payments, secrets, migrations, destructive behavior, or another named security or trust boundary. Do not use for bounded, understood direct changes unless one of those controlled boundaries changes.
---

# Change Workflow

Choose the smallest workflow that safely delivers the requested outcome. Keep
application behavior authoritative in the user request and one living plan when
planning is needed. Do not create workflow sidecars or transition state.

## Choose the execution shape

- **Direct:** Implement a bounded, understood request with no unresolved
  material decision. Inspect, edit, validate, self-review, and report without
  creating workflow artifacts.
- **Standard planned:** Use one living plan for complex, ambiguous,
  cross-cutting, or long-running work that changes no controlled boundary.
- **Controlled planned:** Use one living plan and independent final review when
  the change affects authentication, authorization, payments, secrets,
  migrations, destructive behavior, or another explicitly named security or
  trust boundary.

Do not turn code proximity into controlled work. Name the contract that changes.

## Create or use a living plan

Read [plan-template.md](references/plan-template.md) whenever creating,
reviewing, or executing a saved plan.

- Use the path supplied by the user. Otherwise save one safe kebab-case file
  under `.ai/plans/`.
- Keep goal, boundaries, decisions, tasks, discoveries, validation, and outcome
  in that file.
- Update the same plan during execution. Do not create a spec, work-status file,
  journey, implementation map, review state, fingerprint, or revision archive.
- Use native Goal mode for long-running execution. Goal-mode progress is the
  runtime indicator; do not mirror it into another file.
- Record a material discovery in the plan. Ask the user only when the discovery
  creates an unresolved behavior, permission, destructive, or external-action
  decision.
- After saving a new plan, end the response with its exact path and a
  ready-to-copy `/goal` execution prompt. Do not start the Goal automatically.
  Use:

  ```text
  /goal Implement <exact-plan-path>. Preserve its boundaries, keep the plan updated, run every required validation, and finish only when its definition of done is proven.
  ```

  For controlled work, also require completion of the plan's independent final
  review before finishing.

## Implement safely

1. Read `AGENTS.md`, the instruction router, the plan when present, and only the
   area instructions that match the changed code.
2. Inspect current code and Git state before editing. Preserve unrelated work.
3. Make the smallest change that satisfies the requested behavior. Do not add
   persistence, services, coordination, dependencies, retries, state, or
   operational gates without a concrete requirement or demonstrated failure.
4. Prevent concurrent agents from editing the same file. Use isolated
   worktrees only for genuinely parallel implementation.
5. Run the smallest sufficient validation that proves the changed behavior.
   Required acceptance evidence cannot be deferred; disclose optional checks
   that were not run and their residual risk.
6. Self-review the actual diff for scope, regressions, security, private data,
   and unrelated changes.

## Review controlled work

Read [review-checklist.md](references/review-checklist.md) for controlled work
or when the user explicitly requests independent review.

- Pause plan-owned writers before review.
- Review an explicit Git base, commit, or uncommitted diff.
- Use an independent reviewer that reports findings and does not implement
  fixes.
- Fix blocking findings and rerun affected validation.
- Use a fresh follow-up reviewer only when remediation materially changes the
  reviewed boundary.
- Do not maintain review budgets, authorization tokens, custom fingerprints,
  or model/session identity rules.

## Respect action boundaries

- Obtain explicit authority before destructive actions, shared external-state
  mutation, credential use beyond the request, or changes outside the declared
  repositories.
- Do not commit, push, open a pull request, deploy, release, or send external
  messages unless the user explicitly requests that action.
- Never store secrets or credential-bearing output in plans or reports.

## Complete the work

Before claiming completion, compare the actual diff and validation evidence
with the request and living plan. Update the plan's outcome when one exists.
Report changed scope, required validation, deferred optional checks, preserved
unrelated work, and known limitations.
