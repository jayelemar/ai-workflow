# Manual Execute Plan Wrapper

Use: `.ai/prompts/manual-execute-plan.md`

Plan:
`.ai/plans/<plan-name>.md`

Objective:
Execute the approved plan manually in the current conversation without
invoking the workflow runner.

Strict Constraints:
- Follow the plan strictly.
- Use the plan's spec as the behavior source of truth.
- Do not invoke the workflow runner.
- Do not create or update runner-only workflow state just to continue
  execution.

Required Behavior:
- Read `.codex/AGENTS.md`.
- Read `.ai/instructions/index.md` and load the relevant routed instructions.
- Read the plan file.
- Read the plan's spec file.
- Read `.ai/artifacts/<plan-name>/manual-handoff.md` for ordinary manual work,
  or `.ai/artifacts/<plan-name>/goal-handoff.md` for HIGH-GOAL work. The spec,
  plan, and Git state remain authoritative.
- Read `user-journey.md` and `implementation-map.md` only when the plan
  requires them.
- Apply the requested code and test changes.
- Run the smallest validation that covers the changed behavior.
- Before pausing ordinary manual work, refresh
  `.ai/artifacts/<plan-name>/manual-handoff.md` with
  `.ai/wrappers/manual-handoff.md`. Before pausing HIGH-GOAL work, refresh
  only `.ai/artifacts/<plan-name>/goal-handoff.md` with
  `.ai/wrappers/goal-checkpoint.md`.

Final Output:
Return only:

Execution complete for .ai/plans/<plan-name>.md
