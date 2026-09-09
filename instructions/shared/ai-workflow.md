Version: 6.5
Last Updated: 2026-09-09

# AI Workflow Instructions

## Purpose

Define ownership for the prompt-driven LOW, MEDIUM, and HIGH workflow without
duplicating stage or review protocols.

## Contract Ownership

- `.ai/AGENTS.md` owns global invariants and the corrective-deviation decision
  table.
- `.ai/instructions/shared/workflow-state.md` owns stage transitions only.
- `.ai/prompts/workflow/generate-spec.md` owns finalized-spec schemas,
  immutable spec-path creation, and exact-match reuse versus content-revision
  naming.
- `.ai/templates/plan.template.md` owns `plan-manifest@3`, plan structure,
  backward-compatible plan lineage, `review-strategy@2`, and review-budget
  fields.
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
- `.ai/prompts/utilities/cleanup-workflow.md` owns prompt-led approval for
  destructive cleanup; its maintenance script owns inventory and mutation.
- Wrappers adapt inputs only.

## Plan Ownership

- Finalized spec files are immutable. Plan revisions retain the exact spec path
  they were created from; any spec-content change uses a newly finalized spec
  at a new path, while an exact unchanged spec reuses the predecessor's path.
- Every new plan declares each Git repository root and integration-base ref.
- A validated `worktree-setup@1` report may overlay filesystem targets only;
  it never changes plan ownership, bases, order, or desired behavior.
- Each HIGH task belongs to exactly one repository. Cross-repository outcomes
  use dependent tasks with an explicit provider-to-consumer contract.
- The plan workspace may be a Git parent checkout or an unversioned
  coordination root for multiple independent repositories.
- Only root-level `.ai/plans/*.md` files are active plans. Replanning preserves
  one active revision per work item and stores superseded plans as evidence
  under the predecessor's artifact directory.

## Subagent Identity and Creation

- The only workflow subagent roles are `scout`, `builder`, and `reviewer`.
- Resolve the role's full model ID and reasoning effort plus decimal
  `fork_turns` and `name_format` from `.ai/config/agent-models.toml` before
  every spawn. If any value is missing or invalid, stop as blocked; never
  substitute a runtime.
- Set every subagent name from `name_format` as
  `<role>_<model-family>_<reasoning-effort>_<purpose>`. Derive `model-family`
  from the final hyphen-delimited token of the resolved model ID (`terra` from
  `gpt-5.6-terra`), and write `purpose` as short lowercase snake case. Example:
  `scout_terra_high_auth_flow`.
- The name's role, model family, and reasoning effort must match the explicit
  role, full `model`, and `reasoning_effort` supplied to the spawn. Also include
  the exact subagent name, role, full model, and reasoning effort in its bounded
  assignment and in durable delegation or review evidence.
- Parallel assignments may overlap only for read-only work such as research or
  review. Every concurrent write assignment must declare exclusive file-path
  ownership or use a separate worktree; no two agents may edit the same file at
  the same time.

## Validation

- Run focused contract and health tests after workflow-source changes.
- Run the health check from `.ai` and by absolute path from another directory.
- Confirm canonical references exist, wrappers remain thin, project-local data
  remains ignored and untracked, and retired runner concepts remain absent.

## Anti-Patterns

- Duplicating a schema or transition protocol outside its owner.
- Calling a finalized spec or saved plan `approved` when no approval occurred.
