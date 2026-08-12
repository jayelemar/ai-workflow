# Execute Plan

Run only when the user explicitly invokes:

`execute <plan-file>`

This command authorizes implementation of a saved LOW or MEDIUM
`plan-manifest@2`. Read `.ai/AGENTS.md`, the plan, its finalized spec and flow
artifacts when declared, current Git state in every declared repository, and
only the project instructions routed for the implementation scope.

## Preconditions

- Every declared repository root and integration-base ref must resolve.
- LOW requires its saved compact plan file; a conversational Plan-mode result
  is not an execution input. MEDIUM requires a finalized typed spec.
- Declared flow artifacts must be present and complete.
- Preserve unrelated changes in every repository.

## Execution

- Follow the requested behavior, finalized spec, repository ownership, and plan
  order strictly.
- If a material new requirement, dependency, risk, or repository boundary
  appears, stop. Return to the appropriate explicit spec or Plan-mode stage and
  wait for a new execution command.
- Run every required plan validation command. Optional external validation may
  be deferred only under `.ai/AGENTS.md` disclosure rules.

## Completion

For LOW, self-check the actual diff, scope, required validation, declared
repositories, and preserved unrelated work.

For MEDIUM, automatically run `.ai/prompts/review-changes.md` after validation
and save `.ai/artifacts/<plan-name>/review.md` with exactly one status:
`Ready to complete`, `Fix required`, or `Blocked`. Fix in-scope defects and
repeat required validation/review; stop on a true blocker.

## Final Response

Report changed scope by repository, required validation results, deferred
optional checks and risk, and either the LOW self-check or MEDIUM review path.
