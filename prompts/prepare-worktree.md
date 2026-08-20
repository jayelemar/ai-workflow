# Prepare a Portable Task Worktree

Create or validate isolated Git worktrees for one saved plan. This is an
optional setup utility: it prepares an execution environment but never runs
the plan, invokes `execute` or `/goal`, changes product code, stages files, or
creates commits.

This prompt supports all of these layouts without a project-specific branch:

- one Git repository whose checkout is also the plan workspace;
- a monorepo with one declared Git root; and
- an unversioned coordination root containing worktrees sourced from multiple
  independent Git repositories, including explicitly declared sibling
  repositories that share the plan workspace's parent directory.

## Invocation and Input

Run only when explicitly invoked with:

```text
run .ai/prompts/prepare-worktree.md, plan: .ai/plans/<plan-name>.md
```

Accept the repository-relative plan path above or a bare `<plan-name>`, which
resolves to `.ai/plans/<plan-name>.md`. If none is supplied, inspect
`.ai/plans/*.md`; use it only when exactly one plan exists, otherwise stop and
list the candidate paths. Do not select by recency.

Resolve the **plan workspace** as the directory containing the source `.ai/`
directory. The workspace may or may not be a Git repository. Reject absolute
paths, traversal, symlink escapes, unreadable files, and plans outside the
source `.ai/plans/` directory.

Read the complete plan. It must declare `plan-manifest@2`, exactly one
`LOW`, `MEDIUM`, or `HIGH` classification, a safe kebab-case `# Plan:` name
that matches the filename, and one or more valid `## Repositories` entries.
Each entry must provide a unique safe repository ID, a root relative to the
plan workspace, and an explicit integration-base ref. Resolve each root to a
Git checkout. A resolved root may be inside the plan workspace. For a plan
that declares two or more repositories, it may instead be an immediate sibling
of the plan workspace when both directories have the same real parent.

Treat repository roots as plan-owned path declarations, not general filesystem
access. Reject absolute roots, symlink escapes, duplicate or overlapping Git
roots, traversal to an ancestor, and every outside root other than the explicit
immediate-sibling case above. An outside sibling is a source checkout only;
every generated target and all control context must remain inside the task
root.

Validate the classification inputs before any mutation:

- LOW: the saved plan.
- MEDIUM: the saved plan and its readable saved spec.
- HIGH: the saved plan, spec, and
  `.ai/artifacts/<plan-name>/goal-handoff.md` using `goal-handoff@1`.

For HIGH, require the handoff's single `## Next Action` command to be a
`/goal` invocation that references this plan. Do not execute it.

Require and read the source workspace's `AGENTS.override.md` as the root
instruction entrypoint, then read `.ai/AGENTS.md`,
`.ai/instructions/index.md`, and only the routed instructions relevant to
worktree setup. Also read applicable repository-owned `AGENTS.md` files;
those may add narrower repository requirements but do not replace the root
override or relax this prompt's safety rules. Load the shared security guidance
whenever environment files, credentials, or secret configuration are in scope.
Follow a repository's required command wrapper (for example, `rtk`).

## Resolve the Topology and Targets

For every declared repository, use `git rev-parse --git-common-dir` and
`git worktree list --porcelain` to locate its primary checkout: the registered
worktree whose Git directory is the common Git directory, rather than linked
worktree metadata. The declared source root must be that primary checkout;
never create a worktree from a linked worktree or use a linked worktree's
control context as the source.

Use these paths:

```text
task root: <plan-workspace>/.worktrees/<plan-name>
```

Use the task root itself as a Git worktree only when the plan declares exactly
one repository in total and that repository's primary checkout is the plan
workspace. Every multi-repository plan uses the coordination-root layout,
including plans whose sources are the plan workspace plus one or more sibling
repositories. In that layout, each repository uses this immediate child of the
task root:

```text
<task-root>/<repository-id>
```

Do not create a second nested task root, use a singular `.worktree/`
directory, or place a worktree outside the task root. In the latter layout,
the task root is an unversioned coordination directory and its children are
the Git worktrees. Never copy or move a sibling source checkout into the task
root; create its linked Git worktree at the declared target child.

Derive one branch for each repository as `<branch-type>/<plan-name>`. Map a
validated `bugfix-spec@1` to `fix` and `feature-spec@1` to `feat`; use a
narrower conventional type (`docs`, `test`, `refactor`, `perf`, `ci`, or
`build`) only when the saved plan establishes it. Use `chore` only for
maintenance-only work. If the saved artifacts do not establish a branch type,
stop and ask the user. Never use agent, model, vendor, or tool prefixes.

Resolve the parent Codex runtime from `.ai/config/agent-models.toml` by
mapping `[roles.parent].tier` to `[tiers.<tier>].model` and reading its
`reasoning_effort`. Missing or conflicting values block setup; do not
substitute a runtime.

