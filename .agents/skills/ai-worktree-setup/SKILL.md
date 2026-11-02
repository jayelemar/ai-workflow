---
name: ai-worktree-setup
description: Prepare isolated native Git worktrees and task-local plan context for a living implementation plan. Use when the user asks to prepare a worktree execution environment for a plan; do not use for implementation, worktree cleanup, commits, or publication.
---

# AI Worktree Setup

Create isolated native Git worktrees for one living plan. This utility prepares
an execution environment only. It does not implement the plan, start `/goal`,
stage or commit changes, copy secrets, or create workflow state. It also creates
a task-local copy of the workflow and documentation context needed to execute
the plan from the prepared task root.

Use for a request to prepare worktrees, including a direct invocation:

```text
Use $ai-worktree-setup, plan: .ai/plans/<plan-name>.md
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
   that repository's current `HEAD`. Resolve and report the exact base commit.
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

## Choose the topology by repository count

Use `<workspace>/.worktrees/<plan-name>/` as the task root in both layouts.

Single repository: the task root is the native Git worktree. Place the
repository directly at:

```text
<workspace>/.worktrees/<plan-name>/
```

```text
<task-root>/               # native Git worktree
├── .git                   # linked-worktree metadata file
├── .ai/                   # independent Git clone + selected local context
├── .agents/skills/        # four relative links into this task-local .ai
├── docs/                  # only required external documentation, if selected
├── AGENTS.md              # source root guidance, when present
├── AGENTS.override.md     # preserved explicit routing and custom guidance
└── ...                    # repository files directly in the task root
```

Multiple repositories: the task root is a coordination directory. Place each
prepared repository under:

```text
<workspace>/.worktrees/<plan-name>/<repository-id>
```

Keep repository IDs unique and safe, and reserve `.ai`, `.agents`, `docs`,
`AGENTS.md`, and `AGENTS.override.md` for control context. Do not copy repository
files into the coordination directory outside their native Git worktrees:

```text
<task-root>/
├── .ai/                   # independent Git clone + selected local context
├── .agents/skills/        # four relative links into this task-local .ai
├── docs/                  # only required external documentation, if selected
├── AGENTS.md              # source root guidance, when present
├── AGENTS.override.md     # preserved explicit routing and custom guidance
└── <repository-id>/       # native Git worktree, one per repository
```

The source workspace is authoritative during preparation. Select a bounded
snapshot before mutation; do not mirror either `.ai/` or workspace `docs/`.
Never refresh an existing task root.

## Select the context before mutation

Inventory and report exact relative filenames in these three in-memory lists.
These lists are preparation inputs, not saved workflow state or a new copier.

- `canonical_files`: the union of committed and indexed canonical `.ai` files,
  plus explicitly inspected new canonical source files needed by this plan.
  Canonical locations are `.gitignore`, `AGENTS.md`, `README.md`, `package.json`,
  `pnpm-lock.yaml`, `.codex/config.toml`, `.agents/skills/`, `.github/`, `docs/`,
  `instructions/shared/`, `prompts/`, and `scripts/`. Directory entries here
  describe allowed source locations; expand them into regular-file paths,
  never recursive copies. Reject unexpected tracked paths before cloning.
  Include source deletions in the inventory so they remain deleted in the copy.
  Always include all four managed skills (`ai-build`, `ai-worktree-setup`,
  `ai-commit`, `ai-pr`), their metadata, and linked references, including
  inspected new canonical sources. Require each source directory and its
  `SKILL.md` to be real, readable, and contained by `.ai/.agents/skills/`,
  with no symbolic link in any component, before creating any worktree.
- `local_files`: `.ai/instructions/index.md`, every local file directly routed
  by that index (including nested routes), their necessary local references,
  and exactly the selected `.ai/plans/<plan-name>.md`. Include all direct index
  routes so the unchanged router remains valid; load only applicable guidance
  during execution. Canonical shared routes are already in `canonical_files`.
- `workspace_files`: `AGENTS.override.md`, root `AGENTS.md` when present, and
  individual external docs/specs that the plan or applicable guidance explicitly
  requires. References from custom root guidance/overrides must remain usable.
  Required `.ai/specs/` files belong in `local_files` instead. Do not select a
  whole docs/specs directory or infer that every link is required context.

Inspect the selected plan, router, applicable instructions, root guidance, and
required docs/specs for necessary file references. Resolve each relative to its
document, verify containment in the workspace (and `.ai` for `.ai` entries),
and reject absolute paths, `..` traversal, symbolic links in any component,
directories in place of files, and missing/unreadable required context. Reject
escaping links without reading their targets. Classify incidental historical
links as references rather than recursively collecting them. Stop for a missing
scope decision when a required reference points to unrelated plans or records;
do not quietly copy them or drop required context.

Exclude credentials and populated environment files, `.env*`, private keys,
credential stores, raw `.git` files/directories, hooks, dependency trees,
`node_modules`, caches, builds (`dist`, `build`, `out`), logs, artifacts, state,
temporary records, and unrelated plans/specs. Apply these exclusions to every
list, including tracked canonical candidates and required references. Stop if
required context conflicts with an exclusion. A broader snapshot requires
explicit named scope and never implicitly authorizes credential copying.

Require readable regular `AGENTS.override.md`, `.ai/AGENTS.md`, and the index.
Require the exact active routing block documented in `docs/codex-agent.md`
inside `.ai`, including the conditional root route, exactly once. Verify its
explicit routing order, including existing root guidance. Preserve an accepted
custom override byte-for-byte. If routing is absent or
ambiguous, stop with the existing `setup:codex` command and its actionable
routing guidance; do not generate an override here. Verify `.ai` is its own Git
top level, record its `HEAD`, and inspect its working tree and index separately.
No source Git config, hooks, alternate object storage, or external Git pointer
is part of selected context.

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

For a single repository, inspect the chosen base tree before mutation. Stop if
it contains `.ai` or `AGENTS.override.md`. Inspect every selected workspace file
against the base: an existing regular checkout file is acceptable only when
its bytes already equal the selected source file. Otherwise stop for a checkout
collision. Inspect `.agents/` and `.agents/skills/` in the base tree: existing
ancestors must be real directories, and none of the four managed skill paths
(`ai-build`, `ai-worktree-setup`, `ai-commit`, `ai-pr`) may exist, including
tracked links. Preserve unrelated custom files and skills. A tracked `docs/`
directory alone is not a collision. Context copying must never overwrite
differing checkout files or non-file entries.
Do not create the single-repository task root before `git worktree add`.

Preserve unrelated dirty-source changes. Application changes do not appear in
a new worktree; state that explicitly before continuing. Selected workflow and
context files instead use their current working bytes, including relevant
modifications, additions, and deletions, regardless of staging. A deleted
required file blocks preparation. Never stash, clean, reset, switch, merge,
rebase, delete, prune, or overwrite source state. Record source branch/HEAD,
status, index bytes, and selected-file bytes/modes before mutation; compare
them again afterward without printing sensitive data.

## Create safely

After every repository passes preflight:

Create the native Git worktrees before copying control context:

1. For a single repository, create only the `.worktrees/` parent if needed and
   use `<task-root>` as `<target>`. For multiple repositories, create the task
   root and use `<task-root>/<repository-id>` as each `<target>`.
2. For each repository, run the equivalent of:

   ```bash
   rtk git -C '<source-root>' worktree add -b '<branch>' '<target>' '<base-commit>'
   ```

   Never use `-B`, `--force`, detached worktrees, or branch/path reuse. Verify
   each target's worktree registration, top-level path, branch name, exact base
   commit, and clean status before copying control context.

3. Create independent `.ai` metadata using the local source repository. Use
   `--no-local` and `--no-hardlinks`, never `--shared`, `--reference`, a copied
   `.git`, or an external pointer. Disable hooks, remove the clone's origin
   immediately without displaying its URL, and check out the recorded commit.
   Clone configuration must contain no source-local config or credentials.
4. Overlay the preflighted exact-file lists with current source bytes,
   permissions, and timestamps. Remove only destination canonical files that
   are absent in the source inventory; never restore a source deletion from
   `HEAD`. Do not stage copied additions or modify source indexes. Read and
   execute the canonical [context-copy procedure](references/context-copy.md)
   with absolute `workspace`, `task_root`, `workflow_head`, and the three arrays
   resolved by preflight. The canonical array is relative to `.ai`; the other
   arrays are relative to the workspace. Recheck containment, file types,
   exclusions, and source stability immediately before running. All
   destinations must be absent except byte-identical selected workspace files
   already supplied by the native checkout. The procedure recreates all four
   project-root skill links against the task-local `.ai`. Do not copy source
   project-root skill links. It requires all four canonical skill sources and
   refuses managed-output collisions before copying.

5. Verify selected-file fidelity without printing contents: byte comparison,
   modes, selected deletions still absent, and all required files readable.
   Enumerate the destination outside its fresh `.git` to prove every file is
   either canonical or explicitly selected; verify excluded files are absent.
   Verify root/custom routing still resolves within the task root. Verify all four
   `.agents/skills/` entries are relative links to
   `../../.ai/.agents/skills/<skill-name>` and resolve within the task-local
   `.ai/.agents/skills/`. Preserve unrelated `.agents/` files and custom skills.
   Verify `.ai` resolves to its own Git top level, its `.git` is a local
   directory, there is
   no `objects/info/alternates`, no object hard links to the source, no remotes,
   no copied source hooks/config, and no parent-index tracking of `.ai`.
   Working modifications and deletions should match source selected context;
   the clone need not be clean. New untracked canonical files can make health
   fail its tracking check; report this, never stage them to manufacture green.
6. Run actual default and full `.ai` health from the task root after separately
   authorized dependency provisioning. Use the pinned package manager and
   report exact results, including source deletions or missing dependencies
   that block checks. Do not claim passing health from static inspection. These
   checks validate workflow routing/isolation, not application readiness.
7. Recheck every prepared checkout. In a single-repository task, copied control
   context may appear as untracked files; report it explicitly and require all
   tracked application files to remain clean with no other additions. Do not
   change ignore rules implicitly. Multi-repository child worktrees must remain
   clean. Recheck every source checkout and the source `.ai` files, index,
   branches, and HEAD; confirm preparation changed none of them.

If any creation, copy, or verification step fails after mutation begins, keep
the partial state, identify every created branch and path, and stop. Do not
perform automatic rollback or cleanup.

## Optional environment and dependency setup

Creating worktrees does not authorize secret copying or dependency installation.
Perform either only when the user or living plan explicitly requests it.

- Follow repository-owned setup instructions and pinned package-manager or
  runtime versions.
- Use reproducible lockfile-preserving install commands.
- Provision `.ai` dependencies separately with
  `rtk proxy corepack pnpm@10.34.4 --dir '<task-root>/.ai' install --ignore-workspace --frozen-lockfile`.
  Never copy or symlink the source `node_modules`, package store, or caches.
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
Control context: <independent .ai clone, selected-file fidelity, exclusions, root/custom routing>
Source work: <preserved dirty changes or clean>
Environment: <not requested or non-secret result>
Dependencies: <not requested or result per repository>
Validation: <checks passed and exact gaps>
```

For every ready task, print exactly one optional two-pane launcher with the
session name derived above. Print the command without starting tmux; running it
creates the named session. Start both panes at `<task-root>`. For a single
repository, this is already the checkout, so repository commands run directly
here. For multiple repositories, commands must explicitly select or enter the
intended child worktree by its relative repository ID. The copied plan, specs,
documentation, and instruction router are available directly from this root:

Print this launcher as plain `tmux`, without an `rtk` prefix or another wrapper,
so it also works on machines where RTK is not installed.

```bash
tmux new-session -s '<project-title> <plan-name>' -c '<task-root>' \; split-window -t '<project-title> <plan-name>:' -h -p 67 -c '<task-root>'
```

Do not emit separate launchers or repository-suffixed session names for a
multi-repository task.

Then print the exact ready-to-copy execution prompt without running it:

```text
/goal Implement <task-root>/.ai/plans/<plan-name>.md. Use the prepared worktrees reported above for all plan-owned edits. Preserve its boundaries, keep the task-local plan updated, run every required validation, and finish only when its definition of done is proven.
```

For controlled work, also require completion of the plan's independent final
review before finishing. State that preparation did not start implementation
and that delivery still requires separate explicit authorization.
