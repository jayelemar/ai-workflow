# Generate User Flow Artifact

This prompt creates a user-facing product-flow artifact from an approved spec and codebase inspection.

---

## Instruction Loading

Read:

- `.codex/AGENTS.md`
- `.ai/instructions/index.md`
- relevant `.ai/instructions/**/*.md`
- the approved spec file

Load:

- `.ai/prompts/superpowers.md`

Apply the superpowers advisory guidance for analysis and edge-case checks.

---

## Objective

Create the user-flow artifact for user-facing work before plan creation.

Output path:

`.ai/artifacts/<plan-name>/product-flow.md`

Derive `<plan-name>` from the spec filename by removing the path and `.spec.md`.

---

## Scope Rules

- The approved spec is the single source of desired behavior.
- Inspect the codebase only to identify current routes, components, services, APIs, state boundaries, storage effects, and existing tests.
- The artifact must not invent desired behavior beyond the spec.
- If the spec does not define a user-facing behavior well enough to create a deterministic flow, STOP and list the missing decisions.
- For non-user-facing work, do not create a product-flow artifact; the later plan records `N/A: <concrete reason>` in `## User Flow Artifact`.

---

## User-Facing Definition

User-facing work means a feature, bugfix, or change that affects a customer, admin, or operator screen, route, workflow, visible state, or user-triggered API behavior.

If the work is user-facing, this artifact is mandatory before plan creation.

---

## Artifact Format

The artifact must use Markdown + Mermaid only.

Rules:

- Do not include HTML.
- Do not include images.
- Do not include executable code except Mermaid fenced blocks.
- Keep implementation facts tied to observed codebase paths.
- Keep desired behavior tied to the approved spec.

---

## Required Artifact Sections

Create exactly these top-level sections, in this order:

## Goal

Summarize the spec-defined outcome in 1-3 bullets.

## Actors

List the user roles or systems that initiate or participate in the flow.

## Entry Points

List visible routes, screens, components, commands, API calls, or events where the user flow starts. Include repo-relative paths when known from codebase inspection.

## User Flows

List each user action in order. Each action must include:

- action name
- actor
- trigger
- expected system response
- relevant observed codebase path(s), when known

## Mermaid Diagram

Include one Mermaid flowchart showing the main path and important branches.

## States

List visible, request, persistence, and permission states that matter to the flow.

## Failures

List spec-defined or existing-codebase failure paths that affect the user experience.

## Acceptance Scenarios

Convert the spec acceptance criteria into scenario bullets tied to the user actions above.

## Open Decisions

List unresolved decisions. If none exist, write exactly:

`None`

---

## Validation

Before completing:

- verify all required sections exist
- verify the artifact is Markdown + Mermaid only
- verify every user action comes from the approved spec or codebase-inspected entry path
- verify no desired behavior was invented beyond the spec
- verify the artifact is saved to `.ai/artifacts/<plan-name>/product-flow.md`

If any requirement fails:

→ fix the artifact before completing

---

## INPUT

Spec file:
<repo-relative path>.spec.md

Default:
.ai/specs/<spec-file>.spec.md

---

## Final Output

Return only:

User flow artifact saved to .ai/artifacts/<plan-name>/product-flow.md
