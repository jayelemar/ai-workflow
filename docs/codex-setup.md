# Codex Setup

Codex checks `AGENTS.override.md` before `AGENTS.md` in each workspace
directory. The nested [AGENTS.md](../AGENTS.md) owns execution behavior for native Execute plan, `/goal`, and ordinary
requests. It routes plan creation to `.ai/.agents/skills/create-plan/SKILL.md`.

## Run Setup

The local `instructions/index.md` and `instructions/local/architecture.md`
are ignored by Git and absent from a fresh clone. The
[setup skill](../.agents/skills/setup-local-codex/SKILL.md) handles missing files through
[Create or Update Instructions](../prompts/manage-instructions.md) in bootstrap
mode, then continues installation after its creation approval and validation.
Existing valid instructions are preserved. Before skill discovery is installed,
ask Codex to read and follow `.ai/.agents/skills/setup-local-codex/SKILL.md`
directly; afterward use `$setup-local-codex`. For manual CLI setup, complete that
bootstrap first if either file is missing; the utility requires a nonempty index
and does not discover or generate project instructions.

Run only after an explicit local setup request, from the containing project root (Git or unversioned):

```bash
rtk proxy corepack pnpm@10.34.4 --dir .ai setup:codex
```

From `.ai`, the equivalent is `rtk proxy corepack pnpm@10.34.4 setup:codex`.
After instruction bootstrap, delegate all installation mutation, preflight, and validation to the
[setup utility](../scripts/setup/agents-override.mjs). Do not add independent
installation filesystem, Git, or workflow-stage logic.

## Installed Files

The utility preserves readable regular root `AGENTS.md` bytes and tracking
state, and installs these project-local outputs:

| Output                                      | Behavior                                                                                                                         |
| ------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------- |
| `AGENTS.override.md`                        | Routes root guidance first when present, then `.ai/AGENTS.md` and `instructions/index.md`; also covers root guidance added later |
| `.agents/skills/brainstorm`                 | Relative link to `../../.ai/.agents/skills/brainstorm`                                                                           |
| `.agents/skills/create-plan`                | Relative link to `../../.ai/.agents/skills/create-plan`                                                                          |
| `.agents/skills/worktree-setup`             | Relative link to `../../.ai/.agents/skills/worktree-setup`                                                                       |
| `.agents/skills/git-commit`                 | Relative link to `../../.ai/.agents/skills/git-commit`                                                                           |
| `.agents/skills/pull-request`               | Relative link to `../../.ai/.agents/skills/pull-request`                                                                         |
| `.agents/skills/show-summary`               | Relative link to `../../.ai/.agents/skills/show-summary`                                                                         |
| `.agents/skills/manual-qa-checklist`        | Relative link to `../../.ai/.agents/skills/manual-qa-checklist`                                                                  |
| `.agents/skills/worktree-cleanup`           | Relative link to `../../.ai/.agents/skills/worktree-cleanup`                                                                     |
| `.agents/skills/setup-local-codex`          | Relative link to `../../.ai/.agents/skills/setup-local-codex`                                                                    |
| `.codex/config.toml`                        | Byte-exact snapshot of `.ai/.codex/config.toml`, currently the only canonical config content                                     |
| `instructions/local/github.md` inside `.ai` | Ignored account-mapping template with generic placeholders; existing local content is preserved                                  |

The `.agents/`, `.agents/skills/`, and `.codex/` containers are real directories.
When the parent is a Git repository, only the override, managed skill links,
and config file receive exact parent local Git excludes. Unversioned parents
install the same outputs without creating Git metadata or ignore files.
Tracked ignore files, custom skills, other `.codex/` files,
global/user config, authentication files, and runtime state remain untouched.
Source skills remain in `.ai`; no global skills are installed. Valid outputs
are reused unchanged on repeated setup. Source config changes do not update an
installed snapshot automatically: an identical regular file is reused; a
differing config stops all setup before writes for explicit resolution.

Rerun setup after adding these outputs to an existing installation. It adds
missing skill links and the private account template while reusing valid outputs.
The template is created with owner-only file permissions and contains no account
names, credentials, or detected machine configuration. Fill in its repository,
GitHub login, and CLI profile mappings locally; existing bytes, modes, and
timestamps are preserved on reruns. Account authentication and CLI profile
configuration remain separate operator steps. Both delivery skills read the
local file through the shared delivery instructions, without changing the index.
After setup, report the ignored template's location and ask the operator to
complete its mappings once. Setup does not sign in, create CLI profiles, or
copy credentials.

## Existing Installations and Skill Renames

Run the setup command above to install the current skill links and retire
previously generated links, including `show-plan-progress`. Only untracked symlinks with the exact old generated relative
target are removed, even if dangling after source renaming. Setup verifies new
outputs before removing old links. Custom entries, wrong links, tracked paths,
and case aliases stop setup before writes; resolve them explicitly. Existing
Git excludes remain intact, and only exact new excludes are appended.
Retries reuse valid new links and finish any remaining legacy-link removal.
Historical plans and prepared task roots are not rewritten. Recreate prepared
execution environments when they need the renamed workflow.

