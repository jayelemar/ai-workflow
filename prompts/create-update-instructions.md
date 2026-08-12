# Create or Update Instructions

Create or update reusable instruction guidance without changing application
behavior.

## Input

```text
Target area: <local or shared instruction>
Observed repeated rule: <repository evidence>
Requested outcome: <create | update | route | retire>
```

## Required Inspection

- Read `.ai/AGENTS.md` and ignored `.ai/instructions/index.md`.
- Inventory relevant `.ai/instructions/**/*.md` using ignored-file-aware search.
- Read the target instruction and overlapping shared baselines.
- Inspect enough current repository evidence to distinguish a reusable rule
  from a one-off implementation detail.

## Ownership

- Keep portable policy under `.ai/instructions/shared/`.
- Keep project paths, commands, framework choices, and area ownership in
  ignored project-local instructions under `.ai/instructions/`.
- Keep `.ai/instructions/index.md` limited to routing. Route every maintained
  local instruction, including applicable debugging, maintainability, and
  documentation/runbook baselines.
- Keep canonical workflow-source guidance in
  `.ai/instructions/ai-workflow.md`. Do not recreate the retired shared
  workflow-instruction variant.
- Git history is the instruction history. Do not create or update instruction
  changelogs.

## Editing Rules

- Preserve the `Purpose`, `Rules`, `Placement`, `Validation`, and
  `Anti-Patterns` shape when it fits the target instruction.
- Eliminate duplicate or conflicting rules by assigning one canonical owner
  and replacing other copies with a route or reference.
- Do not place project names, aliases, component libraries, framework examples,
  or repository paths in shared guidance.
- Do not create a local instruction without repeated repository evidence and a
  route in `instructions/index.md`.
- Retire dead routes and references in the same change. Never leave a route to
  a missing instruction.

## Validation

- Confirm every routed path exists and every maintained local instruction is
  reachable from `.ai/instructions/index.md`.
- Search active source for stale instruction paths, retired workflow concepts,
  project-specific shared rules, and instruction changelog references.
- Run the focused contract and health checks.

## Final Response

Report instruction files changed, routes changed, repository evidence used,
and validation results.
