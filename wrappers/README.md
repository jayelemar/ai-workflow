# AI Workflow Wrappers

These files are reusable operator templates for calling the core workflow
prompts.

Core prompts in `.ai/prompts/` define workflow behavior. Wrappers define the
text to paste when starting a spec or plan task.

For cloning, installation, publishing, runner setup, and troubleshooting, use
`.ai/README.md`. This file focuses only on day-to-day wrapper usage.

## Workflow Selection

Before intake or implementation, use `.ai/wrappers/select-workflow.md` in an
analysis-only session. It does not write files.

| Classification | Path | Exact next action |
| --- | --- | --- |
| `LOW` | Simple session-local `/plan` | Start `/plan`; do not create durable workflow artifacts. |
| `MEDIUM` | Spec + manual plan | Create a spec, then use `create-plan` with `Execution mode: manual`. |
| `HIGH-GOAL` | Approved manual goal package | Create and approve the spec and manual plan, create only `goal-handoff.md`, then start `/goal` with its Exact Goal. |
| `HIGH-RUNNER` | Runner-managed path | Create a spec, then use `create-plan` with `Execution mode: runner-managed`. |

For HIGH work, the operator must explicitly choose `HIGH-GOAL` or
`HIGH-RUNNER`. `HIGH-GOAL` supports long or exploratory Codex work and has a
portable handoff; `HIGH-RUNNER` uses the existing state-machine lifecycle. The
selector explains this tradeoff but does not choose for the operator.

## Recommended Flow

Canonical lifecycle:

```text
spec -> optional user-journey artifact -> plan -> (manual execute | sync artifacts -> validator/runner)
```

1. Run an analysis-only intake. This is the first operator gate and must not
   write files:
   - Feature: use `.ai/wrappers/feature-intake.md`, then reply
     `APPROVE DIRECTION`.
   - Bugfix: use `.ai/wrappers/bug-intake-rca.md`, then reply `APPROVE RCA`.
   - Run intake in Plan Mode or an analysis-only session. Plan Mode cannot
     create spec or plan files.
2. Create a spec in an agent session:
   - Feature: use `.ai/wrappers/generate-feature-spec.md`
   - Bugfix: use `.ai/wrappers/generate-bugfix-spec.md`
   - Supply the approved brief from intake. It does not authorize guessed
     product behavior; resolve remaining material unknowns first.
3. Optionally create a user-journey artifact for flow-trace-required work when
   you want to inspect it before planning:
   - Use `.ai/wrappers/generate-user-flow.md`
   - Output: `.ai/artifacts/<plan-name>/user-journey.md`
   - Skip this manual step when using `.ai/wrappers/create-plan.md`; it creates
     or regenerates the user-journey artifact automatically only when the
     scope needs end-to-end flow mapping before writing the plan.
   - `create-plan` also auto-preflights `.ai/artifacts/<plan-name>/implementation-map.md`,
     savepoint validity, and spec-required behavior ownership before it returns
     a draft plan.
   - Skip for non-user-facing or narrow flow-trace-not-required work; the plan
     records `N/A: <concrete reason>`.
4. Create a plan in an agent session:
   - Use `.ai/wrappers/create-plan.md`.
   - Explicitly set `Execution mode: manual` or
     `Execution mode: runner-managed` in the request.
   - Plan questions should cover only undiscoverable technical, rollback, or
     task-boundary decisions. Do not repeat the completed product interview.
5. For every `runner-managed` plan, use
   `.ai/wrappers/review-high-risk-plan.md` in a fresh Plan Mode or
   analysis-only session. Also use it for a `manual` plan when the work is
   high-risk, cross-system, contract, security, or data-risk. Repair material
   findings in Agent Mode, then repeat the independent review in a fresh
   session until it returns `OKAY`.
6. The operator reviews the finalized spec and plan, then replies
   `APPROVE IMPLEMENTATION` before any code changes or workflow execution.
7. Use the selected post-plan path:
   - `LOW`: session-local `/plan`; no durable workflow artifacts.
   - `MEDIUM`: `manual` spec-and-plan execution.
