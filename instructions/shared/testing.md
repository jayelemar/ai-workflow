# Testing Instructions

## Purpose and scope

Provide high confidence with fast feedback and low maintenance cost. Apply to
application unit, integration, contract, and E2E tests, manifest validation
scripts, and sandboxed browser or network validation.

## Test selection

- Choose the smallest sufficient set for every changed-boundary risk. Prefer
  fewer high-value tests; optimize confidence and stable CI rather than test
  count or coverage percentage.
- Use unit tests as the highest-volume layer: fast, deterministic, independent
  checks for business logic, calculations, transformations, validation, domain
  logic, and edge cases.
  Keep them free of UI, network, timing, and external-service dependencies.
- Use integration tests at moderate volume for contracts and data flow across
  components, services, APIs, databases, queues, or external integrations.
- Reserve E2E for critical business workflows (authentication, registration,
  checkout, subscriptions, revenue, or mission-critical journeys) or user
  workflows that lower layers cannot establish. Do not add one for every
  feature, component, message, edge case, or bug.
- Before changing behavior or fixing a bug, confirm or add a failing regression
  at the cheapest practical layer, then make the smallest passing change.
  Use integration for interaction failures and E2E only for a required complete
  workflow. Before adding coverage, state the risk, existing coverage, cheapest
  valid layer, and why future developers will understand the test.
- Test observable behavior and business outcomes. Avoid implementation-detail,
  call-count, mock-behavior, and framework-internal assertions.
- Treat flakes as defects: fix, quarantine, or remove tests with arbitrary waits,
  unstable external dependencies, or timing sensitivity. Delete obsolete,
  duplicate, low-signal, removed-feature, and costly-to-maintain coverage.
- Start with focused commands. Broaden to package or workspace checks only for
  cross-package changes or a distinct risk that narrower checks cannot cover.
  A broad required completion gate must name that risk in the request or plan.
- Keep merge-required checks to fast unit, core integration, and the smallest
  critical E2E set. Put expensive full regressions, browser matrices, visual,
  performance, and long-running E2E checks in scheduled or dedicated pipelines.

## Required evidence

- Before saving a validation command, name its observable invariant and expected
  result. Verify the exact command exercises it with the relevant configuration,
  fixtures, environment, and external inputs.
- Evidence for any acceptance criterion or completion invariant is required,
  whether automated, native, physical-device, operator, deployment, external
  service, or environment inspection. Missing required evidence blocks
  completion. Only checks proving none of these may be optional.
- Choose the least costly venue with equivalent confidence in the same invariant:
  focused local command, compatible development runtime, shared development or
  staging environment, fresh application build, or release pipeline.
- Reuse a runtime only after verifying compatible application version,
  native/runtime dependencies, effective configuration, and connected services.
  Record that compatibility evidence and the selected venue with results.
- A fresh build proves compilation and packaged configuration. A development
  or staging check proves only the behavior and environment boundaries it
  exercises; these venues are not interchangeable.
- If optional validation is skipped, report why, the unverified risk, and the
  smallest follow-up check. Required evidence cannot be deferred.

## Environment requirements

- For environment-dependent behavior, inspect effective configuration in every
  required environment at its consuming boundary. Mocks or local evidence cannot
  prove DNS, TLS, OS association, deployed configuration, or external services.
- Require direct compatible native-runtime or physical-device checks when
  acceptance depends on native rendering, frame timing, lifecycle, platform file
  URIs, or native upload transport. Source-only, mocked, browser-only, and
  non-native checks supplement but cannot replace this evidence. Client-only or
  server-only work without that native boundary does not require native checks.
- Do not add a generic operator-confirmation gate. Ask only when venues differ
  materially in evidence or residual risk and the request or finalized spec
  leaves that choice unresolved. Name required operator authority for a new
  deployment, credential use, privileged action, or shared-data mutation.
- Sandbox failures can prevent Node/Playwright network or browser tests from
  reaching application behavior. Request command-level escalation for the
  specific blocked command; do not broaden validation scope or use `yolo`.

## Placement

- Colocate unit/component tests when the repository uses `*.test.*` patterns.
- Keep integration/domain tests within established ownership boundaries.
- Keep schema, API, and client contracts near the owning package or domain.
- Keep only critical browser workflows in E2E suites; prefer route, service,
  contract, or component coverage for other behavior.

## Anti-Patterns

- Duplicating behavior across layers without a distinct risk.
- Preserving flaky tests because they sometimes catch failures.
- Running the slowest suite by default when focused evidence is equivalent.
