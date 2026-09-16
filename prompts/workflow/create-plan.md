# Create Plan

Create one saved `plan-manifest@5` and one stable `work-status@1` only after
explicit plan invocation. For MEDIUM or HIGH, require a finalized spec. In the
same invocation, determine whether flow tracing is required and reuse or create
the required pair before activating the plan and status together.

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
`<work-item>-r<N+1>` from the predecessor's lineage. Reject a predecessor
without `plan-manifest@5` and complete lineage. Reject a supplied name
for a replan, a non-AUTO initial name, unsafe or inconsistent lineage, a name
or archive collision, and more than one active plan for the same work item.

The resolved plan name determines the active plan filename and new
revision-specific artifact directory. Treat an omitted `Flow artifacts` value
as `AUTO`. Resolve
classification or spec from conversation only when exactly one finalized input
applies; otherwise stop for the ambiguous input.

Read `.ai/AGENTS.md`, `.ai/instructions/index.md`, the routed workflow,
reasoning, flow-trace, testing, and delivery instructions, every finalized
input, `.ai/templates/plan.template.md`, and
`.ai/templates/work-status.template.md`. When tracing is required, apply
`.ai/prompts/workflow/generate-flow-artifacts.md`. Inspect repository ownership,
contracts, validation, Git roots, and integration bases.

## Preconditions

- LOW has no spec. MEDIUM/HIGH requires one readable `feature-spec@1` or
  `bugfix-spec@1` whose `Open Decisions` is exactly `None`.
- Treat every finalized spec path as immutable. For a replan, compare the
  supplied spec with the predecessor plan's spec. Reuse the exact predecessor
  path only when the complete finalized spec remains authoritative without any
  content change. Require a different readable finalized spec path when any
  content changed, including evidence, root-cause analysis, or other context
  changes that preserve desired behavior. Never overwrite or edit the
  predecessor's spec; each plan revision must retain the exact spec path it was
  created from.
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
- If any supplied plan, status, review, or worktree report belongs to an older
  contract, return exactly: `Legacy workflow artifact: <path> uses <format>;
replan using the current contract before execution or resume.` Do not migrate,
  overwrite, or delete it.

## Planning Contract

Use both templates. Prepare the plan at `.ai/tmp/<plan-name>.md` and status at
`.ai/tmp/<work-item>.work-status.md`, then activate them together. The stable
status destination is `.ai/artifacts/<work-item>/work-status.md` for every plan
revision.

- Populate `## Plan Lineage` on every newly generated plan. For an initial
  plan, record its stable name, revision `1`, no predecessor, and no archived
  revisions. For a replan, preserve the predecessor's work-item name, increment
  its revision by exactly one, record the immediate archive destination, and
  copy the complete ordered archive history followed by that destination.

- Give every task one stable identifier beginning at `T-001`. Use task
  headings from the plan template for LOW, MEDIUM, and HIGH. During a replan,
  preserve an ID when its outcome remains the same, even when changed behavior
  reopens it. Supersede a materially replaced outcome and assign each new
  outcome the next never-used identifier. Never renumber or reuse IDs.
- Link exactly one stable work-status path from `## Work Tracking`. The plan
  describes current implementation scope; it never copies live progress.

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
- Before saving, run a complexity-proportionality audit. Map every new
  persistent store, coordinator, scheduler, cryptographic layer, dependency,
  external service, abstraction, and recurring validation gate to an exact
  request/spec criterion and concrete current risk. Use the simplest existing
  repository mechanism that fully satisfies that contract, collapse redundant
  tasks and evidence runs, and never activate a saved architectural fallback
  before its trigger occurs.
- Omit a mechanism or check that has no exact behavioral or evidentiary basis.
  If the finalized spec explicitly requires the complexity, preserve it and do
  not silently weaken its guarantee; simplifying that guarantee requires a new
  specification decision. A preferred alternative architecture or
  hypothetical future hardening is not plan scope.
- Before saving, trace every acceptance criterion to its implementation owner,
  task or unchanged inspected boundary, and validation evidence. Record the
  criterion references on the applicable task and plan validation entries.
  Stop when any criterion lacks owned work or evidence; preserving a boundary
  does not count unless its effective behavior was inspected.
