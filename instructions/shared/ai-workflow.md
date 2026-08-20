Version: 5.1
Last Updated: 2026-08-14

# AI Workflow Instructions

## Purpose

Define the prompt-driven LOW, MEDIUM, and HIGH workflow without a runner or
persisted transition authority.

## Rules

- Read `.ai/AGENTS.md`, then `.ai/instructions/index.md` and the smallest routed
  instruction set relevant to the stage.
- Apply `.ai/instructions/shared/workflow-state.md` as the canonical stage
  sequence: read-only intake, explicitly invoked MEDIUM/HIGH spec, explicitly
  invoked planning that reuses or creates required flow artifacts, then explicit
  execution. Direct flow-artifact generation remains available but is not a
  required separate stage.
- Apply `.ai/instructions/shared/flow-trace-artifacts.md` to classify and review
  `user-journey@1` plus `implementation-map@1`.
- Prompts own stage behavior, schemas, and final responses. Wrappers only adapt
  user inputs and must not restate those contracts.
- No prompt may introduce runner selection, workflow state, event history,
  sidecars, a preview gate, or pre-execution plan approval.
- MEDIUM and HIGH completion use the independent whole-plan review contract in
  `.ai/prompts/review-changes.md` and the locked `reviewer` runtime in
  `.ai/config/agent-models.toml`.
- HIGH task delegation, validation, per-task actual-diff review, task-scoped
  commit sequencing, and final-review remediation commits remain governed by
  `.ai/prompts/goal-checkpoint.md`.

## Plan Ownership

- New plans use `plan-manifest@2` and declare every Git repository root plus its
  integration-base ref.
- Each HIGH task belongs to exactly one declared Git repository. Split a
  cross-repository outcome into dependent tasks rather than committing across
  repositories as one task.
- Progress reporting uses only the declared repository roots and bases.

## Validation

- Run focused contract and health tests after workflow-source changes.
- Run the self-contained health check from `.ai` and from another working
  directory.
- Verify canonical source references exist, project-local data remains ignored
  and untracked, wrappers remain thin, and active source contains no retired
  runner concepts.

## Anti-Patterns

- Duplicating a prompt schema in a wrapper or instruction.
- Calling a finalized spec or saved plan `approved` when no operator approval
  occurred.
