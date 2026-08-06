Version: 4.3
Last Updated: 2026-08-07

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
- Follow `shared/workflow-state.md` for stage authority, saved artifacts,
  explicit execution commands, review status, and HIGH delegation lifecycle.
- Follow `shared/reasoning-quality.md` for scope discoveries and reasoning
  safeguards, and `shared/flow-trace-artifacts.md` for flow-map classification
  and artifacts.
- The next explicit invocation remains the authorization boundary. Do not add
  `APPROVE`, a pre-execution review, preview, user-supplied manual handoff, or
  progress update as an additional gate.
- During required delegation, the root agent keeps the terminal transcript
  understandable with concise, ephemeral status messages. Announce each role's
  dispatch with its task, bounded scope, and expected result; announce only
  verified material milestones or completion with the current phase, evidence
  found or changed paths, validation state, and next check; and, before a
  continued wait, state the last known phase and what result is awaited. Do not
  repeat an unchanged status, narrate tool transport events, expose a
  sub-agent's private reasoning, or present an inference as a result.
- Required delegation status is conversational visibility only: it must not
  introduce runner selection, runner state, authorization gates, or additional
  workflow artifacts.
- Manual token telemetry remains available at
  `.ai/scripts/workflow/telemetry/manual-token-usage.ts`; it records explicit
  workflow checkpoints without stage orchestration.

## Placement

- Keep flow-trace requirements in `shared/flow-trace-artifacts.md`.
- Keep reasoning safeguards in `shared/reasoning-quality.md`.
- Keep workflow-stage rules in `shared/workflow-state.md`.
- Keep HIGH-GOAL checkpoint structure in `.ai/prompts/goal-checkpoint.md`.
- Keep repository validation commands in their owning local instruction and
  test strategy in `shared/testing.md`.

## Validation

- Validate modified workflow prompts and scripts with the workflow health check
  or focused script tests.
- Verify active workflow source contains no runner selection or management and
  no pre-execution approval or review gate.
- Verify prompts route stage behavior to `shared/workflow-state.md` without
  introducing an extra authorization gate.

## Anti-Patterns

- Bypassing the classifier or the shared workflow-stage authority.
- Adding a runner-selection mechanism or pre-execution approval gate.
