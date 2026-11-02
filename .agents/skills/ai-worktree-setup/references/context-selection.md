# Context selection

Read before selecting context or creating worktrees. Keep the source workspace
authoritative: select a bounded snapshot; never mirror `.ai/` or workspace
`docs/`, or refresh an existing task root.

Inventory exact relative filenames in these three in-memory lists.
These lists are preparation inputs, not saved workflow state or a new copier.

- `canonical_files`: the union of committed and indexed canonical `.ai` files,
  plus explicitly inspected new canonical source files needed by this plan.
  Canonical locations are `.gitignore`, `AGENTS.md`, `README.md`, `package.json`,
  `pnpm-lock.yaml`, `.codex/config.toml`, `.agents/skills/`, `.github/`, `docs/`,
  `instructions/shared/`, `instructions/mobile/`, `instructions/desktop/`,
  `instructions/web/`, `instructions/server/`, `prompts/`, and `scripts/`.
  Include reusable source across all five instruction roots, including nested
  platform and framework files; task relevance controls loading, not source
  availability. Directory entries here
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
  during execution. Preserve paths under `instructions/local/`, including
  `local/architecture.md` and any necessary references it requires. Canonical
  routes in all five reusable roots are already in `canonical_files`. Select
  local files individually; do not copy the entire `instructions/local/` tree.
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
