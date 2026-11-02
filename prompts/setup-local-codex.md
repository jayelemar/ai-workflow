# Setup Local Codex

Run only when the operator explicitly requests local project instruction setup.

From the direct parent project root, run:

`pnpm --dir .ai setup:codex`

Delegate all mutation and validation to the package utility. Do not add independent filesystem, Git, or workflow-stage logic.

The utility preserves readable regular root `AGENTS.md` and explicitly routes
to it first when present, then `.ai/AGENTS.md` and the instruction index. It
preserves custom overrides byte-for-byte when they contain the exact active
routing block documented in `.ai/docs/codex-agent.md`. Only the exact previous
generated override template is automatically upgraded.

It also creates real project-root `.agents/skills/` directories when absent
and relative links for `ai-build`, `ai-worktree-setup`, `ai-commit`, and `ai-pr`
to the same project's `.ai/.agents/skills/` source. It preserves custom skills
and excludes only the four generated links and override through the existing
local Git exclude. It changes no global skills, user configuration, or tracked
ignore file. Valid existing outputs remain unchanged on repeated setup.

Missing or ambiguous custom routing, tracked overrides, symbolic-link or
non-file instruction targets, and defined legacy Codex conflicts fail before
managed writes. Resolve the reported condition explicitly without discarding
existing root or custom guidance, then retry. Do not add a force-overwrite path.

Missing skill sources, unsafe ancestors, tracked managed outputs, or conflicting
files, directories, and links also fail whole-operation preflight before writes.
Only links to the exact expected local source may be reused. Report partial
writes if an unexpected filesystem failure occurs after preflight.

Report the actual command output and exit status. Do not claim setup success after a non-zero result.
