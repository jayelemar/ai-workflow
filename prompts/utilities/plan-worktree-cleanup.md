# Clean Selected Plans and Task Worktrees

Permanently remove task worktrees and workflow records for one or more
explicitly selected living plans. This utility is destructive and runs only
after the operator confirms the complete deletion inventory.

Invoke it with a non-empty list of source plan paths:

```text
Run `.ai/prompts/utilities/plan-worktree-cleanup.md`.

Plans:
- `.ai/plans/<first-plan>.md`
- `.ai/plans/<second-plan>.md`
```

Accept one or more plans. Reject a missing or empty `Plans` list without
mutation. Do not infer plans from `.worktrees/`, Git branches, open files, or
conversation history.

## Required Context

Read `.ai/AGENTS.md`, `.ai/instructions/index.md`, the complete selected plans,
and the repository instructions needed to inspect their worktrees. Resolve the
source `.ai/` repository and its containing workspace. Reject invocation from a
copied workflow beneath `.worktrees/`. Follow the workspace's required command
wrapper.

This utility authorizes no implementation, delivery, branch deletion, remote
mutation, or cleanup outside the selected plans.

## Resolve Selected Targets

Before asking for confirmation:

1. Require every supplied plan to be a readable regular Markdown file directly
   under the source `.ai/plans/` directory. Reject absolute paths, traversal,
   symlinks, duplicate resolved paths, and paths outside the source workflow.
2. Derive each plan name from its filename without the `.md` suffix. Require a
   safe kebab-case name and map it to
   `<workspace>/.worktrees/<plan-name>/`.
3. Resolve the complete deletion set for each selected plan:
   - the source plan file;
   - its task root and every native Git worktree contained by that root;
   - `.ai/specs/<plan-name>.spec.md`, when present;
   - task-owned paths beneath `.ai/artifacts/`, `.ai/logs/`, `.ai/state/`, and
     `.ai/tmp/` whose first relative component is exactly `<plan-name>`; and
   - additional workflow-record paths beneath those same managed roots that
     the selected plan explicitly references and no unselected source plan
     references.
4. Deduplicate the deletion set. Never broaden a plan name into a prefix or
   glob match. For example, selecting `account` must not select
   `account-recovery`.
5. Preserve every unselected plan and its records. If ownership of a referenced
   record is shared or cannot be established, exclude it and report why.

## Inspect Before Confirmation

Inspect every selected task root without mutation. Require the task root to be
contained by `<workspace>/.worktrees/`, to be a real directory rather than a
symlink, and to match the current preparation topology:

```text
<task-root>/
├── .ai/
├── docs/                    # when copied during preparation
├── AGENTS.override.md
└── <repository-id>/         # one or more native Git worktrees
```

For every repository worktree, resolve and retain its primary repository,
branch, Git registration, and status. Stop without offering confirmation when
containment, symlink safety, repository identity, or branch-storage ownership
cannot be proven. Never treat a standalone primary repository as a disposable
task worktree.

Prepare one consolidated inventory grouped by the plans in the invocation.
Show:

- every selected source plan and task root;
- every registered worktree, primary repository, and retained branch;
- every plan-owned spec, artifact, log, state, and temporary path;
- modified and untracked paths that will be discarded; and
- unexpected entries inside a selected task root that will also be removed.

Do not print file contents, environment values, credentials, or secret-derived
data. State that ignored files inside selected task roots will also be
permanently removed even when they are not individually listed.

## Required Confirmation

After displaying the complete inventory, ask exactly:

```text
Type PROCEED to clean up every plan listed above, or CANCEL to stop.
```

Accept only the exact uppercase response `PROCEED` or `CANCEL`.

- On `CANCEL`, stop without mutation.
- On any other response, make no changes and repeat the same confirmation
  prompt with both valid options.
- On `PROCEED`, re-run the complete inspection before mutation. If any target,
  Git status, registration, branch, or record path changed, display the updated
  inventory and require a new `PROCEED` or `CANCEL` response.

The initial invocation and any response other than exact `PROCEED` are not
deletion authorization.

## Cleanup

After confirmed revalidation:

1. Remove each registered selected worktree through its primary repository
   with `git worktree remove`. Use `--force` only when required to discard
   changes already disclosed in the confirmed inventory.
2. Retain every Git branch. Never delete, rename, reset, merge, rebase, or prune
   a branch.
3. After a selected plan's registered worktrees are removed, remove its exact
   task root, including the copied `.ai/`, `docs/`, `AGENTS.override.md`, and
   other entries shown in the confirmed inventory.
4. Do not remove source workflow records until worktree removal succeeds for
   every selected plan. If any worktree or task-root removal fails, stop,
   preserve all remaining source plans and records, and report partial task-root
   cleanup.
5. Remove only the confirmed source plans and confirmed plan-owned workflow
   records. Do not run the global `cleanup:local` utility as a substitute.
6. Verify that selected task roots and records are absent, unselected plans and
   records remain, worktree registrations are gone, and all recorded branches
   still exist.

Do not fetch, pull, push, commit, stash, switch, reset, merge, rebase, delete a
branch, prune worktrees, or mutate remote state.

## Completion

Report:

- every plan cleaned;
- task roots and registered worktrees removed;
- plan-owned records removed and shared records preserved;
- confirmation that all branches were retained;
- confirmation that unselected plans were preserved; and
- failures, partial cleanup, or postcondition gaps.

Do not claim complete cleanup when any selected target remains or a required
postcondition could not be verified.
