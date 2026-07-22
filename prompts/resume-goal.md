# Resume Goal

Resume a HIGH-GOAL work item from its portable companion artifact. This is an
analysis-only resume step; it does not write files or runner state.

## Required Behavior

1. Read `.ai/artifacts/<goal-name>/goal-handoff.md`.
2. Validate `goal-handoff@1`, then read the linked `## Spec` and `## Plan`.
   Treat `## Exact Goal` as the saved objective and `## Next Action` as the
   immediate starting point. Re-check current Git state before acting because
   the handoff is a checkpoint, not the authority for repository state.
3. In Codex, restore the saved objective with `/goal <exact goal>`.
4. In another provider, use the same handoff as the starting context; do not
   translate it into runner-managed state.

## Strict Constraints

- Do not modify the handoff during resume; use `goal-checkpoint` before a
  later pause or provider/account switch.
- Do not invoke the workflow runner or create a spec, plan, runner state,
  event, or review artifact.
- Never infer progress beyond verified entries in the handoff and current Git
  state.

If the handoff, linked spec, or linked manual plan is missing or incomplete,
STOP and request the relevant artifact; do not create runner state as a
fallback during resume.

## Final Output

Return only:

`Resume from .ai/artifacts/<goal-name>/goal-handoff.md using its Exact Goal and Next Action.`