- An environment-dependent acceptance criterion cannot be optional or
  deferred. Carry the spec's local, staging, and production matrix into task
  ownership, configuration sources, and required validation. Require the
  project's explicit environment selector; never substitute a
  framework-specific debug, release, runtime, or build-mode flag or a
  hard-coded fallback. If a required environment value or behavior was
  unresolved in the finalized spec, stop and route the content change through
  specification.
- For an environment-specific URL, name its configuration source and owning
  build or deployment boundary, require fail-fast behavior for a missing or
  invalid selected value, preserve the specified browser fallback, and test
  that no environment can generate a link for another environment.
- Keep LOW plans compact: minimum scope, ownership, steps, and validation. Use
  the full sensitive-boundary detail only when planning identifies and names a
  sensitive boundary; record its deterministic trigger and targeted checks.
- Populate `review-strategy@2`. For a named sensitive boundary, group failed
  invariants into root-cause families, select applicable adversarial variants,
  choose mutation/property coverage, and save a specific architectural
  fallback. Otherwise omit `### Sensitive Boundary Detail`.
- Make review checks proportionate to realistic changed-boundary risk. The
  strategy must tell reviewers to seek concrete defects and the smallest
  sufficient correction, not to introduce new controls, acceptance criteria,
  or architecture merely because stronger hardening is conceivable.
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
  - `2` for every MEDIUM plan and ordinary HIGH plan;
  - `3` for HIGH work involving multiple repositories, authentication or
    authorization, payments, secrets, migrations, destructive behavior, or an
    external security boundary.
    LOW records `N/A: LOW uses self-check`.
- Every HIGH task declares owned paths, exact validation, commit purpose, and a
  deterministic delegation decision. Use `REQUIRED` for a scout when
  evidence spans three or more source areas, a builder for implementation fully
  isolated from other tasks, and a reviewer for a sensitive boundary. Never use
  `OPTIONAL`.
- Refer to the corrective-deviation table in `.ai/AGENTS.md`; do not copy its
  criteria into the plan.
- Select required validation through `shared/testing.md`. For every validation
  entry, label it `Required` or `Optional`, cite the acceptance criteria or
  plan-only invariant it proves, and state the observable invariant and
  expected result before saving its exact command or bounded manual check.
  Name the selected venue—focused local, existing compatible development
  runtime, shared development or staging, fresh build, release pipeline, or a
  more specific project-defined venue—and record why it is the least costly
  option that provides sufficient evidence.
  Verify that the check can feasibly exercise that condition in the declared
  repository and prepared environment after accounting for relevant
  environment and configuration sources. `External evidence` must likewise be
  labeled `Required` or `Optional`; optional evidence may not prove a spec
  acceptance criterion or completion invariant. Make a
  broader repository-wide command a required completion gate only when its
  distinct risk is not covered by focused validation, and record that risk in
  the plan.
- Before requiring a fresh mobile application build, verify whether focused
  checks plus a compatible installed development client or matching
  development/staging environment prove the same invariant. Require the fresh
  build only for a named native, packaged-configuration, runtime-compatibility,
  or release-boundary risk, and record why the cheaper venue is insufficient.
  A deployed environment must not substitute for compilation or packaged
  configuration evidence, and a successful build must not substitute for
  effective deployed configuration or external-service evidence.
- Recommend the selected least-cost sufficient venue in the final response.
  Do not ask for generic validation approval. Stop for a venue decision only
  when the alternatives materially change evidence or residual risk and the
  request or finalized spec does not resolve the choice. When a shared venue
  requires a new deployment, credential use, privileged action, or shared-data
  mutation, identify that operator dependency in the plan before execution.
- Write the completion condition so every required validation and required
  external-evidence item must pass. Unavailable required evidence is an
  execution blocker, never a permitted completion-time deferral.
- Required external evidence that is missing makes execution `Blocked`.
- Create no workflow runner, transition state, detailed event log, preview, or
  sidecar authority. `work-status@1` is the sole permitted progress snapshot
  and never authorizes execution.

## Work Status Contract

For an initial plan, create status with the complete current goal, current spec
or LOW request, candidate active-plan path, all tasks as `not started`, no
completed or changed tasks, revision-log entry `1`, current blocker
`Awaiting explicit execution invocation`, and the classification-specific exact
next action.

