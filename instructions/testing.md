Version: 1.2
Last Updated: 2026-06-28

# Testing Instructions

## Purpose

Set a shared testing standard that provides high release confidence while minimizing maintenance cost, CI runtime, and developer friction.

## Applies To

- Unit, integration, contract, and end-to-end tests in application repositories.
- Validation scripts defined in workspace or package manifests.
- Local browser or network-backed validation that may need sandbox escalation in Codex.

## Rules

- Tests are a safety net, not a burden; every test must justify its existence by meaningful confidence relative to maintenance cost.
- Prefer fewer high-value tests over large quantities of brittle, redundant, or low-signal tests.
- Use unit tests as the highest-volume layer for business logic, calculations, transformations, validation rules, domain logic, and edge cases.
- Keep unit tests fast, deterministic, independent, and free of UI, network, timing, or external-service dependencies.
- Use integration tests at moderate volume for contracts and data flow across components, services, APIs, databases, queues, or external integrations.
- Use E2E tests sparingly for critical business workflows only, such as authentication, registration, checkout, subscription management, revenue-generating flows, or mission-critical user journeys.
- Do not create E2E tests for every feature, component, validation message, or edge case.
- When a bug is found, add regression coverage at the cheapest layer that would have prevented it: unit first, integration for interaction failures, E2E only when a complete user workflow is required.
- Validate observable behavior and business outcomes; avoid tests that mainly assert implementation details, call counts, mock behavior, or framework internals.
- Treat flaky tests as defects; fix, quarantine, or remove tests that randomly fail, depend on arbitrary waits, depend on unstable external systems, or rely on timing.
- Classify merge-required validation as fast unit tests, core integration tests, and the smallest critical E2E set.
- Move expensive validation to scheduled or dedicated pipelines: full regression suites, browser matrices, visual regression, performance testing, and long-running E2E suites.
- Before adding a test, state the risk mitigated, whether coverage already exists, the cheapest valid layer, and why future developers will understand the test.
- Delete obsolete, duplicate, low-signal, removed-feature, or high-maintenance tests instead of preserving test count.
- Optimize for confidence, fast feedback, low maintenance overhead, high signal-to-noise ratio, and stable CI; do not optimize for total test count or coverage percentage alone.

## Placement

- Put unit and component tests close to the behavior they cover when the repository already follows colocated `*.test.*` patterns.
- Put integration or domain-level tests under the repository's established test ownership boundaries instead of scattering them ad hoc.
- Put only critical browser workflows in end-to-end suites; prefer targeted route, service, contract, or component tests for non-critical behavior.
- Keep schema, API contract, and client contract coverage close to the package or domain that owns the contract.

## Validation

- Prefer the smallest targeted test command that covers the changed behavior first, then broaden to package-level or workspace-level validation only when the risk requires it.
- Use browser or full end-to-end validation only when the change affects a user workflow that cannot be trusted from lower-level tests alone.
- In the Codex sandbox, local E2E that needs Node/Playwright local network access or browser automation may fail for environment reasons before application behavior is exercised; use command-level escalation for those runs instead of broadening validation scope.
- Do not use `yolo` for local E2E or browser-validation commands; request command-level escalation only for the specific command that needs sandbox bypass.
- Use full workspace test, build, or lint commands only when changes cross package boundaries or narrower validation cannot cover the risk.
- If validation is skipped, state the reason, the risk left unverified, and the smallest command that should be run later.

## Anti-Patterns

- Adding an E2E regression test automatically for every bug.
- Duplicating the same behavior at unit, integration, and E2E layers without a distinct risk reason.
- Asserting framework internals instead of repository behavior.
- Preserving flaky tests because they catch failures sometimes.
- Using coverage percentage or total test count as the goal.
- Running the slowest suite by default when a targeted deterministic test would provide equivalent confidence.
