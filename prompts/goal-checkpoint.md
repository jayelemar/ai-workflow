# Goal Checkpoint

Create or refresh the portable checkpoint for a HIGH-GOAL work item. Use this
during initial HIGH planning to create the required handoff, and later before
`/goal pause`, ending a session, or switching provider or account.

Read `.ai/AGENTS.md` before inspecting or writing checkpoint context.

## Input

- Goal name: the plan name during initial HIGH planning; afterward, the stable
  kebab-case identifier already recorded in the handoff
- Exact goal: the finalized spec's `## Goal` text during initial HIGH planning;
  afterward, the current saved objective

If the goal name is missing or not kebab-case, STOP and request a stable
identifier before writing a checkpoint.

## Strict Constraints

- This is a checkpoint-only action. Do not implement work or change the goal.
- During initial HIGH planning, create the handoff before saving the plan's
  final output. Record that implementation has not started, the current
  repository state, `Awaiting explicit /goal invocation` as the blocker, and
  this exact two-line next action:

  ```text
  /goal <exact-goal>

  plan: <plan-file>
  ```

- Do not create workflow state, event logs, sidecars, or a MEDIUM review
  artifact. The linked finalized spec and saved HIGH plan are required inputs, not
  artifacts to recreate here.
- Create or refresh only `.ai/artifacts/<goal-name>/goal-handoff.md`.
- Inspect current repository state read-only as needed to record verified
  progress.
- Never copy secrets, raw diffs, or full command output into the checkpoint.

## Required Checkpoint Content

Write concise, verified Markdown with exactly these sections:

```md
# Goal Handoff: <goal-name>

## Document Format

goal-handoff@1

## Exact Goal

<the exact saved objective>

## Spec

<linked finalized feature or bugfix spec path>

## Plan

<linked saved plan path>

## Repository State

<current branch, relevant changed paths, and commit/working-tree summary>

## Verified Progress

<completed work and validation actually run>

## Decisions

<decisions that remain relevant; use None when none exist>

## Task Commit Protocol

For every implementation task in the linked saved plan:

Process tasks serially. Never combine two planned tasks in one commit, even
when their changes are technically compatible. Do not start the next task
until the current task has completed this protocol.

Planned task paths are the default staging and review boundary, not immutable
ownership. If execution discovers that an already required cross-task contract
cannot be consumed because an earlier task implemented the wrong internal
interface, apply the corrective-deviation criteria in `.ai/AGENTS.md`. Record
the exact mismatch before editing, reopen only the minimum prior-task paths,
run all affected task validation, and obtain a fresh configured reviewer. If
the earlier HIGH task is already committed, create one separate focused
`fix(<scope>): <spec-restoring summary>` commit before resuming the dependent
task. Do not ask for operator approval solely because the correction reopens an
earlier task's file. If any corrective criterion fails, stop for a material
discovery.

Before HIGH work starts, read `.ai/config/agent-models.toml`. Resolve each
role's `tier` to the locked model under `[tiers]`, then use that role's
`reasoning_effort`. The parent may use its `elevated_reasoning_effort` only when
the current work matches `elevate_when`. If the current parent does not match
an allowed registry runtime, STOP and request a new session with the registry
setting.

When a task-local `worktree-setup@1` report exists with `Ready` status,
validate its repository-ID mappings against the Git worktree registries,
branches, and base commits before starting the first task. Use each mapped
target instead of the saved plan's source root for filesystem resolution only;
stop on any missing, stale, or conflicting mapping.

For every required subagent, pass `[spawn].fork_turns` as a decimal string and
provide a self-contained assignment naming the applicable `AGENTS.md`, saved
spec, saved plan, owned files, and expected result. Never use full-history
forks. If the registry is missing or invalid, or a required model is
unavailable, STOP the task as `Blocked`; never substitute another model.

1. Read the current task's saved `Delegation` decision and required roles.
2. If delegation is `REQUIRED`, announce in the root terminal each role's task,
   bounded scope, and expected result, then spawn it with only that assignment.
   On a verified material milestone or completion, announce the role, current
   phase, evidence or changed paths, validation state, and next check. Before
   waiting again, state the last known phase and the exact result awaited;
   never substitute `Interacted with` or `Waiting for agents` transport text
   for this status, repeat unchanged updates, or disclose private reasoning.
   Wait for each result, then record the role, scope, and concise outcome in
   `## Verified Progress` or the task review evidence. If a required role
   cannot run or lacks its result, STOP the task as `Blocked`; do not continue
   as a single agent. These terminal messages are ephemeral and never create a
   progress artifact or authorization gate.
