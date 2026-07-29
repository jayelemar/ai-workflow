Version: 2.0
Last Updated: 2026-07-29

# Flow-Trace Artifact Instructions

## Purpose

Define when MEDIUM or HIGH plans need user-journey and implementation-map
artifacts.

## Applies To

- `.ai/prompts/select-workflow.md`
- `.ai/prompts/create-plan.md`
- `.ai/prompts/generate-user-flow.md`
- `.ai/prompts/review-changes.md`

## Rules

- Any request needing end-to-end flow mapping is at least MEDIUM; LOW must
  escalate before planning continues.
- Flow traces are required for multi-step workflows, multi-route handoffs,
  multiple visible states or failure branches, or user-triggered API behavior
  whose ownership is not obvious from one file or state.
- They are not required for narrow copy, styling, single-component, or
  single-state changes with obvious ownership.
- When required, create `.ai/artifacts/<plan-name>/user-journey.md` and
  `.ai/artifacts/<plan-name>/implementation-map.md` from the saved spec and
  observed codebase facts. The plan records both paths.
- When not required, record `N/A: <concrete reason>` for both in the plan.
- The implementation map covers every user action in the user journey with
  applicable UI, API, service, data, and validation ownership; use `None:
  <concrete reason>` only when a category does not apply.
- Review required flow artifacts against the actual implemented diff and
  validation evidence. The spec remains authoritative over an artifact.

## Validation

- Required artifacts contain the sections and mapping coverage defined by
  `.ai/prompts/generate-user-flow.md`.
- Plan artifacts are either complete or use the exact concrete `N/A` reason.

## Anti-Patterns

- Keeping a LOW classification for work that needs an end-to-end trace.
- Requiring flow maps for every small user-facing change.
- Inventing behavior in flow artifacts beyond the saved spec.
