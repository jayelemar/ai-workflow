# Review Implemented Changes

Review actual implementation evidence only. This is never a pre-execution
review of a spec or plan.

## MEDIUM Automatic Review

After MEDIUM validation, inspect the plan-owned actual diff, linked spec,
required flow artifacts when applicable, current Git state, and validation
evidence. Write `.ai/artifacts/<plan-name>/review.md` with exactly:

```md
# Implementation Review: <plan-name>

## Status

Ready to complete | Fix required | Blocked

## Scope Reviewed

<actual diff paths and plan scope>

## Validation Evidence

* <command and result>

## Findings

* None | <actionable finding>

## Required Next Action

<complete | in-scope fix and re-review | exact blocker resolution>
```

Use `Ready to complete` only when no required in-scope fix remains. Use `Fix
required` for actionable defects. Use `Blocked` only for a true external,
missing-input, or unresolved-risk blocker.

## HIGH-GOAL Task Review

During an active `/goal`, review each completed task's actual diff against its
plan scope and validation before committing it. Record the review and
validation evidence in the HIGH-GOAL handoff or task record, then make the
task-scoped commit before beginning the next task. Do not reuse MEDIUM's
single `review.md` as the HIGH task-review protocol.
