# Plan Progress

Run only when the user explicitly invokes:

`run plan-progress <plan-file>`

Report committed progress read-only. Do not edit, stage, discard, commit, push,
or create files.

Read `.ai/AGENTS.md` before inspecting the saved plan.

## Repository and Base Authority

1. Read and validate `plan-manifest@2`.
2. Read every `## Repositories` entry. For each stable repository ID, resolve
   its declared `Root` and declared `Integration base` exactly.
3. Stop when a root is not a Git repository, a base ref does not resolve, an
   implementation step names an undeclared repository, or HIGH task ownership
   is not exactly one repository.
4. Never infer a repository from the current working directory and never try an
   undeclared fallback base. Only the plan-declared ref is authoritative.
5. In each declared repository, inspect current branch/status and commits
   reachable after its declared integration base.

## Commit Matching

- Match commits from actual changed paths and diffs against each step/task's
  declared repository, owned paths, behavior, and dependencies. A subject alone
  is insufficient.
- Exclude unrelated commits, validation-only bookkeeping, and uncommitted work.
- LOW/MEDIUM is complete only when matching commits across all declared
  repositories cover the full plan scope.
- A HIGH task is complete only when matching task-scoped commit evidence in its
  single declared repository covers its work. Follow-up fixes support that task
  but do not count as another task.
- Stop rather than guessing when ownership or matching evidence is ambiguous.

## Completion Calculation

The saved plan contributes 10 percentage points. Matching committed work
contributes the remaining 90.

- LOW/MEDIUM: 10% until the full committed scope across every declared
  repository is covered, then 100%.
- HIGH: add an equal share of 90% for each completed task and round to the
  nearest whole percentage.

## Final Response

When work matches, return only:

```text
<type>(<scope>): <short imperative summary>

completion: <percentage>% (<completed>/<total> implementation tasks; plan: 10%)

repositories:
--<repository-id>: <base ref>; <matching commit evidence>

summary format:
<specific non-technical headline>
--<specific committed outcome and effect>
```

For LOW/MEDIUM replace the task ratio with `committed plan scope`.

When no implementation commit matches, return only:

```text
completion: 10% (plan: 10%; no committed implementation work)

No commit message or summary is available until plan work is committed.
```

When evidence is incomplete, return only the reason and exact evidence needed.
