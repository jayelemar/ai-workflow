# CI Architecture Instructions

## Purpose

Represent the required project-local architecture route in a standalone source
checkout.

## Rules

- Keep CI validation scoped to the canonical workflow source in this repository.

## Placement

- Keep product- and repository-specific architecture rules in the consuming
  project's ignored `instructions/architecture.md` file.

## Validation

- Run the canonical workflow health check and its full test suite.

## Anti-Patterns

- Treating this fixture as reusable project architecture guidance.
