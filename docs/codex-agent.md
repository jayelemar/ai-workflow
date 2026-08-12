# Codex Project Instruction Setup

Codex discovers project instructions from `AGENTS.md` at the repository root
and then from nested directories toward the working directory. `.ai/AGENTS.md`
is workflow source, so active prompts read it directly.

Projects that want automatic discovery may add this optional repository-root
template:

```md
# Repository AI Instructions

Read and follow `.ai/AGENTS.md` before work.
Use `.ai/instructions/index.md` to load only instructions relevant to the
request.
```

Use the repository-root template for automatic discovery; no tool-specific
indirection file is required.

Reference: <https://learn.chatgpt.com/docs/agent-configuration/agents-md>
