Version: 1.0
Last Updated: 2026-07-18

# Documentation And Runbook Instructions

## Purpose

Keep architecture, security, workflow, setup, deployment, and recovery guidance
usable by operators, implementers, and reviewers.

## Applies To

- Security-sensitive domains, cross-system contracts, ownership boundaries, migrations, deployments, and operational recovery changes.
- Workflow documentation, skill entrypoints, prompts, and repository instructions.

## Rules

- Maintain a threat model and authorization matrix for each security-sensitive domain; update them when trust boundaries, roles, permissions, or sensitive data flows change.
- Document system contracts, ownership boundaries, and externally visible compatibility expectations when a change crosses modules, services, or teams.
- Document deployment, migration, rollback, and recovery procedures for changes that need operator action or production observation.
- Keep README and feature documentation aligned with architecture changes that alter entry points, boundaries, configuration, or operating procedures.
- Write runbooks as executable steps with prerequisites, signals, safe actions, escalation criteria, and recovery verification.

- Give each file one purpose and each rule one canonical owner. Link to that
  owner instead of repeating its procedure.
- Write in plain language with actionable bullets: name the action, condition,
  and evidence needed. Remove filler and obsolete examples.
- Keep entrypoints short. Move substantial detail to focused references and
  explicitly require reading them before the relevant action; moving a safeguard
  must not make it optional or unreachable.

## Placement

- Put repository paths, system diagrams, owner names, and deployment tooling in local documentation.
- Put reusable documentation and runbook requirements in this file.

## Validation

- Verify documentation describes current behavior and names the owner, trigger, validation signal, and recovery outcome.
- Review security-sensitive documentation with the implementation's authorization boundaries and audit evidence.
- Verify a peer unfamiliar with the change can identify deploy, observe, diagnose, and recover steps from the documentation.

- Check relative links and compare revised guidance with the original for
  preserved applicability, exclusions, approval boundaries, and required evidence.
- Verify workflow references are reachable before their required steps.

## Anti-Patterns

- Recording decisions only in ephemeral chat, commit messages, or incident threads.
- Calling a high-level narrative a runbook when it has no executable recovery steps.
- Leaving threat models or authorization matrices unchanged after a trust-boundary change.
- Duplicating implementation details across documents without one maintained source of truth.
