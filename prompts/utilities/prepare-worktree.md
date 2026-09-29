# Prepare Task Worktrees

Create isolated native Git worktrees for one living plan. This utility prepares
an execution environment only. It does not implement the plan, start `/goal`,
stage or commit changes, copy secrets, or create workflow state. It also creates
a task-local copy of the workflow and documentation context needed to execute
the plan from the prepared task root.

Run only when explicitly invoked:

```text
Run .ai/prompts/utilities/prepare-worktree.md, plan: .ai/plans/<plan-name>.md
```

Optional inputs may provide repository mappings, local base refs, or a branch
name when the plan does not establish them clearly:

```text
repositories: app=frontend, api=admin-api
bases: app=origin/staging, api=origin/staging
branch: feat/<plan-name>
```

## Read and resolve

1. Read `.ai/AGENTS.md`, `.ai/instructions/index.md`, the complete living plan,
   and only the repository instructions relevant to setup.
2. Resolve the workspace as the directory containing `.ai/`. Require the plan
   to be a readable regular file under `.ai/plans/`, reject absolute paths,
   traversal, and symlink escapes, and derive a safe kebab-case plan name from
   its filename.
3. Resolve each repository from an explicit invocation mapping or a repository
   root clearly named by the plan. Each root must be relative to the workspace,
   contained by it, and resolve to a distinct Git top level. Stop and ask for
   the smallest missing mapping when ownership is ambiguous; never guess a
   repository from a task description alone.
4. Use an explicitly supplied local base ref for a repository. Otherwise use
   that repository's current `HEAD`. Resolve and report the exact base commit.
   Do not fetch, pull, or silently substitute another ref.
5. Use the supplied branch name or `work/<plan-name>`. Require a safe Git branch
   name. Separate repositories may use the same branch name because their refs
   are independent.

## Use one predictable topology

Place every prepared repository under:

```text
<workspace>/.worktrees/<plan-name>/<repository-id>
```

The task root is a coordination directory even when the plan has one
repository. Keep repository IDs unique and safe. Do not copy repository files
into the task root outside their native Git worktrees.

The prepared task root must have this control-context layout:

```text
<task-root>/
├── .ai/                   # complete mirrored workflow context
├── docs/                  # complete mirrored documentation, when present
├── AGENTS.override.md     # portable root instruction entrypoint
└── <repository-id>/       # native Git worktree, one per repository
```

The source workspace is authoritative during preparation. The mirrors are a
task-local snapshot for execution. Never refresh or overwrite an existing
control-context destination.

Before creating anything, verify that the workspace's `AGENTS.override.md`,
`.ai/AGENTS.md`, and `.ai/instructions/index.md` are readable regular files and
that the complete source `.ai/` tree is readable. When the workspace has a
`docs/` directory, require its complete tree to be readable. Stop with the
existing setup command when routing is missing; do not invent another
instruction copy.

When `.worktrees/` falls inside a Git checkout, require it to be ignored before
creating the task root. Do not change ignore rules implicitly.

## Preflight every repository

Inspect and report, without mutation:

- the source Git top level, branch, `HEAD`, chosen base ref and commit;
- tracked, untracked, and ignored status relevant to the plan;
- existing worktrees and branches; and
- the proposed branch and target path.

Stop before mutation when:

- a repository root escapes the workspace, overlaps another selected root, or
  is itself an unsafe symbolic link;
- the base does not resolve locally;
- the target path or task root already exists;
- the proposed local branch already exists or is checked out elsewhere;
- a matching remote branch exists and the user has not chosen whether to track
  it or create a different branch; or
- source changes overlap the plan's scope.

Preserve unrelated dirty-source changes. They do not appear in a new worktree;
state that explicitly before continuing. Never stash, clean, reset, switch,
merge, rebase, delete, prune, or overwrite source state.

## Create safely

After every repository passes preflight:

