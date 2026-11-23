# Utility Prompt Index

These prompts are independent utilities, not workflow stages. Skill discovery,
instruction management, and returning worktree docs require explicit invocation.
Local setup and selected worktree cleanup use the canonical skills linked below.
Read `.ai/AGENTS.md` plus relevant routed instructions.

- [Local Codex setup](../.agents/skills/setup-local-codex/SKILL.md): install the safe
  local project override, canonical `.codex/config.toml`, and relative
  project-root links for all managed skills.
- [Agent skills discovery](skill-discovery.md): research and
  assess repository-relevant skills.
- [Instructions management](manage-instructions.md): create,
  update, route, or retire instruction guidance.
- [Return worktree docs](return-worktree-docs.md): explain task-owned
  documentation, instruction, skill, and prompt changes and request separate approval for each
  parent file change. Exclude plans; review starts only on explicit invocation.
- [Worktree cleanup](../.agents/skills/worktree-cleanup/SKILL.md) (`$worktree-cleanup`): inventory only
  without a selector; select `plan: .ai/plans/<plan-name>.md` or explicitly
  request bulk cleanup with `all-plans: true`, or use
  `include everything except saved-outfit-details.md and platform-services-mobile.md`.
  Bulk includes active plans unless explicitly excluded. Remove
  only selected task resources, plans, worktrees, and owned records after
  inspection and exact operator confirmation; resources are removed before worktrees, and
  plans/evidence last. Preserve unselected plans/resources, source checkouts,
  and all branches. [Task Resources](../instructions/shared/task-resources.md)
  owns creation context and recovery requirements.

Return docs from the original workspace:

```text
Run `.ai/prompts/return-worktree-docs.md`.
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
