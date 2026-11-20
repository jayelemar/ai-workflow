# Utility Prompt Index

These prompts are independent utilities, not workflow stages. Local setup,
skill discovery, instruction management, worktree update review, and cleanup
require explicit invocation.
Read `.ai/AGENTS.md` plus relevant routed instructions.

- [Local Codex setup](setup-local-codex.md): install the safe
  local project override, canonical `.codex/config.toml`, and relative
  project-root links for all managed skills.
- [Agent skills discovery](skill-discovery.md): research and
  assess repository-relevant skills.
- [Instructions management](manage-instructions.md): create,
  update, route, or retire instruction guidance.
- [Review worktree updates](review-worktree-updates.md): explain task-owned
  documentation and instruction changes and request separate approval for each
  parent file change. Exclude plans; review starts only on explicit invocation.
- [Plan worktree cleanup](worktree-cleanup.md): inventory only
  without a selector; select `plan: .ai/plans/<plan-name>.md` or explicitly
  request bulk cleanup with `all-plans: true`, or use
  `include everything except saved-outfit-details.md and platform-services-mobile.md`.
  Bulk includes active plans unless explicitly excluded. Remove
  only selected plans, task worktrees, and owned records after inspection and
  exact operator confirmation; preserve unselected plans and all branches.

Start a review from the original workspace:

```text
Run `.ai/prompts/review-worktree-updates.md`.
worktree: .worktrees/<task-name>
```

[Brainstorm](../.agents/skills/brainstorm/SKILL.md) supports `$brainstorm` and
brainstorming requests, remaining read-only until `CREATE_PLAN`.

Plan creation is owned by
[Create Plan](../.agents/skills/create-plan/SKILL.md), invoked by plan creation or revision
requests and `$create-plan`. Execution follows [AGENTS.md](../AGENTS.md). Use the canonical skills directly for
[Worktree Setup](../.agents/skills/worktree-setup/SKILL.md)
(`$worktree-setup`), [Git Commit](../.agents/skills/git-commit/SKILL.md)
(`$git-commit`), and [Pull Request](../.agents/skills/pull-request/SKILL.md) (`$pull-request`).
Normal matching remains enabled; selection grants no extra mutation authority.
See [setup and request examples](../README.md#skills-and-utilities).
