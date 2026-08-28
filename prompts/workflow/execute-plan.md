# Execute Plan

Run only when the user explicitly invokes `execute <plan-file>`. This command
authorizes implementation of one saved LOW or MEDIUM `plan-manifest@3`.

Read `.ai/AGENTS.md`, the plan, its finalized spec and flow artifacts when
declared, current Git state in every repository, and only project instructions
routed for the implementation scope.

## Preconditions

- Require the requested plan to be a root-level active `.ai/plans/*.md` file.
  If its former active path was superseded, apply `## Superseded Plan
Resolution` from `.ai/instructions/shared/workflow-state.md` and stop without
  implementation.
- Reject any older plan, review, handoff, or worktree report with exactly:
  `Legacy workflow artifact: <path> uses <format>; replan using the current
contract before execution or resume.` Do not migrate, overwrite, or delete it.
- Every declared repository root and integration-base ref must resolve.
- Validate a current `worktree-setup@1` report against the `plan-manifest@3`,
  repository mappings, branches, bases, and Git worktree registries before using
  its filesystem-target overlay. Reject a stale or legacy report.
- LOW requires its saved compact plan. MEDIUM requires its finalized typed spec.
- Declared flow artifacts must be present and complete.
- Preserve unrelated changes in every repository.

## Execution

- Follow requested behavior, finalized spec, repository ownership, and plan
  order.
- Classify discoveries only through the corrective-deviation table in
  `.ai/AGENTS.md`. Record a qualifying correction and affected evidence; stop
  for a material discovery. Its actionable planning invocation must use
  `Plan name: AUTO` and name this active plan under `Supersedes`.
- Run every required plan validation command. Defer optional external evidence
  only under `.ai/AGENTS.md` disclosure rules.

## Completion

LOW self-checks actual scope, diff, required validation, repositories, and
preserved unrelated work.

MEDIUM invokes `.ai/prompts/workflow/review-changes.md` and saves its
`implementation-review@2` result. That prompt exclusively controls review
rounds, remediation, statuses, risk decisions, and completion eligibility; do
not restate or reinterpret its transitions here.

## Final Response

Report changed scope by repository, required validation, deferred optional
checks and risk, preserved unrelated work, and the LOW self-check or exact
MEDIUM review status and required next action. Claim completion only when the
canonical review result permits it.

For every blocked or otherwise non-complete result, lead with the exact status
and cause, then write `Do this next:` and provide the exact action required by
`.ai/instructions/shared/workflow-state.md`. For MEDIUM, reproduce the
canonical review artifact's `## Required Next Action` verbatim; do not
paraphrase it into a generic recommendation. For LOW, construct the exact
blocker resolution and resume invocation directly. Never make the user ask
what to do next. Providing a command does not invoke the next stage.
