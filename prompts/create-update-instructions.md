# Sync Repository AI Instructions

Create or update repository-specific AI instruction files based on the actual codebase.

---

## Scope

Create or update:

* project-local `.ai/instructions/*.md`
* project-local `.ai/changelogs/*.changelog.md`

Shared baseline exceptions:

* `.ai/instructions/shared/security.md`
* `.ai/instructions/shared/testing.md`
* `.ai/instructions/shared/workflow-state.md`
* `.ai/changelogs/security.changelog.md`
* `.ai/changelogs/testing.changelog.md`
* `.ai/changelogs/workflow-state.changelog.md`

Do NOT modify:

* `.codex/AGENTS.md`
* application code
* tests

---

## Instruction Loading

Read:

* `.codex/AGENTS.md`
* `.ai/instructions/index.md`

When updating existing instruction content, also read:

* the matching existing `.ai/instructions/*.md` files selected by `.ai/instructions/index.md`
* the matching existing `.ai/changelogs/*.changelog.md` files

Rules:

* treat `.ai/instructions/index.md` as the repository instruction routing entrypoint
* use the index to discover existing repo-specific area files before deciding what to create, update, or skip
* do not assume a missing area just because it is not mentioned in `.codex/AGENTS.md`

---

## Source of Truth

Use ONLY the codebase:

* folder structure
* source files
* configs
* scripts
* tests

Do NOT assume patterns without evidence.

---

## Baseline Check (MANDATORY)

Ensure:

* `.codex/AGENTS.md` exists
* `.ai/` exists

If missing:

→ output `STOP`
→ state what is missing
→ do not proceed

---

## Discovery

Identify ONLY what is clearly supported:

* architecture
* reusable patterns (must appear multiple times)
* validation commands
* domain-specific logic

Rules:

* do NOT infer from single occurrences
* do NOT generalize weak patterns

If uncertain:

→ skip
→ report under Skipped Areas

---

## Required Files

Always create:

```txt
.ai/instructions/architecture.md
```

Do not create a repo-specific `testing.md` when the shared baseline file already exists. Keep repo-specific validation commands in local area files instead.

---

## Dynamic Files

Create only when justified by the repo.

These are example areas. They are NOT mandatory.

Examples:

Frontend:

* ui.md
* forms.md
* api-client.md
* state-management.md
* routing.md
* styling.md
* auth.md

Backend:

* api.md
* database.md
* migrations.md
* auth.md
* queues.md
* validation.md

Rules:

* examples are suggestions only, NOT requirements
* area MUST exist in multiple locations in the codebase
* patterns MUST be reusable (not one-off)
* naming MUST reflect actual structure
* do NOT create files based only on these examples
* keep shared baseline files portable; do not add repository-specific paths or commands to `shared/security.md`, `shared/testing.md`, or `shared/workflow-state.md`

If an example is not supported by the codebase:

→ skip it
→ list under Skipped Areas

---

## Instructions Format

Each file MUST include:

Version: 1.0
Last Updated: YYYY-MM-DD

# <Area> Instructions

Sections:

* Purpose
* Applies To
* Rules
* Placement
* Validation
* Anti-Patterns

Rules:

* concise and specific
* no generic advice
* every rule must map to code evidence
* NO changelog inside instruction files

---

## Changelog

For each instruction file:

`.ai/changelogs/<area>.changelog.md`

Format:

# <Area> Instruction Changelog

## v1.0 — YYYY-MM-DD

* Initial creation

Rules:

* changelog ONLY in `.ai/changelogs/`
* no duplication inside instruction files

---

## Ownership Rules

* architecture → structure and boundaries
* testing → validation and commands
* area files → specific patterns

If overlap:

→ keep rule in highest authority file
→ reference instead of duplicating

---

## Create vs Update

* if file does NOT exist → CREATE
* if exists → UPDATE

Update rules:

* inspect the existing instruction file and matching changelog before editing
* preserve valid content
* modify only incorrect or missing parts
* avoid full rewrites

If no updates needed:

→ state "No updates required"

---

## Change Safety

* do not remove valid rules without justification
* only update necessary sections
* maintain consistency across files

Versioning:

* increment version only for meaningful changes
* update Last Updated
* update corresponding changelog

---

## Partial Completion (IMPORTANT)

This process is allowed to complete partially.

If some areas cannot be confidently determined:

* skip them
* report them clearly

Do NOT STOP for:

* missing optional areas
* weak or incomplete patterns

---

## STOP Conditions (STRICT)

Only STOP if:

* repository structure is unreadable
* required base directories are missing
* instructions cannot be generated at all

---

## Output

### 1. Analysis Summary

* repo type
* detected areas

---

### 2. Files Created

* path
* reason (based on code evidence)

---

### 3. Files Updated

* path
* reason (what changed and why)

---

### 4. Files Skipped

* area
* reason (no evidence, one-off, unclear)

---

### 5. File Contents

* full content of each created or updated file

---

### 6. Validation

* no duplication across files
* ownership rules followed
* rules traceable to codebase

---

### 7. Coverage Summary

* strong areas (high confidence)
* partial areas (limited evidence)
* skipped areas (no reliable evidence)
