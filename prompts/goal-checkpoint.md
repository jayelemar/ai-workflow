# Goal Checkpoint

Create or refresh the portable checkpoint for a HIGH-GOAL work item. Use this
only before `/goal pause`, ending a session, or switching provider or account.

## Input

- Goal name: a stable kebab-case identifier chosen when the goal starts
- Exact goal: the current approved objective

If the goal name is missing or not kebab-case, STOP and request a stable
identifier before writing a checkpoint.

## Strict Constraints

- This is a checkpoint-only action. Do not implement work or change the goal.
- Do not invoke the workflow runner or create runner state, runner event, or
  review artifact. The linked approved spec and manual plan are required
  inputs, not artifacts to recreate here.
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

1. Implement only the task's planned scope.
2. Run the task's exact declared validation successfully.
3. Review the task diff for regressions and out-of-scope files.
4. Stage only files owned by that task; never stage `.ai/` artifacts.
5. Create exactly one local, conventional, task-specific Git commit before
   starting the next task.
6. Confirm no remaining change owned by the completed task is left uncommitted.
7. Record the commit SHA, subject, and validation result in `## Verified Progress`.

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

Return only:

`Goal checkpoint refreshed at .ai/artifacts/<goal-name>/goal-handoff.md`
