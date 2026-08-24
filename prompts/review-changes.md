# Review Implemented Changes

Review actual implementation evidence only. Read `.ai/AGENTS.md`, the saved
plan, finalized spec when declared, required flow artifacts, actual repository
diffs, and validation evidence.

## Independent Final Review

After all planned implementation has finished, MEDIUM execution and HIGH
`/goal` completion require an independent whole-plan review before completion.

1. Read `.ai/config/agent-models.toml`. Resolve the `reviewer` role's `tier` to
   its locked model and use its `reasoning_effort`. Pass `[spawn].fork_turns`
   as a decimal string. If the registry is missing or invalid, the reviewer
   model is unavailable, or the current runtime cannot spawn the configured
   role, set the review to `Blocked`; never substitute a different runtime.
2. Spawn a fresh reviewer subagent for every review round. Give it a
   self-contained assignment naming the applicable `AGENTS.md`, finalized
   spec, saved plan, flow artifacts, declared repository roots and integration
   bases, plan-owned cumulative diff, and validation evidence. Never use a
   full-history fork.
3. Review the cumulative implementation attributable to the plan, including
   committed HIGH task changes and current remediation changes. Exclude and
   preserve unrelated user work. The reviewer reports findings only and does
   not implement fixes.
4. Every finding must name an exact path and line or symbol, explain the
   concrete impact, prescribe an in-scope fix, and use exactly one priority:
   `P0` for an immediate stop-ship defect, `P1` for a high-impact defect, `P2`
   for a material normal-priority defect, or `P3` for a non-blocking
   improvement.
5. `P0`, `P1`, and `P2` are blocking. `P3` is advisory and remains recorded
   without preventing completion. A round is clear only when it reports no
   blocking finding.
6. A review round is counted only when a fresh independent reviewer returns its
   cumulative whole-plan report. HIGH task reviews, validation runs,
   remediation attempts, and advisory handling do not increment the count.
   Before review or resumption, read the existing MEDIUM review artifact or
   HIGH goal handoff. Persist every round result, checkpoint decision, and
   selected authorization there. If required round, checkpoint, or
   authorization evidence is missing or unreadable, stop as `Blocked` rather
   than guessing or resetting it.
7. A clear round completes as `Ready to complete` without a continuation
   checkpoint. Deactivate any authorization, set `Authorized next round` to
   `None`, and retain the operator token and selected mode as historical
   evidence. Record `P3` findings without creating a continuation checkpoint.
8. For blocking findings, set `Fix required`, fix only in-scope defects, and
   rerun every required plan validation. Failed or incomplete remediation, or
   any required validation failure, must not enter `Awaiting operator decision`
   and cannot be overridden by a continuation token. HIGH also completes the
   remediation-commit protocol in `.ai/prompts/goal-checkpoint.md` before
   checkpoint eligibility.
9. After successfully remediating and validating blocking rounds 1 and 2,
   automatically start the next fresh review round. After successfully
   remediating and validating blocking round 3, set the status to
   `Awaiting operator decision`, record no active authorization, and pause
   before spawning the next reviewer.
10. At an active checkpoint, accept only one exact standalone, case-sensitive
    token:
    - `END_REVIEW` sets `Completed by operator` and completes without a fresh
      review of the latest remediation.
    - `REVIEW_NEXT_ROUND` records `one-round`, authorizes exactly one additional
      fresh cumulative review round, and is consumed only when that reviewer
      returns a report; then record `Authorization active: no` and `Authorized
next round: None` while retaining its token and mode as history. If the
      reviewer runtime or required review evidence fails before a report returns,
      do not increment the round or consume its authorization. Record the exact
      failure and retry that same authorized round after the failure is resolved
      and execution is explicitly resumed, without requiring a new checkpoint or
      token. If the returned authorized round is blocking, remediate it, rerun
      required validation, complete applicable HIGH remediation commits, create
      a new continuation checkpoint, and pause before any further reviewer.
    - `REVIEW_UNTIL_CLEAR` records and persists `until-clear`, then automatically
      starts each next fresh review round after successful in-scope remediation,
      every required validation, and applicable HIGH remediation commits.
      Continue until a fresh round is clear without creating another
      continuation checkpoint.
      These are the only three accepted tokens. No token or authorization is
      inferred, enabled by default, or accepted outside an active checkpoint.
11. `REVIEW_UNTIL_CLEAR` stops without completion or another checkpoint prompt
    when incomplete remediation remains, required validation fails, the
    reviewer runtime fails, required evidence is unavailable, a true blocker
    occurs, or a material discovery returns work to specification or planning.
    Deactivate the authorization, set `Authorized next round` to `None`, and
    retain the token, selected mode, and exact stop evidence; never bypass the
    existing `Fix required`, `Blocked`, or material-discovery path. After the
    stop condition is resolved and execution is explicitly resumed, require a
    new eligible continuation checkpoint and exact operator token before any
    further reviewer; never reactivate the stopped authorization.
12. Any invalid token leaves the status at `Awaiting operator decision`, starts
    no reviewer, and completes nothing; request `END_REVIEW`,
    `REVIEW_NEXT_ROUND`, or `REVIEW_UNTIL_CLEAR` again. A stale, duplicate, or
    out-of-context token has no review-control effect after a review starts or
    either completion path is reached.
