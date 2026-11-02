# Codex Project Instruction Setup

Codex checks `AGENTS.override.md` before `AGENTS.md` in each workspace directory.
The nested `.ai/AGENTS.md` remains the authority for this repository and routes
planned or controlled work to the canonical nested skill.

## Git Parent Checkout

From `.ai`, run:

```bash
pnpm setup:codex
```

Or from the containing workspace:

```bash
pnpm --dir .ai setup:codex
```

The utility creates an ignored workspace-root `AGENTS.override.md` that directs
Codex to read root `AGENTS.md` when present, then `.ai/AGENTS.md`, then
`.ai/instructions/index.md`. This explicit order keeps existing root guidance
reachable even though Codex discovers the override first. The conditional root
route also covers root guidance added after setup. `.ai/AGENTS.md` loads the
canonical `.ai/.agents/skills/ai-build/SKILL.md` when applicable.

The setup utility also adds `/AGENTS.override.md` to the parent repository's
local Git exclude. It creates real `.agents/` and `.agents/skills/` directories
when absent and manages exactly these relative links:

| Project-root link                  | Relative target                              |
| ---------------------------------- | -------------------------------------------- |
| `.agents/skills/ai-build`          | `../../.ai/.agents/skills/ai-build`          |
| `.agents/skills/ai-worktree-setup` | `../../.ai/.agents/skills/ai-worktree-setup` |
| `.agents/skills/ai-commit`         | `../../.ai/.agents/skills/ai-commit`         |
| `.agents/skills/ai-pr`             | `../../.ai/.agents/skills/ai-pr`             |

Each generated link has its own exact local exclude. The utility does not
ignore the entire `.agents/` tree or alter the tracked parent ignore file.
Existing custom skills remain visible. Skill source stays inside `.ai`.

Existing root `AGENTS.md` must be a readable regular file;
setup preserves its bytes and tracking state. Tracked overrides, symbolic links,
non-regular instruction targets, and defined legacy Codex conflicts are rejected
before managed writes. Before mutation, the utility validates every source,
managed output, ancestor, routing requirement, and exclude requirement. Missing
sources, unsafe ancestors, tracked managed outputs, or conflicting files,
directories, dangling links, and wrong links stop setup. Only a link to the
exact expected local source is reusable. Repeated setup leaves valid outputs
unchanged. Unexpected write failures report partial writes; resolve the
reported conflict and retry without discarding unrelated content. Unrelated
Codex configuration remains untouched.

Tracked managed paths are checked case-insensitively on every filesystem.
Tracked case aliases and their tracked contents block setup even when deleted
locally; a matching link target does not make a tracked alias reusable.
Existing outputs and their `.agents/skills/` ancestors must also use the exact
canonical spelling reported by directory listings. Setup refuses filesystem
case aliases before writes, preserving them for explicit operator resolution;
it never broadens excludes or changes `core.ignorecase` to hide them.
Tracked file or submodule entries at `.agents` or `.agents/skills` also block
setup, including uninitialized submodules and paths deleted locally. Existing
output ancestors must belong to the parent repository and contain no nested Git
metadata; setup never writes into another repository. Custom repositories under
unrelated skill names are preserved.
Ownership requires the same canonical Git-directory identity as the parent,
not just the same reported worktree root. Project roots and output containers
inside Git metadata are refused, including separately configured Git directories.
Containment covers both the private Git directory and shared common directory
of linked worktrees; ordinary linked worktrees outside metadata remain supported.

