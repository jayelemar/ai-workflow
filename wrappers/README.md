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
spec -> user-journey artifact -> plan -> sync artifacts -> validator/runner
```

1. Create a spec:
   - Feature: use `.ai/wrappers/generate-feature-spec.md`
   - Bugfix: use `.ai/wrappers/generate-bugfix-spec.md`
2. Optionally create a user-journey artifact for user-facing work when you want to
   inspect it before planning:
   - Use `.ai/wrappers/generate-user-flow.md`
   - Output: `.ai/artifacts/<plan-name>/user-journey.md`
   - Skip this manual step when using `.ai/wrappers/create-plan.md`; it creates
     or regenerates the user-journey artifact automatically for user-facing
     work before writing the plan.
   - `create-plan` also auto-preflights `.ai/artifacts/<plan-name>/implementation-map.md`,
     savepoint validity, and spec-required behavior ownership before it returns
     a draft plan.
   - Skip for non-user-facing work; the plan records `N/A: <concrete reason>`.
3. Create a plan:
   - Use `.ai/wrappers/create-plan.md`
4. Use one post-plan path. The default runner first performs
   `sync-plan-artifacts`, then continues to validation.

Default runner path:

```bash
pnpm exec tsx .ai/scripts/workflow-runner.ts .ai/plans/<plan-name>.md
```

One-off Codex profile override:

```bash
pnpm exec tsx .ai/scripts/workflow-runner.ts --profile codex-personal .ai/plans/<plan-name>.md
```

Plan preview path:

```text
Use '.ai/prompts/plan-preview-before-apply.md'

Plan:
.ai/plans/<plan-name>.md
```

Plan preview rules:

- `draft` plans self-run the `plan-validator` / `fix-plan` loop until they
  either STOP on a real blocker or become ready for execution.
- `approved` and `active` plans enter execution immediately.
- The non-test diff approval gate starts only when execution is about to write
  a non-test file.

Standalone manual preview path:

```text
Use '.ai/prompts/manual-preview.md'

Target:
<describe the target files and requested change>
```

Standalone manual preview does not require plan state, does not create
`.ai/artifacts`, and waits for explicit approval before non-test writes.

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
  `sync-plan-artifacts`, `plan-validator`, `fix-plan`, `execute-plan`,
  `review-changes`, `unblock-plan`, `reopen-plan`, and `commit-summary`.
- `plan-preview-before-apply` and `manual-preview` are available only through
  explicit prompt-file invocation; they are not keyword-triggered workflow
  modes.
- `plan-preview-before-apply` is a manual post-plan controller, not an
  execution-only helper.
- `manual-preview` is a standalone ad hoc helper, not a workflow stage.
- `plan-preview-before-apply` should keep execution/validation artifacts and
  the workflow context snapshot current if you plan to use the normal review
  flow afterward.
- If you manually invoke a runner-oriented post-plan workflow prompt anyway,
  you must supply the current plan, spec, snapshot, and routed instruction
  files yourself because those prompts are runner-oriented.
- Keep desired behavior explicit.
- Use codebase inspection only for current observed behavior and implementation facts.
- Do not write "based on context" for goals, expected behavior, or known decisions.
- If a behavior decision is unknown, write `Unknown; ask me`.
- Exclude `.ai/artifacts` from broad searches unless reading the active snapshot, event evidence, or runner logs for the current plan.
- Non-review workflow stages should emit the shared terminal contract: `**Plan**`, `**Summary**`, `**Key Details**`, optional `**Validation**`, and `**Next**`.
