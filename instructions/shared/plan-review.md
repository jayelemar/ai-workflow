# Plan Review

Use the independent-review sections for controlled work or an explicitly
requested independent review. Review the actual Git diff after plan-owned writers have paused.

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

## Review procedure

- Use an independent reviewer that reports findings without implementing fixes.
- Fix blocking findings before completion.
- Do not create review budgets, authorization tokens, fingerprints, or review-state files.

## Manual review handoff

After successfully implementing a saved plan, end the completion response with
an optional manual review handoff:

- Provide one ready-to-copy fenced text block beginning with `/review ` followed
  by the full natural-language review instructions. Include the exact
  repository/worktree path, the plan path, and the target supported by Git state:
  uncommitted changes, a specific commit, or changes against a known base.
  Account for both committed and uncommitted plan-owned work when present.
- In that same block, instruct the reviewer to check correctness,
  regressions, plan acceptance criteria, and validation gaps; exclude unrelated
  pre-existing changes and report actionable findings without editing files.
- Provide one self-contained prompt per affected repository. Keep the command,
  target, paths, and review instructions together so one copy and paste supplies
  the complete request. Do not invent slash-command flags or start the review
  automatically.
- This optional follow-up does not replace controlled work's required
  independent final review, which must be complete before claiming completion.
- Do not emit this handoff for plan creation, blocked or incomplete
  implementation, or ordinary direct requests. Keep it in the response; do not
  create review-state files or add an approval gate.