Native skill discovery from project-root `.agents/skills/`, including symlinked
folders, is documented in [Build skills](https://learn.chatgpt.com/docs/build-skills).
No global skills or user configuration are installed. Applying setup to a live
project requires a separate explicit local setup request.

## Existing Overrides

Custom overrides are preserved byte-for-byte when they contain this exact block
once as active Markdown, outside code fences and enclosing HTML comments:

```md
<!-- ai-workflow-routing:start -->

Read and follow `AGENTS.md` first when it exists in this workspace root.
Then read and follow `.ai/AGENTS.md` before starting work.
Use `.ai/instructions/index.md` to load only instructions relevant to the request.
<!-- ai-workflow-routing:end -->
```

Custom rules may appear before or after the block. LF and CRLF line endings are
accepted without rewriting the file. Missing, changed, repeated, or inactive
blocks fail with a routing explanation before either managed target changes;
add the documented block while preserving existing guidance, then retry.

The utility recognizes only the exact previous generated template and upgrades
it to include this block. Similar prose or a previous template with custom text
is a custom override and is never automatically rewritten. Repeated setup
preserves accepted overrides and existing exact local exclude rules.

## Unversioned Coordination Root

When the containing workspace is not a Git checkout, setup stops before
mutation because no parent Git exclude can own the override. Use an existing
operator-managed `AGENTS.override.md` with the exact routing block above,
preserving any existing root and custom instructions.

Do not add this local override to a child application repository.

## Agent Model

The repository's `.codex/config.toml` sets `gpt-6.1-sol` as the default model
for trusted Codex sessions started inside `.ai`. Its `[agents]` defaults set
otherwise unconfigured sub-agents to `gpt-6.1-sol` with `high` reasoning,
independently of the parent's effort.

Verified on October 7, 2026 against the
[official OpenAI model documentation](https://learn.chatgpt.com/docs/models).
OpenAI recommends GPT-6.1 Sol for complex coding and agentic workflows when
available to the account and client.

For sessions started from the containing workspace, set the same `model` in
that workspace's `.codex/config.toml`, or start Codex with
`codex --model gpt-6.1-sol`. Restart the session after changing configuration.
The nested configuration does not apply when the working directory is above
`.ai`.

Reference: <https://learn.chatgpt.com/docs/config-file/config-advanced>

## Subagent Models and Tracking

The [Subagent Models and Names rules](../AGENTS.md#subagent-models-and-names)
define the scout, builder, and reviewer runtimes. Every role spawn supplies an
explicit model and reasoning effort, overriding the native `[agents]` defaults
and the parent session's settings. These instruction-driven assignments also
apply from the containing workspace when it loads `.ai/AGENTS.md`.

Names include the role, model family, actual effort, and purpose, for example:

- `scout_luna_high_auth_map`
- `builder_sol_high_auth_fix`
- `reviewer_sol_xhigh_auth_review`

Changing only a name does not change the runtime. Inspect the exposed
`spawn_agent` schema before each delegation. In the audited runtime, each role
spawn sets the matching full `model`, `reasoning_effort`, and
`fork_turns: "none"`; `"all"` inherits the parent runtime and cannot accept
overrides. Do not use a numeric fork depth or assume these arguments work in
every client.

A child without inherited history needs explicit context in its spawn message:
the repository, relevant instruction paths, bounded assignment, expected
result, and exclusive write ownership (or no edits for read-only work). If the
requested model, effort, or spawn override is unavailable, stop that delegation
and report the limitation instead of silently substituting or inheriting
another runtime. Do not claim verification in an untested client.

Explicit user runtime choices take precedence and must also appear in the name.
For example, an explicit Luna/low scout uses `scout_luna_low_auth_map` and supplies
`model: "gpt-6-luna"` with `reasoning_effort: "low"`.

Reference: <https://learn.chatgpt.com/docs/agent-configuration/subagents>

## Verification

After explicit setup, start a fresh Codex client from the containing workspace.
Use its skill catalog (`/skills`, or the app-server's read-only `skills/list`
with the project root in `cwds` and `forceReload: true`) to verify that
`ai-build`, `ai-worktree-setup`, `ai-commit`, and `ai-pr` are enabled and resolve
to this project's skill source. File inspection alone does not establish native
discovery. See [app-server skills](https://learn.chatgpt.com/docs/app-server).
Ask it to list its instruction sources; for planning or controlled work,
confirm it loads `.ai/.agents/skills/ai-build/SKILL.md`.

Prepared worktrees recreate links against their own independent `.ai` copy in
both supported layouts. They must not point back to the source workspace.
See the [skills and request examples](../README.md#skills-and-utilities).

For a delegated task, inspect the spawn arguments and confirm that its name,
model, and reasoning effort match the role defaults or the user's explicit
override. Record the accepted arguments and any runtime metadata actually
exposed; a requested setting alone is not independent proof of the underlying
execution model. A parent at `xhigh` must still spawn a default scout at `high`
and a default builder at `high`.

Reference: <https://learn.chatgpt.com/docs/agent-configuration/agents-md>
