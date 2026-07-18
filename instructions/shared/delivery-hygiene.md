Version: 1.0
Last Updated: 2026-07-18

# Delivery Hygiene Instructions

## Purpose

Keep changes easy to review, deploy, revert, and trace.

## Applies To

- Plans, commits, pull requests, reviews, and release handoffs.

## Rules

- Use focused conventional commits with one coherent purpose and a descriptive subject.
- Do not use `wip`, vague, conflict-only, or mixed-purpose commits for reviewable delivery history.
- Split independently deployable or reversible outcomes into separate commits or staged pull requests when practical.
- Rebase, squash, or otherwise clean noisy intermediate history before merge while preserving needed review and incident traceability.
- Record scope, validation performed, migration effect, compatibility, rollout risk, rollback or recovery path, and deferred checks in the pull request or commit description when applicable.
- State dependency order and validation order for cross-layer delivery.

## Placement

- Put repository commit tooling, PR templates, branch rules, and release commands in local instructions.
- Put portable history and delivery-evidence standards in this file.

## Validation

- Review each commit and pull request for one purpose, explicit validation evidence, and a practical revert or recovery path.
- Confirm migration, security, and rollout risks are recorded when the changed scope includes them.
- Confirm descriptions distinguish completed validation from deferred production, manual, or external validation.

## Anti-Patterns

- Combining cleanup, refactoring, feature behavior, and generated output without a stated dependency.
- Claiming a change is safe to merge without validation evidence.
- Hiding migration or rollout risk in an issue comment instead of delivery metadata.
- Retaining noisy fixup history when it prevents clear review or revert.
