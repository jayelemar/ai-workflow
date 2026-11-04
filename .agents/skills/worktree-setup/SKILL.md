---
name: worktree-setup
description: Prepare isolated native Git worktrees and task-local plan context for a living implementation plan. Use when the user asks to prepare a worktree execution environment for a plan; do not use for implementation, worktree cleanup, commits, or publication.
---

# Worktree Setup

Create isolated native Git worktrees for one living plan. This utility prepares
an execution environment only. It does not implement the plan, start `/goal`,
stage or commit changes, copy secrets, or create workflow state. It also creates
a task-local copy of the workflow and documentation context needed to execute
the plan from the prepared task root.

Use for a request to prepare worktrees, including a direct invocation:

```text
Use $worktree-setup, plan: .ai/plans/<plan-name>.md
```

Selecting this skill grants no authority for implementation, dependency or
environment setup, staging, commits, publication, or cleanup.

Optional inputs may provide repository mappings, local base refs, or a branch
name when the plan does not establish them clearly:

```text
repositories: app=frontend, api=admin-api
bases: app=origin/staging, api=origin/staging
branch: feat/<plan-name>
```

## Read and resolve

1. Read a readable regular root `AGENTS.md` when present, then
   `.ai/AGENTS.md`, `.ai/instructions/index.md`, the complete living plan, and
   only the repository instructions relevant to setup. Preserve custom root
   guidance and custom overrides; an override must explicitly route to root
   `AGENTS.md` when present, then `.ai/AGENTS.md` and the instruction index.
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
   that repository's current `HEAD`. Record the exact base commit internally.
   Do not fetch, pull, or silently substitute another ref.
5. Use the supplied branch name when it is exactly `fix/<plan-name>` or
   `feat/<plan-name>`. Otherwise, use `fix/<plan-name>` when the plan clearly
   describes a bug fix or `feat/<plan-name>` when it clearly describes feature
   work. If the plan does not establish the branch type unambiguously, stop and
   ask the user to choose `fix` or `feat`. Require a safe Git branch name; do not
   accept another prefix or a different suffix. Separate repositories may use
   the same branch name because their refs are independent.
6. Derive `<project-title>` from the current workspace directory name,
   normalized to safe kebab-case. Use the safe `<plan-name>` as the task title.
   Use `<project-title> <plan-name>` as the single tmux session name for the
   task, regardless of how many repositories it contains. Resolve the project
   title for each invocation; never hard-code a particular project's name.
   Quote the complete session name in shell commands so the space is preserved.

## Layout and required references

Use `<workspace>/.worktrees/<plan-name>/` as `<task-root>`:

| Repositories | Task root              | Native worktree targets                              |
| ------------ | ---------------------- | ---------------------------------------------------- |
| One          | Native Git worktree    | `<task-root>`                                        |
| Multiple     | Coordination directory | `<workspace>/.worktrees/<plan-name>/<repository-id>` |

Keep repository IDs unique and safe. Reserve `.ai`, `.agents`, `docs`,
`AGENTS.md`, and `AGENTS.override.md` for control context. In multiple-repository
setups, repository files belong only in their native child worktrees.

Before selecting context or creating worktrees, read and follow
[context-selection.md](references/context-selection.md). Before mutation and
again during verification, read and follow
[worktree-checks.md](references/worktree-checks.md). These references own the
required inventories, exclusions, routing, collision checks, source preservation,
and destination evidence. Keep checks and inventories internal on success.

## Prepare in order

After context selection and every repository preflight pass:

1. For one repository, create only the `.worktrees/` parent if needed; do not
   create the task root before `git worktree add`. For multiple repositories,
   create the coordination task root first.
2. For each repository, run the equivalent of:

   ```bash
   rtk git -C '<source-root>' worktree add -b '<branch>' '<target>' '<base-commit>'
   ```

   Never use `-B`, `--force`, detached worktrees, or branch/path reuse. Verify
   registration, top-level path, branch, exact base commit, and clean status
   before copying control context.

3. Read and execute the canonical
   [context-copy procedure](references/context-copy.md), using absolute
   `workspace`, `task_root`, `workflow_head`, and the three preflighted arrays.
   Recheck containment, types, exclusions, and source stability immediately
   before running. It owns independent cloning, the exact-file overlay,
   source-deletion handling, and all six relative task-local skill links.
   Do not duplicate its mechanics or copy source project-root skill links.
4. Complete destination verification in `worktree-checks.md`, including actual
   default and full health after separately authorized dependency provisioning,
   and recheck every source and prepared checkout. Creating worktrees does not
   authorize secret copying or dependency installation; follow that reference
   for any separately requested environment setup.

If any creation, copy, or verification fails after mutation begins, preserve
partial state and stop. Do not roll back, mutate sources, or clean up.

## Output

Successful setup returns exactly two fenced code blocks: first `text`, then
`bash`. No headings, status report, extra success narrative, or automatic
execution. Resolve every placeholder to a concrete value; quote shell values.

The first block is one exact ready-to-copy execution prompt. Include the
absolute task-local plan path and an explicit repository-ID-to-absolute-worktree-
path mapping for every repository, even for one repository. Never refer to paths
"reported above." Include relevant source-work limitations from verification.
For controlled work, require the plan's independent final review before finishing:

```text
/goal Implement <task-root>/.ai/plans/<plan-name>.md. Use these prepared worktrees for all plan-owned edits: <repository-id>=<absolute-worktree-path> (repeat for every repository). Preserve its boundaries, keep the task-local plan updated, run every required validation, and finish only when its definition of done is proven. Implementation and Goal execution have not started; delivery requires separate explicit authorization.
```

The second block is the single two-pane launcher below, printed without starting
it. Use plain `tmux`, without an RTK prefix or wrapper. Keep both panes at the
task root, the 67% horizontal split, and one session for multiple repositories.
Single-repository commands run directly at the root; multiple-repository commands
must explicitly select or enter the intended child by repository ID.

```bash
tmux new-session -s '<project-title> <plan-name>' -c '<task-root>' \; split-window -t '<project-title> <plan-name>:' -h -p 67 -c '<task-root>'
```

Blocked or partial setup returns only `Error:` with the concrete blocker and
`Fix:` with the smallest corrective action. Add `Created:` listing paths and
branches only when partial creation occurred. Emit neither the `/goal` prompt nor
the tmux launch command. Required scope or authorization questions remain allowed
when the request does not resolve them.
