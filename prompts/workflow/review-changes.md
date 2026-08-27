# Review Implemented Changes

This prompt is the sole authority for the MEDIUM/HIGH final-review loop, the
explicit any-plan manual-until-clear loop, `implementation-review@2`,
review-round accounting, statuses, transitions, and risk-decision tokens. Read
`.ai/AGENTS.md`, the current `plan-manifest@3`, its finalized spec and flow
artifacts, actual repository diffs, validation evidence, and the saved
`review-strategy@2` plus review budget.

If a plan, review, handoff, or worktree report belongs to an older contract,
return exactly: `Legacy workflow artifact: <path> uses <format>; replan using
the current contract before execution or resume.` Do not migrate, overwrite, or
delete the artifact.

## Invocation Modes

Formal completion mode is invoked by the owning MEDIUM execution or HIGH goal
stage and follows the automatic budget and authoritative state machine below.

Manual-until-clear mode starts only from an explicit invocation of
`.ai/prompts/utilities/review-until-clear.md` with `Plan: <plan-file>`. It is
available for every current `plan-manifest@3` classification and authorizes
review plus corrective remediation of an already implemented plan-owned diff.
Before review:

1. Validate the plan, its declared repositories and integration bases, required
   spec and artifacts, current Git state, and preserved unrelated work.
2. Require plan-owned implementation evidence in the cumulative diff or
   committed HIGH tasks and evidence that the implementation stage attempted
   the plan validation. Manual mode never executes an untouched plan or
   substitutes for initial implementation; use `Blocked` and return the owning
   execute or goal invocation when this evidence is absent.
3. Read all known review findings and required validation evidence. Remediate
   every known in-scope `P0`–`P2` and rerun every affected task and plan
   validation before starting a fresh independent reviewer. `P3` remains
   advisory.
4. After each complete blocking round, remediate and validate in the same way,
   then automatically start a fresh independent reviewer. Continue until a
   complete round is clear or a mandatory `Blocked` condition applies. The
   repeated-root-cause replan rule in the authoritative state machine remains
   mandatory.

For LOW, manual mode keeps round evidence in the final response for this
invocation and does not create an `implementation-review@2` artifact. Report
scope, reviewer runtime, fresh rounds, resolved and advisory findings,
validation, deferred checks, and `Clear` or the exact blocker.

For MEDIUM, read or initialize the declared `review.md`; for HIGH, update the
existing `goal-handoff@2` and apply the remediation commit rules in
`.ai/prompts/workflow/goal-checkpoint.md`. Preserve all existing round history,
record `REVIEW_UNTIL_CLEAR` as the manual authorization, and keep fresh round
numbers positive and strictly increasing. Manual returned review work is
separate from the immutable automatic budget and does not increase the
automatic-rounds-used count. A clear round sets `Ready to complete`; a runtime,
evidence, material-discovery, repeated-family, or validation blocker uses
`Blocked` or `Fix required` as required below.

Manual mode never expands plan or spec scope and does not authorize delivery,
pushing, or a pull request. It also does not replace the exact risk-decision
tokens accepted by formal completion mode at `Awaiting risk decision`.

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
- A risk-authorized review-until-clear continuation is recorded separately
  from the automatic budget. Its returned fresh rounds keep the same strictly
  increasing sequence without increasing the automatic-rounds-used count.

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
4. If one root-cause family remains blocking in two fresh rounds, stop
   incremental fixes; never clear, downgrade, or risk-accept that family. For
   every classification and invocation mode, set `Blocked` and return to
   planning. Carry the saved architectural fallback and complete round evidence
   into the next plan, and reassess the classification because repeated failure
   may show that the prior risk estimate was too low. Do not activate or apply
   the fallback incrementally under the current plan. Make the blocked result
   immediately actionable without a follow-up question:
   - For MEDIUM or HIGH, derive a concise unused kebab-case plan name from the
     saved fallback boundary and record this complete invocation under
     `Do this next:` and in the durable next-action field:

     ```text
     execute .ai/prompts/workflow/create-plan.md

     Plan name: <derived unused fallback plan name>
     Classification: resolve from current finalized context
     Spec: <current finalized spec path>
     Flow artifacts: AUTO
     ```

   - For LOW, derive the fallback plan name in the same way and return a direct
     create-plan invocation with `Classification: LOW`, `Spec: N/A: LOW`, and
     `Flow artifacts: AUTO`. Create-plan reapplies the deterministic classifier
     and stops with an exact escalation action only if the fallback proves a
     higher-class trigger; LOW itself never requires a spec.
5. After successful remediation and validation, automatically start the next
   fresh round only when the automatic budget still has one. HIGH first records
   required remediation commits under `.ai/prompts/workflow/goal-checkpoint.md`.
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
   - `REVIEW_UNTIL_CLEAR` authorizes successive fresh cumulative reviews beyond
     the automatic budget. After each blocking report, remediate every known
     in-scope `P0`–`P2`, complete applicable targeted and mutation/property
     checks, rerun required validation, record applicable HIGH remediation
     commits, and automatically start the next fresh review. A clear report
     ends the authorization and sets `Ready to complete`. Every mandatory
     `Blocked` condition still applies.
     A reviewer startup, runtime, or evidence failure returns no round,
     preserves the authorization, and requires explicit resume. A session
     interruption also preserves the recorded authorization for explicit
     resume without another risk-decision token. This authorization never
     expands implementation scope or authorizes delivery, pushing, or a pull
     request.
   - `ACCEPT_UNREVIEWED_REMEDIATION` sets `Completed with accepted review risk`
     only when all known `P0`–`P2` are fixed, required validation passes, and
     applicable HIGH remediation commits exist. Record that the latest
     remediation was not independently re-reviewed. This is risk acceptance,
     never reviewer clearance.
8. Invalid, stale, duplicate, combined, or out-of-context tokens change no
   state, start no reviewer, and complete nothing. Continue to require the
   current state's valid action.
9. Use `Blocked` for unavailable mandatory evidence/runtime, invalid round
   history, a material discovery, a root-cause family that remains blocking in
   two fresh rounds, or a genuine external blocker. Use `Fix required` for
   incomplete remediation or failed required validation.

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

- Token: <None | REVIEW_ONE_MORE | REVIEW_UNTIL_CLEAR | ACCEPT_UNREVIEWED_REMEDIATION>
- Eligibility: <eligible reason | not eligible reason>
- Disclosure: <None | latest remediation was not independently re-reviewed>

## Required Next Action

<exact copy-pasteable invocation, or exact blocker resolution followed by the invocation that resumes the owning stage>
```

For every non-complete status, write the exact action the user can take now.
Lead the user-facing result with the status and cause, then reproduce the
durable action under `Do this next:`. Never require the user to ask what to do.

## HIGH Evidence

For HIGH, record the same state, immutable budget, strictly increasing fresh
rounds, findings, validation, risk decision, remediation commit evidence, and
next action in the `goal-handoff@2` fields owned by
`.ai/prompts/workflow/goal-checkpoint.md`. Do not copy this state machine into the
handoff.
