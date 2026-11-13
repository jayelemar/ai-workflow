# Worktree checks

Read before mutation and again during destination verification. Gather all
independently discoverable repository, context, and layout blockers with a
corrective action for each. Inspect all selected repositories even if one fails.
Collect missing/unsafe source skills and required files alongside independent
context blockers. Check independently incompatible file permissions before
content proof or Git-dependent checks can stop. Skip only reads or Git probes
that depend on invalid paths.
Do not create any worktree until every preflight passes. Keep checks internal on
success; use the entrypoint's failure output for blockers or partial creation.

## Repository preflight and source preservation

When `.worktrees/` falls inside a Git checkout, require it to be ignored before
creating the task root. Do not change ignore rules implicitly. Reject symlinks
in every target ancestor, including `.worktrees/`, before resolving target paths.

Inspect internally, without mutation:

- source Git top level, branch, `HEAD`, chosen local base ref and exact commit;
- tracked, untracked, and ignored status relevant to the plan;
- existing worktrees, local branches, and matching remote branches; and
- proposed branch, target, task-root layout, and all selected context destinations.

Block roots outside the workspace, overlapping selected roots, unsafe symbolic
links, unresolved local bases, ambiguous ownership, matching remote branches,
and source application changes overlapping the plan. A matching remote branch
requires a different valid branch name; do not suggest tracking it. Local branch
or path collisions are blockers unless every retry condition below is proven.

For a single repository, inspect the chosen base tree before mutation. Stop if
it contains `.ai` or `AGENTS.override.md`. An existing selected workspace file
must be regular and match its source, allowing Git checkout normalization of
that same base; differing content is a checkout collision. Inspect `.agents/` and `.agents/skills/`: existing ancestors must be
real directories, and none of the managed skill paths may exist in the base,
including tracked links. Preserve unrelated custom files and skills. A tracked
`docs/` directory alone is not a collision. Do not create the single-repository
task root before `git worktree add`.

Preserve unrelated dirty-source changes. Application changes do not appear in
a new worktree; include that limitation in the successful `/goal` handoff.
Selected workflow and context files instead use current working bytes, including
modifications, additions, and deletions, regardless of staging. A deleted required
file blocks preparation. Never stash, clean, reset, switch, merge, rebase, delete,
prune, or overwrite source state. Record source branch/HEAD, status, index bytes,
and selected-file bytes/modes/timestamps before mutation; compare again afterward
without printing sensitive data. Expected source Git administration changes are
worktree registrations, newly created task branches, and local context excludes.
The context-copy procedure may append its three managed root rules to
the application repository's shared `info/exclude`. This can hide previously
untracked control context in source status; preserve its bytes and every other
source status entry. Inspect that exclude path before worktree creation: require
safe real ancestors and an absent or regular, non-symlink, single-link file.

## Matching interrupted setup

For every existing target, require all of the following before any creation:

- The target is a real native worktree registered at exactly that path in the
  expected source repository. Its top level and common Git directory match the
  expected repository; a lookalike checkout or external Git pointer is insufficient.
- Its branch equals the requested safe branch and its `HEAD` equals the exact
  resolved base commit. A branch advanced by implementation is a conflict.
- All tracked application files and the application index are clean. In a single
  repository, only selected control files and the exact managed links may
  appear as untracked additions; permit ignored context only after inventorying
  it too. Reject other additions, including ignored artifacts. In multiple
  repositories each child must be completely clean, including ignored additions.
- Single-repository roots contain only the base checkout plus selected control
  context. Multiple-repository coordination roots contain only expected child
  targets, selected control context, and their necessary real directory ancestors.
  Reject unexpected entries and conflicting files, links, or ancestors.

An absent task root with an existing branch is a collision, not proof of an
interrupted setup. A missing multi-repository child may be created only after
all existing children and shared context pass verification. An empty real
coordination root is resumable when all other evidence is compatible.