- `HIGH-GOAL`: approved manual spec-and-plan package, then Codex `/goal` with
  its sole portable goal checkpoint.
   - `HIGH-RUNNER`: `runner-managed` spec-and-plan lifecycle.

Manual post-plan path:

- Continue execution in the same conversation from the spec and plan.
- Do not create runner-only workflow state just to keep working.
- For explicit manual execution, use `.ai/wrappers/manual-execute-plan.md`.
- For ordinary manual work, create and refresh
  `.ai/artifacts/<plan-name>/manual-handoff.md` with
  `.ai/wrappers/manual-handoff.md` before pausing, ending a session, or
  switching agent/provider. HIGH-GOAL instead uses only
  `.ai/artifacts/<goal-name>/goal-handoff.md` after its spec and plan are
  approved. In both paths, the spec, plan, and current Git state remain
  authoritative.
- Repo-local Codex hooks can auto-append token checkpoints after manual
  `spec`, `plan`, and final `execute` when you use the tracked wrappers or
  prompts and the agent emits the required completion marker lines.
- Those auto-checkpoints are valid only when the matching spec or plan file was
  actually written; marker text alone should not count as a completed stage.
- Manual fallback remains:
  `pnpm exec tsx .ai/scripts/workflow/telemetry/manual-token-usage.ts --plan <plan-name> --stage <spec|plan|execute>`
- For cleaner apples-to-apples measurements, start manual `spec -> plan -> execute`
  work in a fresh conversation when possible.

Runner-managed post-plan path:

- Complete the mandatory independent plan review and receive
  `APPROVE IMPLEMENTATION` before invoking the runner.
- The runner first performs `sync-plan-artifacts`, then continues to
  validation.

HIGH-GOAL continuity:

- Choose a stable kebab-case `<goal-name>` when the Codex `/goal` starts.
- Before `/goal pause`, ending a session, or switching provider/account, use
  `.ai/wrappers/goal-checkpoint.md` to refresh
  `.ai/artifacts/<goal-name>/goal-handoff.md` only.
- Use `.ai/wrappers/resume-goal.md` to resume: Codex restores the saved goal
  with `/goal`; another provider reads the same handoff as starting context.
- Goal checkpoints and resume never write runner state.

Default runner path:

```bash
pnpm exec tsx .ai/scripts/workflow/runner.ts .ai/plans/<plan-name>.md
```

One-off Codex profile override:

```bash
pnpm exec tsx .ai/scripts/workflow/runner.ts --profile codex-personal .ai/plans/<plan-name>.md
```

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

## Rules

- Install and publish the workflow using the setup steps in `.ai/README.md`.
- Manual prompting is supported for spec generation, plan creation, and
  manual plan-bound execution.
- After a plan exists, the workflow runner is the default path only for plans
  that explicitly chose `runner-managed` execution or already use
  runner-managed state for the same task.
- Every `runner-managed` plan requires a fresh independent plan review that
  returns `OKAY` after the latest material planning repair, followed by
  `APPROVE IMPLEMENTATION`, before the runner command is invoked.
- Manual plans may continue execution in the same conversation without
  `sync-plan-artifacts`, `plan-validator`, or runner-managed state files.
- Deleting `.ai/artifacts/<plan-name>/` or `.ai/artifacts/<goal-name>/` removes
  all local state for that work item. These artifacts are local/ignored by
  default; sync the relevant directory separately when moving machines.
- Review stages use harness review only. Do not add a separate subagent or
  plugin review system inside the default runner review path.
- `manual-preview` is a standalone ad hoc helper, not a workflow stage.
- If you manually invoke a runner-oriented post-plan workflow prompt anyway,
  you must supply the current plan, spec, snapshot, and routed instruction
  files yourself because those prompts are runner-oriented.
- Keep desired behavior explicit.
- Use codebase inspection only for current observed behavior and implementation facts.
- Do not write "based on context" for goals, expected behavior, or known decisions.
- If a behavior decision is unknown, write `Unknown; ask me`.
- Exclude `.ai/artifacts` from broad searches unless reading the active snapshot, event evidence, or runner logs for the current plan.
- Non-review workflow stages should emit the shared terminal contract: `**Plan**`, `**Summary**`, `**Key Details**`, optional `**Validation**`, and `**Next**`.
