# Create Plan

Create one saved `plan-manifest@3` only after explicit plan invocation. For
MEDIUM or HIGH, require a finalized spec. In the same invocation, determine
whether flow tracing is required and reuse or create the required pair before
saving the plan.

## Input

```text
Plan name: <kebab-case-name> | AUTO
Supersedes: N/A | .ai/plans/<current-plan-name>.md
Classification: LOW | MEDIUM | HIGH | resolve from current finalized context
Spec: .ai/specs/<name>.spec.md | N/A: LOW | resolve from current finalized context
Flow artifacts: .ai/artifacts/<name>/ | AUTO | N/A: <concrete reason>
```

`Plan name` is required and `Supersedes` is required. For an initial plan, require a safe
kebab-case name and `Supersedes: N/A`; that name is both the plan name and
stable work-item name, with revision `1`. Accept `Plan name: AUTO` only with a
root-level active predecessor under `.ai/plans/`. Derive the successor as
`<work-item>-r<N+1>` from the predecessor's lineage. A predecessor without a
`## Plan Lineage` section is a compatible revision `1` whose work-item name is
its `# Plan:` name and whose archive history is empty. Reject a supplied name
for a replan, a non-AUTO initial name, unsafe or inconsistent lineage, a name
or archive collision, and more than one active plan for the same work item.

The resolved plan name determines the active plan filename and new
revision-specific artifact directory. Treat an omitted `Flow artifacts` value
as `AUTO`. Resolve
classification or spec from conversation only when exactly one finalized input
applies; otherwise stop for the ambiguous input.

Read `.ai/AGENTS.md`, `.ai/instructions/index.md`, the routed workflow,
reasoning, flow-trace, testing, and delivery instructions, and every finalized
input. When tracing is required, apply
`.ai/prompts/workflow/generate-flow-artifacts.md`. Inspect repository ownership,
contracts, validation, Git roots, and integration bases.

## Preconditions

- LOW has no spec. MEDIUM/HIGH requires one readable `feature-spec@1` or
  `bugfix-spec@1` whose `Open Decisions` is exactly `None`.
- Reapply the deterministic classifier in `.ai/prompts/workflow/select-workflow.md` to
  the planned scope. Stop if the requested class is lower than its trigger.
- Reuse a complete valid `user-journey@1` and `implementation-map@1` pair. If
  tracing is required and either is missing, create or complete the pair before
  the plan. Preserve a valid counterpart and stop rather than overwrite a
  malformed or spec-conflicting artifact.
- When tracing is unnecessary, record the same concrete `N/A` reason for both
  artifacts.
- Stop for missing desired behavior, unresolved decisions, or an unidentified
  integration base.
- Treat only root-level `.ai/plans/*.md` files as active execution authority.
  Files named `superseded-plan.md` under `.ai/artifacts/` are immutable history
  and cannot authorize execution, review, resume, or worktree preparation.
- If any supplied plan, review, handoff, or worktree report belongs to an older
  contract, return exactly: `Legacy workflow artifact: <path> uses <format>;
replan using the current contract before execution or resume.` Do not migrate,
  overwrite, or delete it.

## Planning Contract

Use `.ai/templates/plan.template.md` and save
`.ai/plans/<plan-name>.md`.

- Populate `## Plan Lineage` on every newly generated plan. For an initial
  plan, record its stable name, revision `1`, no predecessor, and no archived
  revisions. For a replan, preserve the predecessor's work-item name, increment
  its revision by exactly one, record the immediate archive destination, and
  copy the complete ordered archive history followed by that destination.

- Declare every Git repository by stable ID, explicit relative root, planned
  ownership, and evidence-backed integration base. The plan workspace may be a
  Git parent checkout or an unversioned multi-repository coordination root.
- Reject absolute roots, symlink escapes, ancestor traversal, duplicate or
  overlapping roots. For multi-repository coordination only, an explicitly
  declared immediate sibling sharing the workspace's real parent is a valid
  source root.
- State provider-to-consumer callable contracts for dependent work. Split
  cross-repository outcomes into dependent steps; each HIGH task owns exactly
  one repository.
- Do not add behavior beyond the finalized spec or LOW request.
- Keep LOW plans compact: minimum scope, ownership, steps, and validation. Use
  the full sensitive-boundary detail only when planning identifies and names a
  sensitive boundary; record its deterministic trigger and targeted checks.
