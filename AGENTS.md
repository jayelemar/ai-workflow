# AGENTS.md

This file is the behavioral authority for work that uses the `.ai` workflow.
Prompts own stage contracts and output schemas; routed instructions own reusable
repository conventions.

## Scope

The `.ai` workflow is opt-in: it starts only when the user explicitly invokes a
workflow prompt or stage. A direct request does not invoke the workflow by
default.

Ordinary read-only requests—including codebase analysis, explanation, search,
diagnosis, and status reporting—remain outside the workflow unless the user
explicitly invokes it. Do not classify, plan, execute, or formally review those
requests under the `.ai` workflow.

Creating or changing workflow artifacts, or implementing an authorized plan,
requires the corresponding explicitly invoked workflow stage.

## Sources of Truth

- The user request and a finalized spec define desired behavior.
- The codebase defines current behavior, repository facts, and implementation
  constraints. Do not infer desired behavior from current code.
- A saved plan defines execution scope and order, not new behavior.
- When these sources materially conflict, state the conflict and stop for the
  missing decision instead of inventing a resolution.

## Global Invariants

- Keep changes minimal, traceable to the request, spec, and plan, and inside
  declared repository ownership. Preserve unrelated work. Do not convert a
  hypothetical future need, preferred architecture, or defense-in-depth idea
  into required behavior, permanent infrastructure, or a blocking finding.
- Prefer the simplest implementation and correction that fully satisfies the
  required behavior and evidenced risk. New persistence, coordination,
  cryptography, dependencies, services, schedulers, and operational gates need
  an explicit requirement or concrete failure that a simpler existing
  mechanism cannot satisfy.
- Inspect evidence before reaching conclusions. Surface assumptions,
  uncertainty, failures, deviations, and deferred checks explicitly.
- Prefer readable, strongly typed, maintainable code that follows existing
  architecture and naming. Avoid duplicate behavior, dead code, speculative
  logic, needless dependencies, and unrelated refactors.
- Before approving changes, verify that authentication and access control still
  work, private client, user, and firm data remain protected, and every
  relevant test has passed or has an explicit deferral reason.
- Parallel agents may research or review in parallel, but concurrent write work
  must have exclusive file ownership. Never assign more than one agent to edit
  the same file at the same time.
- Read `.ai/instructions/index.md`, then only the routed instructions that match
  the work. Prompts may directly require a canonical shared instruction.
- Intake is read-only. Every later stage requires its own explicit user
  invocation. A saved artifact never authorizes the next stage.
- A finalized spec remains authoritative during planning, execution, and
  review. Plans and artifacts must not add behavior absent from that spec.
- New execution uses `plan-manifest@5` and one stable `work-status@1` per work
  item. MEDIUM and HIGH completion uses the
  independent `implementation-review@3` contract in
  `.ai/prompts/workflow/review-changes.md` and the locked reviewer runtime in
  `.ai/config/agent-models.toml`. `P0`, `P1`, and `P2` remain blocking; `P3` is
  advisory. Reviewer clearance is valid only for matching
  `review-input-fingerprint@1` evidence.
- `work-status@1` is an evidence snapshot, not transition authority. Keep its
  first sections human-readable. Update it at task start and completion,
  blockers, review changes,
  and plan activation. Do not introduce a workflow runner, automatic
  transition state, detailed event journal, sidecar authority, preview gate,
  pre-execution approval gate, or automatic delivery action.

## Corrective-Deviation Decision

Use this table as the only decision rule for discoveries during authorized
execution. Planned task paths are implementation, review, staging, and commit
boundaries, not immutable security boundaries.

| Decision             | Required evidence                                                                                                                                                                                                                                                                   | Action                                                                                                                                                                                                                                                                                                                   |
| -------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| Corrective deviation | The change restores behavior already required by the finalized spec; stays in a repository declared by the plan; introduces no new user-visible behavior or unresolved decision; and adds no integration, migration, secret, permission model, destructive behavior, or risk class. | Record the mismatch and reason, make the smallest correction, run every affected task check, include it in the required fresh review, and use a separate corrective commit when the owning HIGH task was already committed. No additional operator approval is required solely because an earlier task path is reopened. |
| Material discovery   | Any corrective-deviation requirement above is unproven or false.                                                                                                                                                                                                                    | Stop the current stage and return to the explicitly invoked specification or planning stage that owns the changed behavior, dependency, risk, or repository boundary.                                                                                                                                                    |

## Validation and Completion

- Required validation must pass before completion. Never silently weaken,
  skip, or replace a required check.
- A specification acceptance criterion cannot be downgraded to optional or
  deferred evidence by a plan, execution, handoff, or review. Evidence needed
  to prove that criterion remains required when it is manual, external, or
  environment-dependent; unavailable required evidence blocks completion.
- Optional validation that depends on an unavailable external service,
  environment, credential, device, or operator may be deferred only when the
  final report names the unverified behavior, risk, reason, and smallest
  follow-up check.
- Validate the actual plan-owned diff against the request, finalized spec when
  present, saved plan, routed instructions, and untouched unrelated files.
- Apply production-readiness checks only at relevant changed boundaries.
- Never claim completion without reporting changed scope, validation results,
  deferred optional checks, and known limitations.

## `.ai` Repository Boundary

- `.ai/` is its own Git repository. Its containing workspace may be either a
  Git parent checkout that ignores `.ai/` or an unversioned coordination root
  containing multiple independent repositories.
- Keep reusable instructions tracked under `.ai/instructions/shared/`. Keep
  project-local instruction routing and area instructions, specs, plans,
  artifacts, logs, and workflow-local state ignored and untracked.
- When a Git parent checkout exists, do not stage `.ai` files in it.

Version: 2.5
Last Updated: 2026-09-16
