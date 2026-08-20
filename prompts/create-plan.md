# Create Plan

Create one saved `plan-manifest@2`. This stage runs only when the
user explicitly invokes plan creation after read-only intake and, for MEDIUM or
HIGH, after the required spec is finalized. The same invocation determines
whether flow tracing is required, reuses a complete flow-artifact pair when
available, or creates the missing pair before saving the plan.

## Input

```text
Classification: LOW | MEDIUM | HIGH | resolve from current finalized context
Spec: .ai/specs/<name>.spec.md | N/A: LOW | resolve from current finalized context
Flow artifacts: .ai/artifacts/<name>/ | AUTO | N/A: <concrete reason>
```

Treat an omitted `Flow artifacts` value as `AUTO`. Classification and spec may
be resolved from explicit conversation context only when exactly one finalized
input is applicable; otherwise stop for the ambiguous input. Use the finalized
spec name as the plan and artifact name unless the user supplies a different
plan name.

Read `.ai/AGENTS.md`, `.ai/instructions/index.md`, the routed workflow,
reasoning, flow-trace, testing, and delivery instructions, plus every finalized
input. When flow tracing is required, also read and apply
`.ai/prompts/generate-flow-artifacts.md`. Inspect repository facts needed for
concrete ownership, contracts, dependencies, validation, Git roots, and
integration bases.

## Preconditions

- LOW uses classifier evidence and does not create a spec.
- MEDIUM/HIGH requires one readable `feature-spec@1` or `bugfix-spec@1` with
  `Open Decisions` equal to `None`.
- Classify flow-tracing need using
  `.ai/instructions/shared/flow-trace-artifacts.md`. IF tracing is required and
  a complete `user-journey@1` plus `implementation-map@1` pair already exists,
  THEN reuse it. IF either required artifact is missing, THEN create or complete
  the pair at `.ai/artifacts/<name>/` with the canonical flow-artifact prompt,
  preserve any valid existing counterpart, and validate both before saving the
  plan. Stop instead of overwriting an existing artifact that is malformed or
  conflicts with the finalized spec.
- IF tracing is not required, THEN record the same concrete `N/A` reason for
  both flow artifacts in the plan. An explicit `N/A` that conflicts with a
  tracing requirement is unresolved input and must stop planning.
- Stop for missing desired behavior, unresolved decisions, or an integration
  base that cannot be identified. Do not infer or silently default it.

## Planning Contract

Use `.ai/templates/plan.template.md` exactly and save:

`.ai/plans/<plan-name>.md`

- Save every required flow artifact before the plan and list its exact path in
  `## Artifacts`. Do not create application changes, workflow state, or
  execution output while producing these planning artifacts.
- Declare every Git repository by stable ID, explicit root, and explicit
  integration-base ref. A repository root must be relative to the plan
  workspace and resolve to a primary Git worktree. Roots inside the plan
  workspace are valid. An outside root is valid only for a plan with two or
  more repositories, only when it is an explicitly declared immediate sibling
  of the plan workspace with the same real parent, and only as a source for the
  coordination-root layout used by `prepare-worktree.md`. Reject absolute
  roots, symlink escapes, ancestor traversal, duplicate or overlapping Git
  roots, and all other outside paths while planning rather than deferring the
  incompatibility to worktree preparation.
- Do not use a hard-coded base candidate order. Save the base established by
  repository evidence or supplied by the user.
- Reconcile desired behavior with current ownership, public/internal contracts,
  framework conventions, data and service boundaries, and exact validation.
- Do not add behavior beyond the finalized spec or LOW request.
- LOW plans stay compact. MEDIUM/HIGH plans include sufficient ownership and
  validation to execute without new behavior decisions.
- A cross-repository outcome must be represented by dependent steps. For HIGH,
  each task declares exactly one repository ID; split any cross-repository task
  into dependent tasks before saving.
- Every HIGH task declares owned files, exact validation, commit purpose, and a
  deterministic delegation decision of `REQUIRED` or `NONE`. Never use
  `OPTIONAL` or defer the decision to execution.
- Use `REQUIRED` for every applicable rule: independent evidence across three
  or more source areas requires an `investigator`; implementation isolated
  from every other task with no shared file ownership requires a `builder`;
  authentication, authorization, payments, secrets, migrations, destructive
  behavior, or external security boundaries require a `reviewer`.
- Create no workflow state, sidecar, event log, preview, validator artifact, or
  progress record.

## HIGH Handoff

For HIGH only, create `.ai/artifacts/<plan-name>/goal-handoff.md` using
`.ai/prompts/goal-checkpoint.md`. Link the finalized spec and saved plan, record
the current repository state and `No implementation started`. Use the plan name
as `Goal name` and copy the finalized spec's `## Goal` text verbatim as `Exact
goal`. Use `Awaiting explicit /goal invocation` as the only blocker, and name
the following two-line invocation as the next action:

```text
/goal <exact-goal>

plan: <plan-file>
```

Use the checkpoint content and unchanged HIGH commit protocol, then return to
this prompt. Do not create a handoff for LOW or MEDIUM.

## Stage Boundary

Saving a plan does not implement it. The next stage must be explicitly invoked:

- LOW/MEDIUM: `execute .ai/plans/<plan-name>.md`
- HIGH:

  ```text
  /goal <exact-goal>

  plan: .ai/plans/<plan-name>.md
  ```

Do not add a preview, approval, or plan-validation gate.

## Final Response

For LOW or MEDIUM, return exactly:

`Plan saved to .ai/plans/<plan-name>.md [<classification>]`

For HIGH, return exactly:

```text
/goal <finalized spec `## Goal` text verbatim>

plan: .ai/plans/<plan-name>.md
```

Copy the finalized spec's `## Goal` text verbatim and use the saved plan's exact
path after the lowercase `plan:` label. Do not add a classification, summary,
explanation, Markdown fence, or any other content. Returning the invocation does
not authorize implementation.
