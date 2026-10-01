# Utility Prompt Index

These prompts are independent utilities, not workflow stages. Use one only
after an explicit user invocation and read `.ai/AGENTS.md` plus the routed
instructions required by that utility.

- [AGENTS override setup](utilities/agents-override-setup.md): install the safe
  local project override.
- [Agent skills discovery](utilities/agent-skills-discovery.md): research and
  assess repository-relevant skills.
- [Instructions management](utilities/instructions-management.md): create,
  update, route, or retire instruction guidance.
- [Worktree preparation](utilities/prepare-worktree.md): safely create native
  Git worktrees for one living plan and output its execution prompt.
- [Commit organizer](utilities/commit-organizer.md): propose and, after explicit
  authorization, organize focused local commits.
- [Pull request creation](utilities/pull-request-creation.md): prepare and,
  after explicit approval, create a pull request.

The canonical implementation workflow is the progressive
[change-workflow skill](../.agents/skills/change-workflow/SKILL.md).
