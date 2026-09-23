# Work Status: <stable-work-item-name>

## Document Format

work-status@1

## Current Work

- Work item: `<stable-work-item-name>`
- Overall status: `not started` | `in progress` | `blocked` | `complete`
- Classification: `LOW` | `MEDIUM` | `HIGH`
- Goal: <current complete desired outcome in plain language>
- Spec: `.ai/specs/<name>.spec.md` | `N/A: LOW plans do not use a spec`
- Active plan: `.ai/plans/<current-plan-name>.md`

## Progress Summary

- Completed: <stable task IDs | `None`>
- Active: <one stable task ID | `None`>
- Blocked: <stable task IDs | `None`>
- Reopened: <stable task IDs | `None`>
- Remaining: <stable task IDs | `None`>

## Repository State

- <repository ID: branch, base, HEAD, relevant working-tree summary>

## Current Tasks

Repeat for every task in the active plan, in plan order.

### T-001: <plain-language task outcome>

- State: `not started` | `active` | `blocked` | `reopened` | `complete`
- Plan revision: `<positive integer>`
- Delegation: <ordered HIGH delegation evidence | `N/A` | `Pending`>
- Validation: <command and result | `Pending`>
- Actual-diff review: <result | `Pending`>
- Commit: <SHA and subject | `N/A` | `Pending`>

## Changed or Removed Tasks

<`None` | one entry per superseded task ID, replacement IDs when applicable,
revision, and concise reason>

## Revision Log

1. <plan revision, spec path, plan path, and one-line reason; oldest first>

## Review State

- Format: `implementation-review@3` | `N/A: LOW self-check`
- Status: <canonical review status | `N/A: LOW self-check` | `Not started`>
- Automatic budget: <`2` | `3` | `N/A: LOW self-check`>
- Review input fingerprints: <current evidence | `None`>
- Fresh rounds: <strictly increasing round records | `None`>
- Findings: <blocking, resolved, advisory, and pre-existing dispositions | `None`>
- Risk decision: <canonical evidence | `None`>
- Remediation commits: <repository, round, SHA, and subject | `None`>

## Blockers

<current blockers | `None`>

## Next Action

<one exact action; HIGH uses `/goal <exact normalized Goal text from the
finalized spec>`, a blank line, then `Work item: <stable-work-item-name>`>
