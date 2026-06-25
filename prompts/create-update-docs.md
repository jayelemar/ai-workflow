# Sync AI Docs

Create or update the AI documentation layer under `.ai/docs/` based on the latest committed code changes.

---

## Goal

Keep `.ai/docs/` concise, accurate, routable, and useful for AI-assisted development.

---

## Scope

You may create or update:

- `.ai/docs/README.md`
- `.ai/docs/routes.md`
- `.ai/docs/features/*.md`
- `.ai/docs/modules/*.md`

Do NOT modify:

- application code
- tests
- `.ai/instructions/`
- `.codex/AGENTS.md`

---

## Source of Truth

The codebase is the source of truth.

Docs are only a routing and context layer. If docs conflict with code, follow the code and update docs.

---

## Documentation Rules

- Feature docs are required for major features.
- Module docs are required only for important modules:
  - shared across features
  - complex business logic
  - critical behavior such as auth, billing, permissions, queues, payments, integrations

- Do not create module docs for helpers, small utilities, or thin wrappers.
- Avoid duplication between feature docs and module docs.
- Keep docs concise and structured.
- Use exact file paths.
- Use one-line file summaries.
- Mark unclear details as `UNKNOWN`.
- Do not invent behavior.

---

## Required Structure

.ai/docs/
README.md
routes.md
features/
modules/

---

## README.md Requirements

Create or update `.ai/docs/README.md` with:

# AI Docs

## Purpose

This folder contains project context for AI-assisted development.

Docs help AI understand feature behavior, module responsibilities, and where to look before modifying code.

## Rules

- Feature docs are required for major features.
- Module docs are required only for important, shared, complex, or critical modules.
- Docs are a routing/context layer.
- Code is the source of truth.
- If docs and code conflict, follow code and update docs.

## Structure

- routes.md — task-based documentation routing
- features/ — feature behavior and flows
- modules/ — important shared/complex module responsibilities

## Principle

Feature = entry point
Module = deep dive

---

## routes.md Requirements

Create or update `.ai/docs/routes.md` with:

# AI Documentation Routes

## Bugfix

1. Identify affected files.
2. Read related feature doc.
3. Read related module doc if one exists.
4. Verify behavior against source code.

## New Feature

1. Read related feature docs.
2. Read related module docs if shared logic is involved.
3. Follow existing source patterns.
4. Update or create docs after implementation.

## Sub-feature

1. Read parent feature doc.
2. Read related module doc if one exists.
3. Verify current behavior in source code.
4. Update parent feature doc if behavior changed.

## Refactor

1. Read related feature docs to preserve behavior.
2. Read related module docs to preserve contracts.
3. Follow documented refactor guardrails.
4. Verify against source code and tests.

---

## Feature Doc Template

Create or update `.ai/docs/features/<feature-name>.md` using:

# Feature: <Feature Name>

## Purpose

<1–2 lines describing what this feature does.>

## Flow

- <main step>
- <main step>
- <main step>

## AI Read First

1. <path> — <why this file matters>
2. <path> — <why this file matters>
3. <path> — <why this file matters>

## Key Files

- <path> — <one-line responsibility>
- <path> — <one-line responsibility>

## Related Modules

- .ai/docs/modules/<module>.md — <why used>

## Behavior Rules

- <important expected behavior>
- <important constraint>

## Refactor Guardrails

- <behavior that must not break>
- <important invariant>

## Validation

- <test command, test file, or verification step>
- UNKNOWN if no clear validation path exists

## Last Verified

Date: YYYY-MM-DD
Commit: <short-hash>

## Recent Notes (max 3)

- YYYY-MM-DD: <latest relevant change>

---

## Module Doc Template

Create or update `.ai/docs/modules/<module-name>.md` ONLY if the module is important, shared, complex, or critical.

# Module: <Module Name>

## Responsibility

<1–2 lines describing what this module owns.>

## Entry Points

- <path>:<function/class/controller> — <what enters here>
- <path>:<function/class/controller> — <what enters here>

## Used By

- .ai/docs/features/<feature>.md

## Key Files

- <path> — <one-line responsibility>
- <path> — <one-line responsibility>

## Rules / Constraints

- <business or technical rule>
- <security/data/integration constraint>

## Refactor Guardrails

- Do not break public API behavior.
- Do not change data contracts without checking related features.
- Do not bypass validation, auth, or error-handling layers.

## Validation

- <test command, test file, or verification step>
- UNKNOWN if no clear validation path exists

## Last Verified

Date: YYYY-MM-DD
Commit: <short-hash>

## Recent Notes (max 3)

- YYYY-MM-DD: <latest relevant change>

---

## Footer Rules

For every created or modified doc:

- Update Last Verified:
  - Date: today
  - Commit: latest short commit hash

- Update Recent Notes:
  - Add newest note at top
  - Keep maximum 3 notes
  - Remove older notes beyond 3

---

## Update Behavior

When docs already exist:

- Update only affected sections
- Preserve useful existing information
- Remove outdated details if code contradicts them
- Do not rewrite entire docs unnecessarily

---

## Detection

Use:

- latest commit
- changed files
- relevant source files
- existing `.ai/docs/` files
- previous analyze-docs output if provided

Determine:

- affected features
- affected important modules
- whether routes.md needs updates

---

## Final Response

After making changes, report:

1. Docs created
2. Docs updated
3. Docs intentionally skipped
4. Any UNKNOWN items needing human confirmation

---

## Context

Commit Message:
[PASTE]

Changed Files:
[PASTE]
