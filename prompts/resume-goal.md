# Resume Goal

Resume a HIGH-GOAL work item from its portable companion artifact. This is an
analysis-only resume step; it does not write files or workflow state.

Read `.ai/AGENTS.md` before loading the handoff.

## Required Behavior

1. Read `.ai/artifacts/<goal-name>/goal-handoff.md`.
2. Validate `goal-handoff@1`, then read the linked `## Spec` and `## Plan`.
   Treat `## Exact Goal` as the saved objective and `## Next Action` as the
   immediate starting point. Re-check current Git state before acting because
   the handoff is a checkpoint, not the authority for repository state.
3. In Codex, invoke the handoff's exact `## Next Action`; it must use
   `/goal <exact-goal> <linked-plan-path>`.
4. In another provider, use the same handoff as the starting context.

## Strict Constraints

- Do not modify the handoff during resume; use `goal-checkpoint` before a
  later pause or provider/account switch.
- Do not create a spec, plan, workflow state, event, or MEDIUM review artifact.
- Never infer progress beyond verified entries in the handoff and current Git
  state.

If the handoff, linked finalized spec, or linked saved plan is missing or incomplete,
STOP and request the relevant artifact; do not create workflow state as a
fallback during resume.

## Final Output

Return only:

`Resume from .ai/artifacts/<goal-name>/goal-handoff.md using its Exact Goal and Next Action.`
