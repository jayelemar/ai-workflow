# AGENTS.md

This file is the behavioral authority for work that uses the `.ai` workflow.
Prompts own workflow stages and output schemas; routed instructions own reusable
repository conventions.

## Sources of Truth

- The user request and a finalized spec define desired behavior.
- The codebase defines current behavior, repository facts, and implementation
  constraints. Do not infer desired behavior from current code.
- A saved plan defines execution scope and order, not new behavior.
- When these sources materially conflict, state the conflict and stop for the
  missing decision instead of inventing a resolution.

## Working Rules

- Keep changes minimal, traceable to the request/spec/plan, and within declared
  repository ownership. Preserve unrelated work.
- Inspect evidence before reaching conclusions. Surface assumptions,
  uncertainty, failures, deviations, and deferred checks explicitly.
- Prefer readable, strongly typed, maintainable code that follows existing
  architecture and naming. Avoid speculative logic, duplicate behavior, dead
  code, needless dependencies, and unrelated refactors.
- Treat generated code as a draft: review it for correctness, security,
  performance, accessibility, and maintainability where those boundaries are
  relevant to the changed behavior.
- Load `.ai/instructions/index.md`, then only the routed instructions that match
  the work. Prompts may directly require a canonical shared instruction.

## Workflow and Scope

- Intake is read-only. MEDIUM and HIGH specs are created only when the spec
  prompt is explicitly invoked. Planning always saves a plan file, including
  for LOW. When tracing is required, plan creation reuses
  a complete flow-artifact pair or creates the missing pair through the
  canonical flow-artifact prompt before saving the plan; a separate
  flow-artifact invocation is supported but not required. Implementation begins
  only from the explicit execution command that names that saved plan.
- A finalized spec is authoritative during planning, execution, and review.
  Plans and artifacts must not add behavior that the spec does not define.
- When executing from a prepared task root, read the task-local
  `.ai/artifacts/<plan-name>/worktree-setup.md` when it exists. Apply a
  validated `worktree-setup@1` report with `Ready` status as a filesystem-only
  repository-ID-to-target overlay; the saved plan's repository roots remain
  source provenance. Require every mapped target, branch, base commit, and Git
  worktree registration to match the report before implementation or review,
  and stop on a missing, stale, or conflicting mapping.
- If a material requirement, dependency, risk, or repository boundary changes,
  stop the current stage, disclose it, and return to the appropriate explicit
  spec or planning stage.
- Do not introduce a workflow runner, transition state, sidecar authority,
  preview gate, or pre-execution approval gate.

## Validation and Completion

- Required validation must pass before completion. A required check may not be
  silently weakened, skipped, or replaced.
- Optional validation that depends on an unavailable external service,
  environment, credential, device, or operator may be deferred only when the
  final report names the unverified behavior, risk, reason, and smallest
  follow-up check.
- Validate the actual diff against the request, finalized spec when present,
  saved plan, routed instructions, and untouched unrelated files.
- After all MEDIUM or HIGH implementation, require an independent reviewer on
  the cumulative plan-owned diff. Resolve the locked reviewer runtime from
  `.ai/config/agent-models.toml`; do not substitute another model. Fix and
  revalidate `P0`, `P1`, and `P2` findings. Automatically start fresh review
  rounds after remediated rounds 1 and 2. After remediated round 3, pause at the
  continuation checkpoint defined by `.ai/prompts/review-changes.md`; only
  exact `END_REVIEW`, `REVIEW_NEXT_ROUND`, or `REVIEW_UNTIL_CLEAR` input has
  authority there. One-round authorization returns to a checkpoint after a
  later remediated blocking result. Until-clear authorization persists and
  repeats only while remediation, validation, reviewer, evidence, blocker, and
  scope safeguards allow it. Record advisory `P3` findings without blocking
  completion or creating a checkpoint.
- Apply production-readiness checks only at relevant changed boundaries. For
  example, assess authentication and authorization only when identity or access
  is affected; assess migration safety only when data or schema changes; assess
  observability and performance only for production paths where those risks
  materially apply.
- Never claim completion without reporting changed scope, validation results,
  deferred optional checks, and known limitations.

## `.ai` Repository Boundary

- `.ai/` is a nested Git repository ignored by the parent application.
- Keep reusable instructions tracked under `.ai/instructions/shared/`; keep the
  project-local instruction index and area instructions, specs, plans,
  artifacts, logs, and workflow-local state ignored and untracked.
- Do not stage `.ai` files in the parent repository.
