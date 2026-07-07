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

Commit 1
--Completed item 1.
--Completed item 2.

Commit 2
--Completed item 3.
```

Rules:

* Use the plan name as the feature name, rewritten in simple title case.
* Keep exactly one header line.
* Use `Commit N` group labels for completed task savepoints in completion order.
* Use two hyphens before each completed item.
* Include only completed work.
* Include every meaningful completed item. There is no maximum bullet count.
* Preserve existing completed commit groups when refreshing the file.
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
* validation
* fix-plan work
* implementation
* review
* final validation

Use the plan status, next action, completed workflow stages, completed tasks,
and remaining workflow stages to estimate progress.

Stage ranges:

* Spec / Requirements: 1-5%
* Plan Drafting: 5-10%
* Artifact Creation / Syncing: 8-15%
* Plan Validation / Fix Plan: 10-20%
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

Avoid:

* tests
* files
* commit hashes
* blockers
* implementation details
* workflow counters
* internal stage names

Mention those only when they are important to business status.

---

## Status Interpretation

Use these mappings when estimating progress:

* `draft + sync-plan-artifacts`: artifact creation or syncing range
* `draft + plan-validator`: plan validation range
* `draft + fix-plan`: plan validation / fix-plan range
* `approved` before execution starts: approved / ready range
* `active` with the first task in progress: implementation started range
* `active` with some completed tasks: implementation in progress range
* `review`: review / cleanup range
* `completed + commit-summary`: final validation / ready to ship range
* `completed` with no required next action: 100%

When status and next action conflict, choose the lower credible percentage and
base bullets only on completed work.

---

## Existing Boss Summary Handling

If `.ai/artifacts/<plan-name>/boss-summary.md` already exists:

* preserve completed `Commit N` groups that still correspond to completed task
  savepoints.
* rewrite the single header with the latest percentage.
* append any missing completed task groups.
* do not duplicate the header.
* do not duplicate an existing `Commit N` group.

If the file does not exist, create it.

---

## Example

Input:

`.ai/plans/market-research-competitive-gap-upgrade.md`

Output:

```text
Market Research Competitive Gap Upgrade (12%)

Commit 1
--Prepared the upgrade plan for stronger competitor research.
--Mapped the main areas for safer market evidence.
--Refined the plan before feature work begins.
```
