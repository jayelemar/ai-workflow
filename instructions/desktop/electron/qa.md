# Electron QA

## Purpose

Produce evidence for the requested desktop behavior using the repository's
existing Electron test dependency and native harness. No additional browser CLI,
MCP server, or persistent JavaScript REPL is required.

## Establish the target

Read the repository authority, applicable instruction routes, local desktop
guidance, current package scripts, changed code, and existing native harness.
Identify the smallest checks that establish the requested behavior. Separate
renderer layout, native window state, and OS behavior. Establish a reproducible
failure before proposing a fix; QA alone does not authorize changes.

## Select validation

Select relevant type, lint, unit, and native checks from current package scripts
rather than running every command automatically. Determine which command builds
or launches Electron; avoid building twice without a reason. Typecheck, lint,
unit tests, and browser-only checks cannot prove native behavior.

If the harness accepts an external unpacked or packaged executable, verify its
version, build, runtime dependencies, and effective configuration first. Record
which executable was actually exercised, even if a test script also builds source.

## Native and visual checks

- Reuse the existing Playwright Electron launch pattern with isolated temporary
  user data. Remove development-only launch overrides for a production-build
  run according to the local harness. Never use a person's normal app profile.
- Wait for the expected renderer and select windows by their actual URL or
  identity rather than assuming the first window is the target.
- Exercise changed controls with normal clicks, keyboard input, and pointer
  gestures. Main-process evaluation can inspect state or stage a failure; it
  does not substitute for exercising the user control under review.
- For overlay changes, check applicable transitions: hidden startup, show
  without focus theft, hide/show state retention, close-as-hide, and repeated
  requests without duplicate windows.
- For resize and layout changes, inspect initial and minimum sizes,
  pointer/keyboard resizing, clipping, and focus indicators. Verify drag regions
  do not swallow input or window-control clicks.
- For lifecycle and shortcut changes, check the relevant tray fallback,
  main-window reopening, owned-shortcut cleanup, and registration failure.
  Calling a callback does not prove the OS delivered a global shortcut.
- Reload for renderer-only iteration; rebuild and relaunch after main/preload
  changes. Reuse a dev runtime only when code and effective configuration match
  the behavior under review, following `shared/testing.md`.
- Capture relevant screenshots in temporary storage and review them visually
  alongside measurements; a screenshot file alone is not evidence. Use CSS
  pixels for layout and record native display scale. Exclude unrelated windows
  and private data, following `shared/security.md`.

## Environment and completion

A graphical session is required; Linux needs a display such as Xvfb. Preserve
Electron's renderer sandbox and isolation. If execution restrictions block launch
or local networking, request access for the specific validation command rather
than a global sandbox change. Report blocked required native checks; browser-only
evidence cannot replace them.

Close only test-owned processes and remove only data created by the run, including
after failed launches. Report app/build, platform, commands/results, exercised
transitions, reviewed visuals, failures, and remaining checks. Evidence on one OS
or display setup does not establish behavior on another.

## References

Read only the primary documentation needed for the current API question:

- [Playwright Electron API](https://playwright.dev/docs/api/class-electron)
- [Electron window limitations](https://www.electronjs.org/docs/latest/tutorial/custom-window-styles)
- [Electron draggable regions](https://www.electronjs.org/docs/latest/tutorial/custom-window-interactions)
