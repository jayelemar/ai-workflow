# Testing Instruction Changelog

## v1.1 — 2026-07-19

* Kept repository commands and test-layout facts local; delegated portable test
  strategy, reporting, and environment policy to `shared/testing.md`.

## v1.3 — 2026-07-09

* Added the behavior-change and bugfix rule to confirm or add a failing
  regression test before implementation, using the cheapest practical test
  layer.

## v1.2 — 2026-06-28

* Converted the testing baseline into a shared cross-project instruction and removed Gondoor-specific paths and commands.

## v1.1 — 2026-06-24

* Added Codex sandbox guidance for local E2E, including Node/Playwright local network escalation rules and a ban on using `yolo`.

## v1.0 — 2026-06-24

* Initial creation
