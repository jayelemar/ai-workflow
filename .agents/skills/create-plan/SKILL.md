---
name: create-plan
description: Create, revise, or review an implementation plan before execution. Use when the user requests a saved plan or work requires planning first. Do not use merely to implement an existing plan.
---

# Create Plan

Produce one decision-complete plan grounded in the request and repository.
This skill creates or revises plans; it does not implement them or start a Goal.
Execution standards belong to `.ai/AGENTS.md`.

If brainstorming is active, first follow the gate in
[Brainstorm](../brainstorm/SKILL.md). Selecting this skill does not bypass it.

Read [plan-template.md](references/plan-template.md) before planning. Inspect
current code, constraints, and relevant instructions; resolve material decisions
with the user. Keep the outcome, boundaries, decisions, tasks, required validation,
and definition of done independently understandable by the next implementer.

Respect the active client mode. In native Plan mode, present the plan using its
required format without writing files. When saving is permitted, use the user's
path or the reference's `.ai/plans/` naming convention. Revise the same selected
plan rather than creating companion specifications or status artifacts.

After saving a new plan, report its exact path and provide the reference's
ready-to-copy `/goal` prompt as a convenience. Native Execute plan and normal
implementation requests are equally supported. Do not start the Goal automatically.
For controlled work, include the required independent final review in the plan
and its execution handoff.
