# Plan Progress

Run this prompt only when the user explicitly invokes:

`run plan-progress <plan-file>`

Report committed progress for one saved plan. This is read-only: do not edit,
stage, discard, commit, push, or create any file.

## Required Inspection

1. Read the plan file. Read its linked spec when the plan declares one.
2. Determine the plan class:
   - use `## Classification` when present;
   - otherwise map `HIGH-GOAL` in `## Execution Mode` to `HIGH`;
   - otherwise treat a legacy plan containing `[task:<id>]` implementation
     entries as `HIGH`;
   - stop when the class is missing or unsupported.
3. Determine the target Git repository from paths owned by the plan:
   - use the nested `.ai` repository when all owned paths are under `.ai/`;
   - otherwise use the parent application repository;
   - stop when the plan spans repositories and task ownership cannot be
     separated reliably.
4. Inspect the target repository's current branch, working-tree status, recent
   commit subjects, and commit diffs.
5. Compare commits reachable from the current branch after its integration base
   with the plan. Use `origin/development`, `origin/main`, `development`, then
   `main` as the first available integration-base candidate. Stop if no
   integration base is available.

## Commit Matching

- Match work using the planned task or step name, declared `Files` paths, and
  the actual changed files and diff of each candidate commit. Do not rely on a
  commit subject alone.
- Count only commits that match the plan-owned implementation scope. Exclude
  unrelated commits, preparation-only checks, validation-only checklist items,
  and uncommitted changes.
- For HIGH, identify implementation tasks from `[task:<id>]` entries. For
  legacy HIGH plans without those markers, use the numbered tasks under
  `### Implementation`.
- A HIGH task is complete only when one or more matching task-scoped commits
  cover its declared implementation work. A follow-up fix may support an
  already completed task but never counts as another task.
- LOW and MEDIUM are complete only when the committed work covers their full
  declared implementation scope. If the plan does not provide enough task or
  file evidence to establish that, stop instead of guessing.

## Completion Calculation

The saved plan file contributes 10 percentage points. The remaining 90 points
come only from matching commits.

| Class | Completion rule |
| --- | --- |
| LOW | 10% when only the plan exists; 100% when the full implementation scope is committed. |
| MEDIUM | 10% when only the plan exists; 100% when the full implementation scope is committed. |
| HIGH | 10% for the saved plan plus an equal share of 90% for every completed implementation task. |

Round the displayed HIGH percentage to the nearest whole number. Include the
plan's 10% contribution in the completion line.

## Output

When at least one implementation commit matches, print only the following
plain-text structure. Do not use Markdown fences or add commentary.

```text
<type>(<scope>): <short imperative summary>

completion: <percentage>% (<completed>/<total> implementation tasks; plan: 10%)

summary format:
<specific, non-technical headline>
--<specific completed outcome and its user or operational effect>
--<specific completed outcome and its user or operational effect>
--<specific completed outcome and its user or operational effect>
```

- Use a conventional commit type and scope supported by the matching commits.
- Write the commit line and summary from committed work only. Do not describe
  planned or uncommitted work as complete.
- Make the headline state the completed capability in plain language. Use as
  many `--` lines as the plan's matched, committed scope needs to cover its
  major outcomes, such as protected behavior, user-facing flows, operational
  safeguards, and automated coverage when the matching commits support them.
  Do not impose a fixed minimum or maximum line count.
- Keep each `--` line specific and understandable to a non-technical reader.
  Include the resulting protection, constraint, or practical effect rather
  than merely naming changed files or implementation layers. Do not add filler
  outcomes just to reach the preferred detail level.
- For LOW and MEDIUM, replace the task ratio with `committed plan scope`.

When no implementation commit matches, print only:

```text
completion: 10% (plan: 10%; no committed implementation work)

No commit message or summary is available until plan work is committed.
```

When evidence is incomplete or ambiguous, print only a concise reason and the
exact evidence required. Do not infer a percentage beyond the confirmed 10%
plan contribution.
