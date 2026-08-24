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
- Classify discoveries using the corrective-deviation contract in
  `.ai/AGENTS.md`. When every corrective criterion holds, record the deviation,
  make the smallest spec-restoring change even when it reopens an earlier
  step's path, rerun affected validation, and include it in independent review;
  no new execution command or operator approval is required. If any criterion
  fails, treat the change as material, stop, and return to the appropriate
  explicit spec or planning stage.
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
