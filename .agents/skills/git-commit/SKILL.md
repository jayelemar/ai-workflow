---
name: git-commit
description: Prepare coherent local Git commits from repository changes. Use when the user asks to organize, stage, or commit changes; preserve approval and protected-branch rules. Does not publish or push.
---

# Git Commit

Prepare the current repository's unstaged changes as a clean, reviewable local
commit history.

This prompt is repository-level and may include `.ai` files when this
repository is the `.ai` repository.

Read before acting:

- `.ai/AGENTS.md`
- repository-local `AGENTS.md` files
- `.ai/instructions/shared/delivery-hygiene.md`
- relevant testing or release instructions

## Inspect First

Before staging or committing, inspect:

- `git status --short`
- `git diff --stat`
- `git diff --name-status`
- recent commit subjects
- applicable repository instructions

## Protected Branches

Immediately after identifying the current branch, stop when it is one of:

- `main`
- `dev`
- `staging`
- `development`

Ask the user for explicit permission to run the Git commit workflow on
that branch before inspecting changes, staging files, or creating commits. Do
not continue on a protected branch without that permission.

## Grouping Rules

Create one coherent, independently reviewable purpose per commit.

- Keep implementation, focused tests, and directly related documentation
  together.
- Keep generated output, logs, plans, and delivery evidence separate unless
  they are required for the same deliverable.
- Do not mix unrelated features, refactors, cleanup, or documentation.
- Do not stage, modify, discard, or commit unrelated existing changes.
- Use partial staging for shared files when required to preserve coherent
  commit boundaries.
- Keep dependency order explicit. Do not create an intermediate commit that
  leaves the repository unusable when a practical atomic migration is needed.
- When a living plan exists, preserve its independently reviewable task and
  dependency boundaries without treating the plan as delivery authorization.

## Proposal Before Mutation

Before staging, use this compact proposal format for one or multiple commits:

- Start with the proposed commit count and branch.
- Show each commit in execution order with its conventional-commit subject
  and file count. Keep implementation and related tests together according
  to the grouping rules; the display format does not determine grouping.
- List every exact file path in a plain-text code block under its commit.
  When paths share a directory prefix, state that prefix once above the
  groups and list paths relative to it. For partial staging, identify the
  included hunks beside the path.
- Show one shared **Checks** line after all groups. Summarize actual validation
  results; qualify checks that cover only part of the proposal. Do not add
  per-commit test-status lines or repeat command logs.
- Add a concise **Notes** line only when needed for warnings, failed or deferred
  checks, unrelated changes, dependencies, migration or compatibility effects,
  meaningful rollout risks, or recovery/revert instructions. Keep exceptions
  visible rather than describing routine safeguards or absent risks.
- End with one approval question covering all proposed commits, unless
  creation is already explicitly authorized. Keep any required explanation
  of the approval rule short and separate after the question.

Use this layout, repeating the numbered subject and file block for each commit
and using singular wording for one commit:

````text
**<N> proposed commits** · `<branch>`
All file paths relative to `<shared prefix>/`.

**1.** `<type(scope): subject>` · **<file count> files**

```text
<exact relative path>
<exact relative path>
```

**Checks:** <validation summary>
**Notes:** <exceptions, only when applicable>

**Create these <N> local commits?**
````

Wait for approval before staging or committing unless the user explicitly
authorizes creating the commits.

## Commit Procedure

After authorization, process each group in dependency order:

1. Stage only that group's files or hunks.
2. Run `git diff --cached --check`.
3. Run focused validation appropriate to that group.
4. Reinspect the staged file list and staged diff.
5. Create one local conventional commit. Add repository-specific trailers only
   when an existing repository convention or the user explicitly requires
   them.
6. Confirm the group left no unintended staged changes.

Never use repository-wide staging unless the proposed group explicitly covers
the complete repository worktree. Do not push. Do not amend, reset, or discard
changes unless the user explicitly requests it.

## Commit Message Rules

Before drafting, follow
[Commit Subjects and PR Titles](../../../instructions/shared/delivery-hygiene.md#commit-subjects-and-pr-titles).

- Target 50 characters for the commit subject.
- Add a body only when the reason, compatibility effect, migration, security,
  rollout risk, or deferred validation is not obvious.
- Use concise `-` bullets in bodies, wrapped at 72 characters.
- Never use vague subjects such as `WIP`, `updates`, or `fix changes`.

## Final Report

Keep the completion report compact:

- List one `SHA · subject` line per created commit, in dependency order.
- Summarize validation once under **Checks**, with exceptions under **Notes**.
- State whether the working tree is clean; otherwise list remaining unstaged
  or untracked files. Include staged leftovers or incomplete groups if any.
- Include practical revert or recovery order only when relevant.
