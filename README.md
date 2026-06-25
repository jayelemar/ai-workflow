# `.ai` Nested Repository

This directory is a standalone Git repository for reusable AI workflow source files.

Tracked directories:
- `prompts/`
- `scripts/`
- `templates/`
- `wrappers/`

Local-only directories that are intentionally excluded:
- `artifacts/`
- `changelogs/`
- `instructions/`
- `logs/`
- `plans/`
- `specs/`
- `state/`

The parent repository continues to ignore `.ai/`, so this nested repository can be versioned independently without changing the main repository's tracking behavior.

Remote setup is intentionally out of scope for this local initialization. Add a remote later from inside `.ai` when the target GitHub repository is ready.
