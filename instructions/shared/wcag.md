Version: 1.0
Last Updated: 2026-07-02

# WCAG Frontend Instructions

## Purpose

Set a shared frontend accessibility baseline using WCAG 2.2 and clarify how
that baseline relates to shadcn/ui, Radix UI, Base UI, Tailwind, and custom
application components.

## Applies To

- User-facing web and admin UI.
- shadcn/ui components and locally copied component code.
- Radix UI and Base UI primitive composition.
- Tailwind theme, token, color, spacing, focus, and motion changes.
- Forms, navigation, dialogs, sheets, popovers, menus, tables, charts,
  notifications, media, and icon-only controls.

## Rules

- Treat WCAG 2.2 AA as the default target for frontend work unless a stricter
  product, legal, or customer requirement applies.
- Treat shadcn/ui as an accessibility-friendly starting point, not a guarantee
  of WCAG conformance for the finished application.
- Preserve the accessibility behavior provided by shadcn primitives, Radix UI,
  and Base UI: roles, ARIA attributes, focus management, keyboard interaction,
  escape handling, portal behavior, and accessible labels.
- Prefer semantic HTML and native controls before ARIA. Use ARIA to add missing
  semantics, not to cover avoidable non-semantic markup.
- Use app-local shadcn components from `@/components/ui` when they fit the UI
  need, then configure them through supported props, variants, and composition
  patterns before replacing their underlying primitive behavior.
- When using `asChild`, slots, custom triggers, or custom close controls, ensure
  the rendered element still has the correct native semantics, accessible name,
  keyboard behavior, disabled behavior, and focus visibility.
- Give every interactive control an accessible name. Icon-only buttons, menu
  items, toggles, combobox triggers, close buttons, and toolbar actions must
  have visible text, `aria-label`, or equivalent screen-reader-only text.
- Pair every form control with a programmatic label. Provide instructions,
  required state, validation errors, and recovery guidance in text that is
  associated with the control.
- Do not rely on color alone to communicate state, validation, selection,
  priority, progress, or destructive intent.
- Maintain sufficient contrast for text, icons, borders that define controls,
  focus indicators, disabled alternatives, charts, and state indicators after
  theme or token changes.
- Keep visible focus states clear for every keyboard-focusable element. Do not
  suppress outlines unless replacing them with an equally visible focus style.
- Ensure complete keyboard support for interactive UI: Tab and Shift+Tab move
  predictably, Enter and Space activate controls where expected, Arrow keys
  work for composite widgets where expected, and Escape closes dismissible
  overlays.
- Provide useful alt text for meaningful images and empty alt text for purely
  decorative images.
- Use real headings, landmarks, lists, tables, and captions where they express
  page structure or data relationships. Do not recreate these structures with
  generic `div` markup.
- For dialogs, sheets, popovers, dropdown menus, command palettes, selects, and
  tooltips, keep focus order, initial focus, return focus, outside interaction,
  labels, descriptions, and dismissal behavior intentional.
- Do not use tooltips as the only place where required instructions, labels,
  errors, or critical information are available.
- For async changes, loading states, errors, success messages, and background
  updates, expose important status changes in a way assistive technology can
  perceive.
- Respect user preferences for reduced motion. Avoid motion that blocks task
  completion or creates unnecessary vestibular risk.
- Make responsive layouts work at mobile widths, high zoom, large text, and
  browser text scaling without clipping, overlap, hidden controls, or
  horizontal scrolling except where the content type truly requires it.
- For charts and visual data, provide text equivalents, labels, summaries, or
  adjacent data tables when the visual alone carries meaning.

## Placement

- Keep reusable WCAG baseline guidance in this file.
- Keep Gondoor-specific UI component ownership and shadcn styling rules in
  `.ai/instructions/ui.md`.
- Keep product-specific acceptance criteria in the relevant spec or plan.
- Keep accessibility fixes close to the component, route, form, or workflow
  that owns the inaccessible behavior.

## Validation

- Manually verify keyboard-only interaction for changed UI, including focus
  order, activation keys, overlay dismissal, and focus return.
- Check accessible names, labels, roles, descriptions, status messages, and
  landmark structure with browser accessibility tooling or a screen reader when
  the change affects semantics or assistive-technology output.
- Run automated accessibility checks such as axe, Playwright accessibility
  checks, Lighthouse, or equivalent when available, but do not treat automated
  checks as complete WCAG coverage.
- Verify color contrast after theme, token, variant, chart, or state-color
  changes.
- Run focused component, integration, or E2E tests when accessibility behavior
  is part of a critical workflow or has previously regressed.
- When full accessibility validation is not possible, state the unverified
  WCAG risk and the smallest follow-up check needed.

## Anti-Patterns

- Claiming WCAG compliance solely because a page uses shadcn/ui.
- Replacing accessible shadcn, Radix UI, or Base UI primitives with custom
  markup without reproducing the required semantics and keyboard behavior.
- Using clickable `div` or `span` elements for button or link behavior.
- Removing visible focus styles for visual polish.
- Shipping icon-only controls without accessible names.
- Encoding validation, status, or selection using only color.
- Hiding labels and instructions from assistive technology.
- Creating custom dialogs, dropdowns, selects, tabs, menus, or comboboxes when
  existing app primitives already provide the expected accessibility behavior.
