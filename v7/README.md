# Workflow Runner V7 — Isolated Bootstrap

V7 lives here while active legacy workflow-runner work continues elsewhere.
Do not invoke or edit `.ai/scripts/workflow-runner.ts` for V7 bootstrap work.

## Structure

- `config/`: editable Codex model and reasoning policy.
- `runner/`: starts Codex and verifies exact session evidence.
- `lifecycle/`: workflow stages, state, history, reporting, locking, and recovery.
- `wrappers/`: reusable workflow instruction wrappers.
- `pilot/`: isolated pilot specification, plan, and validation test.

## Commands

```bash
pnpm exec tsx .ai/v7/workflow-runner.ts create --workflow <name> --route feature --intake-revision 1 --spec <absolute-path> --plan <absolute-path> --intake-artifact <absolute-path> --intake-session <id> --intake-invocation-start <RFC3339> --workflow-root <absolute-path>
pnpm exec tsx .ai/v7/workflow-runner.ts checkpoint --workflow <name> --revision 1 --stage <id> --attempt <n> --outcome <id> --session <exact-session-id> --invocation-start <RFC3339> --workflow-root <absolute-path>
pnpm exec tsx .ai/v7/workflow-runner.ts checkpoint --workflow <name> --revision 1 --stage plan-setup --attempt <n> --outcome zero-token --reason "setup complete"
pnpm exec tsx .ai/v7/workflow-runner.ts recover --workflow <name> --revision 1 --mode abandon --reason "integrity interruption reviewed"
pnpm exec tsx .ai/v7/workflow-runner.ts report --workflow <name> --revision 1
```

Every command emits one redacted JSON object. Every Codex-backed checkpoint
requires explicit exact-session evidence; V7 never selects a latest session.
V7 evidence is stored only under `.ai/artifacts/<workflow>/v7/runs/<revision>/`.

## Cutover boundary

These V7 guides are not active legacy wrappers. Move them into active wrapper
paths only after operator authorizes legacy-runner cutover.
