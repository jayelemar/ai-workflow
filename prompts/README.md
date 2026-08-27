# Prompt Index

Use these prompts only through an explicit user invocation. Read
`.ai/AGENTS.md` and the routed instructions required by the selected prompt.

## Workflow

Ordered application-development stages and their supporting controls:

- [Select workflow](workflow/select-workflow.md): classify the request.
- [Generate specification](workflow/generate-spec.md): finalize feature or
  bug-fix behavior.
- [Generate flow artifacts](workflow/generate-flow-artifacts.md): map required
  journeys and implementation ownership.
- [Create plan](workflow/create-plan.md): save the executable plan.
- [Prepare worktree](utilities/prepare-worktree.md): prepare validated execution
  targets.
- [Execute plan](workflow/execute-plan.md): implement an explicitly invoked
  plan.
- [Review changes](workflow/review-changes.md): perform formal or explicitly
  invoked manual independent review loops.
- [Goal checkpoint](workflow/goal-checkpoint.md): manage HIGH task evidence and
  commits.
- [Resume goal](workflow/resume-goal.md): resume a valid HIGH handoff.

## Utilities

Independent repository setup, discovery, maintenance, and delivery actions:

- [AGENTS override setup](utilities/agents-override-setup.md): install the safe
  local project override.
- [Agent skills discovery](utilities/agent-skills-discovery.md): research and
  assess repo-relevant skills.
- [Instructions management](utilities/instructions-management.md): create,
  update, route, or retire instruction guidance.
- [Workflow cleanup](utilities/cleanup-workflow.md): preview and safely remove
  local workflow records and task worktrees with explicit issue approval.
- [Review until clear](utilities/review-until-clear.md): repeatedly review,
  remediate, and validate an implemented plan until no blocking findings remain.
- [Commit organizer](utilities/commit-organizer.md): organize focused commits.
- [Pull request creation](utilities/pull-request-creation.md): prepare and create
  an explicitly requested pull request.

Wrappers under `.ai/wrappers/` remain thin input adapters and point to the
canonical prompt paths above.
