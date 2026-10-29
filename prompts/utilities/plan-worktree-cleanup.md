# Clean Plan Worktrees and Records

Permanently remove task worktrees and workflow records for every living plan
discovered in the source `.ai/plans/` directory. This utility is destructive
and runs only after the operator confirms the complete deletion inventory.

Invoke it without plan arguments:

```text
Run `.ai/prompts/utilities/plan-worktree-cleanup.md`.
```

Do not accept or require explicit plan paths, names, filters, or exclusions.
Discover every plan directly under the source `.ai/plans/` directory. Require
at least one discovered plan; otherwise report that there is nothing to clean
and stop without mutation or confirmation.

## Required Context

Read `.ai/AGENTS.md`, `.ai/instructions/index.md`, every discovered plan, and
the repository instructions needed to inspect their worktrees. Resolve the
source `.ai/` repository and its containing workspace. Reject invocation from
a copied workflow beneath `.worktrees/`. Follow the workspace's required
command wrapper.

This utility authorizes no implementation, delivery, branch deletion, remote
mutation, or cleanup outside the discovered plan set.

## Discover Cleanup Targets

Before asking for confirmation:

1. Enumerate every direct `.md` entry under the source `.ai/plans/` directory
   in deterministic filename order. Require each discovered plan to be a
   readable regular file rather than a symlink. Preserve and report non-Markdown
   entries instead of treating them as plans.
2. Require at least one discovered plan. Do not infer additional plans from
   `.worktrees/`, Git branches, open files, or conversation history.
3. Derive each plan name from its filename without the `.md` suffix. Require a
   safe kebab-case name and map it to
   `<workspace>/.worktrees/<plan-name>/`.
4. Resolve the complete deletion set for each discovered plan:
   - the source plan file;
   - its task root and every native Git worktree contained by that root;
   - `.ai/specs/<plan-name>.spec.md`, when present;
   - task-owned paths beneath `.ai/artifacts/`, `.ai/logs/`, `.ai/state/`, and
     `.ai/tmp/` whose first relative component is exactly `<plan-name>`; and
   - additional workflow-record paths beneath those same managed roots that
     any discovered plan explicitly references.
5. Deduplicate the deletion set. Never broaden a plan name into a prefix or
   glob match. For example, discovering `account` must not make an unrelated
   `account-recovery` record plan-owned.
6. Preserve workflow records that are not owned or referenced by a discovered
   plan. Report task roots beneath `.worktrees/` that have no corresponding
   discovered plan, but do not remove them.

## Inspect Before Confirmation

Inspect every discovered plan's task root without mutation. A missing task root
does not block cleanup of that plan's source records; show it as absent. When a
task root exists, require it to be contained by `<workspace>/.worktrees/`, to
be a real directory rather than a symlink, and to match the current preparation
topology:

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

Prepare one consolidated inventory grouped by every discovered plan. Show:

- every discovered source plan and its present or absent task root;
- every registered worktree, primary repository, and retained branch;
- every plan-owned spec, artifact, log, state, and temporary path;
- modified and untracked paths that will be discarded; and
- unexpected entries inside a listed task root that will also be removed.

Do not print file contents, environment values, credentials, or secret-derived
data. State that ignored files inside listed task roots will also be
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
- On `PROCEED`, repeat plan discovery and the complete inspection before
  mutation. If the plan list, target, Git status, registration, branch, or
  record path changed, display the updated inventory and require a new
  `PROCEED` or `CANCEL` response.

The initial invocation and any response other than exact `PROCEED` are not
deletion authorization.

## Cleanup

After confirmed revalidation:

1. Remove each registered listed worktree through its primary repository
   with `git worktree remove`. Use `--force` only when required to discard
   changes already disclosed in the confirmed inventory.
2. Retain every Git branch. Never delete, rename, reset, merge, rebase, or prune
   a branch.
3. After a listed plan's registered worktrees are removed, remove its exact
   task root, including the copied `.ai/`, `docs/`, `AGENTS.override.md`, and
   other entries shown in the confirmed inventory.
4. Do not remove source workflow records until worktree removal succeeds for
   every listed plan. If any worktree or task-root removal fails, stop,
   preserve all remaining source plans and records, and report partial task-root
   cleanup.
5. Remove every confirmed source plan and only the confirmed plan-owned
   workflow records. Do not run the global `cleanup:local` utility as a
   substitute.
6. Verify that listed task roots and plan-owned records are absent, unrelated
   records and unmatched task roots remain, worktree registrations are gone,
   and all recorded branches still exist.

Do not fetch, pull, push, commit, stash, switch, reset, merge, rebase, delete a
branch, prune worktrees, or mutate remote state.

## Completion

Report:

- every plan cleaned;
- task roots and registered worktrees removed;
- plan-owned records removed and unrelated records preserved;
- confirmation that all branches were retained;
- unmatched task roots and non-plan entries preserved; and
- failures, partial cleanup, or postcondition gaps.

Do not claim complete cleanup when any listed target remains or a required
postcondition could not be verified.
