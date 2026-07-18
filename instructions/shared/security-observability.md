Version: 1.0
Last Updated: 2026-07-18

# Security Observability Instructions

## Purpose

Make security-sensitive behavior detectable, diagnosable, and recoverable without exposing sensitive data.

## Applies To

- Authentication, authorization, privileged actions, sensitive configuration, data access, and security-relevant production integrations.

## Rules

- Emit structured audit events for privileged actions, authorization denials, sensitive configuration changes, and other security-significant state changes.
- Include actor, target, action, outcome, request or correlation identifier, and safe contextual metadata; never include secrets, credentials, raw tokens, cookies, or full authorization headers.
- Define alerts for abnormal authorization denials, authentication failures, and sensitive configuration changes, with a documented owner and response path.
- Run SAST and dependency or supply-chain scanning in CI for production code and dependencies; investigate or explicitly risk-accept relevant findings before release.
- Maintain incident playbooks for authentication, authorization, and data-access events, including containment, evidence preservation, recovery, and verification steps.
- Keep audit retention, access, and integrity controls appropriate to the sensitivity of the events.

## Placement

- Put provider names, event schemas, alert thresholds, retention periods, and on-call routing in local instructions or runbooks.
- Put portable audit, detection, and response requirements in this file.

## Validation

- Verify audit events are emitted on allowed and denied sensitive paths without leaking sensitive data.
- Verify alerts have a testable trigger, named owner, and linked response procedure.
- Verify CI scanning runs on the affected code and dependency paths, or record the missing control and release risk.

## Anti-Patterns

- Logging only successful privileged actions while omitting denial evidence.
- Treating raw application logs as an audit trail without event structure, access control, or retention.
- Alerting without an owner or response procedure.
- Disabling security scans to unblock delivery without explicit risk acceptance and remediation tracking.
