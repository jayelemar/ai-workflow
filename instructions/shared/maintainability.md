Version: 1.1
Last Updated: 2026-09-16

# Maintainability Instructions

## Purpose

Keep production changes understandable, reviewable, and safe to evolve.

## Applies To

- Application code, services, routes, components, hooks, libraries, and database-facing modules.
- Plans and reviews that change more than one implementation boundary.

## Rules

- Give each module one clear responsibility and a named owner boundary.
- Keep route and page files focused on entry composition; move reusable domain behavior into focused modules.
- Split a route, page, service, or component when it combines independent responsibilities, has separate reasons to change, or prevents focused testing and review.
- Set and record a concrete review-scope boundary before introducing a broad feature. Separate independently deployable or reversible outcomes.
- Treat a large changed file or a task spanning more than one ownership boundary as a review warning. Explain why it remains coupled or split it before merge.
- Preserve public contracts while extracting modules unless the finalized spec or user request explicitly modifies the contract.
- Prefer small, cohesive modules over large catch-all helpers, coordinators, or shared files.
- Prefer an established local primitive over a new abstraction or subsystem
  when both satisfy the same contract. A new store, coordinator, scheduler,
  dependency, service, or generic framework must have a concrete current need
  and must be smaller in total implementation and operational cost than the
  available alternative.
- Complexity by itself is not a defect when it is necessary to preserve an
  explicit behavior or security guarantee. Record the requirement and keep the
  implementation no broader than that guarantee.

## Placement

- Put repository-specific file locations and ownership conventions in local architecture instructions.
- Put portable decomposition and review-scope standards in this file.

## Validation

- Review the changed-file list for concentrated routes, pages, services, and components.
- Confirm each new module has one responsibility, a clear caller boundary, and focused validation.
- Confirm plan tasks and commits remain independently reviewable and reversible where practical.
- For each newly introduced permanent mechanism, confirm its exact requirement,
  simpler alternatives considered, and why the selected mechanism is the
  smallest sufficient design.

## Anti-Patterns

- Adding another responsibility to an already broad route, page, service, or component without an explicit coupling rationale.
- Hiding unrelated refactors inside feature work.
- Creating generic shared modules with no clear ownership.
- Treating file size alone as the only reason to split code.
- Building reusable infrastructure for a single hypothetical future consumer.
- Replacing a correct spec-compliant design solely because a reviewer prefers
  another architecture.