## Preconditions and Collision Rules

Before creating anything, for every repository:

1. Record its primary path, branch, upstream, exact integration-base ref and
   resolved base commit, current `HEAD`, status, and registered worktrees.
2. Require a clean tracked and non-ignored source worktree. Do not stash,
   clean, reset, switch, fetch, pull, merge, rebase, or otherwise modify it.
3. Require the plan's integration-base ref to resolve locally. Its resolved
   commit is the worktree base; do not silently replace it with current HEAD.
4. For a new task root, confirm the derived branch is valid, does not already
   exist locally or remotely, is not registered to another worktree, and its
   target path is absent. For an existing task root, require the existing
   branch and target to be the recorded matching relationship.
5. Never delete, overwrite, prune, detach, force, or reuse a branch/path
   collision.

Before mutation, also require the source workspace's `AGENTS.override.md` to
be a readable regular file whose references are portable to the task root. It
must delegate to the source workspace's `.ai/AGENTS.md` and contain no
credential or source-specific absolute path. When the plan workspace is a Git
repository, require the source override to be ignored by Git.

Require `.worktrees/` to be ignored in every repository for which it lies
inside the primary checkout. Reject an unignored target location. Do not use
Git file lists to inspect source `.ai/` because it can be an ignored nested
Git repository with required hidden files.

An existing task root is durable state, not an invitation to refresh it. Reuse
it only when its copied plan, repository leaves, branch names, base commits,
and Git registries exactly agree with this invocation. A missing leaf may be
created after that validation. Stop on any mismatch, unexpected local change,
or conflict; never repair it destructively.

## Create the Worktrees and Control Context

For a new task root:

1. Materialize the resolved Git topology. Only for a plan with exactly one
   repository whose primary checkout is the plan workspace, use `git worktree
   add -b <branch> <task-root> <base-commit>` so Git creates the task root. For
   every multi-repository plan, create only the unversioned task root, then
   create each child with `git worktree add -b <branch> <target>
   <base-commit>`. Do not use `-B`, `--force`, or a command that replaces an
   existing relationship.
2. Mirror the complete source `.ai/` tree into `<task-root>/.ai/`. Include
   ignored, hidden, generated, artifact, log, wrapper, plan, spec, instruction,
   and nested-Git entries. Preserve safe symlinks, permissions, timestamps, and
   relative paths. Create the target `.ai/` only after confirming it is absent;
   use an archive-preserving trailing-slash copy equivalent to:

   ```bash
   rsync -aH --safe-links '<source-workspace>/.ai/' '<task-root>/.ai/'
   ```

3. Mirror the source workspace's `AGENTS.override.md` to
   `<task-root>/AGENTS.override.md` as a regular file without changing its
   contents. Require the destination to be absent before copying and ignored
   by Git whenever the task root is itself a Git worktree. Never create a root
   `AGENTS.md` as a substitute for the override.
4. If a source `.codex/config.toml` exists, copy only that portable project
   configuration as a regular file to `<task-root>/.codex/config.toml` without
   displaying its contents. Do not copy authentication data, state, hooks,
   caches, or machine/session files. Stop if the configuration contains a
   credential or a source-worktree-specific absolute path.
5. Copy project-local `.agents/skills` only when source instructions require
   it. Copy independent files, require the target to be ignored, and never
   copy `.agents` state, `.claude`, or other session data by default.

In a coordination-root layout, the copied control context must remain outside
every application worktree.

Keep the copied plan byte-for-byte unchanged. Its declared repository roots
record source provenance and may not resolve to the generated targets from the
task root. The task-local `worktree-setup.md` report supplies the only allowed
filesystem overlay: it maps every repository ID to one verified target path
relative to the task root. The overlay changes no integration base, ownership,
task order, validation requirement, or desired behavior.

Verify the task-root override is byte-for-byte identical to the source root
without printing its contents and that its `.ai/AGENTS.md` reference resolves
inside the task root. For an existing task root, require the existing override
to match; stop rather than refreshing or overwriting it. Do not create an agent
instruction file inside `.codex/`.

## Secret Configuration and Dependencies

Do not copy `node_modules`, build outputs, caches, credentials, or populated
environment files as part of a general directory mirror.

When a declared repository needs populated environment files for dependency,
runtime, or setup validation, discover their required paths only from the
saved plan and applicable repository instructions. For each required `.env` or
`.env.*` source file:

- require a non-empty source, a safe destination within the matching target
  worktree, and a destination ignored by Git;
- copy it as a regular file only when the destination is absent, set `0600`,
  and never print, diff, hash-report, log, stage, commit, or otherwise expose
  its values;
