# Sync Repository AI Instructions

Create or update repository-specific AI instruction files based on the actual codebase.

---

## Scope

Create or update:

* project-local `.ai/instructions/*.md`
* project-local `.ai/changelogs/*.changelog.md`

Project-local changelogs are intentionally ignored by the nested `.ai` Git
repository. Shared instruction changelogs are source files and use
`.ai/changelogs/shared/*.changelog.md`.

Shared source files:

* `.ai/instructions/shared/*.md`
* `.ai/changelogs/shared/*.changelog.md`

Treat shared source files as read-only. Inspect them when routed, but report
needed shared-source changes instead of editing them.

Do NOT modify:

* `.codex/AGENTS.md`
* application code
* tests

---

## Instruction Loading

Read:

* `.codex/AGENTS.md`
* `.ai/instructions/index.md` when it already exists

When updating existing instruction content, also read:

* the matching existing `.ai/instructions/*.md` files selected by `.ai/instructions/index.md`
* the matching existing changelog at the ownership-specific location defined
  below
* shared baseline instruction files named by `.ai/instructions/index.md`, including `.ai/instructions/shared/security.md` when routed for the task

Before editing, read every project-local instruction file and its matching
changelog, plus each routed shared baseline file and matching shared changelog.

Rules:

* treat `.ai/instructions/index.md` as the repository instruction routing entrypoint
* if `.ai/instructions/index.md` does not exist, bootstrap it first in the same run before using it for routing
* use the index to discover existing repo-specific area files before deciding what to create, update, or skip
* do not assume a missing area just because it is not mentioned in `.codex/AGENTS.md`

---

## Instruction-Set Coherence (MANDATORY)

Before creating or updating files:

* inventory every project-local instruction file, matching changelog, and index route
* verify every maintained local instruction has a narrow route in `index.md`
* compare rules by meaning, not only exact wording, for duplicate ownership
* keep portable policy in shared baselines, repository structure in `architecture.md`, and implementation-specific rules in area files
* replace lower-authority duplicate rules with a concise reference to the owner
* keep overlapping validation commands only when the area needs a concrete, narrower command
* do not delete an existing instruction file without explicit user approval; report an un-routed or unsupported file instead

For read-only shared source files, report duplicate or stale baseline rules as
follow-up work; do not edit them.

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
.ai/instructions/index.md
.ai/instructions/architecture.md
```

Do not create a repo-specific `testing.md` when the shared baseline file already exists. Keep repo-specific validation commands in local area files instead.

If `.ai/instructions/index.md` is missing, also create:

```txt
.ai/changelogs/index.changelog.md
```

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
* keep `.ai/instructions/index.md` aligned with shared baseline files that must always load or be explicitly routed, including `shared/security.md` when the repository wants a security baseline in normal instruction selection
* route every maintained project-local instruction file in `.ai/instructions/index.md`; use a narrow scope rather than a catch-all route

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

For a project-local instruction file:

`.ai/changelogs/<area>.changelog.md`

For a shared instruction file under `.ai/instructions/shared/`:

`.ai/changelogs/shared/<area>.changelog.md`

Format:

# <Area> Instruction Changelog

## v1.0 — YYYY-MM-DD

* Initial creation

Rules:

* use the ownership-specific changelog path above
* only shared instruction changelogs are tracked by the nested `.ai` repository
* no duplication inside instruction files

---

## Ownership Rules

* architecture → structure and boundaries
* testing → validation and commands
* area files → specific patterns

If overlap:

→ keep rule in highest authority file
→ reference instead of duplicating

Authority order for this prompt:

1. routed shared baseline for portable policy
2. `architecture.md` for repository structure and ownership
3. area instruction for implementation-specific behavior
4. `testing.md` for repository validation commands

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

## Index Bootstrap (MANDATORY)

If `.ai/instructions/index.md` is missing:

* CREATE `.ai/instructions/index.md` first
* CREATE `.ai/changelogs/index.changelog.md` first
* use the new index as the routing entrypoint for any additional instruction updates in the same run

Bootstrap rules:

* derive the index only from the observed repository structure and repeated path ownership patterns
* include the standard instruction sections and version headers
* define the smallest justified set of repo-specific routing rules
* reference shared baseline files from the index when the repo uses them
* do not invent area files that are not yet justified by the codebase
* if only `architecture.md` is justified beyond the index, create only those required files

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

### 7. Instruction-Set Coherence

* routed local files
* duplicate rules removed or replaced with references, naming the owner
* duplicate rules retained only when scopes are materially different
* un-routed, unsupported, or read-only baseline issues left for follow-up

---

### 8. Coverage Summary

* strong areas (high confidence)
* partial areas (limited evidence)
* skipped areas (no reliable evidence)
