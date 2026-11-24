Version: 1.7
Last Updated: 2026-11-25

# Mobile UI Instructions

## Purpose

Set a portable baseline for mobile layouts whose content and controls must
remain visible, reachable, and usable across supported device sizes.

## Applies To

- Native, cross-platform, and hybrid mobile application screens.
- Layout, scrolling, safe-area, keyboard, modal, gesture, text-scaling, and
  viewport-dependent interaction changes.
- Screen-state presentation, transitions, and recovery actions.

## Rules

- Before selecting, creating, naming, or using a simulator or emulator, read
  and follow [Mobile Virtual Devices](virtual-devices.md).
- Treat visibility and reachability as behavior. An interactive control
  existing in the component or accessibility tree does not prove that a user
  can see or activate it.
- Design vertically growing content for the smallest supported viewport first.
  When the project does not declare a smaller supported viewport, use a compact
  portrait baseline of 375 by 667 logical points on iOS and 360 by 640 logical
  points on Android.
- Select viewport coverage under Validation based on the changed layout risk.
  Use logical viewport dimensions as acceptance criteria rather than relying
  only on named device models.
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
- Apply consistent presentation and the same reachability rules to loading,
  empty, populated, offline, error/retry, expired-session, permission-dependent,
  and maximum-content states. Preserve entered data across recoverable failures
  and provide clear recovery actions where applicable.
- Distinguish initial loading from background refresh. Keep authorized populated
  content visible during refresh and show an appropriate progress indicator.

## Placement

- Keep framework APIs, component-library conventions, product paths, supported
  device matrices, and application-specific styling rules in the repository's
  local UI instruction.
- Keep this file independent of React Native, Flutter, SwiftUI, UIKit, Android
  Views, Jetpack Compose, or a particular mobile testing framework.

## Validation

- Before testing, identify the affected screens, changed behavior, and whether
  correctness depends on viewport dimensions. Follow [test selection](../shared/testing.md#test-selection)
  for functional coverage; a mobile feature change alone does not require a
  viewport matrix or native checks when it has no native-dependent behavior.
- For a layout-affecting change, default to one compact phone viewport within
  each platform selected under [Mobile Virtual Devices](virtual-devices.md).
  Propose a representative modern or tall phone when the change affects shared
  layout primitives, responsive breakpoints, viewport-relative sizing,
  distributed spacing, anchored controls, or safe-area handling; when a known
  defect depends on a larger viewport; or when explicit acceptance criteria
  require both sizes. State the concrete reason for additional coverage.
  Before adopting coverage on two or more devices, obtain approval of the
  specific device list under [Mobile Virtual Devices](virtual-devices.md#rules).
  An explicit user-selected single device overrides the default viewport matrix;
  report remaining coverage gaps without adding devices automatically.
  Two viewport sizes do not automatically require both iOS and Android.
- When a functional flow needs native verification, run it on one required
  viewport per selected platform unless behavior itself differs by viewport.
  On additional sizes, check only the affected layout and interactions, using
  the same state or fixture where practical. Do not repeat unrelated screens
  or the full feature suite merely to obtain another viewport result.
- Reuse prior evidence only when its application version, runtime, configuration,
  and changed surfaces remain compatible under [required evidence](../shared/testing.md#required-evidence).
  Recheck affected screens after relevant edits; prior evidence for an unchanged
  screen does not require rerunning it because another feature was added.
- Exercise the state with the greatest expected vertical content and confirm
  every required action is fully visible or reachable by scrolling and can be
  activated.
- Use native-runtime evidence for clipping, hit testing, safe areas, keyboard
  obstruction, frame timing, or gesture interaction. Component-tree presence,
  snapshots, and source inspection are supplemental and cannot prove those
  behaviors.
- Follow [Accessibility test approval](../shared/testing.md#accessibility-test-approval)
  before planning or running dedicated accessibility checks, including
  VoiceOver, TalkBack, enlarged text, and accessibility text scaling.
- Exercise changed states and transitions, checking input preservation and
  recovery actions. For background-refresh changes, verify populated content
  stays visible while progress is indicated.
- Report the tested viewport dimensions and behavior, why any additional size
  was needed, and any required coverage still missing. For blocked required
  viewport validation, follow
  [Validation and Completion](../../AGENTS.md#validation-and-completion).

## Anti-Patterns

- Choosing only the developer's default or largest simulator without assessing
  compact-layout risk.
- Repeating the full feature flow at every phone size when only layout differs.
- Validating phone width while ignoring available height and safe-area insets.
- Fixed-height containers around variable text, dynamic content, or actions.
- Adding headers, banners, copy, or actions without rechecking the remaining
  content height.
