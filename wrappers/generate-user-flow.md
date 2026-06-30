# Generate User Flow Wrapper

Use: .ai/prompts/generate-user-flow.md

Spec file:
<repo-relative path>.spec.md

Default:
.ai/specs/<feature-or-bug-name>.spec.md

Output artifact:
.ai/artifacts/<feature-or-bug-name>/product-flow.md

Objective:
Create the user-flow artifact for user-facing work before plan creation.

Strict Constraints:
- You are only allowed to create or update `.ai/artifacts/<feature-or-bug-name>/product-flow.md`.
- Do not edit, modify, or delete application code, tests, routes, configs, migrations, or generated files.
- Do not create a plan.
- Do not execute a plan.
- Limit output strictly to the user-flow artifact creation process.

Required Behavior:
- Read `.codex/AGENTS.md`.
- Read `.ai/instructions/index.md` and use it as the repository instruction routing entrypoint.
- Read the relevant instruction files selected by `.ai/instructions/index.md`.
- Read the approved spec file.
- Inspect the codebase only for existing routes, components, APIs, services, state, storage effects, and tests.
- Exclude `.ai/artifacts` from broad searches except the target artifact path.
- Use the spec as the single source of desired behavior.
- Do not introduce behavior outside the spec.
- Write Markdown + Mermaid only.
- Include the required sections: Goal, Actors, Entry Points, User Flows, Mermaid Diagram, States, Failures, Acceptance Scenarios, Open Decisions.
- If the spec is incomplete, vague, ambiguous, or not user-facing, STOP and state the concrete reason instead of creating the artifact.

Final Output:
Return only:

User flow artifact saved to .ai/artifacts/<feature-or-bug-name>/product-flow.md
