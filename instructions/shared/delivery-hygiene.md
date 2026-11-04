Version: 1.1
Last Updated: 2026-09-23

# Delivery Hygiene Instructions

## Purpose

Keep changes easy to review, deploy, revert, and trace.

## Applies To

- Plans, commits, pull requests, reviews, and release handoffs.

## Rules

- Keep each commit focused on one coherent purpose.
- Do not use `wip`, vague, conflict-only, or mixed-purpose commits for reviewable delivery history.
- Split independently deployable or reversible outcomes into separate commits or staged pull requests when practical.
- Rebase, squash, or otherwise clean noisy intermediate history before merge while preserving needed review and incident traceability.
- Record scope, validation performed, migration effect, compatibility, rollout risk, rollback or recovery path, and deferred checks in the pull request or commit description when applicable.
- Every pull request includes concise outcomes and explicit validation evidence.
  State checks not run and why when no completed checks are available. Keep
  risk, migration, recovery, and deferred-check information proportional to the
  change; omit inapplicable sections and filler. Commit evidence does not
  replace the PR's self-contained validation handoff.
- Distinguish completed checks, missing required acceptance evidence, and
  optional deferred checks, following
  [Validation and Completion](../../AGENTS.md#validation-and-completion).
  Examples in the PR skill illustrate simple and sensitive changes without
  prescribing boilerplate.
- State dependency order and validation order for cross-layer delivery.
- Add repository-specific trailers only when an existing delivery convention
  or explicit user request requires them. Do not create a workflow ledger for
  commit metadata.

## Commit Subjects and PR Titles

Use `<type>(<scope>): <imperative summary>` with a specific, imperative subject or title
no longer than 72 characters. Allowed types: `feat`, `fix`, `refactor`, `perf`,
`chore`, `docs`, `test`, `build`, `ci`, `style`, and `revert`.

## Placement

- Put repository commit tooling, PR templates, branch rules, and release commands in local instructions.
- Put portable history and delivery-evidence standards in this file.

## Validation

- Review each commit and pull request for one purpose, explicit validation evidence, and a practical revert or recovery path.
- Confirm migration, security, and rollout risks are recorded when the changed scope includes them.
- Confirm descriptions distinguish completed validation from deferred production, manual, or external validation.

## Anti-Patterns

- Combining cleanup, refactoring, feature behavior, and generated output without a stated dependency.
- Hiding migration or rollout risk in an issue comment instead of delivery metadata.
