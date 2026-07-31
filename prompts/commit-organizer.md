# Commit Organizer

Prepare the current repository's unstaged changes as a clean, reviewable local
commit history.

This prompt is repository-level and may include `.ai` files when this
repository is the `.ai` repository.

Read before acting:

* repository-local `AGENTS.md` files
* `.ai/instructions/shared/delivery-hygiene.md`
* relevant testing or release instructions

## Inspect First

Before staging or committing, inspect:

* `git status --short`
* `git diff --stat`
* `git diff --name-status`
* recent commit subjects
* applicable repository instructions

## Protected Branches

Immediately after identifying the current branch, stop when it is one of:

* `main`
* `dev`
* `staging`
* `development`

Ask the user for explicit permission to run the commit-organizer workflow on
that branch before inspecting changes, staging files, or creating commits. Do
not continue on a protected branch without that permission.

## Grouping Rules

Create one coherent, independently reviewable purpose per commit.

* Keep implementation, focused tests, and directly related documentation
  together.
* Keep generated output, logs, plans, and delivery evidence separate unless
  they are required for the same deliverable.
* Do not mix unrelated features, refactors, cleanup, or documentation.
* Do not stage, modify, discard, or commit unrelated existing changes.
* Use partial staging for shared files when required to preserve coherent
  commit boundaries.
* Keep dependency order explicit. Do not create an intermediate commit that
  leaves the repository unusable when a practical atomic migration is needed.
* When organizing a HIGH-GOAL, the saved plan's task boundary overrides general
  grouping: never combine changes from more than one planned task in a commit.
* Before staging a HIGH task, verify its required delegation outcomes are
  recorded. A missing or failed required delegation blocks the commit.

## Proposal Before Mutation

Before staging, show a commit plan with:

1. commit order;
2. conventional-commit subject;
3. exact files or file hunks in each group;
4. dependency order;
5. validation for each group;
6. deferred checks, migration effects, compatibility, rollout risk, and
   recovery or revert notes when applicable.

Wait for approval before staging or committing unless the user explicitly
authorizes creating the commits.

## Commit Procedure

After authorization, process each group in dependency order:

1. Stage only that group's files or hunks.
2. Run `git diff --cached --check`.
3. Run focused validation appropriate to that group.
4. Reinspect the staged file list and staged diff.
5. Create one local conventional commit.
6. Confirm the group left no unintended staged changes.

Never use repository-wide staging unless the proposed group explicitly covers
the complete repository worktree. Do not push. Do not amend, reset, or discard
changes unless the user explicitly requests it.

## Commit Message Rules

Use conventional commits:

```text
<type>(<scope>): <imperative summary>
```

* Use `feat`, `fix`, `refactor`, `perf`, `chore`, `docs`, `test`, `build`,
  `ci`, `style`, or `revert`.
* Make the subject specific and imperative; target 50 characters and never
  exceed 72.
* Add a body only when the reason, compatibility effect, migration, security,
  rollout risk, or deferred validation is not obvious.
* Use concise `-` bullets in bodies, wrapped at 72 characters.
* Never use vague subjects such as `WIP`, `updates`, or `fix changes`.

## Final Report

Report:

* created commit SHAs and subjects, in dependency order;
* validation passed and validation deferred;
* remaining unstaged or untracked files, if any;
* practical revert or recovery order when relevant.
