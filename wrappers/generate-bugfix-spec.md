# Generate Bugfix Spec Wrapper

Use .ai/prompts/generate-spec.md.

Bugfix: <bug name>

Objective:
Create a specification file only.

Strict Constraints:
- Do not edit, modify, or delete any part of the codebase.
- Do not propose or apply code changes.
- Do not create a plan.
- Limit output strictly to the spec creation process.

Source Material:
- You may inspect the codebase to confirm current behavior, affected files, routes, tests, logs, and reproduction facts.
- You may inspect `.ai/instructions/*` when relevant.
- Exclude `.ai/artifacts` from broad searches unless reading current-plan runner evidence.
- Do not infer desired behavior from the codebase.
- Expected behavior must come from the user-provided details below.
- If expected behavior, edge cases, constraints, or acceptance criteria are unclear, STOP and ask.

Details:
<details>

Current Behavior:
<what is happening>

Expected Behavior:
<what should happen>

Reproduction:
<steps, input, route, logs, or error>

Constraints:
<what must not change>

Known Decisions:
- <explicit rule already decided>
- <explicit constraint already decided>

Unknowns:
- Treat anything not listed in Expected Behavior, Constraints, or Known Decisions as unknown.
- Ask clarifying questions before finalizing the spec if any unknown affects behavior, edge cases, or acceptance criteria.

Process Requirements:
- Confirm the bug is described as current behavior vs expected behavior.
- Define exact IF/THEN behavior for the fix.
- Define edge cases and failure behavior.
- Define acceptance criteria.
- Ask clarifying questions only for missing behavior decisions, not for facts that can be inspected from the repo.

Output:
Save the finalized spec to:
.ai/specs/<bug-name>.spec.md
