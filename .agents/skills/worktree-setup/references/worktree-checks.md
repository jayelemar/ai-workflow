# Worktree checks

Read before mutation and again during destination verification. Complete every
repository preflight before creating any worktree. Keep checks internal on
success; use the entrypoint's failure output for blockers or partial creation.

## Repository preflight and source preservation

When `.worktrees/` falls inside a Git checkout, require it to be ignored before
creating the task root. Do not change ignore rules implicitly.

Inspect internally, without mutation:

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
ancestors must be real directories, and none of the six managed skill paths
(`create-plan`, `worktree-setup`, `git-commit`, `pull-request`, `show-summary`,
`show-qa-checklist`) may exist, including
tracked links. Preserve unrelated custom files and skills. A tracked `docs/`
directory alone is not a collision. Context copying must never overwrite
differing checkout files or non-file entries.
Do not create the single-repository task root before `git worktree add`.

Preserve unrelated dirty-source changes. Application changes do not appear in
a new worktree; include that limitation in the successful `/goal` handoff. Selected workflow and
context files instead use their current working bytes, including relevant
modifications, additions, and deletions, regardless of staging. A deleted
required file blocks preparation. Never stash, clean, reset, switch, merge,
rebase, delete, prune, or overwrite source state. Record source branch/HEAD,
status, index bytes, and selected-file bytes/modes before mutation; compare
them again afterward without printing sensitive data.

## Copy safeguards

Use the required context-copy block, preserving current source bytes, permissions,
and timestamps. Remove only destination canonical files absent in the source
inventory; never restore source deletions from `HEAD`. Do not stage additions or
modify source indexes. Destinations must be absent except byte-identical selected
workspace files supplied by the checkout. Require independent clone metadata:
`--no-local` and `--no-hardlinks`, never `--shared`, `--reference`, copied `.git`,
or an external pointer. Disable hooks, remove origin immediately without printing
its URL, and check out the recorded commit. Copy no source-local config or
credentials.

## Destination verification

Verify selected-file fidelity without printing contents: byte comparison,
modes, selected deletions still absent, and all required files readable.
Enumerate the destination outside its fresh `.git` to prove every file is
either canonical or explicitly selected; verify excluded files are absent.
Verify root/custom routing still resolves within the task root. Verify all six
`.agents/skills/` entries are relative links to
`../../.ai/.agents/skills/<skill-name>` and resolve within the task-local
`.ai/.agents/skills/`. Preserve unrelated `.agents/` files and custom skills.
Verify `.ai` resolves to its own Git top level, its `.git` is a local
directory, there is
no `objects/info/alternates`, no object hard links to the source, no remotes,
no copied source hooks/config, and no parent-index tracking of `.ai`.
Working modifications and deletions should match source selected context;
the clone need not be clean. New untracked canonical files can make health
fail its tracking check; treat this as a blocker, never stage them to manufacture green.

Run actual default and full `.ai` health from the task root after separately
authorized dependency provisioning. Use the pinned package manager and
record exact results internally, including source deletions or missing dependencies
that block checks. Do not claim passing health from static inspection. These
checks validate workflow routing/isolation, not application readiness.

Recheck every prepared checkout. In a single-repository task, copied control
context may appear as untracked files; include that fact in the `/goal` handoff and require all
tracked application files to remain clean with no other additions. Do not
change ignore rules implicitly. Multi-repository child worktrees must remain
clean. Recheck every source checkout and the source `.ai` files, index,
branches, and HEAD; confirm preparation changed none of them.

If creation, copy, or verification fails after mutation begins, keep partial
state and identify every created branch and path. Stop without automatic
rollback, source mutation, or cleanup.

## Separately authorized environment setup

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
