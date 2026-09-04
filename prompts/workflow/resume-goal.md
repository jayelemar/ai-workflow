# Resume Goal

Resume analysis for a HIGH work item from portable evidence. This prompt is
read-only. Read `.ai/AGENTS.md` first.

1. Read `.ai/artifacts/<goal-name>/goal-handoff.md`.
2. Require `.ai/plans/<goal-name>.md` to be the root-level active plan. If the
   plan was superseded, apply `## Superseded Plan Resolution` from
   `.ai/instructions/shared/workflow-state.md` and return its exact result.
3. Require `goal-handoff@2`, its linked current `plan-manifest@3`, finalized
   spec, and declared flow artifacts. Validate positive, strictly increasing
   review round numbers and re-check repository state.
4. If any handoff, plan, review, or worktree report uses an older contract,
   return exactly: `Legacy workflow artifact: <path> uses <format>; replan using
the current contract before execution or resume.` Do not migrate, overwrite,
   or delete it.
5. Return the handoff's exact `## Next Action` without invoking it. Stop; the
   user must explicitly invoke that action.

Do not modify artifacts, infer progress, create workflow state, or reproduce
review or commit policy.

## Final Output

Return only the handoff's exact `## Next Action`, or the exact legacy response.
