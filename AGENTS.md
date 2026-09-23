# AGENTS.md

This file is the behavioral authority for work that uses the `.ai` repository.

## Scope

Ordinary requests use normal Codex behavior: inspect, implement, validate, and
report without creating workflow artifacts.

Read `.ai/.agents/skills/change-workflow/SKILL.md` when the user asks to create
or follow a saved implementation plan, invokes Goal mode with a plan, requests
long-running or cross-cutting work, or changes authentication, authorization,
payments, secrets, migrations, destructive behavior, or another named security
or trust boundary.

Read `.ai/instructions/index.md`, then only the area instructions routed for the
changed code. A plan never replaces those repository conventions.

## Sources of Truth

- The user request and living plan when present define desired behavior.
- The codebase defines current behavior, repository facts, and implementation
  constraints. Do not infer desired behavior from existing code.
- Validation and the actual Git diff define what was implemented.
- When these sources materially conflict, stop for the missing decision rather
  than inventing a resolution.

## Working Rules

- Inspect evidence before reaching conclusions.
- Make the smallest change that fully satisfies the request. Do not add
  persistence, services, coordination, cryptography, dependencies, retries,
  state, or operational gates without a concrete requirement or demonstrated
  failure that a simpler existing mechanism cannot satisfy.
- Preserve unrelated work and existing dirty-tree changes. Keep refactors and
  cleanup outside the requested scope unless they are required for correctness.
- Prefer readable, strongly typed code that follows existing architecture and
  naming.
- Check implied edge cases, failures, state transitions, and permission
  boundaries at changed surfaces.
- Before approving sensitive changes, verify authentication and access control,
  protect private client, user, firm, credential, and configuration data, and
  run the relevant tests.
- Prevent concurrent agents from editing the same file. Use isolated worktrees
  for genuinely parallel implementation.
- Do not create workflow runners, transition databases, status sidecars,
  review fingerprints, detailed event ledgers, or automatic delivery actions.

## Action Boundaries

- Obtain explicit authority before destructive actions, remote data mutation,
  credential use beyond the request, or changes outside the declared
  repositories.
- Do not commit, push, open a pull request, deploy, release, or send external
  messages unless the user explicitly requests that action.
- Never store secrets or credential-bearing output in plans, artifacts, logs,
  commits, or reports.

## Validation and Completion

- Run the smallest sufficient validation that proves the changed behavior.
- Required acceptance evidence cannot be downgraded, skipped, or called
  optional. Unavailable required evidence blocks completion.
- Optional environment, service, device, or operator checks may be deferred
  only when the final report names the unverified behavior, risk, reason, and
  smallest follow-up check.
- Validate the actual changed diff against the request, living plan when
  present, routed instructions, and preserved unrelated work.
- Never claim completion without reporting changed scope, validation results,
  deferred optional checks, and known limitations.

## `.ai` Repository Boundary

- `.ai/` is its own Git repository. Its containing workspace may be a Git
  parent checkout that ignores `.ai/` or an unversioned coordination root.
- Keep reusable source tracked in `.ai/`. Keep project-local instructions and
  living plans under the existing ignored paths.
- Existing ignored legacy workflow records must remain untouched unless the
  user explicitly requests cleanup.
- When a Git parent checkout exists, do not stage `.ai` files in it.

Version: 3.0
Last Updated: 2026-09-23
