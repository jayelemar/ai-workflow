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
Codex to read `.ai/AGENTS.md` and `.ai/instructions/index.md`. It does not copy
the workflow skill into the parent repository; `.ai/AGENTS.md` loads the
canonical `.ai/.agents/skills/change-workflow/SKILL.md` when applicable.

The setup utility also adds `/AGENTS.override.md` to the parent repository's
local Git exclude. It refuses to overwrite custom, tracked, symbolic-link, or
non-regular targets and leaves unrelated Codex configuration untouched.

## Unversioned Coordination Root

When the containing workspace is not a Git checkout, setup stops before
mutation because no parent Git exclude can own the override. Use an existing
operator-managed `AGENTS.override.md` with these routing rules:

```md
# Local Project AI Instructions

Read and follow `.ai/AGENTS.md` before starting work.
Use `.ai/instructions/index.md` to load only instructions relevant to the request.
```

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

Changing only a name does not change the runtime. Each `spawn_agent` call must
set the matching full model ID, reasoning effort, and `fork_turns: "4"`;
a full-history fork inherits the parent runtime and cannot accept overrides.
Explicit user runtime choices take precedence and must also appear in the name.
For example, an explicit Luna/low scout uses `scout_luna_low_auth_map` and supplies
`model: "gpt-6-luna"` with `reasoning_effort: "low"`.

Reference: <https://learn.chatgpt.com/docs/agent-configuration/subagents>

## Verification

Start a new Codex session from the containing workspace and ask it to list its
instruction sources. For a planning or controlled request, confirm that it also
loads `.ai/.agents/skills/change-workflow/SKILL.md`.

For a delegated task, inspect the spawn arguments and confirm that its name,
model, and reasoning effort match the role defaults or the user's explicit
override. A parent at `xhigh` must still spawn a default scout at `high` and a
default builder at `high`.

Reference: <https://learn.chatgpt.com/docs/agent-configuration/agents-md>
