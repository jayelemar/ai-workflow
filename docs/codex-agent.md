# Codex Project Instruction Setup

Codex checks `AGENTS.override.md` before `AGENTS.md` in each project directory.
Use the local override bootstrap to select the nested `.ai` workflow without
changing shared project instructions. `.ai/AGENTS.md` remains workflow source,
so active prompts also read it directly.

From `.ai`, run:

```bash
pnpm setup:agents-override
```

Or from the project root, run:

```bash
pnpm --dir .ai setup:agents-override
```

Both commands create this exact project-root file:

```md
# Local Project AI Instructions

Read and follow `.ai/AGENTS.md` before starting work.
Use `.ai/instructions/index.md` to load only instructions relevant to the request.
```

The utility also adds the exact `/AGENTS.override.md` rule to Git's resolved
repository-local Git exclude, verifies the file and ignored status, and is safe
to run repeatedly. It refuses to overwrite custom, tracked, symbolic-link, or
non-regular override targets.

Before mutation it also refuses every parent-root `AGENTS.md` entry and any
legacy `.codex/AGENTS.md`, matching fallback, or manual-token hook
configuration, code, cache, or state. Resolve those local conflicts explicitly;
the utility never rewrites them. Unrelated Codex configuration and nested
workflow source remain untouched.

Reference: <https://learn.chatgpt.com/docs/agent-configuration/agents-md>