13. Stop as `Blocked` only for a true external or missing-input blocker. A
    material behavior, dependency, risk, or repository-boundary discovery
    returns to the appropriate explicit spec or planning stage and no token or
    authorization can override it. LOW self-checks and HIGH task reviews remain
    unchanged.

## Consolidated Review Contract

Apply this section only when the saved plan contains `## Review Strategy` with
format `review-strategy@1`. Plans without that versioned section retain the
independent review loop above unchanged.

1. Complete the entire cumulative review before returning, even after the
   first blocking finding is confirmed. Do not stop at the first reproduction
   or disclose one variant while leaving the same planned matrix unaudited.
2. Review every saved security-sensitive surface against its applicable
   adversarial matrix. The matrix considers direct access, aliases, later
   assignment, transitive flow, computed access, destructuring, `bind`, `call`,
   `apply`, reflection and mutation APIs, container/member storage,
   encoding/normalization, and environment/process-control manipulation when
   relevant to that surface.
3. Group confirmed variants by the failed invariant and shared remediation,
   not by syntax spelling. Give each family a stable root-cause identifier and
   report all confirmed `P0`, `P1`, and `P2` families together. A finding may
   list multiple reproductions, but must prescribe closure of the complete
   applicable family rather than only the example payload.
4. Distinguish a genuinely new root-cause class from another variant of a
   previously reported class. Use the saved plan's architectural fallback when
   the same class remains blocking in two fresh rounds; never automatically
   clear, ignore, or downgrade a finding because a review threshold was met.
5. Keep code-review clearance, advisory `P3` findings, baseline validation
   discrepancies, and external/operator evidence as separate results. Missing
   external evidence does not justify additional unrelated code findings, and
   code clearance does not fabricate or satisfy that evidence.

## MEDIUM Review

Save `.ai/artifacts/<plan-name>/review.md` with exactly:

```md
# Implementation Review: <plan-name>

## Status

Ready to complete | Fix required | Awaiting operator decision | Completed by operator | Blocked

## Scope Reviewed

<actual cumulative diff paths grouped by declared repository>

## Reviewer Runtime

<resolved reviewer model, reasoning effort, and fork turns>

## Review Rounds

- <round number, returned report, blocking findings fixed, validation rerun, and result>

## Continuation Checkpoint

- Active: <yes | no>
- Eligible after round: <number | N/A>
- Operator token: <END_REVIEW | REVIEW_NEXT_ROUND | REVIEW_UNTIL_CLEAR | None>
- Selected authorization: <None | one-round | until-clear>
- Authorization active: <yes | no>
- Authorized next round: <number | None>

## Validation Evidence

- <required command and result>
- <optional deferred check, reason, and risk when applicable>

## Findings

- None | <remaining P3 finding | active P0/P1/P2 finding when Fix required | exact external or missing-input blocker when Blocked>

## Completion Path

<reviewer-cleared | operator-ended after round number with resolved findings, passing validation, and explicit latest-remediation non-re-review disclosure | incomplete>

## Required Next Action

<complete | in-scope fix and validation | END_REVIEW, REVIEW_NEXT_ROUND, or REVIEW_UNTIL_CLEAR | exact blocker resolution>
```

Use `Ready to complete` only when the latest fresh review round has no `P0`,
`P1`, or `P2`, no failed required validation remains, and every earlier
blocking finding has been fixed. Use `Fix required` only while an in-scope
remediation round is continuing and record its active blocking findings.
Use `Awaiting operator decision` only after blocking round 3, or a later
one-round-authorized blocking result, has been fully remediated, required
validation passes, and any HIGH remediation commits are complete. It is not
used while until-clear authorization remains active. Use `Completed by
operator` only for an exact `END_REVIEW` at that active checkpoint; record the
ending round, resolved blocking findings, passing required validation, and that
the latest remediation was not independently re-reviewed. These are five
statuses with distinct completion paths; authorization mode never creates a
sixth status, and `Completed by operator` is never reviewer clearance.
`Blocked` is limited to a true external or missing-input blocker and records
that blocker instead of a review finding.

## HIGH Task Review

During an explicitly invoked `/goal`, retain each task's pre-commit actual-diff
review against its single-repository ownership, finalized spec, exact
validation, and required delegation evidence. Missing or failed required
evidence blocks the task. Record the result in the goal handoff, then follow
the unchanged task commit protocol in `.ai/prompts/goal-checkpoint.md` before
starting the next task.

## HIGH Final Review

After every planned HIGH task has completed its task commit protocol, run the
independent final review over the whole plan regardless of each task's saved
delegation decision. Record every round, resolved blocking finding, validation
result, advisory `P3`, remediation commit, selected authorization and its active
state, and the explicit `reviewer-cleared` or `operator-ended` completion path
in the goal handoff. Follow the final review remediation protocol in
`.ai/prompts/goal-checkpoint.md`. HIGH is complete either when the latest fresh
final review is clear and all required validation passes or through the
explicitly disclosed `Completed by operator` path after an eligible checkpoint.
