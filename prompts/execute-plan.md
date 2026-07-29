# Execute Plan

Run this prompt only when the user explicitly invokes:

`execute <plan-file>`

That invocation authorizes implementation from the saved plan. Read the plan,
its saved spec when required, current Git state, and only the routed
instructions that match the implementation scope.

## Preconditions

- The plan file must exist and declare `LOW` or `MEDIUM` execution.
- LOW must contain its saved compact plan. MEDIUM must link to a readable saved
  spec and plan. If either required artifact is missing, STOP and name it.
- Preserve unrelated working-tree changes.

## Execution Safeguards

- Follow the plan and spec strictly. Do not start from a preview, handoff, or
  informal approval.
- If a material new requirement, dependency, risk, or scope change appears,
  pause implementation. Update the affected spec and/or plan at the proper
  stage, reclassify upward when required, then wait for the new explicit stage
  invocation before resuming.
- Run the plan's scoped validation before declaring implementation complete.

## Completion by Classification

### LOW

Perform a concise self-check of the actual diff, plan scope, validation result,
and untouched unrelated files. Report the validation and self-check outcome.
LOW does not create a spec or independent review artifact.

### MEDIUM

After validation, automatically run `.ai/prompts/review-changes.md` against
the actual diff. Save its complete result at:

`.ai/artifacts/<plan-name>/review.md`

Use exactly one status: `Ready to complete`, `Fix required`, or `Blocked`.

- `Fix required`: make only in-scope fixes, rerun validation, then rerun and
  overwrite the automatic review evidence.
- `Blocked`: stop with the blocker and required next action in `review.md`.
- `Ready to complete`: report completion with the validation and review path.

## Final Output

Report the changed scope, validation result, and either the LOW self-check or
MEDIUM review artifact path.
