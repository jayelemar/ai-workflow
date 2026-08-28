# Clean Local Workflow Records and Task Worktrees

Run only when the operator explicitly invokes this utility with:

```text
Run `.ai/prompts/utilities/cleanup-workflow.md`.

Mode: preview | apply
```

Default a missing `Mode` to `preview`. This utility is destructive only in
`apply` mode. It never starts or resumes another workflow stage.

## Required Context

Read `.ai/AGENTS.md`, `.ai/instructions/index.md`,
`.ai/instructions/shared/ai-workflow.md`, and
`.ai/instructions/shared/security.md`. Resolve the source `.ai/` repository and
its containing plan workspace. Reject a copied workflow under `.worktrees/`.
Follow the workspace's required command wrapper.

Delegate all inventory, Git worktree removal, task-root deletion, record
protection, and postcondition reporting to the source workflow's
`scripts/maintenance/cleanup-workflow.mjs`. Do not substitute ad-hoc `rm`, Git
prune, branch deletion, or manual record deletion.

## Preview

Run the utility without apply flags. Report its complete task-root
classification, active-plan count, archived-revision count, and workflow-record
count. Do not mutate anything or ask for a deletion decision in `preview` mode.

Treat these utility classifications as authoritative:

- `Clean`: safe for normal Git worktree removal.
- `Approval required`: contains uncommitted changes, is locked, is orphaned or
  unregistered, has broken registration evidence, or contains unexpected
  task-root entries.
- `Blocked`: violates containment, symlink, repository-identity, or another
  non-overridable safety boundary.

Never print file contents, environment values, credentials, or secret-derived
data. Paths, branches, Git status codes, and non-secret issue descriptions are
allowed.

## Apply and Approval

Begin `apply` mode with the same non-mutating preview. If the utility reports a
blocker, stop without mutation and report it.

When no task root requires approval, run `--apply-all` with no `--approve`
arguments. The explicit `Mode: apply` invocation authorizes deletion of clean
items.

When one or more task roots require approval, do not delete anything yet.
List every approval-required task root with its repository worktrees, branches,
issues, and modified or untracked paths. Then ask exactly:

`Deleting these task roots will permanently discard their local files. Git branches will be retained. Delete these task roots too? Reply yes or no.`

Wait for exactly `yes` or `no`. Treat any other response as unresolved and ask
again without mutation.

- On `yes`, invoke `--apply-all` and pass one repeated `--approve <task-name>`
  argument for every task name in the displayed approval-required set.
- On `no`, invoke `--apply-clean`. This removes clean task roots and unrelated
  workflow records while retaining every approval-required task root and its
  safely resolvable plan, spec, artifacts, logs, state, and temporary records.

The apply command re-runs preflight. If its issue set differs from the approved
set, do not reinterpret the earlier answer: display the updated inventory and
ask again. Never add `--force` yourself; only the utility may force-remove an
exactly approved task root. Git branches are always retained.

## Completion

Report:

- mode and final status;
- task roots removed and retained;
- approval-required decisions applied;
- workflow records removed or conservatively preserved;
- confirmation that branches were retained;
- blockers, failures, and partial removals.

Do not claim complete cleanup after a non-zero utility exit. Do not run another
workflow stage, delivery action, or branch cleanup.
