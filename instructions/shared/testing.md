Version: 1.6
Last Updated: 2026-09-23

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
- Before changing behavior or fixing a bug, confirm or add a failing regression test at the cheapest practical layer, then implement the smallest change that makes that test pass.
- Validate observable behavior and business outcomes; avoid tests that mainly assert implementation details, call counts, mock behavior, or framework internals.
- Treat flaky tests as defects; fix, quarantine, or remove tests that randomly fail, depend on arbitrary waits, depend on unstable external systems, or rely on timing.
- Classify merge-required validation as fast unit tests, core integration tests, and the smallest critical E2E set.
- Treat the validation venue as part of the evidence decision: distinguish a
  focused local command, an existing compatible development runtime, a shared
  development or staging environment, a fresh application build, and a
  release pipeline. Recommend the least costly venue that can exercise the
  same observable invariant with equivalent confidence.
- Do not introduce a generic operator-confirmation gate for validation. Ask for
  a decision only when venue choices materially differ in evidence or residual
  risk and the request or finalized spec does not resolve that choice. Name
  required operator authority when a venue entails a new deployment,
  credential use, privileged action, or mutation of shared environment data.
- Evidence needed to prove a specification acceptance criterion is required,
  regardless of whether it comes from an automated command, device, operator,
  deployment, external service, or environment inspection. Only evidence that
  proves no acceptance criterion or completion invariant may be optional.
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

- When selecting required validation for a living plan, choose the smallest
  sufficient set that covers every changed-boundary risk.
- A broader repository-wide validation command may be a required completion
  gate only when the request or plan states the distinct risk that focused validation
  cannot cover; otherwise omit it from required validation.
- Before saving a validation command, state its observable invariant and
  expected result, then verify that the exact command can exercise that
  condition after accounting for relevant environment, configuration, fixture,
  and external-input sources.
- For environment-dependent behavior, validate the effective configuration in
  every required environment at the boundary that consumes it. Mocked or local
  evidence cannot establish DNS, TLS, operating-system association, deployed
  configuration, or external-service behavior.
- Prefer the smallest targeted test command that covers the changed behavior first, then broaden to package-level or workspace-level validation only when the risk requires it.
- Reuse an existing development runtime or deployed environment instead of
  creating a fresh build only after verifying that its application version,
  native/runtime dependencies, effective configuration, and connected
  services are compatible with the boundary under test. Record that
  compatibility evidence and the selected venue in the validation result.
- Do not treat a fresh build and a deployed-environment check as
  interchangeable: a build proves compilation and packaged configuration,
  while development or staging evidence proves only the behavior and
  effective environment boundaries it actually exercises.
- Use browser or full end-to-end validation only when the change affects a user workflow that cannot be trusted from lower-level tests alone.
- Require a direct check in a compatible native runtime or on a physical device
  when acceptance depends on native rendering, frame timing, application
  lifecycle, platform file URIs, or native upload transport. Mocked,
  source-only, browser-only, and non-native tests are supplemental; they cannot
  replace that native evidence.
- In the Codex sandbox, local E2E that needs Node/Playwright local network access or browser automation may fail for environment reasons before application behavior is exercised; use command-level escalation for those runs instead of broadening validation scope.
- Do not use `yolo` for local E2E or browser-validation commands; request command-level escalation only for the specific command that needs sandbox bypass.
- Use full workspace test, build, or lint commands only when changes cross package boundaries or narrower validation cannot cover the risk.
- If optional validation is skipped, state the reason, the risk left
  unverified, and the smallest check that should be run later. Missing required
  evidence is a blocker, not a deferral.

## Anti-Patterns

- Adding an E2E regression test automatically for every bug.
- Duplicating the same behavior at unit, integration, and E2E layers without a distinct risk reason.
- Asserting framework internals instead of repository behavior.
- Preserving flaky tests because they catch failures sometimes.
- Using coverage percentage or total test count as the goal.
- Running the slowest suite by default when a targeted deterministic test would provide equivalent confidence.