For a replan, require the predecessor's stable status to be readable and valid.
Reconcile every predecessor task exactly once:

- carry `complete` only when its outcome, dependencies, acceptance criteria,
  and validation evidence remain valid;
- keep unchanged unfinished work in its current non-complete state;
- keep the same ID and mark `reopened` when an existing outcome is affected;
- move removed or materially replaced outcomes to `## Changed or Removed
Tasks`, with replacement IDs and reason when applicable; and
- add new outcomes with the next never-used IDs and state `not started`.

Candidate status must contain exactly the candidate plan's current task IDs in
plan order, retain changed-or-removed history, append one concise revision-log
entry, link the candidate plan and exact current spec, recompute its progress
summary, reset revision-specific review status, fingerprints, rounds, findings,
and remediation evidence to their unstarted values under the candidate's saved
budget, and set one exact next action. Progress-only updates never invoke
planning or create a plan revision.

## Plan Activation

Finish and validate the candidate plan, candidate status, and new artifacts
before changing the active plan set. For a replan, confirm the predecessor's
referenced finalized spec and stable status remain readable. Reuse flow
artifacts only when complete and consistent with the current spec; otherwise
create the pair under the successor artifact directory. MEDIUM review evidence
remains revision-specific. HIGH task and commit evidence remains in stable work
status and is reconciled to the successor.

Activate every plan only through `.ai/scripts/workflow/activate-plan.mjs`. The
helper validates exact plan/status links and task-ID equality. For a replan it
also archives the predecessor. Activation is rollback-protected: never expose
a plan without matching status, overwrite an archive, or leave a predecessor
inactive after failure. Preserve diagnostic candidates and return the exact
blocker and retry action.

For an initial plan, invoke:

```text
node .ai/scripts/workflow/activate-plan.mjs --candidate-plan .ai/tmp/<plan-name>.md --candidate-status .ai/tmp/<work-item>.work-status.md
```

For a replan, invoke:

```text
node .ai/scripts/workflow/activate-plan.mjs --predecessor .ai/plans/<predecessor-plan-name>.md --candidate-plan .ai/tmp/<successor-plan-name>.md --candidate-status .ai/tmp/<work-item>.work-status.md
```

## Status Initialization

For HIGH, include current repository state, ordered tasks as not started, no
validation or review rounds, `Awaiting explicit /goal invocation` as the
blocker, and this next action:

```text
/goal Complete the active HIGH workflow plan for work item `<work-item>` according to its linked finalized specification.

Work item: <work-item>
```

For LOW and MEDIUM, store the exact `execute .ai/plans/<plan-name>.md` action.
Work status stores evidence, not copied review or commit policy.

## Stage Boundary and Final Response

Saving a plan does not implement it. For a replan, archive activation also does
not implement it. Every successful response must offer the optional isolated
worktree preparation command before the direct execution command. Preparing a
worktree does not authorize or start execution; it returns a task-local command
that the user must invoke explicitly.

For HIGH return exactly:

````text
Plan saved to .ai/plans/<plan-name>.md [<classification>]
Work status: .ai/artifacts/<work-item>/work-status.md

Validation recommendation: <least-cost sufficient venue summary; name every required fresh build and why a cheaper compatible development or staging venue is insufficient; name any operator dependency>

Do this next: choose one.

Prepare an isolated worktree:
```text
run .ai/prompts/utilities/prepare-worktree.md, plan: .ai/plans/<plan-name>.md
```

Execute in the current checkout:
```text
/goal Complete the active HIGH workflow plan for work item `<work-item>` according to its linked finalized specification.

Work item: <work-item>
```
````

For LOW or MEDIUM return exactly:

````text
Plan saved to .ai/plans/<plan-name>.md [<classification>]
Work status: .ai/artifacts/<work-item>/work-status.md

Validation recommendation: <least-cost sufficient venue summary; name every required fresh build and why a cheaper compatible development or staging venue is insufficient; name any operator dependency>

Do this next: choose one.

Prepare an isolated worktree:
```text
run .ai/prompts/utilities/prepare-worktree.md, plan: .ai/plans/<plan-name>.md
```

Execute in the current checkout:
```text
execute .ai/plans/<plan-name>.md
```
````
