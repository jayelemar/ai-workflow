# Create Plan Wrapper

Use: .ai/prompts/create-plan.md

Spec file:
<repo-relative path>.spec.md

Default:
.ai/specs/<feature-or-bug-name>.spec.md

User-journey artifact for user-facing work:
.ai/artifacts/<feature-or-bug-name>/user-journey.md

For non-user-facing work:
Record `N/A: <concrete reason>` for the user journey entry in `## Artifacts` and in `.ai/artifacts/<feature-or-bug-name>/implementation-map.md`.

Objective:
Create any missing planning prerequisite artifact, then create the implementation plan.

`create-plan` now auto-preflights user-facing planning artifacts and task boundaries before it returns a draft:

- `user-journey.md`
- `implementation-map.md`
- savepoint validity
- spec-required behavior ownership

Strict Constraints:
- You are only allowed to create or update planning artifacts for this feature or bug:
  - `.ai/artifacts/<feature-or-bug-name>/user-journey.md`
  - `.ai/artifacts/<feature-or-bug-name>/implementation-map.md`
  - `.ai/artifacts/<feature-or-bug-name>/state/files.json`
  - `.ai/artifacts/<feature-or-bug-name>/state/workflow.json`
  - `.ai/artifacts/<feature-or-bug-name>/state/file-ownership.json`
  - `.ai/artifacts/<feature-or-bug-name>/state/context.md`
  - `.ai/artifacts/<feature-or-bug-name>/events/`
  - `.ai/plans/<feature-or-bug-name>.md`
- Do not edit, modify, or delete application code, tests, routes, configs, migrations, or generated files.
- Do not apply code changes.
- Do not generate diffs or patches.
- Do not execute the plan.
- Planning may describe intended code/test changes, but must not perform them.
- Limit output strictly to the plan creation process.

Required Behavior:
- Read `.codex/AGENTS.md`.
- Read `.ai/instructions/index.md` and use it as the repository instruction routing entrypoint.
- Read `.ai/instructions/shared/workflow-state.md`.
- Read the relevant instruction files selected by `.ai/instructions/index.md`.
- Read `.ai/templates/plan.template.md`.
- Read the spec file.
- For user-facing work, ensure `.ai/artifacts/<feature-or-bug-name>/user-journey.md` exists before planning.
- If user-facing work is missing `user-journey.md`, automatically create it first by applying `.ai/prompts/generate-user-flow.md` to the same spec and observed codebase paths, then continue plan creation.
- For user-facing work, derive or repair `.ai/artifacts/<feature-or-bug-name>/implementation-map.md` from every user-flow and acceptance-scenario action before finalizing plan phases.
- Exclude `.ai/artifacts` from broad searches unless reading current-plan runner evidence.
- Use the spec as the single source of truth.
- Use the user-journey artifact to map every user action to implementation and validation paths.
- Do not introduce behavior outside the spec.
- If the work is user-facing and the user-journey artifact is incomplete or inconsistent with the spec, automatically regenerate it first by applying `.ai/prompts/generate-user-flow.md`, then continue plan creation.
- For user-facing work, self-check that each savepoint can pass/review/commit independently, that no lifecycle-only or red-test-only savepoints remain, and that each spec-required behavior is assigned to a concrete task.
- Auto-correct missing implementation-map coverage, bad savepoints, and under-scoped behavior ownership before returning the draft.
- STOP only when the spec is incomplete, vague, ambiguous, or when preflight still cannot satisfy the user-journey, implementation-map, savepoint, or behavior-ownership rules.
- If the spec is incomplete, vague, or ambiguous, STOP and list the missing decisions instead of creating a plan.
- Follow the plan template exactly.
- Save the plan to `.ai/plans/<feature-or-bug-name>.md`.
- Create every artifact listed in the plan template's `## Artifacts` section before returning, including `state/context.md` and the `events/` directory.

Initial Plan State:
- `## Status` must be `draft`.
- `## Next Action` must be `plan-validator`.
- `.ai/artifacts/<feature-or-bug-name>/state/workflow.json` must use `status: "draft"` and `nextAction: "plan-validator"`.
- `.ai/artifacts/<feature-or-bug-name>/state/context.md` must exist with an initial snapshot that names the plan path, spec path, artifact paths, status, next action, and notes that no validation/execution/review events exist yet.
- `.ai/artifacts/<feature-or-bug-name>/events/` must exist even when it is empty.

Final Output:
Return only:

Plan saved to .ai/plans/<feature-or-bug-name>.md
