Version: 6.1
Last Updated: 2026-08-27

# AI Workflow Instructions

## Purpose

Define ownership for the prompt-driven LOW, MEDIUM, and HIGH workflow without
duplicating stage or review protocols.

## Contract Ownership

- `.ai/AGENTS.md` owns global invariants and the corrective-deviation decision
  table.
- `.ai/instructions/shared/workflow-state.md` owns stage transitions only.
- `.ai/templates/plan.template.md` owns `plan-manifest@3`, plan structure,
  `review-strategy@2`, and review-budget fields.
- `.ai/prompts/workflow/review-changes.md` solely owns `implementation-review@2`, final
  and explicitly invoked manual review loops, risk decisions, and review-round
  accounting.
- `.ai/prompts/workflow/goal-checkpoint.md` owns `goal-handoff@2`, HIGH task progress,
  commit evidence, and HIGH commit rules. Handoffs store evidence without
  copying policy text.
- `.ai/prompts/workflow/generate-flow-artifacts.md` owns the unchanged
  `user-journey@1` and `implementation-map@1` schemas.
- `.ai/prompts/utilities/pull-request-creation.md` owns optional, explicitly invoked pull
  request delivery.
- Wrappers adapt inputs only.

## Plan Ownership

- Every new plan declares each Git repository root and integration-base ref.
- A validated `worktree-setup@1` report may overlay filesystem targets only;
  it never changes plan ownership, bases, order, or desired behavior.
- Each HIGH task belongs to exactly one repository. Cross-repository outcomes
  use dependent tasks with an explicit provider-to-consumer contract.
- The plan workspace may be a Git parent checkout or an unversioned
  coordination root for multiple independent repositories.

## Validation

- Run focused contract and health tests after workflow-source changes.
- Run the health check from `.ai` and by absolute path from another directory.
- Confirm canonical references exist, wrappers remain thin, project-local data
  remains ignored and untracked, and retired runner concepts remain absent.

## Anti-Patterns

- Duplicating a schema or transition protocol outside its owner.
- Calling a finalized spec or saved plan `approved` when no approval occurred.