3. Implement only the current task's planned scope or a qualifying corrective
   deviation recorded under the protocol above.
4. Run the task's exact declared validation successfully.
5. Review the task diff for regressions, out-of-scope files, and every
   required delegation outcome.
6. Stage only files owned by that task; never stage `.ai/` artifacts.
7. Immediately before committing, run `git branch --show-current`. If the
   current branch is `main`, `dev`, `development`, or `staging`, STOP and ask
   the operator whether to proceed with that commit; wait for an explicit
   answer. Do not commit on that branch without it.
8. Create exactly one local, conventional, task-specific Git commit containing
   only the current task before starting the next task.
9. Confirm no remaining change owned by the completed task is left uncommitted.
10. Record the commit SHA, subject, validation result, and required delegation
    outcome in `## Verified Progress`.

If a task produces no tracked changes, record its validation and no-change
result in `## Verified Progress` before starting the next task; do not create
an empty commit to simulate task completion.

Never commit when validation fails, the behavioral boundary is ambiguous, or
the commit would include unrelated user changes. A path mismatch alone is not
behavioral ambiguity when all corrective-deviation criteria are proven. Stop
and request operator direction for genuine ambiguity. Do not push, open a pull
request, amend, squash, or force-push unless the operator explicitly requests
it.

## Final Review Protocol

After every planned task has completed the task commit protocol, run the
independent whole-plan review in `.ai/prompts/review-changes.md`. This final
review is mandatory regardless of the tasks' saved delegation decisions.

1. Run all plan-level required validation, then spawn a fresh configured
   `reviewer` subagent to inspect the cumulative plan-owned diff from every
   declared integration base through current `HEAD` and any remediation work.
2. If the review is clear of `P0`, `P1`, and `P2`, record the reviewer runtime,
   round result, validation, any advisory `P3` findings, and `Completion path:
reviewer-cleared` in `## Verified Progress`, then complete the goal.
3. If the reviewer reports a blocking finding, implement only the in-scope
   remediation or a qualifying corrective deviation under `.ai/AGENTS.md`.
   Only a material behavior, dependency, risk, or repository-boundary discovery
   that fails those criteria stops the goal and returns to the appropriate
   explicit spec or planning stage.
   When the linked plan uses `review-strategy@1`, group the round's findings by
   their stable root-cause identifiers, close every applicable variant in the
   saved adversarial matrix, and add mutation/property regressions at the
   cheapest valid layer. Do not patch only the reviewer's example spelling.
   If the same root-cause class remains blocking in two fresh review rounds,
   stop incremental remediation and return to planning for the saved
   architectural fallback. This threshold never automatically clears,
   ignores, or downgrades a `P0`, `P1`, or `P2` finding.
4. Rerun every task validation affected by the remediation and all applicable
   plan-level required validation. Review the remediation diff for unrelated
   files and preserved user work. Never commit failed or ambiguous
   remediation.
5. For each declared repository changed in that review round, stage only its
   remediation paths, never `.ai/` artifacts. Immediately before committing,
   run `git branch --show-current`; on `main`, `dev`, `development`, or
   `staging`, stop and obtain explicit operator permission for that commit.