- preserve an existing destination and validate it instead of overwriting it;
- report paths and key names only, never values; and
- stop if a required source, ignore rule, key name, permission, or non-secret
  endpoint decision cannot be established.

Never invent credentials, fall back to an example environment, or alter ports
and endpoint values unless the plan or repository instructions explicitly
define an isolated-runtime allocation rule. Apply such a rule exactly and
record only non-secret assignments. If the rule is missing or incompatible
with existing task-local environment state, stop and ask for a decision.

Prepare dependencies independently for each repository. Read its local
instructions, package manifests, lockfiles, runtime pins, and documented setup
first. For Node projects, reconcile `packageManager`, lockfile, runtime pins,
and engine constraints; conflicts block setup. Activate the pinned runtime and
run the lockfile-preserving command for the declared manager, such as `pnpm
install --frozen-lockfile`, `npm ci`, `yarn install --immutable`, or `bun
install --frozen-lockfile`. For other ecosystems, use only the repository's
documented reproducible install command. Never reuse or symlink dependencies
from the primary checkout. Initialize submodules only when `.gitmodules`
exists and repository instructions allow it.

If a setup operation changes tracked files, leave the changes intact, stop,
and report the affected paths as a blocker. If one repository succeeds and a
later one fails, preserve all partial state.

## Verify Setup

Verify without revealing secrets:

1. The source and target `.ai/` trees match for a new task root using an
   archive-preserving checksum dry run with trailing slashes, equivalent to
   `rsync -aHncni --delete --safe-links`, and no itemized changes. For a reused
   root, verify the selected plan and required artifacts are readable there
   without refreshing durable control context. The task-root
   `AGENTS.override.md` is a regular file, matches the source root, and resolves
   only to task-local instructions.
2. Each target is registered in `git worktree list`, resolves to its expected
   top-level directory, and has the derived branch and recorded base commit.
3. Each source primary still has its preflight branch, commit, and status.
4. Target control files are outside application worktrees in coordination-root
   layouts. Worktree-local Codex configuration, `AGENTS.override.md`, copied
   skills, and environment files are ignored whenever they are inside a Git
   worktree and do not resolve into the source workspace.
5. Every copied environment file is non-empty, `0600`, ignored, and has only
   the required key names checked. Report the environment-file count only.
6. Dependencies completed for every participating repository, and no tracked
   application file changed during setup.
7. `codex --version` and `codex login status` succeed without showing
   credentials. For HIGH, require `codex features list` to report `goals` and
   `multi_agent` enabled. For LOW/MEDIUM, report feature states when available
   but do not require HIGH-only features.
8. The selected plan, required spec/artifacts, `AGENTS.override.md`,
   `.ai/AGENTS.md`, `.ai/instructions/index.md`, and
   `.ai/config/agent-models.toml` are readable in the task root when present in
   the source workflow. Verify every instruction reference from the root
   override and applicable repository-owned `AGENTS.md` files is readable.
9. The repository mapping recorded for the task-local report is complete and
   unique. Each target is relative to and contained by the task root, maps to
   the same repository ID and recorded base as the saved plan, and matches the
   verified Git worktree registration and branch.

Create or update only this non-secret task-local report using document format
`worktree-setup@1` and exactly one status of `Ready`, `Partial`, or `Blocked`:

```text
.ai/artifacts/<plan-name>/worktree-setup.md
```

Record the source plan, classification, topology, repository IDs, primary and
target paths, task-root-relative repository mapping, bases and commits,
branches, control-context mirror result, environment destination names and
permission status, documented runtime assignments, dependency results, user
decisions, validation results, and any partial failure. Never record
environment values or credential-derived data.

If a failure occurs after mutation, leave every created root, worktree, branch,
environment file, dependency directory, and report intact. State the exact
failed step and partial state; do not remove anything automatically.

## Completion Output

Return a concise report:

```text
Preparation: Ready | Blocked | Partial
Plan: <task-local plan path>
Topology: single Git root | monorepo | coordination root with repositories
Task root: <absolute path>
Repositories: <id: branch @ base commit — worktree path, one per line>
Control context: <.ai mirror and portable Codex setup result>
Environment: <count and non-secret validation status>
Runtime: <documented assignments or not required>
Dependencies: <status per repository>
Validation: <passed checks and exact gaps>
```

Then print paste-ready session startup commands:

```bash
cd '<resolved-task-root>'
codex -m '<resolved-parent-model>' -c model_reasoning_effort='<resolved-parent-reasoning-effort>'
```

Finally print the exact resolved handoff in a separate text block:

- LOW/MEDIUM: `execute <task-local-plan-path>`
- HIGH: the validated `/goal` command from `goal-handoff.md`

State that setup did not run the handoff and that the user must invoke it in
the new Codex session to authorize implementation.

Version: 6.2
Last Updated: 2026-08-21