Before creating missing children, apply all read-only checks from
[context-copy.md](context-copy.md) to the existing shared context. A missing `.ai`
is resumable. An existing `.ai` must already have compatible independent clone
metadata, an intact baseline index, no remotes/active hooks/alternate storage,
complete object data, no hard-linked metadata files, and the exact recorded source
workflow commit. Match supported SHA-1/SHA-256 repository-format fields to
the source and verify supported files/reftable reference storage; a clone must
remain compatible on reverification. Reject invalid or incomplete
clone metadata rather than resetting, deleting, or automatically repairing it.
If the source workflow `HEAD` changed, the old clone cannot prove this request's
base. Report the mismatch and require an explicit new scope or target decision.

For canonical files, accept absent entries or content matching the recorded
workflow base (including Git checkout normalization) or intended current source,
with compatible base/source modes. Resolve baseline attributes from the recorded
commit, never from partially overlaid working-tree attribute files. Disable Git
replacement lookup for all copy-procedure reads so replacement refs cannot alter
recorded commits, trees, or attribute blobs; leave those refs untouched. Reject
task-local `.git/info/attributes` overrides before destination Git probes; leave
that unplanned metadata and all task edits untouched for user resolution.
Derive native base modes from Git executable status and the active umask
(`0666 & ~umask` or `0777 & ~umask`), rather than assuming `0644`/`0755`.
Overlay only those entries; apply selected source deletions only to matching
base content. Existing local/workspace files must match intended source bytes and
source modes (or a proven native tracked checkout mode). For tracked workspace
files, accept Git-normalized checkout bytes only when both source and destination
match that same baseline object; always copy exact selected source bytes. Reject hard-linked destination
context files; task edits must remain independent of sources.
Exact relative skill links are reusable even if copying their targets was
interrupted. Do not replace them. Reject incompatible source changes, unexpected
task edits, conflicting links, and unprovable state. Preserve selected metadata;
skip already correct files. No saved retry state, manifest, or sidecar is used.

## Copy safeguards

Execute the canonical context-copy block only after preflight. Recheck source
stability, containment, types, and exclusions immediately before copying.
Do not stage additions or modify source indexes. Require independent clone
metadata: `--no-local` and `--no-hardlinks`, never `--shared`, `--reference`, copied
`.git`, or an external pointer. Disable hooks, remove origin immediately without
printing its URL, and check out the recorded commit. Copy no source-local config
or credentials. Do not symlink dependencies, copy caches/builds, or mirror sources.

## Destination verification

Verify selected-file fidelity without printing contents: bytes, modes,
timestamps, selected deletions still absent, and required files readable.
Enumerate the destination `.ai` outside its `.git` to prove every file is
canonical or explicitly selected and excluded files are absent. Verify root/custom
routing resolves within the task root. Verify all managed `.agents/skills/` entries
are relative links to `../../.ai/.agents/skills/<skill-name>` and resolve within
the task-local `.ai/.agents/skills/`. Preserve unrelated `.agents/` files and skills.

Verify `.ai` resolves to its own Git top level at the recorded commit, its `.git`
and resolved common Git directory are that same local directory, no `commondir`
redirect exists, there is no `objects/info/alternates`, no object hard links
to the source, no remotes, no copied source hooks/config, and no parent-index
tracking of `.ai`. Working modifications, additions, and deletions must match
selected source context; the clone need not be clean or pass maintenance tracking.

Structural verification completes setup even with `.ai/node_modules` absent.
Do not run a package manager, default/full health, or dependency installation as
a routine completion gate. Workflow maintenance health belongs to revisions of
workflow source. Implementation owns dependency setup and application validation;
separately requested environment setup remains subject to its own authority.

Recheck every prepared checkout against the retry invariants above. In a
single-repository task, require `.ai/`, untracked `.agents/` entries, and
`AGENTS.override.md` to be effectively ignored through the context-copy
procedure's local excludes. Verify with `git ls-files --others --exclude-standard`
for those paths and inventory ignored context separately; ignoring must never
replace structural verification. Require tracked application files clean with
no other additions. Multi-repository children must remain clean. Recheck every source
checkout and source `.ai` files, index, branches, and HEAD; confirm only requested
worktree registrations, branches, and managed local exclude rules were added.

If creation, copy, or verification fails after mutation begins, keep partial state
and identify every created branch and path. Stop without automatic rollback,
source mutation, or cleanup. A later invocation may resume only by proving these
same conditions from current Git and file evidence.
