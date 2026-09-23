# Workflow Usage

The `.ai` workflow uses normal Codex behavior for routine work and one living
plan when planning is useful. It has no classification stage, specification
stage, status sidecar, plan activation, or review state machine.

## At a Glance

| Work type          | Use when                                                        | Persistent workflow artifact | Review                   |
| ------------------ | --------------------------------------------------------------- | ---------------------------- | ------------------------ |
| Direct             | The outcome is bounded and understood                           | None                         | Self-review              |
| Standard planned   | Work is complex, ambiguous, cross-cutting, or lengthy           | One living plan              | Self-review              |
| Controlled planned | A named security, trust, migration, or payment boundary changes | One living plan              | Independent final review |

All three paths inspect the repository, preserve unrelated work, run sufficient
validation, and report the result. None authorizes delivery automatically.

## Direct Work

Use a normal request when the outcome is bounded and understood:

```text
Fix the duplicate receipt import. Preserve existing authorization and run the
focused receipt tests.
```

Codex inspects, implements, validates, self-reviews, and reports. It creates no
workflow artifact.

## Create One Living Plan

Use native Plan mode or explicitly request a saved plan for complex, ambiguous,
cross-cutting, or long-running work. If no path is supplied, save one kebab-case
file under `.ai/plans/`.

A living plan contains the goal, boundaries, decisions, tasks and progress,
validation, discoveries, and outcome. Update that same file during execution;
do not create companion status or review-state files.

After saving a plan, Codex must report its exact path and end its response with
a ready-to-copy `/goal` execution prompt. Creating the plan does not start its
execution automatically.

The canonical template is
[plan-template.md](../.agents/skills/change-workflow/references/plan-template.md).

## Execute With Goal Mode

Reference the living plan in a concrete goal:

```text
/goal Implement .ai/plans/<work-item>.md. Preserve its boundaries, keep the plan updated, run every required validation, and finish only when its definition of done is proven.
```

For controlled work, the generated prompt also requires the independent final
review defined by the plan before completion.

Goal-mode progress is the runtime progress indicator. Do not mirror it into
repository state.

During execution, Codex reads the plan, inspects current code and Git state,
implements the next unfinished task, updates the same plan with discoveries and
progress, validates the actual changes, and completes the plan outcome. The
plan describes the work; it does not become an execution engine or permission
token.

## Start the Next Plan

Each planned outcome gets its own living plan. Do not overwrite a completed
plan or reuse its runtime state for unrelated work.

1. Finish or stop the current Goal before starting another Goal.
2. Create a new plan file for the new outcome.
3. Restate any earlier decision that still applies; old plans do not
   automatically govern new work.
4. Start a new `/goal` that explicitly references the new plan.

Example:

```text
/goal Implement .ai/plans/next-outcome.md. Preserve its boundaries, keep the plan updated, run every required validation, and finish only when its definition of done is proven.
```

Repository instructions and current code remain available to the new Goal, but
the previous plan remains historical evidence only.

## Controlled Work

Use controlled mode only when a change affects authentication, authorization,
payments, secrets, migrations, destructive behavior, or another named security
or trust boundary.

Controlled work uses the same single living plan, plus one independent final
review of an explicit Git base, commit, or uncommitted diff. Pause plan-owned
writers before review. After remediation, rerun affected validation and use a
fresh reviewer only when the reviewed boundary materially changed.

The canonical checklist is
[review-checklist.md](../.agents/skills/change-workflow/references/review-checklist.md).

## Parallel Work and Worktrees

Do not let multiple agents edit the same file. Use separate Git worktrees when
independent implementations genuinely need to run in parallel. Ordinary
single-agent work does not require a worktree.

Prepare worktrees for a living plan with the independent utility:

```text
Run .ai/prompts/utilities/prepare-worktree.md, plan: .ai/plans/<plan-name>.md
```

It creates native Git worktrees under `.worktrees/<plan-name>/`, preserves the
source checkout, and prints the exact `/goal` prompt to run afterward. It does
not execute the plan, copy secrets, create workflow state, or authorize
delivery. See [Prepare Task Worktrees](../prompts/utilities/prepare-worktree.md).

Run this preparation after creating the plan and before starting its Goal. Use
the execution prompt emitted by the preparation result because it directs
implementation to the prepared worktrees.

## Validation

Run the smallest sufficient checks that prove the requested behavior. Evidence
required by an acceptance criterion cannot be deferred. If an optional external
or environment-dependent check is unavailable, report the unverified behavior,
risk, reason, and smallest follow-up check.

## Delivery

Implementation does not authorize committing, pushing, opening a pull request,
deploying, releasing, or mutating shared external state. Request those actions
explicitly when needed.

Independent utilities remain available for commit organization and pull-request
preparation after explicit invocation.

## Legacy Records

Old ignored specs, plans, statuses, reviews, and other records cannot authorize
new execution. Preserve them unless the user explicitly requests cleanup.
