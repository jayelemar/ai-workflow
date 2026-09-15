Version: 8.0
Last Updated: 2026-09-15

# AI Workflow Instructions

## Purpose

Define ownership for the prompt-driven LOW, MEDIUM, and HIGH workflow without
duplicating stage or review protocols.

## Contract Ownership

- `.ai/AGENTS.md` owns global invariants and the corrective-deviation decision
  table.
- `.ai/instructions/shared/workflow-state.md` owns stage transitions only.
- `.ai/prompts/workflow/generate-spec.md` owns finalized-spec schemas,
  immutable spec-path creation, mandatory filename confirmation, and
  exact-match reuse versus content-revision suggestions.
- `.ai/templates/plan.template.md` owns `plan-manifest@5`, plan structure,
  plan lineage, `review-strategy@2`, and review-budget
  fields.
- `.ai/templates/work-status.template.md` owns `work-status@1`, the stable
  per-work-item progress snapshot, task states, revision log, and current
  artifact links.
- `.ai/prompts/workflow/create-plan.md` owns planning final responses,
  including worktree and direct-execution choices.
- `.ai/prompts/workflow/review-changes.md` solely owns `implementation-review@3`, final
  and explicitly invoked manual review loops, risk decisions, and review-round
  accounting.
- `.ai/scripts/workflow/review-fingerprint.mjs` solely owns deterministic,
  read-only `review-input-fingerprint@1` generation. It provides evidence to
  the review prompt and owns no transition or completion decision.
- `.ai/prompts/workflow/goal-checkpoint.md` owns HIGH task progress and commit
  evidence in `work-status@1`, plus HIGH commit rules. Status stores evidence
  without copying policy text.
- `.ai/prompts/workflow/generate-flow-artifacts.md` owns the unchanged
  `user-journey@1` and `implementation-map@1` schemas.
- `.ai/prompts/utilities/pull-request-creation.md` owns optional, explicitly invoked pull
  request delivery.
- `.ai/prompts/utilities/cleanup-workflow.md` owns prompt-led approval for
  destructive cleanup; its maintenance script owns inventory and mutation.
- `.ai/config/agent-models.toml` owns workflow role locks and advisory runtime
  recommendations for specification and planning.
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
- Every work item has exactly one stable
  `.ai/artifacts/<work-item>/work-status.md`. Plan revisions link it but do not
  copy progress. Progress-only changes update status and never create a plan
  revision.
- Every plan task has one stable `T-001` identifier. Replans preserve IDs for
  the same outcome, reopen affected outcomes, supersede replaced outcomes, and
  assign never-used IDs to new outcomes.

## Subagent Identity and Session Lifecycle

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
- `spawn_agent` starts a new named session. `followup_task` continues an idle
  named session, and `send_message` may refine its still-active bounded
  assignment. A continuation retains the original name, role, model, reasoning
  effort, and boundary; neither continuation mechanism may repurpose a session.
- For a required `builder`, spawn once for one cohesive HIGH task. Continue that
  exact session for later implementation or fixes owned by the same task while
  its scope and exclusive file ownership remain unchanged. A different task,
  changed scope, or changed exclusive file ownership requires a newly spawned
  builder with a new purpose-based name.
- For a required `scout`, spawn once for one HIGH task's bounded investigation
  question. Continue that exact session for follow-up research only while the
  task, subsystem, scope, and question remain unchanged. A change to any of
  those boundaries requires a newly spawned scout with a new purpose-based
  name.
- Reviewers are not eligible for builder or scout session reuse. Every distinct
  review assignment uses a newly spawned reviewer, and every formal fresh round
  must use its own unique round-specific reviewer. Never use `followup_task` to
  assign a later review to an earlier reviewer session.
- Record the initial spawn and every continued assignment and result in order
  under the same subagent identity. If a required in-boundary builder or scout
  session cannot be continued, stop as blocked; never silently replace it with
  a fresh session or substitute another runtime.
- Parallel assignments may overlap only for read-only work such as research or
  review. Every concurrent write assignment must declare exclusive file-path
  ownership or use a separate worktree; no two agents may edit the same file at
  the same time.

## Stage Runtime Recommendations

- Intake resolves the next writable stage before returning: LOW routes to
  `planning`, while MEDIUM and HIGH route to `specification`.
- Resolve the recommended stage's tier and reasoning effort from
  `.ai/config/agent-models.toml`, then map the tier to its full model ID. Never
  infer or hard-code a substitute when the mapping is missing or invalid.
- Report the resolved model and reasoning effort as an advisory recommendation
  in the intake result. The operator remains responsible for selecting the
  runtime before explicitly invoking the next stage.
- A decision-complete intake must make its `Next action` a complete
  copy-pasteable prompt with all known inputs filled in. A wrapper path or
  generic instruction is not an actionable next-stage invocation. When the
  intake itself needs a material decision, it instead returns the narrow
  `Decision:` continuation defined by `shared/workflow-state.md`; it must not
  repeat the full intake wrapper.
- A recommendation does not inspect or change the active runtime, block a later
  stage, create a subagent, or authorize the next stage.

## Validation

- Run focused contract and health tests after workflow-source changes.
- Run the health check from `.ai` and by absolute path from another directory.
- Confirm canonical references exist, wrappers remain thin, project-local data
  remains ignored and untracked, and retired runner concepts remain absent.

## Anti-Patterns

- Duplicating a schema or transition protocol outside its owner.
- Calling a finalized spec or saved plan `approved` when no approval occurred.
