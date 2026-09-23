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

## Verification

Start a new Codex session from the containing workspace and ask it to list its
instruction sources. For a planning or controlled request, confirm that it also
loads `.ai/.agents/skills/change-workflow/SKILL.md`.

Reference: <https://learn.chatgpt.com/docs/agent-configuration/agents-md>
