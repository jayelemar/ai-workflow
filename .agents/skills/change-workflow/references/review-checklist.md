# Independent Review Checklist

Use this checklist for controlled work or an explicitly requested independent
review. Review the actual Git diff after plan-owned writers have paused.

## Scope

- Confirm the base, commit, or uncommitted diff being reviewed.
- Separate plan-owned changes from unrelated and pre-existing work.
- Trace each requested outcome to implementation and validation evidence.

## Findings

Report only:

- a defect introduced by the reviewed diff;
- a direct violation of the request or living plan; or
- a regression in a boundary changed by the diff.

For every finding, provide the path and location, concrete impact, evidence,
and smallest sufficient correction. Treat speculative hardening, stylistic
preference, and unrelated pre-existing defects as non-blocking advice.

## Controlled boundaries

When applicable, verify:

- authentication and authorization remain server-enforced;
- ownership, tenant, and permission checks cannot be bypassed;
- secrets, credentials, tokens, and private data are not exposed;
- destructive and migration behavior has bounded recovery or rollback;
- payment and external trust contracts remain compatible;
- environment selection is explicit where behavior depends on it; and
- required validation exercises the real boundary rather than only a mock.

## Result

- Return prioritized findings first; state clearly when no blocking finding
  remains.
- Do not edit files as the independent reviewer.
- After remediation, require affected validation again.
- Use a fresh follow-up reviewer only when remediation materially changes the
  reviewed boundary.
