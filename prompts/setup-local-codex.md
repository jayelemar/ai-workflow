# Setup Local Codex

Run only when the operator explicitly requests local project instruction setup.
From the direct parent project root, run:

```bash
rtk proxy corepack pnpm@10.34.4 --dir .ai setup:codex
```

Delegate all mutation and validation to the package utility. Do not add
independent filesystem, Git, or workflow-stage logic. Before running, read
[Codex Agent Setup](../docs/codex-agent.md) for managed outputs, exact active
routing, source preservation, preflight conflicts, and recovery requirements.

Resolve reported conflicts explicitly while preserving existing root/custom
guidance, skills, and configuration. Never force-overwrite, automatically merge
settings, broaden ignores, or bypass preflight. If an unexpected failure occurs
after preflight, report partial writes rather than discarding unrelated content.

After successful setup, restart Codex from the trusted project root and follow
the setup reference's native discovery and instruction-source verification.
Report actual command output and exit status. Never claim success after a
non-zero result.

Report the ignored `instructions/local/github.md` account template inside the
workflow checkout and ask the operator to complete its mappings once. Setup
preserves an existing file and does not sign in, create CLI profiles, or copy
credentials.
