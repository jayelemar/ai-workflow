# Progress Update

Create or refresh the boss-friendly status artifact for a workflow plan.

This prompt updates `.ai/artifacts/<plan-name>/boss-summary.md`.

It does NOT modify code, workflow state, commits, or technical workflow
artifacts.

---

## Plan Input (MANDATORY)

.ai/plans/<plan-name>.md

If not provided:

→ output `STOP`
→ state blocking reason (`plan file is required`)
→ do not proceed

---

## Instruction Loading

Read:

* the plan file
* `.ai/artifacts/<plan-name>/state/workflow.json` when present
* `.ai/artifacts/<plan-name>/state/context.md` when present and needed
* current workflow event summaries only when the plan and workflow state do not
  provide enough status context

Do not inspect implementation files unless the plan status is ambiguous and the
workflow artifacts cannot show what has been completed.

---

## Artifact Output (MANDATORY)

Write the status update to:

`.ai/artifacts/<plan-name>/boss-summary.md`

This is the single persisted boss-facing summary file for the plan.
Do not create any other persisted boss-facing summary artifact.
Return only the file contents after writing the file.

---

## Output Format (MANDATORY)

Return only:

```text
Feature Name (percentage%)

Pre-Execution
--Completed plan-specific outcome 1.
--Completed plan-specific outcome 2.

Commit <short_sha>
--Completed item 1.
--Completed item 2.

Commit <short_sha>
--Completed item 3.
```

Rules:

* Use the plan name as the feature name, rewritten in simple title case.
* Keep exactly one header line.
* Include a `Pre-Execution` group when completed spec, planning, artifact sync,
  bounded validation preflight, or approval work exists before completed task commits.
* Use `Commit <short_sha>` group labels for completed task savepoints in completion order.
* Use the saved short commit SHA from the completed task savepoint, such as `Commit 2450d85`.
* Use two hyphens before each completed item.
* Include only completed work.
* Include every meaningful completed item. There is no maximum bullet count.
* If no completed task savepoint exists, omit both `Pre-Execution` and `Commit`
  group labels. List verified completed plan-specific outcomes as ungrouped
  `--` bullets immediately after the header.
* Never place completed implementation outcomes under `Pre-Execution` merely
  because a task savepoint is missing.
* Pre-execution bullets must name actual business or product outcomes from the
  specific plan, spec, artifacts, or event summaries.
* Do not use generic workflow bullets such as "created the implementation plan"
  or "validated the plan" unless the plan itself is the deliverable.
* Preserve existing completed commit groups when refreshing the file.
* Preserve the existing `Pre-Execution` group when it still reflects completed
  pre-execution work, and rewrite it only when the current plan evidence shows a
  more specific completed outcome.
* Add only missing completed commit groups when new task savepoints exist.
* Do not include headings, notes, explanations, markdown fences, or extra text.

---

## Percentage Rules

Estimate the percentage from the overall workflow stage, not only from
implemented code.

Count these as real progress:

* spec work
* planning
* artifact creation
* artifact syncing
* validation and bounded preflight repair work
* implementation
* review
* final validation

Use the plan status, next action, completed workflow stages, completed tasks,
and remaining workflow stages to estimate progress.

Stage ranges:

* Spec / Requirements: 1-5%
* Plan Drafting: 5-10%
* Artifact Creation / Syncing: 8-15%
* Plan Validation / Bounded Preflight: 10-20%
* Approved / Ready for Implementation: 20-25%
* Implementation Started: 25-40%
* Implementation In Progress: 40-75%
* Implementation Complete: 75-85%
* Review / Cleanup: 85-95%
* Final Validation / Ready to Ship: 95-99%
* Complete: 100%

Boundaries:

* If implementation has not started, do not estimate above 25%.
* If implementation is active, estimate based on completed savepoints or tasks.
* If implementation is complete but review or final validation remains, estimate
  80-95%.
* If review and final validation are complete, use 100%.

---

## Bullet Rules

Focus on work already completed, including planning and workflow preparation.

Use:

* simple non-technical wording
* short, specific bullets
* business-facing outcomes
* plan-specific nouns and outcomes so the summary clearly belongs to the current feature

Avoid:

* tests
* files
* commit hashes inside bullet text
* blockers
* implementation details
* workflow counters
* internal stage names
* generic process-only wording that could apply to any plan

Mention those only when they are important to business status.

---

## Status Interpretation

Use these mappings when estimating progress:

* `draft + sync-plan-artifacts`: artifact creation or syncing range
* `draft + plan-validator`: plan validation range
* `approved` before execution starts: approved / ready range
* `active` with the first task in progress: implementation started range
* `active` with some completed tasks: implementation in progress range
* `review`: review / cleanup range
* `completed + commit-summary`: final validation / ready to ship range

When status and next action conflict, choose the lower credible percentage and
base bullets only on completed work.

---

## Existing Boss Summary Handling

If `.ai/artifacts/<plan-name>/boss-summary.md` already exists:

* preserve completed `Commit <short_sha>` groups that still correspond to completed task
  savepoints.
* when at least one completed task savepoint exists, preserve or refresh the
  `Pre-Execution` group so it contains only completed, plan-specific
  pre-execution outcomes.
* rewrite the single header with the latest percentage.
* append any missing completed task groups.
* do not duplicate the header.
* do not duplicate the `Pre-Execution` group.
* do not duplicate an existing `Commit <short_sha>` group.

If the file does not exist, create it.

When no completed task savepoint exists, remove any existing `Pre-Execution`
or `Commit <short_sha>` group labels and retain only verified completed outcomes
as ungrouped bullets below the header.

---

## Example

Input:

`.ai/plans/market-research-competitive-gap-upgrade.md`

Output:

```text
Market Research Competitive Gap Upgrade (12%)

Pre-Execution
--Defined how Market Research should avoid unsupported competitor claims.
--Set the evidence rules for competitor summaries, benchmarks, and confidence levels.
--Planned safer dashboard display for upgraded Market Research results.
--Reviewed and refined the plan until it was approved for execution.

Commit 2450d85
--Prepared the upgrade plan for stronger competitor research.
--Mapped the main areas for safer market evidence.
--Refined the plan before feature work begins.
```
