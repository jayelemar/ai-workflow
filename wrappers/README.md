# AI Workflow Wrappers

These files are reusable operator templates for calling the core workflow
prompts.

Core prompts in `.ai/prompts/` define workflow behavior. Wrappers define the
text to paste when starting a spec or plan task.

For cloning, installation, publishing, runner setup, and troubleshooting, use
`.ai/README.md`. This file focuses only on day-to-day wrapper usage.

## Recommended Flow

Canonical lifecycle:

```text
spec -> user-flow artifact -> plan -> runner
```

1. Create a spec:
   - Feature: use `.ai/wrappers/generate-feature-spec.md`
   - Bugfix: use `.ai/wrappers/generate-bugfix-spec.md`
2. Create a user-flow artifact for user-facing work:
   - Use `.ai/wrappers/generate-user-flow.md`
   - Output: `.ai/artifacts/<plan-name>/product-flow.md`
   - Skip for non-user-facing work; the plan records `N/A: <concrete reason>`.
3. Create a plan:
   - Use `.ai/wrappers/create-plan.md`
4. Use one post-plan path:

Default runner path:

```bash
pnpm exec tsx .ai/scripts/workflow-runner.ts .ai/plans/<plan-name>.md
```

One-off Codex profile override:

```bash
pnpm exec tsx .ai/scripts/workflow-runner.ts --profile codex-personal .ai/plans/<plan-name>.md
```

Manual preview path:

```text
Use '.ai/prompts/preview-before-apply.prompt.md'

Plan:
.ai/plans/<plan-name>.md
```

Manual preview rules:

- `draft` plans self-run the `plan-validator` / `fix-plan` loop until they
  either STOP on a real blocker or become ready for execution.
- `approved` and `active` plans enter execution immediately.
- The non-test diff approval gate starts only when execution is about to write
  a non-test file.

Repeated review-remediation loops use the runner snapshot at `.ai/artifacts/<plan-name>/state/context.md` as the hot-path context. In particular, follow-up `execute-plan` runs should consume the snapshot's latest unresolved review findings first, while the live plan remains the source of truth for exact edits and history.
That snapshot is intentionally compact: prefer its `## Summary`, `## Key Details`, `## Validation`, `## Review`, and `## Latest Review Remediation Context` sections before opening the full plan or event artifacts.

Optional quiet mode:

```bash
pnpm exec tsx .ai/scripts/workflow-runner.ts --compact .ai/plans/<plan-name>.md
```

## Rules

- Install and publish the workflow using the setup steps in `.ai/README.md`.
- Manual prompting is supported for spec generation and plan creation.
- After a plan exists, the workflow runner remains the default path for
  `execute-plan`, `review-changes`, `unblock-plan`, `reopen-plan`, and
  `commit-summary`.
- `preview-before-apply` is available only through explicit prompt-file
  invocation; it is not a keyword-triggered workflow mode.
- `preview-before-apply` is a manual post-plan controller, not an
  execution-only helper.
- `preview-before-apply` should keep execution/validation artifacts and the
  workflow context snapshot current if you plan to use the normal review flow
  afterward.
- If you manually invoke a runner-oriented post-plan workflow prompt anyway,
  you must supply the current plan, spec, snapshot, and routed instruction
  files yourself because those prompts are runner-oriented.
- Keep desired behavior explicit.
- Use codebase inspection only for current observed behavior and implementation facts.
- Do not write "based on context" for goals, expected behavior, or known decisions.
- If a behavior decision is unknown, write `Unknown; ask me`.
- Exclude `.ai/artifacts` from broad searches unless reading the active snapshot, event evidence, or runner logs for the current plan.
- Non-review workflow stages should emit the shared terminal contract: `**Plan**`, `**Summary**`, `**Key Details**`, optional `**Validation**`, and `**Next**`.
