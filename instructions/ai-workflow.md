Version: 4.1
Last Updated: 2026-07-31

# AI Workflow Instructions

## Purpose

Define the explicit LOW, MEDIUM, and HIGH-GOAL workflow for plans, prompts,
templates, and workflow artifacts.

## Applies To

- `.ai/plans/*.md`
- `.ai/artifacts/**`
- `.ai/prompts/*.md`
- `.ai/templates/plan.template.md`
- `.ai/wrappers/*.md`
- `.ai/README.md`

## Rules

- Begin every request with the read-only classifier. Feature intake and bug
  RCA run the exact `.ai/prompts/select-workflow.md` rules as their final step;
  every other request invokes that prompt directly. It selects only LOW,
  MEDIUM, or HIGH and stops for unresolved classification uncertainty.
- LOW saves a compact plan before implementation. It has no spec.
- MEDIUM and HIGH create the spec in the intake conversation, switch to Plan
  mode to save the plan, then switch to Agent mode. MEDIUM begins
  implementation only after `execute <plan-file>`; HIGH begins only after
  `/goal <description> <plan-file>`.
- The next explicit invocation is the authorization boundary. Do not require
  `APPROVE`, a pre-execution review, preview, user-supplied manual handoff, or
  progress update. HIGH planning's required initial handoff is created by the
  workflow and never adds an approval gate.
- Escalate a classification when new evidence warrants it. Do not downgrade
  until the original risk has documented resolution.
- A request requiring a user journey, implementation map, broad integration
  tracing, or cross-cutting risk analysis is at least MEDIUM before planning.
- Plan behavior stays within its saved spec. A material execution discovery
  pauses work, updates the affected spec and/or plan, returns to the proper
  stage, and waits for a new explicit invocation.
- LOW completes with scoped validation and a concise self-check of the actual
  diff.
- MEDIUM completes with scoped validation plus automatic actual-diff review at
  `.ai/artifacts/<plan-name>/review.md`. Its only statuses are `Ready to
  complete`, `Fix required`, and `Blocked`.
- HIGH-GOAL keeps task-scoped delegation when required, implementation,
  validation, actual-diff review, and one task-scoped commit before the next
  task. HIGH planning creates the initial goal handoff alongside the plan;
  `/goal <description> <plan-file>` remains the only execution authorization
  and refreshes repository evidence before task work starts.
- Every HIGH task declares `Delegation: REQUIRED` or `Delegation: NONE` in its
  saved plan. Planning applies the fixed investigator, builder, and reviewer
  rubric in the plan template; execution must run and record every required
  role, or stop the task as `Blocked`.
- During required delegation, the root agent keeps the terminal transcript
  understandable with concise, ephemeral status messages. Announce each role's
  dispatch with its task, bounded scope, and expected result; announce only
  verified material milestones or completion with the current phase, evidence
  found or changed paths, validation state, and next check; and, before a
  continued wait, state the last known phase and what result is awaited. Do not
  repeat an unchanged status, narrate tool transport events, expose a
  sub-agent's private reasoning, or present an inference as a result.
- Terminal delegation status is conversational visibility only: it must not
  create a workflow artifact, runner state, event log, authorization gate, or
  extra approval requirement. The required delegation outcome remains recorded
  only in the existing HIGH review evidence or goal handoff.
- Do not create runner state, event logs, sidecars, task pointers, previews,
  or runner handoffs. The required initial HIGH goal handoff is a portable
  checkpoint, not workflow state or an authorization gate. Historical
  plan/spec wording and specifically preserved historical flow artifacts are
  not active workflow sources.
- Manual token telemetry remains available at
  `.ai/scripts/workflow/telemetry/manual-token-usage.ts`; it records explicit
  workflow checkpoints without stage orchestration.

## Placement

- Keep flow-trace requirements in `shared/flow-trace-artifacts.md`.
- Keep reasoning safeguards in `shared/reasoning-quality.md`.
- Keep HIGH-GOAL checkpoint structure in `.ai/prompts/goal-checkpoint.md`.
- Keep validation command selection in `testing.md` and test strategy in
  `shared/testing.md`.

## Validation

- Validate modified workflow prompts and scripts with the workflow health check
  or focused script tests.
- Verify active workflow source contains no runner selection or management and
  no pre-execution approval or review gate.
- Verify the required LOW, MEDIUM, and HIGH stage boundaries and review
  evidence paths remain explicit.

## Anti-Patterns

- Treating a saved plan as authorization to implement without `execute` or
  `/goal`.
- Downgrading risk silently after a plan has been written.
- Reviewing a speculative spec or plan instead of implemented evidence.
- Reintroducing runner state or operational artifact requirements.
