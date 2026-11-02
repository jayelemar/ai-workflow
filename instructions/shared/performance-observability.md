Version: 2.0
Last Updated: 2026-11-02

# Performance And Observability Instructions

## Purpose

Require measurable evidence for performance-sensitive changes on any platform.

## Applies To

- Performance-sensitive application paths, including client rendering, native
  work, data access, integrations, and high-risk user flows.

## Rules

- Do not claim a performance improvement without before-and-after evidence or
  an explicit statement that production measurement remains pending.
- Define relevant latency, error-rate, throughput, frame timing, or resource-use
  signals for the affected path before changing it.
- Record measurement context: environment, workload, sample window, baseline,
  result, and known limits.
- Select the smallest benchmark, integration, or load check that establishes
  the identified risk. Use the applicable platform's evidence requirements for
  native or browser behavior.

## Placement

- Keep portable measurement principles here. Query plans, backend load, and
  service operational guidance belong in `server/performance-observability.md`.
- Put vendor metrics, dashboard names, thresholds, and commands in local
  instructions or runbooks.

## Validation

- State verified metrics, pending metrics, and any required production-only
  follow-up. Distinguish local evidence from production claims.
- Run the smallest measurement check that covers the changed performance risk.

## Anti-Patterns

- Treating an optimization hypothesis as a measured result.
- Using only local timing for a production claim without stating its limits.
- Adding expensive load tests to every change regardless of risk.
