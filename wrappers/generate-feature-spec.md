# Generate Feature Spec Wrapper

Use .ai/prompts/generate-spec.md.

Feature: <feature name>

Load:
.ai/prompts/superpowers.md

Use superpower skills:
analyze

Objective:
Create a specification file only.

Strict Constraints:
- Do not edit, modify, or delete any part of the codebase.
- Do not propose or apply code changes.
- Do not create a plan.
- Limit output strictly to the spec creation process.

Source Material:
- You may inspect the codebase to identify current implementation facts.
- You may inspect `.ai/instructions/*` when relevant.
- Exclude `.ai/artifacts` from broad searches unless reading current-plan runner evidence.
- Do not infer desired behavior from codebase context.
- Desired behavior must come from the user-provided details below.
- If desired behavior, edge cases, or acceptance criteria are unclear, STOP and ask.

Goal:
<write the actual intended outcome>

If unknown, write:
Unknown; ask me to define the intended outcome.

Known Behavior / Decisions:
- <explicit behavior already decided>
- <explicit rule already decided>

Unknowns:
- Treat anything not listed in Goal or Known Behavior / Decisions as unknown.
- Ask clarifying questions before finalizing the spec if any unknown affects behavior, edge cases, or acceptance criteria.

Details:
<details>

Process Requirements:
- Define expected behavior.
- Define inputs and outputs.
- Define edge cases.
- Define failure behavior.
- Define acceptance criteria.
- Convert behavior into deterministic IF/THEN rules.
- Ask clarifying questions only for missing behavior decisions, not for facts that can be inspected from the repo.

Output:
Save the finalized spec to:
.ai/specs/<feature-name>.spec.md
