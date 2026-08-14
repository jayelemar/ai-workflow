# Review Implemented Changes

Review actual implementation evidence only. Read `.ai/AGENTS.md`, the saved
plan, finalized spec when declared, required flow artifacts, actual repository
diffs, and validation evidence.

## MEDIUM Review

Save `.ai/artifacts/<plan-name>/review.md` with exactly:

```md
# Implementation Review: <plan-name>

## Status

Ready to complete | Fix required | Blocked

## Scope Reviewed

<actual diff paths grouped by declared repository>

## Validation Evidence

- <required command and result>
- <optional deferred check, reason, and risk when applicable>

## Findings

- None | <actionable finding>

## Required Next Action

<complete | in-scope fix and re-review | exact blocker resolution>
```

Use `Ready to complete` only when no required in-scope fix or failed required
validation remains. `Blocked` is limited to a true external or missing-input
blocker.

## HIGH Task Review

During an explicitly invoked `/goal`, review each task's actual diff against
its single-repository ownership, finalized spec, exact validation, and required
delegation evidence. Missing or failed required evidence blocks the task.
Record the result in the goal handoff, then follow the unchanged task commit
protocol in `.ai/prompts/goal-checkpoint.md` before starting the next task.