1. Create the task root and no other coordination state.
2. Mirror the complete source `.ai/` tree into `<task-root>/.ai/`. Include
   ignored, hidden, generated, artifact, log, wrapper, plan, spec, instruction,
   documentation, and nested-Git entries. Preserve safe symlinks, permissions,
   timestamps, and relative paths. Require the destination to be absent and use
   an archive-preserving trailing-slash copy equivalent to:

   ```bash
   rtk rsync -aH --safe-links '<workspace>/.ai/' '<task-root>/.ai/'
   ```

3. When `<workspace>/docs/` exists, mirror its complete contents into
   `<task-root>/docs/` with the same archive-preserving semantics. Include
   ignored, hidden, and untracked documentation files, preserve safe symlinks,
   and require the destination to be absent.
4. Copy `<workspace>/AGENTS.override.md` to
   `<task-root>/AGENTS.override.md` as a regular file without changing its
   contents, permissions, or timestamp. Require the destination to be absent.
   Verify that its `.ai/AGENTS.md` reference resolves within the task root.
5. For each repository, run the equivalent of:

   ```bash
   rtk git -C '<source-root>' worktree add -b '<branch>' '<target>' '<base-commit>'
   ```

6. Never use `-B`, `--force`, detached worktrees, or branch/path reuse.
7. Verify each target's worktree registration, top-level path, branch name,
   exact base commit, and clean status.
8. Verify the source and task-root `.ai/` trees are identical with an
   archive-preserving checksum dry run equivalent to
   `rtk rsync -aHncni --delete --safe-links`. When `docs/` was copied, verify it
   the same way. Verify `AGENTS.override.md` is byte-for-byte identical without
   printing its contents, and verify the copied plan, required specs and
   documentation, `.ai/AGENTS.md`, and `.ai/instructions/index.md` are readable
   from the task root.
9. Recheck every source checkout and confirm setup did not change it.

If a later repository fails after an earlier one was created, keep the partial
state, identify every created branch and path, and stop. Do not perform automatic
rollback or cleanup.

## Optional environment and dependency setup

Creating worktrees does not authorize secret copying or dependency installation.
Perform either only when the user or living plan explicitly requests it.

- Follow repository-owned setup instructions and pinned package-manager or
  runtime versions.
- Use reproducible lockfile-preserving install commands.
- Ask for command-level network approval when the environment requires it.
- Copy a populated environment file only with explicit authorization naming
  the source and destination. Require the destination to be ignored and absent,
  set restrictive permissions, and never print, diff, hash, log, or report
  secret values.
- Stop if setup changes tracked files. Preserve and report the resulting state.

Do not symlink dependencies, copy caches or build outputs, or mirror the source
checkout into the worktree.

## Completion output

Return:

```text
Preparation: Ready | Partial | Blocked
Plan: <exact task-local living-plan path>
Workspace: <absolute workspace path>
Task root: <absolute task-root path>
Repositories: <id: branch @ base commit — target path, one per line>
Control context: <.ai, docs, and AGENTS.override.md mirror result>
Source work: <preserved dirty changes or clean>
Environment: <not requested or non-secret result>
Dependencies: <not requested or result per repository>
Validation: <checks passed and exact gaps>
```

For a ready task, print this optional two-pane launcher with resolved paths and
the safe plan name. Start both panes from the task root so the copied plan,
specs, documentation, and instruction router are directly available:

```bash
rtk tmux new-session -s '<plan-name>' -c '<task-root>' \; split-window -t '<plan-name>:' -h -p 67 -c '<task-root>'
```

Then print the exact ready-to-copy execution prompt without running it:

```text
/goal Implement <task-root>/.ai/plans/<plan-name>.md. Use the prepared worktrees reported above for all plan-owned edits. Preserve its boundaries, keep the task-local plan updated, run every required validation, and finish only when its definition of done is proven.
```

For controlled work, also require completion of the plan's independent final
review before finishing. State that preparation did not start implementation
and that delivery still requires separate explicit authorization.
