# Utility Prompt Index

These prompts are independent utilities, not workflow stages. Local setup,
skill discovery, instruction management, and cleanup require explicit invocation.
Read `.ai/AGENTS.md` plus relevant routed instructions.

- [Local Codex setup](setup-local-codex.md): install the safe
  local project override, canonical `.codex/config.toml`, and four relative
  project-root skill links.
- [Agent skills discovery](skill-discovery.md): research and
  assess repository-relevant skills.
- [Instructions management](manage-instructions.md): create,
  update, route, or retire instruction guidance.
- [Plan worktree cleanup](worktree-cleanup.md): inventory only
  without a selector; select `plan: .ai/plans/<plan-name>.md` or explicitly
  request bulk cleanup with `all-plans: true` (including active plans). Remove
  only selected plans, task worktrees, and owned records after inspection and
  exact operator confirmation; preserve unselected plans and all branches.

Plan creation is owned by
[Create Plan](../.agents/skills/create-plan/SKILL.md), invoked by plan creation or revision
requests and `$create-plan`. Execution follows [AGENTS.md](../AGENTS.md). Use the canonical skills directly for
[Worktree Setup](../.agents/skills/worktree-setup/SKILL.md)
(`$worktree-setup`), [Git Commit](../.agents/skills/git-commit/SKILL.md)
(`$git-commit`), and [Pull Request](../.agents/skills/pull-request/SKILL.md) (`$pull-request`).
Normal matching remains enabled; selection grants no extra mutation authority.
See [setup and request examples](../README.md#skills-and-utilities).
