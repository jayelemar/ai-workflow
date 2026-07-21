# Create Plan Wrapper

Use: .ai/prompts/create-plan.md

Spec file:
<repo-relative path>.spec.md

Default:
.ai/specs/<feature-or-bug-name>.spec.md

Execution mode:
`manual` or `runner-managed`

Mode selection:
Mandatory. If the operator did not explicitly choose `manual` or
`runner-managed`, ask which execution mode to use and stop before creating or
modifying any files.

User-journey artifact for flow-trace-required work:
.ai/artifacts/<feature-or-bug-name>/user-journey.md

For non-user-facing or narrow flow-trace-not-required work:
Record `N/A: <concrete reason>` for the user journey entry in `## Artifacts`
and in `.ai/artifacts/<feature-or-bug-name>/implementation-map.md`.

Objective:
Create any missing planning prerequisite artifact, then create the implementation plan.

Protected branch guard:
Before resolving execution mode or reading any planning input, run
`git rev-parse --abbrev-ref HEAD`. STOP without reading or changing files when
branch lookup fails, or when branch is exactly `main`, `master`, `dev`,
`development`, or `staging`. State `plan creation blocked on protected branch
<branch>`. Detached `HEAD` and other branches may continue.

`create-plan` now auto-preflights flow-trace artifacts and task boundaries
before it returns a draft when the scope actually needs them:

- `user-journey.md`
- `implementation-map.md`
- savepoint validity
- spec-required behavior ownership

If execution mode is `runner-managed`, the workflow runner performs the
`sync-plan-artifacts` stage before validation. That stage reconciles the plan,
spec, user-journey artifact, implementation map, and thin-plan-v2 state before
handing off to `plan-validator`.

If execution mode is `manual`, create the plan and planning artifacts only, and
do not create runner-only workflow state just to continue execution.

For either execution mode, after saving the plan, append:
`pnpm exec tsx .ai/scripts/workflow/telemetry/manual-token-usage.ts --plan <feature-or-bug-name> --stage plan`

Strict Constraints:
- For `manual` mode, you are only allowed to create or update:
  - `.ai/artifacts/<feature-or-bug-name>/user-journey.md`
  - `.ai/artifacts/<feature-or-bug-name>/implementation-map.md`
  - `.ai/artifacts/<feature-or-bug-name>/manual-handoff.md`
  - `.ai/plans/<feature-or-bug-name>.md`
- For `runner-managed` mode, you are only allowed to create or update:
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
- Resolve execution mode before reading the spec, creating planning artifacts,
  or writing the plan.
- If execution mode is missing, STOP and ask:
  `Which execution mode should create-plan use: manual or runner-managed?`
- Read `.codex/AGENTS.md`.
- Read `.ai/instructions/index.md` and use it as the repository instruction routing entrypoint.
- Read `.ai/instructions/shared/workflow-state.md` only for `runner-managed` mode.
- Read the relevant instruction files selected by `.ai/instructions/index.md`.
- Read `.ai/templates/plan.template.md`.
- Read the spec file.
- Classify whether the scope requires flow-trace artifacts before planning.
- Require `.ai/artifacts/<feature-or-bug-name>/user-journey.md` only when the
  scope needs end-to-end flow mapping.
- If required flow-trace work is missing `user-journey.md`, automatically create it first by applying `.ai/prompts/generate-user-flow.md` to the same spec and observed codebase paths, then continue plan creation.
- For flow-trace-required work, derive or repair `.ai/artifacts/<feature-or-bug-name>/implementation-map.md` from every user-flow and acceptance-scenario action before finalizing plan phases.
- Exclude `.ai/artifacts` from broad searches unless reading current-plan runner evidence.
- Use the spec as the single source of truth.
- Use the user-journey artifact to map every user action to implementation and
  validation paths only when flow-trace artifacts are required.
- Do not introduce behavior outside the spec.
- If required flow-trace work has an incomplete or inconsistent
  `user-journey.md`, automatically regenerate it first by applying
  `.ai/prompts/generate-user-flow.md`, then continue plan creation.
- For flow-trace-required work, self-check that each savepoint can
  pass/review/commit independently, that no lifecycle-only or red-test-only
  savepoints remain, and that each spec-required behavior is assigned to a
  concrete task.
- Auto-correct missing implementation-map coverage, bad savepoints, and under-scoped behavior ownership before returning the draft.
- STOP only when the spec is incomplete, vague, ambiguous, or when preflight
  still cannot satisfy the required flow-artifact, savepoint, or
  behavior-ownership rules.
- If the spec is incomplete, vague, or ambiguous, STOP and list the missing decisions instead of creating a plan.
- Follow the plan template exactly.
- Save the plan to `.ai/plans/<feature-or-bug-name>.md`.
- In `manual` mode, record runner-only artifact entries as `N/A: manual plan-bound execution` and do not create runner-only state files or event directories.
- In `manual` mode, create `.ai/artifacts/<feature-or-bug-name>/manual-handoff.md`
  at the artifact root. It must be refreshed before pausing, ending a session,
  or switching agent/provider; initialize it with no execution progress and
  manual execution after approval as the next action.
- In `runner-managed` mode, record `Manual handoff` as
  `N/A: runner-managed execution`, then create every runner-managed artifact
  listed in the plan template's `## Artifacts` section, including
  `state/context.md` and the `events/` directory.

Initial Plan State:
- In `runner-managed` mode:
  - `## Workflow State` must be `draft-artifact-sync`.
  - `.ai/artifacts/<feature-or-bug-name>/state/workflow.json` must contain
    exactly the initial thin-plan-v2 fields: `planPath`, `workflowState`,
    `latest`, `history`, `unresolvedBlockers`, and `updatedAt`.
  - Set `planPath` to `.ai/plans/<feature-or-bug-name>.md`,
    `workflowState` to `draft-artifact-sync`, `latest` to `{}`, and
    `history` and `unresolvedBlockers` to `[]`; set `updatedAt` to a current
    ISO timestamp.
  - Reread and validate `workflow.json` before returning. A file containing
    only `workflowState` is invalid and must be repaired before invoking the
    runner.
  - `.ai/artifacts/<feature-or-bug-name>/state/context.md` must exist with an initial snapshot that names the plan path, spec path, artifact paths, workflow state, and notes that no validation/execution/review events exist yet.
  - `.ai/artifacts/<feature-or-bug-name>/events/` must exist even when it is empty.
- In `manual` mode:
  - keep the plan manifest structure from the template
  - do not create runner-only state files
  - do not require `sync-plan-artifacts` before execution
- After saving either plan mode, append the plan token checkpoint.

Final Output:
Return only:

Plan saved to .ai/plans/<feature-or-bug-name>.md
