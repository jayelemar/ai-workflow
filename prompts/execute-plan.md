# Execute Plan

Run only when the user explicitly invokes:

`execute <plan-file>`

This command authorizes implementation of a saved LOW or MEDIUM
`plan-manifest@2`. Read `.ai/AGENTS.md`, the plan, its finalized spec and flow
artifacts when declared, current Git state in every declared repository, and
only the project instructions routed for the implementation scope.

## Preconditions

- Every declared repository root and integration-base ref must resolve.
- If a task-local `worktree-setup@1` report exists with `Ready` status, validate
  its repository mappings and use each mapped target in place of the plan's
  source root for filesystem resolution only. Stop on any report, Git registry,
  branch, base, or repository-ID mismatch.
- LOW requires its saved compact plan file; a conversational plan result
  is not an execution input. MEDIUM requires a finalized typed spec.
- Declared flow artifacts must be present and complete.
- Preserve unrelated changes in every repository.

## Execution

- Follow the requested behavior, finalized spec, repository ownership, and plan
  order strictly.
- If a material new requirement, dependency, risk, or repository boundary
  appears, stop. Return to the appropriate explicit spec or planning stage and
  wait for a new execution command.
- Run every required plan validation command. Optional external validation may
  be deferred only under `.ai/AGENTS.md` disclosure rules.

## Completion

For LOW, self-check the actual diff, scope, required validation, declared
repositories, and preserved unrelated work.

For MEDIUM, automatically run the independent whole-plan review in
`.ai/prompts/review-changes.md` after all implementation and required
validation. Save `.ai/artifacts/<plan-name>/review.md` with exactly one of the
five statuses defined there: `Ready to complete`, `Fix required`, `Awaiting
operator decision`, `Completed by operator`, or `Blocked`. Use the configured
`reviewer` subagent for every round, persist the round and checkpoint evidence,
selected authorization mode, and follow the automatic-round and checkpoint
rules exactly.

At `Awaiting operator decision`, pause the active execution before spawning
another reviewer and ask for exactly one standalone, case-sensitive token:
`END_REVIEW`, `REVIEW_NEXT_ROUND`, or `REVIEW_UNTIL_CLEAR`.
`REVIEW_NEXT_ROUND` authorizes only the next fresh round and returns a later
remediated blocking result to a new checkpoint. `REVIEW_UNTIL_CLEAR` persists
the selected mode and automatically repeats in-scope remediation, every
required validation, and fresh review until clear. It stops without completion
or another prompt on incomplete remediation, failed validation, reviewer or
evidence failure, a true blocker, or material discovery. `END_REVIEW` completes
as `Completed by operator` only when recorded remediation and every required
validation have succeeded. Invalid, stale, or out-of-context tokens have no
review-control effect.

## Final Response

Report changed scope by repository, required validation results, deferred
optional checks and risk, and either the LOW self-check or MEDIUM review path.
For `Completed by operator`, also report the ending round, resolved blocking
findings, passing validation, and that the latest remediation was not
independently re-reviewed. For `Awaiting operator decision`, report the active
round and repeat the three exact allowed tokens without claiming completion.
