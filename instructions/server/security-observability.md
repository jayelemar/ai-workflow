Version: 1.0
Last Updated: 2026-07-18

# Server Security Observability Instructions

## Purpose

Make backend and infrastructure security behavior detectable, diagnosable, and
recoverable using the safe logging requirements in `shared/security.md`.

## Applies To

- Backend or infrastructure auditing, alerting, retention, scanning operations,
  and incident response for authentication, authorization, privileged actions,
  sensitive configuration, data access, and production integrations.

## Rules

- Emit structured audit events for privileged actions, authorization denials, sensitive configuration changes, and other security-significant state changes.
- Include actor, target, action, outcome, request or correlation identifier, and
  safe contextual metadata, following `shared/security.md` for data exclusions.
- Define alerts for abnormal authorization denials, authentication failures, and sensitive configuration changes, with a documented owner and response path.
- Apply the scanning requirements in `shared/security.md` to affected service
  and infrastructure paths; keep the operational ownership and response process
  aligned with relevant findings.
- Maintain incident playbooks for authentication, authorization, and data-access events, including containment, evidence preservation, recovery, and verification steps.
- Keep audit retention, access, and integrity controls appropriate to the sensitivity of the events.

## Placement

- Put provider names, event schemas, alert thresholds, retention periods, and on-call routing in local instructions or runbooks.
- Put backend audit, detection, and response requirements in this file.
- Keep cross-platform safe logging and supply-chain requirements in
  `shared/security.md`; client-only work does not require backend infrastructure.

## Validation

- Verify audit events are emitted on allowed and denied sensitive paths without leaking sensitive data.
- Verify alerts have a testable trigger, named owner, and linked response procedure.
- Verify CI scanning runs on the affected code and dependency paths, or record the missing control and release risk.

## Anti-Patterns

- Logging only successful privileged actions while omitting denial evidence.
- Treating raw application logs as an audit trail without event structure, access control, or retention.
- Alerting without an owner or response procedure.
- Treating client-only work as requiring backend audit infrastructure.
