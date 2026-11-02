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

The canonical combined planning and execution workflow is
[AI Build](../.agents/skills/ai-build/SKILL.md), invoked by normal planning or
existing-plan requests and `$ai-build`. Use the canonical skills directly for
[AI Worktree Setup](../.agents/skills/ai-worktree-setup/SKILL.md)
(`$ai-worktree-setup`), [AI Commit](../.agents/skills/ai-commit/SKILL.md)
(`$ai-commit`), and [AI PR](../.agents/skills/ai-pr/SKILL.md) (`$ai-pr`).
Normal matching remains enabled; selection grants no extra mutation authority.
See [setup and request examples](../README.md#skills-and-utilities).
