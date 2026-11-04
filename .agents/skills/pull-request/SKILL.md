---
name: pull-request
description: Prepare a GitHub pull request from the complete branch diff. Use when the user asks to draft, prepare, or create a PR; require explicit approval of the exact preview before publication.
---

# Pull Request

Prepare and create one GitHub pull request for the current branch.

Read before acting:

- `.ai/AGENTS.md`
- `.ai/instructions/index.md`
- repository-local `AGENTS.md` files
- `.ai/instructions/shared/delivery-hygiene.md`
- repository-local pull request or branch instructions when present

## Inputs

- Base: an explicit branch or `AUTO`

## Inspect First

Before proposing or mutating anything:

1. Identify the repository root, current branch, remote, and default branch.
2. Resolve `AUTO` to the remote's default branch.
3. Stop if the current branch is detached or matches the resolved base.
4. Inspect working-tree status, commits unique to the branch, and the complete
   diff from the merge base through `HEAD`.
5. Inspect available validation evidence and applicable repository
   instructions.
6. Check whether the branch already has an open pull request. If it does,
   report its URL and stop without creating a duplicate.

Do not include uncommitted changes in the proposed pull request. Disclose any
remaining staged, unstaged, or untracked files and whether they appear related
to the branch changes.

## Title

Use conventional-commit format:

```text
<type>(<scope>): <imperative summary>
```

- Use `feat`, `fix`, `refactor`, `perf`, `chore`, `docs`, `test`, `build`,
  `ci`, `style`, or `revert`.
- Make the title specific and imperative; never exceed 72 characters.
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
- Include explicit validation evidence in every PR. Distinguish completed
  checks from missing required evidence and optional deferred checks; do not
  imply that a deferred check passed or that missing required evidence permits
  completion.
- Add concise risk, compatibility, migration, recovery, or deferred-check
  information when the change needs it. Use a short paragraph or additional
  section when that helps reviewers; omit inapplicable sections and filler.
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

1. resolved base and head branches;
2. whether the branch must be pushed or its remote updated;
3. proposed title; and
4. exact proposed description.

Wait for explicit approval before pushing or creating the pull request. The
initial invocation is not authorization to publish.

## Create

After approval:

1. Recheck the current branch, `HEAD`, working-tree status, and existing pull
   requests. Stop if the proposed branch or commit changed materially.
2. Push the current branch normally when its remote is missing or behind.
3. Create the pull request with the approved base, head, title, and description.
4. Re-read the created pull request to confirm its metadata and URL.

Never commit, amend, rebase, squash, force-push, merge, close, or modify another
pull request as part of this workflow.

## Final Report

Report:

- pull request URL;
- title and base/head branches;
- push result;
- remaining staged, unstaged, or untracked files; and
- any failure or metadata difference found during verification.
