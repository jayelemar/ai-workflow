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
- Read `.ai/artifacts/<plan-name>/manual-handoff.md` when it exists; the spec,
  plan, and Git state remain authoritative.
- Read `user-journey.md` and `implementation-map.md` only when the plan
  requires them.
- Apply the requested code and test changes.
- Run the smallest validation that covers the changed behavior.
- Before pausing, ending the session, or switching agent/provider, refresh
  `.ai/artifacts/<plan-name>/manual-handoff.md` with
  `.ai/wrappers/manual-handoff.md`.

Final Output:
Return only:

Execution complete for .ai/plans/<plan-name>.md
