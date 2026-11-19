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
- Consider property-based testing when many valid inputs or event sequences
  must obey the same rule. Explain the rule being checked, the gap in existing
  coverage, and the expected benefit before proposing additional tests.
- Consider formal verification only for a specific critical rule when simpler
  checks provide insufficient confidence. Explain what the model or proof would
  establish, its assumptions, limitations, and maintenance cost.
- Follow the [scope and approval rules](../../AGENTS.md#working-rules) before
  introducing additional tooling or expanding verification work.
- Treat flakes as defects: fix, quarantine, or remove tests with arbitrary waits,
  unstable external dependencies, or timing sensitivity. Delete obsolete,
  duplicate, low-signal, removed-feature, and costly-to-maintain coverage.
- Start with focused commands. Broaden to package or workspace checks only for
  cross-package changes or a distinct risk that narrower checks cannot cover.
  A broad required completion gate must name that risk in the request or plan.
- Keep merge-required checks to fast unit, core integration, and the smallest
  critical E2E set. Put expensive full regressions, browser matrices, visual,
  performance, and long-running E2E checks in scheduled or dedicated pipelines.

## Accessibility test approval

- Dedicated accessibility testing is off by default on mobile, web, and
  desktop. This includes VoiceOver, TalkBack and other screen readers,
  enlarged text/Dynamic Type, browser text scaling, accessibility audits,
  and other dedicated manual or automated accessibility checks.
- Do not add these checks to plans, suggest them, or execute them merely
  because UI, labels, roles, focus, announcements, or layout changed, a
  regression risk exists, or tooling is available. Continue implementing
  accessible behavior under the applicable UI instructions.
- A direct user request to run a named check or explicit approval of a
  scoped testing proposal authorizes that check. Reuse approval within its
  stated scope. Generic implementation, plan-execution, or "run tests"
  instructions do not grant accessibility-testing approval.
- If an existing task, accepted plan, or runbook explicitly requires an
  unapproved check, explain that requirement and the smallest proposed check,
  then ask permission before execution. Do not invent a requirement to trigger
  this question. Without such a requirement, skip the check without prompting.
- If approval is declined, do not run or repeatedly request the check. Report
  it as untested. Resolve any conflicting mandatory acceptance requirement
  with the user rather than silently removing it or claiming it passed;
  continue unaffected authorized work.
- Before running a command, inspect its scope for bundled dedicated
  accessibility checks. Obtain approval or use an existing narrower command.
  Do not silently disable maintained tests, change application suites, or
  claim the broader gate passed after running only a subset.
- Ordinary functional tests, including incidental label or focus assertions,
  and UI automation using accessibility selectors remain allowed. Reading
  an accessibility tree to locate and activate a control is not a screen-reader
  test and does not authorize a dedicated accessibility audit.

## Required evidence

Follow [Validation and Completion](../../AGENTS.md#validation-and-completion)
for required versus optional evidence, completion blocking, and deferred checks.

- For critical implemented user workflows, read and follow the
  [workflow verification map rules](documentation-runbooks.md#rules). Consult the
  project's documented map when selecting checks. Identify the affected user
  behavior and states, then reuse the smallest sufficient existing tests or
  runtime drivers. Report missing maps or coverage and propose additional tooling
  under the [scope and approval rules](../../AGENTS.md#working-rules).
- Before saving a validation command, name its observable invariant and expected
  result. Verify the exact command exercises it with the relevant configuration,
  fixtures, environment, and external inputs.
- Choose the least costly venue with equivalent confidence in the same invariant:
  focused local command, compatible development runtime, shared development or
  staging environment, fresh application build, or release pipeline.
- Reuse a runtime only after verifying compatible application version,
  native/runtime dependencies, effective configuration, and connected services.
  Record that compatibility evidence and the selected venue with results.
- A fresh build proves compilation and packaged configuration. A development
  or staging check proves only the behavior and environment boundaries it
  exercises; these venues are not interchangeable.

## Environment requirements

- For environment-dependent behavior, inspect effective configuration in every
  required environment at its consuming boundary. Mocks or local evidence cannot
  prove DNS, TLS, OS association, deployed configuration, or external services.
- Require direct compatible native-runtime checks when acceptance depends on
  native rendering, frame timing, lifecycle, platform file URIs, or native upload
  transport. Compatible iOS simulators and Android emulators provide
  native-runtime evidence for behavior they reproduce. Require physical hardware
  only for a named behavior that virtual devices cannot establish. Source-only,
  mocked, browser-only, and non-native checks supplement but cannot replace
  required native evidence. Client-only or server-only work without that native
  boundary does not require native checks.
- For mobile simulator platform selection and agent-run checks, follow
  [Mobile Virtual Devices](../mobile/virtual-devices.md#rules).
- Apart from that platform choice and [Accessibility test approval](#accessibility-test-approval),
  do not add a generic operator-confirmation gate. Ask only when venues differ
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
