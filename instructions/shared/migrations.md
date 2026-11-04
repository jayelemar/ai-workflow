Version: 1.2
Last Updated: 2026-11-02

# Migration Instructions

## Purpose

Standardize safe, observable, forward-only production data and schema changes.

## Applies To

- Database schema, data, policy, storage, permission, and generated-contract migrations.

## Rules

- Never edit, split, reorder, or delete a migration already deployed to any production environment.
- Treat a migration as immutable once it has been pushed to a shared branch or applied to any remote environment. A failed, unrecorded staging run does not by itself authorize editing it; confirm publication and deployment state before changing migration source.
- Recover a pushed migration failure with an operator-approved forward recovery or a documented staging repair procedure; do not silently rewrite the already-published migration.
- Use small, forward-only migrations with one clear compatibility objective.
- For every production-affecting migration, document compatibility, backfill, rollout order, monitoring, rollback or recovery, and validation evidence.
- Design additive-compatible changes before removals: add new structure, deploy compatible readers and writers, backfill safely, verify, then remove only in a later finalized migration.
- Make data backfills resumable, bounded, idempotent where practical, and observable.
- Define rollback as a safe forward recovery when database rollback is unsafe or destructive.
- Regenerate and validate dependent contracts or generated types when a migration changes them.

## Placement

- Put database-vendor commands, paths, and implementation conventions in local instructions.
- Put reusable lifecycle and rollout standards in this file.

## Validation

- Run the smallest migration and database-contract validation that covers the change.
- Verify upgrade compatibility, backfill behavior, permission effects, and recovery path before claiming completion.
- For backend migrations, apply `server/performance-observability.md` for
  applicable query-plan and performance evidence. Validate client-only
  persistence changes with the applicable platform and local instructions.

## Anti-Patterns

- Combining unrelated schema, policy, and backfill changes in one irreversible migration.
- Requiring simultaneous deployment of incompatible application and database versions.
