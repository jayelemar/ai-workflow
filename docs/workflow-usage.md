# Workflow Usage

The `ai-build` skill keeps planning and execution together. The `.ai` workflow
uses normal Codex behavior for routine work and one living
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
[plan-template.md](../.agents/skills/ai-build/references/plan-template.md).

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

## Review After Implementation

The planned-work flow is:

```text
/plan -> save one living plan -> /goal -> implement and validate -> suggest /review
```

After a saved plan is successfully implemented and its required validation and
reviews are complete, the completion response reports the result and ends with
an optional manual review handoff. You run the review yourself. It is not a new
completion gate and does not replace controlled work's mandatory independent
final review.

End with one fenced text block containing the command and all review context
together. Replace the placeholders with the actual repository/worktree and
plan paths so the entire prompt can be copied and pasted in one action:

```text
/review Review the uncommitted changes in <exact-repository/worktree-path> implementing <exact-plan-path>. Check correctness, regressions, plan acceptance criteria, and validation gaps. Exclude unrelated pre-existing changes. Report actionable findings without editing files.
```

The target follows actual Git state: uncommitted changes, a specific commit,
or changes against a known base. Include both committed and uncommitted
plan-owned work when applicable, and provide one self-contained prompt per affected
repository. Do not invent `/review` flags or launch the review automatically.
Plan creation, blocked or incomplete implementation, and ordinary direct
requests do not receive this completion handoff. No review-state file is added.

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
[review-checklist.md](../.agents/skills/ai-build/references/review-checklist.md).

## Parallel Work and Worktrees

Do not let multiple agents edit the same file. Use separate Git worktrees when
independent implementations genuinely need to run in parallel. Ordinary
single-agent work does not require a worktree.

Prepare worktrees for a living plan with the independent AI Worktree Setup skill:

```text
$ai-worktree-setup plan: .ai/plans/<plan-name>.md
```

For one repository, `.worktrees/<plan-name>/` is the native Git worktree itself.
For multiple repositories, it is a coordination directory containing one native
Git worktree per `<repository-id>/`. Both layouts keep an independent workflow
clone plus selected local instructions, one selected plan, required documentation,
and `AGENTS.override.md` at the task root. Existing root `AGENTS.md` guidance is
also retained and explicitly routed. Canonical source includes all five reusable
instruction roots: `shared/`, `mobile/`, `desktop/`, `web/`, and `server/` under
`instructions/`. Selected local context includes the index, all its direct local
routes, and necessary local references, preserving nested `instructions/local/`
paths such as `local/architecture.md`. Execution still loads only applicable
guidance. Unrelated plans/records, dependencies,
caches, build outputs, and credentials are excluded; complete directory mirrors
are not the default.
Setup preserves the source checkout and prints the exact `/goal` prompt to run
afterward. It does not execute the plan, copy secrets, create workflow state, or authorize
delivery. See [AI Worktree Setup](../.agents/skills/ai-worktree-setup/SKILL.md).
Both layouts recreate the four discovery links against their independent local
`.ai` copy and preserve custom skills.

Run this preparation after creating the plan and before starting its Goal. Use
the execution prompt emitted by the preparation result because it directs
implementation to the prepared worktrees.

Select one plan for cleanup with the independent utility:

```text
Run `.ai/prompts/worktree-cleanup.md`.
plan: .ai/plans/<plan-name>.md
```

For deliberately requested bulk cleanup, replace the selector with
`all-plans: true`. This includes every discovered direct plan, including active
plans, and must be disclosed in the inventory. Without a selector, the utility
only inventories plans and shows examples, then stops without confirmation or
mutation. Conflicting or unsafe selectors stop.

Selected task worktrees and plan-owned records are inspected before the
operator types the exact uppercase response `PROCEED`; `CANCEL` stops without
mutation. Reinspection requires renewed confirmation if the inventory changes.
Unselected plans, their worktrees and records, unrelated entries, and every Git
branch are retained. Legacy `cleanup:local` excludes the entire `plans/` tree.
See
[Clean Plan Worktrees and Records](../prompts/worktree-cleanup.md).

## Validation

Run the smallest sufficient checks that prove the requested behavior. Evidence
required by an acceptance criterion cannot be deferred. If an optional external
or environment-dependent check is unavailable, report the unverified behavior,
risk, reason, and smallest follow-up check.

## Delivery

Implementation does not authorize committing, pushing, opening a pull request,
deploying, releasing, or mutating shared external state. Request those actions
explicitly when needed.

Use `$ai-commit` or a normal request to organize commits, and `$ai-pr` or a normal
request to prepare a pull request. The skills retain existing approval rules:
commit authorization does not need redundant approval; protected branches need
explicit permission, and PR publication needs approval of the exact preview.
Their former utility prompts have been removed. None automatically chains
preparation, implementation, commits, publication, and cleanup.

Explicit local setup through `setup:codex` exposes all four skills from the
project root; it is separate from implementation. See
[Codex setup](codex-agent.md) and [request examples](../README.md#skills-and-utilities).

## Legacy Records

Old ignored specs, plans, statuses, reviews, and other records cannot authorize
new execution. Preserve them unless the user explicitly requests cleanup.
