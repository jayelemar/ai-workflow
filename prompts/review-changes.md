# Review Implemented Changes

This prompt is the sole authority for the MEDIUM/HIGH final-review loop,
`implementation-review@2`, review-round accounting, statuses, transitions, and
risk-decision tokens. Read `.ai/AGENTS.md`, the current `plan-manifest@3`, its
finalized spec and flow artifacts, actual repository diffs, validation evidence,
and the saved `review-strategy@2` plus review budget.

If a plan, review, handoff, or worktree report belongs to an older contract,
return exactly: `Legacy workflow artifact: <path> uses <format>; replan using
the current contract before execution or resume.` Do not migrate, overwrite, or
delete the artifact.

## Independent Reviewer

1. Resolve the locked `reviewer` role, model, reasoning effort, and decimal
   `fork_turns` from `.ai/config/agent-models.toml`. If unavailable or invalid,
   use `Blocked`; never substitute a runtime.
2. Every fresh round uses a newly spawned reviewer with a self-contained,
   bounded assignment and no full-history fork. The reviewer reports findings
   only and never implements fixes.
3. Review the cumulative plan-owned diff from every declared integration base,
   including committed HIGH tasks and current remediation. Preserve and exclude
   unrelated user work.
4. Complete the full planned review surface before returning. For a named
   sensitive boundary, execute every targeted check and applicable adversarial
   variant in `review-strategy@2`; group variants by stable failed-invariant
   root-cause family.

## Finding Scope and Priority

A blocking finding must be one of:

- a defect introduced by the plan-owned diff;
- a direct violation of the request or finalized spec; or
- a regression in a boundary changed by the plan.

Record an unrelated pre-existing defect as advisory and do not let it consume
automatic review work. Every finding names an exact path plus line or symbol,
concrete impact, and an in-scope fix. Use exactly `P0`, `P1`, `P2`, or `P3`:
`P0`–`P2` are blocking and `P3` is advisory. A round is clear only when it
reports no in-scope `P0`–`P2`.

## Round Accounting

- A round increments only when a fresh independent reviewer returns a complete
  cumulative report. Task review, validation, remediation, reviewer startup
  failure, and advisory triage do not increment it.
- Read the existing review or HIGH handoff before every review or resume.
  Review round numbers must be positive and strictly increasing. Missing,
  duplicate, decreasing, or reset round evidence is `Blocked`; never guess.
- The plan's saved automatic budget is immutable during execution. Automatic
  review consumes at most that many returned fresh rounds.
- A risk-authorized one-more round is recorded separately from the automatic
  budget and authorizes exactly one returned fresh report.

## Authoritative State Machine

Use exactly these statuses: `Fix required`, `Awaiting risk decision`, `Ready to
complete`, `Completed with accepted review risk`, and `Blocked`.

1. Start a fresh review automatically while no round is active and the saved
   automatic budget has a remaining round.
2. A clear returned round sets `Ready to complete`. Required validation must
   still pass; retain advisory findings.
3. A blocking returned round sets `Fix required`. Remediate every known in-scope
   `P0`–`P2`, apply the saved targeted and mutation/property checks where
   relevant, and rerun every affected task and plan validation. Never begin
   another review while a known `P0`–`P2` remains unresolved or required
   validation fails.
4. If one root-cause family remains blocking in two fresh rounds, set `Blocked`
   and return to planning for the saved architectural fallback. Stop incremental
   fixes; never clear, downgrade, or risk-accept that family.
5. After successful remediation and validation, automatically start the next
   fresh round only when the automatic budget still has one. HIGH first records
   required remediation commits under `.ai/prompts/goal-checkpoint.md`.
6. When a blocking result consumed the last automatic round, finish all known
   remediation, rerun required validation, and then set `Awaiting risk
decision`. This status is forbidden while any known `P0`–`P2` is unresolved
   or required validation fails.
7. At `Awaiting risk decision`, accept only one exact standalone,
   case-sensitive token:
   - `REVIEW_ONE_MORE` authorizes exactly one additional fresh cumulative
     review. It is consumed only when that reviewer returns a complete report.
     A runtime or evidence failure preserves the unconsumed authorization for
     explicit resume. A clear result sets `Ready to complete`; a blocking result
     returns to steps 3, 4, and 6 after remediation and validation.
   - `ACCEPT_UNREVIEWED_REMEDIATION` sets `Completed with accepted review risk`
     only when all known `P0`–`P2` are fixed, required validation passes, and
     applicable HIGH remediation commits exist. Record that the latest
     remediation was not independently re-reviewed. This is risk acceptance,
     never reviewer clearance.
8. Invalid, stale, duplicate, combined, or out-of-context tokens change no
   state, start no reviewer, and complete nothing. Continue to require the
   current state's valid action.
9. Use `Blocked` for unavailable mandatory evidence/runtime, invalid round
   history, a material discovery, the repeated-family fallback trigger, or a
   genuine external blocker. Use `Fix required` for incomplete remediation or
   failed required validation.

## MEDIUM Artifact

Save `.ai/artifacts/<plan-name>/review.md` with exactly this schema:

```md
# Implementation Review: <plan-name>

## Document Format

implementation-review@2

## Status

Fix required | Awaiting risk decision | Ready to complete | Completed with accepted review risk | Blocked

## Scope Reviewed

<cumulative plan-owned paths by repository and excluded unrelated work>

## Reviewer Runtime

<locked model, reasoning effort, and fork turns>

## Review Budget

- Automatic fresh rounds: <1 | 2 | 3>
- Automatic rounds used: <number>
- One-more authorization: <None | authorized for round N | consumed by round N>

## Review Rounds

- Round <strictly increasing number>: <scope, findings by root-cause family, remediation, validation, and result>

## Validation Evidence

- <required command and result>
- <optional deferred evidence, reason, and risk>

## Findings

- <known blocking, resolved blocking, advisory, and unrelated pre-existing findings with disposition>

## Risk Decision

- Token: <None | REVIEW_ONE_MORE | ACCEPT_UNREVIEWED_REMEDIATION>
- Eligibility: <eligible reason | not eligible reason>
- Disclosure: <None | latest remediation was not independently re-reviewed>

## Required Next Action

<fresh review | remediate and validate | risk decision | complete | replan for fallback | exact blocker resolution>
```

## HIGH Evidence

For HIGH, record the same state, immutable budget, strictly increasing fresh
rounds, findings, validation, risk decision, remediation commit evidence, and
next action in the `goal-handoff@2` fields owned by
`.ai/prompts/goal-checkpoint.md`. Do not copy this state machine into the
handoff.
