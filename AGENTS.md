# AGENTS.md

This file is the behavioral authority for work that uses the `.ai` repository.

## Scope

Ordinary requests use normal Codex behavior: inspect, implement, validate, and
report without creating workflow artifacts.

For brainstorming, use `.ai/.agents/skills/brainstorm/SKILL.md`. Its read-only
discussion and explicit planning gate take precedence over the planning rules
below while brainstorming is active.

Use `.ai/.agents/skills/create-plan/SKILL.md` to create, revise, or review a
plan before execution. Bounded, understood requests need no workflow artifact.
Complex, ambiguous, cross-cutting, or long-running work uses one living plan.
Changes to authentication, authorization, payments, secrets, migrations,
destructive behavior, or another named security or trust boundary require a
controlled plan and independent final review. Name the changed contract;
proximity to sensitive code alone does not make work controlled.

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

## Executing Saved Plans

These rules apply to native Execute plan, `/goal`, and ordinary requests to
implement a plan; execution does not require invoking `create-plan`.

- Read the selected plan before editing. Keep its progress, decisions,
  discoveries, validation, and outcome in that same file, without sidecars.
- Record material discoveries; ask only for unresolved behavior, permission,
  destructive, external-action, or repository-ownership decisions.
- Goal mode is available for long-running execution, not required. Do not start
  a Goal without a user request or duplicate its runtime progress elsewhere.
- Before controlled review, explicitly requested independent review, or a
  successful plan completion's manual review handoff, read and follow
  [Plan Review](instructions/shared/plan-review.md). Controlled review must
  finish before claiming completion; the optional manual handoff cannot replace it.

## Subagent Models and Names

Use sub-agents for bounded research or implementation when delegation materially
helps, and for required independent reviews. Keep small tasks in the parent.
Use these role defaults unless the user explicitly requests another runtime:

| Role       | Model         | Reasoning effort | Assignment                         |
| ---------- | ------------- | ---------------- | ---------------------------------- |
| `scout`    | `gpt-6-luna`  | `high`           | Read-only exploration and research |
| `builder`  | `gpt-6.1-sol` | `high`           | Implementation and focused fixes   |
| `reviewer` | `gpt-6.1-sol` | `xhigh`          | Independent review; no edits       |

- Inspect the exposed `spawn_agent` schema before spawning. Set the full
  `model` and `reasoning_effort` explicitly on every role spawn. In the audited
  runtime, use `fork_turns: "none"` for these overrides; `"all"` inherits the
  parent's runtime and cannot accept overrides. Do not prescribe a numeric
  fork depth or assume another client exposes the same interface.
- With no inherited history, supply the repository, relevant instruction paths,
  bounded assignment, expected result, and exclusive write ownership (or
  explicitly no edits) in the spawn message.
- Set `task_name` to `<role>_<model_family>_<reasoning_effort>_<purpose>`.
  Derive `model_family` from the model ID's final hyphen-delimited component;
  use a short lowercase snake-case purpose. Examples:
  `scout_luna_high_auth_map`, `builder_sol_high_auth_fix`, and
  `reviewer_sol_xhigh_auth_review`.
- The name must match the actual requested model and effort, including explicit
  user overrides. Include the name, full model ID, effort, bounded assignment,
  and exclusive write ownership, when applicable, in the spawn message.
- Reuse a scout or builder session only for the same bounded assignment and
  file ownership. Use a new name when the assignment or runtime changes, and a
  fresh reviewer for a materially changed review scope.
- If a requested model, effort, or spawn override is unavailable, stop that
  delegation and report the limitation. Do not silently substitute or inherit
  another runtime, mislabel it, or claim verification in an untested client.

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
- Evidence for every acceptance criterion or completion invariant is required,
  including automated, native, physical-device, operator, deployment, external
  service, and environment checks. Only checks proving none of these may be optional.
- Required acceptance evidence cannot be downgraded, skipped, or called
  optional. Unavailable required evidence blocks completion.
- For unavailable checks, report the unverified behavior, risk, blocker, and
  smallest follow-up check. Optional environment, service, device, or operator
  checks may be deferred only with this reporting.
- Validate the actual changed diff against the request, living plan when
  present, routed instructions, and preserved unrelated work.
- Never claim completion without reporting changed scope, validation results,
  deferred optional checks, and known limitations.

## `.ai` Repository Boundary

- `.ai/` is its own Git repository. Its containing workspace may be a Git
  parent checkout that ignores `.ai/` or an unversioned coordination root.
- Keep reusable source tracked in `.ai/`, including `instructions/shared/`,
  `instructions/mobile/`, `instructions/desktop/`, `instructions/web/`, and
  `instructions/server/`. Keep `instructions/index.md`, everything under
  `instructions/local/`, and living plans ignored.
- When adding, moving, or removing a portable instruction, update the ignored
  `instructions/index.md` routing. Keep one project-local index; do not add a
  duplicate CI index.
- Install `.ai` dependencies to enable its local Husky hooks. The pre-commit
  hook runs `pnpm health`; the pre-push hook runs `pnpm health:full`. Fix failed
  checks before delivery; do not bypass hooks to publish failing changes.
- Existing ignored legacy workflow records must remain untouched unless the
  user explicitly requests cleanup.
- When a Git parent checkout exists, do not stage `.ai` files in it.

Version: 3.4
Last Updated: 2026-11-13
