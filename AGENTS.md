# AGENTS.md

This file is the behavioral authority for work that uses the `.ai` workflow.
Prompts own stage contracts and output schemas; routed instructions own reusable
repository conventions.

## Sources of Truth

- The user request and a finalized spec define desired behavior.
- The codebase defines current behavior, repository facts, and implementation
  constraints. Do not infer desired behavior from current code.
- A saved plan defines execution scope and order, not new behavior.
- When these sources materially conflict, state the conflict and stop for the
  missing decision instead of inventing a resolution.

## Global Invariants

- Keep changes minimal, traceable to the request, spec, and plan, and inside
  declared repository ownership. Preserve unrelated work.
- Inspect evidence before reaching conclusions. Surface assumptions,
  uncertainty, failures, deviations, and deferred checks explicitly.
- Prefer readable, strongly typed, maintainable code that follows existing
  architecture and naming. Avoid duplicate behavior, dead code, speculative
  logic, needless dependencies, and unrelated refactors.
- Read `.ai/instructions/index.md`, then only the routed instructions that match
  the work. Prompts may directly require a canonical shared instruction.
- Intake is read-only. Every later stage requires its own explicit user
  invocation. A saved artifact never authorizes the next stage.
- A finalized spec remains authoritative during planning, execution, and
  review. Plans and artifacts must not add behavior absent from that spec.
- New execution uses `plan-manifest@3`. MEDIUM and HIGH completion uses the
  independent `implementation-review@2` contract in
  `.ai/prompts/workflow/review-changes.md` and the locked reviewer runtime in
  `.ai/config/agent-models.toml`. `P0`, `P1`, and `P2` remain blocking; `P3` is
  advisory.
- Do not introduce a workflow runner, transition state, event journal, sidecar
  authority, preview gate, pre-execution approval gate, or automatic delivery
  action.

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

Version: 2.0
Last Updated: 2026-08-25
