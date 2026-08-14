Version: 1.0
Last Updated: 2026-07-18

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

## Placement

- Put repository-specific file locations and ownership conventions in local architecture instructions.
- Put portable decomposition and review-scope standards in this file.

## Validation

- Review the changed-file list for concentrated routes, pages, services, and components.
- Confirm each new module has one responsibility, a clear caller boundary, and focused validation.
- Confirm plan tasks and commits remain independently reviewable and reversible where practical.

## Anti-Patterns

- Adding another responsibility to an already broad route, page, service, or component without an explicit coupling rationale.
- Hiding unrelated refactors inside feature work.
- Creating generic shared modules with no clear ownership.
- Treating file size alone as the only reason to split code.
