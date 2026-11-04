---
name: pull-request
description: Prepare a GitHub pull request from the complete branch diff. Use when the user asks to draft, prepare, or create a PR; require explicit approval of the exact preview before publication.
---

# Pull Request

Prepare and create one GitHub pull request from the task's current sub-branch
into its parent branch, after approval of the complete preview.

Read before acting:

- `.ai/AGENTS.md`
- `.ai/instructions/index.md`
- repository-local `AGENTS.md` files
- `.ai/instructions/shared/delivery-hygiene.md`
- repository-local pull request or branch instructions when present

## Inputs

- Repository (optional): a local repository path or an established task repository name.
- Parent branch (optional, also called base): the branch that should receive the
  sub-branch's changes.

## Resolve Destination

Before drafting or mutating anything:

1. Use the explicitly named repository; otherwise use the single repository
   clearly established by the task's work. If multiple repositories are involved
   or ownership is unclear, ask which one. Neither the skill's storage location
   nor the shell's working directory selects the repository. In particular,
   `.ai` and its containing project are separate repositories.
2. Verify the selected Git top level and current branch, then read its local
   instructions. Scope all Git operations to that checkout explicitly.
3. Use the parent branch explicitly named by the user, including earlier in the
   task; otherwise use the branch clearly recorded in task context when the
   sub-branch was created. If unknown, ask the user to name it before drafting.
   Do not guess from Git history, branch names, or a tracking branch. `AUTO` is
   not supported; never substitute the repository's default branch.
4. Resolve the destination GitHub repository and, if needed, the push remote
   and branch from explicit instructions or unambiguous Git configuration.
   The repository receiving the PR may differ from the fork receiving the push.
   Ask when multiple remotes or forks leave either destination unclear; do not
   assume `origin` identifies the intended destination.
5. Verify the parent branch exists in the destination repository. If unavailable,
   report the problem and ask for a correction; do not create or substitute it.

Resolving missing information does not approve publication. Confirm the resolved
project and branch direction once, with the complete preview below.

## Inspect First

In the resolved repository:

1. Stop if the current branch is detached or matches the parent branch.
2. Inspect working-tree status, commits unique to the branch, and the complete
   diff from the merge base through `HEAD`.
   Use the resolved parent branch for the merge base.
3. Inspect available validation evidence and applicable repository
   instructions.
4. Check the resolved GitHub repository for an open pull request from this head,
   including its owner for a fork. If one exists, report its URL and stop without
   creating a duplicate, even if its base differs from the intended parent.

Do not include uncommitted changes in the proposed pull request. Disclose any
remaining staged, unstaged, or untracked files and whether they appear related
to the branch changes.

## Title

Before drafting, follow
[Commit Subjects and PR Titles](../../../instructions/shared/delivery-hygiene.md#commit-subjects-and-pr-titles).

- For one commit, reuse its subject when it accurately represents the complete
  diff.
- For multiple commits, synthesize one title for their combined outcome.
- Never use a commit SHA, commit count, ticket-only title, or vague wording.

## Description

Start with concise outcomes and actual validation evidence:

```markdown
## Summary

- <outcome-focused summary>

## Validation

- <completed check and result, or explicitly state checks not run and why>
```

- Use as many concise bullets as needed to cover the distinct outcomes in the
  complete diff; do not impose a fixed bullet count.
- Summarize the complete diff's user-visible or operational outcomes, not the
  commit list.
- Follow [Delivery Hygiene](../../../instructions/shared/delivery-hygiene.md)
  for validation evidence, missing required evidence, risk, compatibility,
  migration, recovery, and deferred-check reporting. Use a short paragraph or
  additional section when it helps reviewers.
- Do not add commit SHAs, a commit-by-commit narrative, or an automatic checklist.

Simple change example (illustrative evidence): “Correct the saved-settings
label.” Validation: settings tests passed and the label was checked locally.

Sensitive change example (illustrative evidence): “Require transcript session
ownership.” Ownership and cross-tenant tests passed. Required staging expiry
check is blocked by unavailable staging, so acceptance remains outstanding.
Optional browser matrix is deferred until before wider rollout. Expired sessions
receive an access error; no migration. Revert if valid owners are rejected,
retaining server access controls.

## Proposal Before Mutation

Show the operator:

1. absolute local repository root and destination GitHub `owner/repository`;
2. branch direction as `<sub-branch> → <parent-branch>` (head → base), including
   the head's owner when it comes from a fork;
3. whether a push is needed and its exact remote, repository, and branch;
4. proposed title; and
5. exact proposed description.

With that full preview, ask: “Create this PR from `<sub-branch>` →
`<parent-branch>`?” Wait for explicit approval before pushing or creating the
pull request. Approval covers only the displayed push and PR creation; the
initial invocation is not authorization to publish. Do not require a separate
branch-only approval before this preview.

## Create

After approval:

1. Recheck the local repository root, GitHub destination, push destination,
   current sub-branch, parent branch, `HEAD`, working-tree status, and existing
   pull requests. If an approved repository, destination, branch, or commit
   changed materially, stop and obtain approval of a revised full preview.
   If a pull request now exists, report its URL and stop without a duplicate.
2. Push the current sub-branch normally to the approved remote and branch when
   needed. Never push the parent branch as part of this workflow.
3. Create the pull request with the approved repository, base, head (qualified
   by owner for a fork), title, and description. Pass the repository and branches
   explicitly rather than relying on working-directory or CLI defaults.
4. Re-read the created pull request to confirm its repository, branch direction,
   title, description, and URL.

Never commit, amend, rebase, squash, force-push, merge, close, or modify another
pull request as part of this workflow.

## Final Report

Report:

- pull request URL;
- local repository, destination GitHub repository, title, and sub-branch → parent-branch;
- push result;
- remaining staged, unstaged, or untracked files; and
- any failure or metadata difference found during verification.
