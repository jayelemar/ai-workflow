# Create Plan Wrapper

Use: .ai/prompts/create-plan.md

Spec file:
.ai/specs/<feature-or-bug-name>.spec.md

Objective:
Create the implementation plan file only.

Strict Constraints:
- You are only allowed to create or update the plan file at `.ai/plans/<feature-or-bug-name>.md`.
- Do not edit, modify, or delete application code, tests, routes, configs, migrations, or generated files.
- Do not apply code changes.
- Do not generate diffs or patches.
- Do not execute the plan.
- Planning may describe intended code/test changes, but must not perform them.
- Limit output strictly to the plan creation process.

Required Behavior:
- Read `.codex/AGENTS.md`.
- Read `.ai/instructions/workflow-state.instructions.md`.
- Read relevant `.ai/instructions/*`.
- Read `.ai/templates/plan.template.md`.
- Read the spec file.
- Exclude `.ai/logs` unless debugging historical runner output.
- Use the spec as the single source of truth.
- Do not introduce behavior outside the spec.
- If the spec is incomplete, vague, or ambiguous, STOP and list the missing decisions instead of creating a plan.
- Follow the plan template exactly.
- Save the plan to `.ai/plans/<feature-or-bug-name>.md`.

Initial Plan State:
- `## Status` must be `draft`.
- `## Next Action` must be `plan-validator`.

Final Output:
Return only:

Plan saved to .ai/plans/<feature-or-bug-name>.md
