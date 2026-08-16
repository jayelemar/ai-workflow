# Execute Plan

Run only when the user explicitly invokes:

`execute <plan-file>`

This command authorizes implementation of a saved LOW or MEDIUM
`plan-manifest@2`. Read `.ai/AGENTS.md`, the plan, its finalized spec and flow
artifacts when declared, current Git state in every declared repository, and
only the project instructions routed for the implementation scope.

## Preconditions

- Every declared repository root and integration-base ref must resolve.
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
validation. Save `.ai/artifacts/<plan-name>/review.md` with exactly one status:
`Ready to complete`, `Fix required`, or `Blocked`. Use the configured
`reviewer` subagent for every round. Fix blocking `P0`, `P1`, and `P2`
findings, rerun every required plan validation, and repeat with a fresh
reviewer until clear; record `P3` findings without blocking completion. Stop
only on a true blocker or a material discovery that requires a new explicit
spec or planning stage.

## Final Response

Report changed scope by repository, required validation results, deferred
optional checks and risk, and either the LOW self-check or MEDIUM review path.
