# Goal Checkpoint

Create or refresh the portable checkpoint for a HIGH-GOAL work item. Use this
during initial HIGH planning to create the required handoff, and later before
`/goal pause`, ending a session, or switching provider or account.

## Input

- Goal name: a stable kebab-case identifier chosen when the goal starts
- Exact goal: the current approved objective

If the goal name is missing or not kebab-case, STOP and request a stable
identifier before writing a checkpoint.

## Strict Constraints

- This is a checkpoint-only action. Do not implement work or change the goal.
- During initial HIGH planning, create the handoff before saving the plan's
  final output. Record that implementation has not started, the current
  repository state, `Awaiting explicit /goal invocation` as the blocker, and
  the exact `/goal <description> <plan-file>` next action.
- Do not create workflow state, event logs, sidecars, or a MEDIUM review
  artifact. The linked approved spec and HIGH plan are required inputs, not
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

<linked approved feature spec path>

## Plan

<linked approved manual plan path>

## Repository State

<current branch, relevant changed paths, and commit/working-tree summary>

## Verified Progress

<completed work and validation actually run>

## Decisions

<decisions that remain relevant; use None when none exist>

## Task Commit Protocol

For every implementation task in the linked approved plan:

Process tasks serially. Never combine two planned tasks in one commit, even
when their changes are technically compatible. Do not start the next task
until the current task has completed this protocol.

Before HIGH work starts, read `.ai/config/agent-models.toml`. Resolve each
role's `tier` to the locked model under `[tiers]`, then use that role's
`reasoning_effort`. The parent may use its `elevated_reasoning_effort` only when
the current work matches `elevate_when`. If the current parent does not match
an allowed registry runtime, STOP and request a new session with the registry
setting.

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
3. Implement only the current task's planned scope.
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

Never commit when validation fails, the task boundary is ambiguous, or the
commit would include unrelated user changes. Stop and request operator
direction in those cases. Do not push, open a pull request, amend, squash, or
force-push unless the operator explicitly requests it.

## Blockers

<current blockers or None>

## Next Action

<one concrete next action>
```

## Final Output

When create-plan uses this prompt during initial HIGH planning, return control
to create-plan instead of producing this standalone output.

Return only:

`Goal checkpoint refreshed at .ai/artifacts/<goal-name>/goal-handoff.md`
