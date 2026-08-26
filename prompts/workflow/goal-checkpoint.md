# Goal Checkpoint

Create or refresh the portable evidence checkpoint for a HIGH work item. Read
`.ai/AGENTS.md`, the current `plan-manifest@3`, linked finalized artifacts, and
repository state before writing.

## Input

- Goal name: `<stable-kebab-case-plan-name>`
- Exact goal: `<finalized spec goal verbatim>`

Reject a missing or invalid goal name. Reject an older plan, handoff, review, or
worktree report with exactly: `Legacy workflow artifact: <path> uses <format>;
replan using the current contract before execution or resume.` Never migrate,
overwrite, or delete it.

## Scope

- This action records verified progress only. It does not implement work,
  change the goal, authorize execution, or create workflow state.
- Create or refresh only
  `.ai/artifacts/<goal-name>/goal-handoff.md` as `goal-handoff@2`.
- Inspect current repository state read-only. Never store secrets, raw diffs,
  full command output, or copied policy text.
- The handoff records review and commit evidence but never embeds the review
  state machine or HIGH commit rules.

## HIGH Task and Commit Rules

Process planned tasks serially. Before HIGH execution, resolve every required
role from `.ai/config/agent-models.toml`; never substitute an unavailable
runtime. Apply the plan's deterministic delegation decision and record its
bounded result.

For each task:

1. Implement only its single-repository scope or a correction qualifying under
   the decision table in `.ai/AGENTS.md`.
2. Run the task's exact validation and review its actual diff, delegation
   evidence, provider-to-consumer contract, regressions, and unrelated files.
3. Stage only task-owned changes and never `.ai` artifacts.
4. Immediately before committing, inspect the current branch. On `main`, `dev`,
   `development`, or `staging`, obtain explicit operator permission.
5. Create exactly one local conventional commit with the plan's saved purpose.
   Do not start the next task until no task-owned change remains uncommitted and
   the handoff records its SHA, subject, validation, review, and delegation.

If a task has no tracked change, record that result and validation without an
empty commit. Never commit failed validation, ambiguous behavior, or unrelated
work. Never push, amend, squash, force-push, or open a pull request without an
explicit delivery request.

For a correction to an already committed task, create a separate focused
`fix(<scope>): <spec-restoring summary>` commit after all affected task checks
and fresh task review pass.

## HIGH Final-Review Commit Rules

After all task records are complete, run all plan validation and invoke only
`.ai/prompts/workflow/review-changes.md` for final-review control. When canonical review
remediation changes a repository:

- validate every affected task and plan check;
- stage only remediation paths;
- apply the protected-branch permission check above;
- create one local conventional remediation commit per changed repository,
  naming the resolved behavior or risk; and
- record the review round, resolved findings, commands/results, SHA, and subject
  in the handoff before the canonical review prompt advances.

Do not copy final-review transitions into this prompt or the handoff.

## Required Handoff Content

Write concise Markdown with exactly these sections:

```md
# Goal Handoff: <goal-name>

## Document Format

goal-handoff@2

## Exact Goal

<exact finalized objective>

## Linked Artifacts

- Spec: <finalized spec path>
- Plan: <plan-manifest@3 path>
- User journey: <path | N/A from plan>
- Implementation map: <path | N/A from plan>

## Repository State

- <repository ID: branch, base, HEAD, relevant working-tree summary>

## Task and Commit Records

1. <task number and state: not started | active | complete | blocked>
   - Repository: <ID>
   - Delegation evidence: <role and result | N/A>
   - Validation evidence: <command and result | pending>
   - Actual-diff review: <result | pending>
   - Commit: <SHA and subject | no tracked change | pending>

## Validation Evidence

- <plan command and result | not run>

## Review State

- Format: implementation-review@2
- Status: <canonical status | Not started>
- Automatic budget: <1 | 2 | 3>
- Fresh rounds: <None | strictly increasing ordered round records>
- Findings: <blocking, resolved, advisory, and pre-existing dispositions | None>
- Risk decision: <canonical recorded evidence | None>
- Remediation commits: <repository, round, SHA, and subject | None>

## Blockers

<current blockers | None>

## Next Action

<one exact action>
```

Fresh review round numbers must remain positive and strictly increase across
every refresh. Never reset, infer, duplicate, reorder, or decrease them. Verify
task order and commit evidence against the current repositories.

During initial planning, record every task as not started, validation and review
as not run, `Awaiting explicit /goal invocation` as the blocker, and the exact
two-line `/goal` invocation referencing the linked plan as `## Next Action`.

## Final Output

When called by create-plan, return control to it. Otherwise return only:

`Goal checkpoint refreshed at .ai/artifacts/<goal-name>/goal-handoff.md`
