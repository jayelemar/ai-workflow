# Server Performance And Observability Instructions

## Purpose

Establish query, backend-load, and service operational evidence for affected
server performance changes, using the shared measurement principles.

## Applies To

- Database queries, indexes, access paths, APIs, background work, and service
  integrations with meaningful concurrency, volume, or operational risk.

## Rules

- Apply `shared/performance-observability.md` for measurement context, baselines,
  and the limits of performance claims.
- Capture and review query plans for meaningful query, index, join, filter,
  sort, pagination, or data-volume changes.
- Add load or stress validation for high-risk flows when targeted unit,
  integration, and query-plan checks cannot establish safe behavior under
  expected concurrency or volume.
- Ensure affected production signals are visible in an existing dashboard or
  document the missing observability as a rollout risk.

## Placement

- Keep client and platform-independent measurement principles in shared guidance.

## Validation

- Validate changed query plans against realistic representative data where
  practical.

## Anti-Patterns

- Shipping a high-risk service performance change with no operational signal
  or rollout observation plan.
- Requiring backend dashboards or query plans for client-only work.