- Populate `review-strategy@2`. For a named sensitive boundary, group failed
  invariants into root-cause families, select applicable adversarial variants,
  choose mutation/property coverage, and save a specific architectural
  fallback. Otherwise omit `### Sensitive Boundary Detail`.
- Treat asynchronous UI state with multiple independent writers—such as query
  lifecycle, deep-link or router input, local user actions, timers, or
  gestures—as a repeated-family risk even in a LOW plan. Record the writer
  precedence and invariant in Scope or Implementation, target their ordering
  transitions in validation, and save a concrete architectural fallback such
  as a single reducer, state arbiter, or owning hook. Do not use `N/A` merely
  because LOW formal execution uses self-check; `N/A` is allowed only when no
  named sensitive boundary or asynchronous multi-writer state surface exists,
  and it must give that concrete reason. Include every path that fallback may
  create or change in planned ownership so any required replan has an explicit,
  reviewable starting boundary.
- Save exactly one automatic fresh-review budget for MEDIUM/HIGH:
  - `1` for single-repository MEDIUM work with no sensitive surface and no
    cross-boundary contract;
  - `2` for every other MEDIUM plan and ordinary HIGH plan;
  - `3` for HIGH work involving multiple repositories, authentication or
    authorization, payments, secrets, migrations, destructive behavior, or an
    external security boundary.
    LOW records `N/A: LOW uses self-check`.
- Every HIGH task declares owned paths, exact validation, commit purpose, and a
  deterministic delegation decision. Use `REQUIRED` for an investigator when
  evidence spans three or more source areas, a builder for implementation fully
  isolated from other tasks, and a reviewer for a sensitive boundary. Never use
  `OPTIONAL`.
- Refer to the corrective-deviation table in `.ai/AGENTS.md`; do not copy its
  criteria into the plan.
- Create no workflow state, sidecar, event log, preview, or progress record.

## Replan Activation

For a replan, finish and validate the successor plan in `.ai/tmp/` and any new
artifacts at their declared revision-specific paths before changing the active
plan set. Reuse the predecessor's declared flow-artifact pair only when it
remains complete and consistent with the current finalized spec; otherwise
create the required pair under the successor artifact directory. MEDIUM review
evidence and HIGH handoff evidence are always revision-specific and never
reused. Create an initial HIGH handoff from the validated candidate through the
candidate exception in `.ai/prompts/workflow/goal-checkpoint.md`; it remains
non-authoritative until activation succeeds.

Activate the replan only through
`.ai/scripts/workflow/activate-replan.mjs`, following the workspace's required
command wrapper. The helper must move the predecessor to
`.ai/artifacts/<predecessor-plan-name>/superseded-plan.md` and move the validated
candidate into `.ai/plans/<successor-plan-name>.md` as one rollback-protected
operation. Never overwrite an archive or active plan. If activation fails,
leave the predecessor active, expose no partial successor in `.ai/plans/`,
preserve diagnostic artifacts, and return the exact blocker and retry action.
Invoke it with exactly these resolved paths:

```text
node .ai/scripts/workflow/activate-replan.mjs --predecessor .ai/plans/<predecessor-plan-name>.md --candidate .ai/tmp/<successor-plan-name>.md
```

## HIGH Handoff

For HIGH, initialize `.ai/artifacts/<plan-name>/goal-handoff.md` as
`goal-handoff@2` through `.ai/prompts/workflow/goal-checkpoint.md`. Record current
repository state, ordered tasks as not started, no validation or review rounds,
`Awaiting explicit /goal invocation` as the blocker, and this next action:

```text
/goal <exact finalized-spec goal>

plan: .ai/plans/<plan-name>.md
```

The handoff stores evidence, not copied review or commit policy.

## Stage Boundary and Final Response

Saving a plan does not implement it. For a replan, archive activation also does
not implement it. LOW/MEDIUM next uses
`execute .ai/plans/<plan-name>.md`. HIGH returns exactly:

```text
/goal <finalized spec `## Goal` text verbatim>

plan: .ai/plans/<plan-name>.md
```

For LOW/MEDIUM return exactly:

`Plan saved to .ai/plans/<plan-name>.md [<classification>]`
