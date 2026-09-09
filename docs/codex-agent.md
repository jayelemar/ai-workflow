# Codex Project Instruction Setup

Codex checks `AGENTS.override.md` before `AGENTS.md` in each workspace directory.
`.ai/AGENTS.md` remains the workflow source, so active prompts also read it
directly.

## Git Parent Checkout

When the directory containing `.ai/` is a Git checkout, use the local override
bootstrap to select the workflow without changing shared project instructions.

From `.ai`, run:

```bash
pnpm setup:codex
```

Or from the project root, run:

```bash
pnpm --dir .ai setup:codex
```

Both commands create this exact project-root file:

```md
# Local Project AI Instructions

Read and follow `.ai/AGENTS.md` before starting work.
Use `.ai/instructions/index.md` to load only instructions relevant to the request.

## Code Review Rules

- Before approving changes, check that login and access control still work.
- Do not expose private client, user, or firm data.
- Run the relevant tests. If a test cannot be run, clearly say why.

## Parallel Work Rules

- Agents may research or review in parallel.
- Never have more than one agent edit the same file at the same time.
```

The utility also adds the exact `/AGENTS.override.md` rule to the parent's resolved
repository-local Git exclude, verifies the file and ignored status, and is safe
to run repeatedly. It refuses to overwrite custom, tracked, symbolic-link, or
non-regular override targets.

Before mutation it also refuses every parent-root `AGENTS.md` entry and any
legacy `.codex/AGENTS.md`, matching fallback, or manual-token hook
configuration, code, cache, or state. Resolve those local conflicts explicitly;
the utility never rewrites them. Unrelated Codex configuration and nested
workflow source remain untouched.

## Unversioned Coordination Root

When the directory containing `.ai/` is an unversioned coordination root for
multiple independent repositories, the bootstrap stops before mutation because
there is no parent Git exclude to own. Use an existing operator-managed
`AGENTS.override.md` at that root with the exact content above. Do not add the
file to any child application repository. The workflow and portable worktree
prompt can then coordinate only the repositories explicitly declared by a
current saved plan.

Reference: <https://learn.chatgpt.com/docs/agent-configuration/agents-md>