## Custom Instruction Routing

A custom override is preserved byte-for-byte only when this exact block occurs
once as active Markdown, outside code fences and enclosing HTML comments:

```md
<!-- ai-workflow-routing:start -->

Read and follow `AGENTS.md` first when it exists in this workspace root.
Then read and follow `.ai/AGENTS.md` before starting work.
Use `.ai/instructions/index.md` to load only instructions relevant to the request.
<!-- ai-workflow-routing:end -->
```

Custom rules may surround the block; LF and CRLF are accepted without rewriting.
Missing, changed, repeated, or inactive blocks fail before writes. Add the block
while preserving guidance, then retry. Only the exact previous generated
template is upgraded automatically; similar prose or added custom text is never
automatically rewritten. Accepted overrides and exact excludes remain unchanged.

## Conflicts and Recovery

Whole-operation preflight validates sources, outputs, ancestors, routing, and
excludes before managed writes. Stop and resolve the reported condition without
discarding root/custom guidance; never force, merge, or overwrite automatically.
Do not broaden ignores or bypass preflight.

- Reject tracked managed outputs, tracked overrides, symlink/non-regular
  instruction targets, defined legacy Codex conflicts, missing sources, unsafe
  ancestors, and conflicting files, directories, dangling or wrong links. Only
  links to the exact expected local source are reusable.
- Require the private account path to be ignored and untracked in the workflow
  repository, and untracked in the parent. Its ancestors must remain real local
  directories in the workflow repository. Unsafe paths, case aliases, shared
  files, and tracked entries deleted locally stop setup before writes. Setup
  never broadens workflow ignore rules or prints existing account mappings.
- Check tracked managed paths case-insensitively on every filesystem, including
  tracked aliases and contents deleted locally. A matching target does not make
  a tracked alias reusable. Existing outputs and ancestors must have directory
  listings' exact canonical spelling. Preserve case aliases for resolution;
  never broaden excludes or change `core.ignorecase` to hide them.
- Reject tracked files or submodules at `.agents`, `.agents/skills`, or `.codex`,
  including uninitialized submodules and entries deleted locally. Output
  ancestors must belong to the parent's canonical Git-directory identity and
  contain no nested Git metadata; reported worktree root alone is insufficient.
  Preserve unrelated skill repositories.
- Reject project roots and output containers inside private or shared common
  Git metadata, including separately configured Git directories. Ordinary
  linked worktrees outside metadata are supported.
- Unexpected write failures must report partial writes. Preserve unrelated
  content, resolve the reported conflict, and retry; non-zero exit is no success.

Report actual command output and exit status. Never claim success after a
non-zero result.

Without a Git parent, setup installs and verifies the same outputs while skipping
parent tracking and exclude operations. The independent `.ai` Git repository
and its private account ignore checks remain required. Existing output containers
must remain real directories without nested Git metadata. Broken Git metadata,
Git metadata directories, and a parent inside another worktree still stop setup
before writes. Run setup at the coordination root, not in a child application
repository.

## Runtime Configuration

The repository `.codex/config.toml` sets trusted `.ai` sessions' default model
to `gpt-6.1-sol` and otherwise unconfigured sub-agents to `gpt-6.1-sol` with
`high` reasoning, independently of parent effort. Setup copies these defaults
for containing-workspace sessions; nested config alone does not apply above
`.ai`. Restart Codex from the trusted project root. Higher-priority runtime and
command-line settings still apply. See [project configuration](https://learn.chatgpt.com/docs/config-file/config-advanced).

## Verify Setup

After setup, verify in a fresh client:

1. Inspect `/skills`, or read-only app-server `skills/list` with the project
   root in `cwds` and `forceReload: true`. Confirm `create-plan`,
   `worktree-setup`, `git-commit`, `pull-request`, `show-summary`, `worktree-cleanup`,
   `setup-local-codex`,
   `manual-qa-checklist`, and `brainstorm` are enabled and resolve to this
   project's source. File inspection alone does not prove native discovery.
2. Ask for instruction sources; verify root-first routing. Plan creation loads
   `.ai/.agents/skills/create-plan/SKILL.md`; saved-plan execution follows
   `.ai/AGENTS.md` without invoking the planning skill.
3. Prepared worktrees must recreate links against their own independent `.ai`
   copy in both layouts, never the source workspace.
4. For delegation, follow [Subagent Models and Names](../AGENTS.md#subagent-models-and-names).
   Compare accepted spawn arguments with the role/name/model/effort and record
   only exposed runtime metadata. Requested settings alone do not independently
   prove the execution model or support in another client.

Native discovery and configuration references:
[skills](https://learn.chatgpt.com/docs/build-skills),
[app-server skills](https://learn.chatgpt.com/docs/app-server),
[instruction sources](https://learn.chatgpt.com/docs/agent-configuration/agents-md).
