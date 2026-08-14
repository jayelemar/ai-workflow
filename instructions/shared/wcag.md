Version: 2.0
Last Updated: 2026-08-13

# WCAG Frontend Instructions

## Purpose

Set a framework-agnostic WCAG 2.2 AA baseline for user-facing interfaces.

## Rules

- Prefer semantic HTML and native controls. Use ARIA only to supply semantics
  that native elements cannot express.
- Give every interactive control an accessible name and every form control a
  programmatic label. Associate instructions, required state, errors, and
  recovery guidance with the relevant control.
- Preserve correct roles, states, focus management, keyboard interaction,
  dismissal behavior, and focus return when composing or customizing UI
  primitives.
- Do not rely on color alone for meaning. Maintain sufficient contrast for
  text, meaningful icons, control boundaries, state indicators, and focus.
- Keep visible focus indicators and complete keyboard operation, including
  predictable Tab order and expected activation, arrow, and Escape behavior.
- Use meaningful alternative text for informative images and empty alternative
  text for decorative images.
- Use headings, landmarks, lists, tables, and captions when they represent the
  content structure. Do not recreate them with generic elements.
- Make important loading, error, success, and asynchronous status changes
  perceivable by assistive technology.
- Respect reduced-motion preferences and avoid motion that blocks task
  completion or creates unnecessary vestibular risk.
- Support mobile widths, zoom, large text, and browser text scaling without
  clipping, overlap, hidden controls, or avoidable horizontal scrolling.
- Provide text equivalents or adjacent data for charts and visual information
  that otherwise carries meaning only visually.

## Placement

- Keep framework, component-library, path, alias, styling, and product-specific
  rules in the project-local UI instruction routed by
  `.ai/instructions/index.md`.
- Keep product acceptance criteria in the finalized spec and plan.

## Validation

- Manually verify keyboard order, activation, dismissal, and focus return for
  changed interaction.
- Inspect accessible names, labels, roles, descriptions, status messages, and
  landmarks with accessibility tooling when semantics change.
- Run available automated accessibility and focused regression checks, while
  recognizing that automation does not establish full WCAG conformance.
- Verify contrast after visual-token or state-color changes.
- When optional accessibility validation depends on unavailable tooling or a
  device, disclose the unverified behavior, risk, and smallest follow-up check.

## Anti-Patterns

- Claiming conformance from a framework or component library alone.
- Replacing accessible primitives without preserving semantics and interaction.
- Clickable generic elements, hidden focus, unlabeled icon controls, color-only
  state, or inaccessible custom composite widgets.
