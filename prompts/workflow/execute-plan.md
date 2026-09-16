# Execute Plan

Run only when the user explicitly invokes `execute <plan-file>`. This command
authorizes implementation of one saved LOW or MEDIUM `plan-manifest@5`.

Read `.ai/AGENTS.md`, the plan, its finalized spec and flow artifacts when
declared, current Git state in every repository, and only project instructions
routed for the implementation scope.

## Preconditions

- Require the requested plan to be a root-level active `.ai/plans/*.md` file.
  If its former active path was superseded, apply `## Superseded Plan
Resolution` from `.ai/instructions/shared/workflow-state.md` and stop without
  implementation.
- Require the plan's linked stable `work-status@1`. Its work item, active plan,
  spec, classification, and ordered current task IDs must exactly match the
  plan. Status is evidence, not execution authority.
- After validating that match and before implementation, apply `## Session
Plan Indicator Synchronization` from
  `.ai/instructions/shared/ai-workflow.md`. Rebuild the indicator from status;
  do not retain conversational setup or reconciliation entries.
- Reject any older plan, status, review, or worktree report with exactly:
  `Legacy workflow artifact: <path> uses <format>; replan using the current
contract before execution or resume.` Do not migrate, overwrite, or delete it.
- Every declared repository root and integration-base ref must resolve.
- Validate a current `worktree-setup@1` report against the `plan-manifest@5`,
  repository mappings, branches, bases, and Git worktree registries before using
  its filesystem-target overlay. Reject a stale or legacy report.
- LOW requires its saved compact plan. MEDIUM requires its finalized typed spec.
- Declared flow artifacts must be present and complete.
- Reconstruct spec-to-plan coverage before mutation. Every acceptance criterion
  must map to an implementation owner or inspected unchanged boundary and to
  required validation evidence. A missing mapping is a material discovery;
  apply `## Material Discovery Routing` before implementation.
- Preserve unrelated changes in every repository.

## Execution

- Follow requested behavior, finalized spec, repository ownership, and plan
  order.
- Before starting a task, set only that task to `active`, set overall status to
  `in progress`, recompute the summary, and save the exact resume action. After
  each task, update status before starting another: record `complete` only
  after its required validation passes, or `blocked` with evidence and exact
  next action. Immediately after each status write, synchronize the session
  plan indicator from the saved status. Never rewrite the plan for
  progress-only changes.
- For environment-dependent behavior, inspect the effective non-secret
  configuration at each planned build or deployment boundary before trusting
  it. Verify required environment-specific URLs, fail-fast behavior for missing
  or invalid values, isolation from other environments, and the specified
  browser fallback at the cheapest valid boundary.
- Classify discoveries only through the corrective-deviation table in
  `.ai/AGENTS.md`. Record a qualifying correction and affected evidence; stop
  for a material discovery. Apply `## Material Discovery Routing` from
  `.ai/instructions/shared/workflow-state.md` and return its exact applicable
  specification or planning invocation as the immediate action.
- Run every required plan validation command. Defer optional external evidence
  only under `.ai/AGENTS.md` disclosure rules.
- Missing or unavailable required environment evidence is `Blocked`; never
  defer it or relabel it optional. A mocked, local, or source-only check may
  supplement but cannot replace evidence for a deployment, DNS, TLS,
  operating-system association, device, or external-service acceptance
  criterion.

## Completion

LOW self-checks actual scope, diff, required validation, repositories, and
preserved unrelated work, then records completion evidence and `complete` in
stable work status.

MEDIUM invokes `.ai/prompts/workflow/review-changes.md` and saves its
`implementation-review@3` result. That prompt exclusively controls review
rounds, remediation, statuses, risk decisions, and completion eligibility; do
not restate or reinterpret its transitions here. Mirror its canonical status,
evidence link, blocker, and next action into stable work status.

## Final Response

Report changed scope by repository, required validation, deferred optional
checks and risk, preserved unrelated work, work-status path, and the LOW
self-check or exact MEDIUM review status and required next action. Claim
completion only when the canonical review result permits it.

For every blocked or otherwise non-complete result, lead with the exact status
and cause, then write `Do this next:` and provide the exact action required by
`.ai/instructions/shared/workflow-state.md`. For MEDIUM after review evidence
exists, reproduce the canonical review artifact's `## Required Next Action`
verbatim; do not paraphrase it into a generic recommendation. For a stop before
review evidence exists, including a material discovery, construct the exact
applicable workflow-state action directly. For LOW, construct the exact blocker
resolution and resume invocation directly. Never make the user ask what to do
next. Providing a command does not invoke the next stage.