6. Create exactly one local conventional commit per changed repository for the
   round. Its subject must name the resolved behavior or risk—not merely the
   review round—and use the owning conventional-commit scope:
   `fix(<affected component>): <imperative summary of the resolved finding>`.
   When no stable component scope exists, use
   `fix: <imperative summary of the resolved finding>`. Never use
   `fix(review)` as a scope. Its body must state the review round, concise
   summaries of every resolved `P0`/`P1`/`P2` finding, and the validation
   commands/results. Do not amend, squash, combine repositories, or include
   unrelated or previously completed task changes.
7. Record the round's resolved findings, validation results, repository commit
   SHAs and subjects, and remaining advisory findings in
   `## Verified Progress`.
8. For blocking rounds 1 and 2, start a fresh independent final-review round
   over the cumulative result automatically. For blocking round 3, record
   `Awaiting operator decision` only after every applicable HIGH remediation
   commit from steps 5 and 6 exists, then pause before another reviewer starts.
   For `review-strategy@1`, require each fresh reviewer to finish the complete
   saved matrix and report all grouped root-cause families before the next
   remediation begins.
9. At that active checkpoint, accept only the exact standalone, case-sensitive
   token `END_REVIEW`, `REVIEW_NEXT_ROUND`, or `REVIEW_UNTIL_CLEAR`. Record the
   token, selected authorization, active state, eligible round, validation, and
   remediation commits in `## Verified Progress`.
10. `END_REVIEW` completes as `Completed by operator` without a fresh review of
    the latest remediation. Record and disclose the ending round, resolved
    blocking findings, passing required validation, remediation commits,
    `Completion path: operator-ended`, and that the latest remediation was not
    independently re-reviewed. Invalid, stale, duplicate, or out-of-context
    tokens start no review and complete nothing; preserve an active checkpoint
    and request the three exact tokens again when applicable.
11. `REVIEW_NEXT_ROUND` records `one-round`, authorizes exactly one fresh
    final-review round, and is consumed only when that reviewer returns a report.
    Then record inactive authorization and no authorized next round while
    retaining the token and mode as history. If the reviewer runtime or required
    review evidence fails before a report returns, do not increment the round or
    consume its authorization; record the exact failure and retry that same
    authorized round after resolution and explicit resume without a new
    checkpoint or token. A blocking returned result follows steps 3 through 7;
    after every applicable HIGH remediation commit exists, record `Awaiting
operator decision` and pause before another reviewer.
12. `REVIEW_UNTIL_CLEAR` records and persists `until-clear`. A blocking result
    follows steps 3 through 7; only after every applicable HIGH remediation
    commit and required validation succeed, automatically start the next fresh
    final-review round without another checkpoint. Stop without completion or
    another prompt on incomplete remediation, failed validation, reviewer or
    evidence failure, a true blocker, or material discovery. Deactivate the
    authorization, clear the authorized next round, and retain its token, mode,
    and exact stop evidence. After resolving the stop and explicitly resuming,
    require a new eligible checkpoint and exact operator token before any further
    reviewer; never reactivate the stopped authorization.
13. A clear round completes through the reviewer-cleared path and advisory
    `P3` findings remain non-blocking. Deactivate any authorization, clear the
    authorized next round, and retain its token and mode as historical evidence.
    Failed remediation or validation cannot create a checkpoint. Stop as
    `Blocked` only for a true external or missing-input blocker, and return
    material discoveries to the appropriate explicit spec or planning stage.

## Blockers

<current blockers or None>

Record a pending operator decision as `Awaiting operator input: <decision>`.
An automatic goal or checkpoint continuation with no new user or external
evidence is not a new failed attempt and must not, by itself, escalate or
duplicate that blocker. Exhaust the corrective-deviation protocol before
requesting input about task-path ownership.

## Next Action

<one concrete next action>
```

## Final Output

When create-plan uses this prompt during initial HIGH planning, return control
to create-plan instead of producing this standalone output.

Return only:

`Goal checkpoint refreshed at .ai/artifacts/<goal-name>/goal-handoff.md`
