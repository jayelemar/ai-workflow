Version: 1.0
Last Updated: 2026-10-30

# Mobile UI Instructions

## Purpose

Set a portable baseline for mobile layouts whose content and controls must
remain visible, reachable, and usable across supported device sizes.

## Applies To

- Native, cross-platform, and hybrid mobile application screens.
- Layout, scrolling, safe-area, keyboard, modal, gesture, text-scaling, and
  viewport-dependent interaction changes.

## Rules

- Treat visibility and reachability as behavior. An interactive control
  existing in the component or accessibility tree does not prove that a user
  can see or activate it.
- Design vertically growing content for the smallest supported viewport first.
  When the project does not declare a smaller supported viewport, use a compact
  portrait baseline of 375 by 667 logical points on iOS and 360 by 640 logical
  points on Android.
- Also verify a representative modern or tall phone. Use logical viewport
  dimensions as acceptance criteria rather than relying only on named device
  models.
- Content that can grow because of headings, copy, localization, dynamic data,
  loading or error states, accessibility text scaling, or inserted controls
  must reflow or be reachable through scrolling.
- Do not place interactive content inside clipped or hidden overflow unless its
  complete reachable area is independently guaranteed at the smallest required
  viewport.
- Respect top and bottom safe-area insets. Important actions must not sit behind
  system bars, home indicators, application navigation, keyboards, sheets, or
  modal boundaries.
- Preserve the platform's minimum accessible touch target. Use at least 44 by
  44 logical points when the project does not define a stronger requirement.
- Support accessibility text scaling without hiding, overlapping, truncating,
  or making required controls unreachable.
- When horizontal gestures contain vertically growing content, preserve
  vertical scrolling and verify that both interactions work in a native
  runtime.
- Apply the same reachability rules to loading, empty, error, populated,
  permission-dependent, and maximum-content states.

## Placement

- Keep framework APIs, component-library conventions, product paths, supported
  device matrices, and application-specific styling rules in the repository's
  local UI instruction.
- Keep this file independent of React Native, Flutter, SwiftUI, UIKit, Android
  Views, Jetpack Compose, or a particular mobile testing framework.

## Validation

- For a layout-affecting mobile change, verify the affected screen on both a
  compact phone viewport and a representative modern or tall phone viewport.
- Exercise the state with the greatest expected vertical content and confirm
  every required action is fully visible or reachable by scrolling and can be
  activated.
- Use native-runtime evidence for clipping, hit testing, safe areas, keyboard
  obstruction, frame timing, or gesture interaction. Component-tree presence,
  snapshots, and source inspection are supplemental and cannot prove those
  behaviors.
- Check accessibility text scaling when changed text or controls are near a
  layout boundary.
- If required compact-device validation cannot run, do not claim the affected
  layout is complete. Report the missing evidence, residual risk, and smallest
  follow-up check.

## Anti-Patterns

- Testing only on the developer's default or largest simulator.
- Validating phone width while ignoring available height and safe-area insets.
- Fixed-height containers around variable text, dynamic content, or actions.
- Hiding overflow around interactive content.
- Treating a query, role match, snapshot, or accessibility-tree entry as proof
  that a control is visible and tappable.
- Adding headers, banners, copy, or actions without rechecking the remaining
  content height.
