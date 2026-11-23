---
name: worktree-cleanup
description: Inventory or clean up selected plans, task-owned local resources, worktrees, and records after exact confirmation. Use for plan or task-worktree cleanup requests; preserve branches and unrelated resources.
---

# Worktree Cleanup

Read and follow the complete [cleanup procedure](references/cleanup-procedure.md)
before inventory, confirmation, or mutation. It owns selection, ownership checks,
resource cleanup, filesystem removal, verification, and failure recovery.

Resolve this skill's canonical source through its generated discovery link to
locate the source `.ai/` and containing workspace. Verify the original workspace;
reject invocation from copied workflow context beneath `.worktrees/`. Discovery
links do not authorize following symlinks in cleanup targets or their ancestors.

With no selector, show only the read-only inventory and selection examples.
Selected cleanup requires the complete inventory, exact `PROCEED`, and all
rechecks in the procedure. Skill selection or invocation alone authorizes no
deletion, implementation, or delivery.
