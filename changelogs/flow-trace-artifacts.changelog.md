# Flow-Trace Artifact Instruction Changelog

## v1.3 — 2026-08-12

* Updated the atomic-task contract reference to the shared AI workflow
  instruction path.

## v1.2 — 2026-07-19

* Replaced duplicated atomic-task checks with a reference to the canonical AI
  workflow contract while retaining implementation-map coverage checks.

## v1.1 — 2026-07-15

* Scoped atomic savepoint preflight to new and draft runner-managed plans and
  added bounded repair, explicit atomization fallback, and normal approval
  behavior.

## v1.0 — 2026-07-09

* Added a shared baseline for flow-trace scope classification,
  `user-journey.md` / `implementation-map.md` contracts, and the common
  create-plan, sync, validator, and review checks that previously lived in
  multiple prompt files.
