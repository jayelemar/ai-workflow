# Create Plan

Create one saved implementation plan for an already-classified request. This
stage plans only; it does not implement or review speculative plans.

## Input Contract

- `LOW`: the classifier result and repository evidence. Do not create a spec.
- `MEDIUM` or `HIGH`: a complete saved spec at `.ai/specs/<name>.spec.md`.
- The selected classification: `LOW`, `MEDIUM`, or `HIGH`.

If a required input is missing or unreadable, STOP and identify its exact path
and purpose. Do not infer behavior that belongs in a missing spec.

## Stage Boundaries

- LOW planning may begin after the classifier selects LOW. Save a compact plan
  before any implementation starts.
- MEDIUM and HIGH planning begin in Plan mode after the intake conversation
  has saved the required spec.
- Saving the plan does not begin implementation. The later explicit
  `execute <plan-file>` or `/goal <description> <plan-file>` invocation is the
  authorization boundary.
- Do not require a separate approval, a plan preview, or a pre-execution plan
  review.

## Instruction Loading

Read `.codex/AGENTS.md`, `.ai/instructions/index.md`, the routed workflow,
reasoning, flow-trace, testing, and delivery instructions, plus the required
spec when one exists. Inspect only the repository facts needed to create a
concrete plan.

## Plan Requirements

Use `.ai/templates/plan.template.md` exactly.

- The saved plan must name its classification and source spec or `N/A: LOW
  plans do not use a spec`.
- LOW plans are compact: concrete scope, ordered implementation steps, focused
  validation, and a completion self-check.
- MEDIUM and HIGH plans must be complete enough to execute without inventing
  behavior. Apply the flow-trace contract when it is required; otherwise use
  its exact `N/A` entries.
- HIGH plans split independently implementable outcomes into task-scoped
  items, each with files, validation, and a conventional-commit purpose. The
  HIGH-GOAL task protocol governs execution.
- Do not create workflow state, event logs, sidecars, handoffs, previews, or
  progress records.
- Record a MEDIUM review path at `.ai/artifacts/<plan-name>/review.md`; it is
  created automatically after implemented-diff review, not while planning.

## Scope and Reclassification

The spec defines behavior; the plan defines execution. If planning discovers a
material risk, dependency, or scope change that invalidates the class or spec,
stop, update the affected planning artifact in its correct stage, and escalate
when required. Do not silently downgrade a prior classification.

## Final Output

Return only:

`Plan saved to .ai/plans/<plan-name>.md`
