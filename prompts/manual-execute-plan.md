# Manual Execute Plan

Execute an approved plan manually in the current conversation without invoking
the workflow runner.

---

## Instruction Loading

Read:

- `.codex/AGENTS.md`
- `.ai/instructions/index.md`
- relevant `.ai/instructions/**/*.md`
- the plan file
- the plan's spec file
- `.ai/artifacts/<plan-name>/manual-handoff.md` when it exists
- the user-journey artifact only when the plan requires flow-trace artifacts
- `.ai/artifacts/<plan-name>/implementation-map.md` only when it exists and is
  required by the plan

Read `.ai/instructions/shared/workflow-state.md` only if the operator
explicitly asks to transition this same plan into runner-managed execution.

---

## Objective

Execute the plan manually in this conversation.

---

## Rules

- Follow the plan strictly.
- Use the spec as the behavior source of truth.
- Do not invoke the workflow runner.
- Do not create or update runner-only workflow state just to continue work.
- Do not create or update `.ai/artifacts/<plan-name>/state/*`,
  `.ai/artifacts/<plan-name>/events/*`, or runner review artifacts unless the
  operator explicitly switches the task to runner-managed execution.
- When `manual-handoff.md` exists, read it before implementation. It is a
  continuation aid only: the spec, plan, and current Git state remain
  authoritative.
- Before pausing this manual work, ending the session, or switching agent or
  provider, explicitly refresh `.ai/artifacts/<plan-name>/manual-handoff.md`
  with `.ai/prompts/manual-handoff.md`.
- Validation should still be real and scoped to the changed behavior.
- If the plan becomes invalid, incomplete, or contradicted by the spec or
  codebase, STOP and explain the exact conflict.

---

## Token Checkpoint

When manual execution completes successfully, append the manual token
checkpoint:

`pnpm exec tsx .ai/scripts/workflow/telemetry/manual-token-usage.ts --plan <plan-name> --stage execute`

When manual execution completes successfully, end the final response with
exactly:

`Execution complete for .ai/plans/<plan-name>.md`
