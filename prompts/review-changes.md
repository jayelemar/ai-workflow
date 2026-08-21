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
6. For a blocking finding, the parent fixes only in-scope defects, reruns every
   required plan validation, and starts a fresh review round. Repeat until a
   fresh round is clear. Stop as `Blocked` only for a true external or
   missing-input blocker. A material behavior, dependency, risk, or
   repository-boundary discovery returns to the appropriate explicit spec or
   planning stage instead of being absorbed as remediation.

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

Ready to complete | Fix required | Blocked

## Scope Reviewed

<actual cumulative diff paths grouped by declared repository>

## Reviewer Runtime

<resolved reviewer model, reasoning effort, and fork turns>

## Review Rounds

- <round number, blocking findings fixed, validation rerun, and result>

## Validation Evidence

- <required command and result>
- <optional deferred check, reason, and risk when applicable>

## Findings

- None | <remaining P3 finding | active P0/P1/P2 finding when Fix required | exact external or missing-input blocker when Blocked>

## Required Next Action

<complete | in-scope fix, validation, and fresh re-review | exact blocker resolution>
```

Use `Ready to complete` only when the latest fresh review round has no `P0`,
`P1`, or `P2`, no failed required validation remains, and every earlier
blocking finding has been fixed. Use `Fix required` only while an in-scope
remediation round is continuing and record its active blocking findings.
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
result, advisory `P3`, and remediation commit in the goal handoff. Follow the
final review remediation protocol in `.ai/prompts/goal-checkpoint.md`. HIGH is
complete only when the latest fresh final review is clear and all required
validation passes.
