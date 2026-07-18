Version: 1.0
Last Updated: 2026-07-18

# Performance And Observability Instructions

## Purpose

Require measurable operational evidence for performance-sensitive changes.

## Applies To

- Database queries, indexes, schema changes affecting access paths, API endpoints, background work, external integrations, and high-risk user flows.

## Rules

- Do not claim a performance improvement without before-and-after evidence or an explicit statement that production measurement remains pending.
- Capture and review query plans for meaningful query, index, join, filter, sort, pagination, or data-volume changes.
- Define relevant latency, error-rate, throughput, and resource-use signals before changing a performance-sensitive path.
- Add load or stress validation for high-risk flows when targeted unit, integration, and query-plan checks cannot establish safe behavior under expected concurrency or volume.
- Record measurement context: environment, workload, sample window, baseline, result, and known limits.
- Ensure affected production signals are visible in an existing dashboard or document the missing observability as a rollout risk.

## Placement

- Put vendor metrics, dashboard names, thresholds, and command syntax in local instructions or runbooks.
- Put portable measurement and evidence requirements in this file.

## Validation

- Validate query-plan changes against realistic representative data where practical.
- Run the smallest load, integration, or benchmark check that covers the identified risk.
- State metrics verified, metrics pending, and any production-only validation required after rollout.

## Anti-Patterns

- Treating an optimization hypothesis as a measured result.
- Using only local timing for a production performance claim without stating its limits.
- Adding expensive load tests to every change regardless of risk.
- Shipping a high-risk performance change with no operational signal or rollout observation plan.
