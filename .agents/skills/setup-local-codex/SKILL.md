---
name: setup-local-codex
description: Set up or repair project-local Codex instructions, configuration, and managed skill links, including missing-instruction bootstrap. Use when the user requests local Codex setup; preserve custom configuration and guidance.
---

# Setup Local Codex

Run only when the operator explicitly requests local project instruction setup.

1. Read and follow [Codex Setup](../../../docs/codex-setup.md), including its
   preservation, preflight, conflict, and recovery requirements.
2. If `.ai/instructions/index.md` or
   `.ai/instructions/local/architecture.md` is missing, read and follow
   [Create or Update Instructions](../../../prompts/manage-instructions.md) in bootstrap mode.
   Preserve valid existing instructions and use its single creation preview and
   approval. After creating and validating the approved files, continue this
   setup in the same session; do not require a separate prompt invocation.
   If both files exist, continue directly.
3. Run the documented setup command from the containing project root.
4. If setup fails, follow the guide's recovery procedure and report the conflict
   and any partial writes.
5. Report actual command output, exit status, the account-template follow-up,
   and the remaining restart and verification steps from the guide.
