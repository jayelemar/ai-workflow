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

## Blockers

<current blockers or None>

## Next Action

<one concrete next action>
```

## Final Output

Return only:

`Goal checkpoint refreshed at .ai/artifacts/<goal-name>/goal-handoff.md`
