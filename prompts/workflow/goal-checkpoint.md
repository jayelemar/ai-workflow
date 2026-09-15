# Goal Checkpoint

Refresh the stable evidence snapshot for a HIGH work item. Read
`.ai/AGENTS.md`, the active `plan-manifest@5`, its linked finalized artifacts,
the existing `work-status@1`, and repository state before writing.

## Input

- Work item: `<stable-kebab-case-work-item>`

Reject a missing or invalid work item. Resolve exactly one root-level active
plan whose `## Plan Lineage` names that work item. Require its linked status at
`.ai/artifacts/<work-item>/work-status.md` and its linked finalized spec. Read
the exact goal from that spec's `## Goal`; require the status goal, spec path,
and active-plan path to match the resolved artifacts. Never accept a
caller-supplied plan path or duplicate goal text as authority. Reject an older plan,
status, review, or worktree report with exactly: `Legacy workflow artifact:
<path> uses <format>; replan using the current contract before execution or
resume.` Never migrate, overwrite, or delete it.

If a former active plan was superseded, apply `## Superseded Plan Resolution`
from `.ai/instructions/shared/workflow-state.md` and stop without modifying old
evidence.

## Scope

- This action records verified progress only. It does not implement work,
  change the goal, authorize execution, or create transition state.
- Update only `.ai/artifacts/<work-item>/work-status.md` as `work-status@1`.
- Keep its current goal, spec, plan, classification, ordered task IDs, revision
  log, and changed-or-removed history consistent with the active plan.
- Inspect repository state read-only. Never store secrets, raw diffs, full
  command output, or copied policy text.
- Status records review and commit evidence but never embeds the review state
  machine or HIGH commit rules.

## HIGH Task and Commit Rules

Process planned tasks serially. Before HIGH execution, resolve every required
role from `.ai/config/agent-models.toml`; never substitute an unavailable
runtime. Before every required role's first delegation, apply `## Subagent
Identity and Session Lifecycle` from
`.ai/instructions/shared/ai-workflow.md`; pass the resolved full model and
reasoning effort explicitly. Record ordered initial spawn and continuation entries, each with subagent name, role, full model, reasoning effort, and result, plus its unchanged boundary.
Continue the same named builder for implementation and fixes within one
unchanged task, scope, and exclusive file ownership. Continue
the same named scout for follow-up research within one unchanged task,
subsystem, scope, and investigation question. A
boundary change requires a newly spawned, newly named agent; an unavailable
required in-boundary continuation is `Blocked`. Never continue a reviewer into
another review assignment.

For each task:

1. Before work, set only that task to `active`, overall status to `in progress`,
   recompute the progress summary, and save the exact resume action.
2. Implement only its single-repository scope or a correction qualifying under
   `.ai/AGENTS.md`. For material discovery, apply Material Discovery Routing
   from `.ai/instructions/shared/workflow-state.md` and record its exact
   next-stage invocation, task state `blocked`,
   and overall status `blocked` before returning.
3. Run the task's exact validation and review its actual diff, delegation
   evidence, provider-to-consumer contract, regressions, and unrelated files.
4. Stage only task-owned changes and never `.ai` artifacts.
5. Immediately before committing, inspect the current branch. On `main`,
   `dev`, `development`, or `staging`, obtain explicit operator permission.
6. Create exactly one local conventional commit with the plan's saved purpose.
   Do not start the next task until no task-owned change remains uncommitted and
   status records `complete`, its SHA, subject, validation, review, and
   delegation.

If a task has no tracked change, record that result and validation without an
empty commit. Never commit failed validation, ambiguous behavior, or unrelated
work. Never push, amend, squash, force-push, or open a pull request without an
explicit delivery request.

For a correction to an already committed task, create a separate focused
`fix(<scope>): <spec-restoring summary>` commit after all affected task checks
and fresh task review pass.

## HIGH Final-Review Commit Rules

After all task records are complete, run all plan validation and invoke only
`.ai/prompts/workflow/review-changes.md` for final-review control. When canonical
review remediation changes a repository:

- validate every affected task and plan check;
- stage only remediation paths;
- apply the protected-branch permission check above;
- create one local conventional remediation commit per changed repository; and
- record the review round, resolved findings, commands/results, SHA, and
  subject in status before the canonical review prompt advances.

Do not copy final-review transitions into this prompt or status.

Before final review or completion, trace every specification acceptance
criterion to its task or inspected unchanged boundary and evidence. Required
external evidence that is missing makes the workflow result `Blocked` and
status `blocked`. For environment-dependent
behavior, record effective non-secret configuration and result for every
required environment without storing credential-bearing URLs.

Fresh review round numbers must remain positive and strictly increase. Never
reset, infer, duplicate, reorder, or decrease them. Verify task order and
commit evidence against current repositories.

Record `Review input fingerprints` in status. Recompute every
`review-input-fingerprint@1` immediately before trusting clearance or recording
completion; mismatched evidence is stale and cannot prove completion.

## Final Output

For a material-discovery stop, return exact status and cause, then `Do this
next:` and status's exact `## Next Action`. Otherwise return only:

`Work status refreshed at .ai/artifacts/<work-item>/work-status.md`
