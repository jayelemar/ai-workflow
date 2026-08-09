# Agent Model Update Evals

Before applying a newly detected model mapping, compare the locked models with
the candidates on representative completed tasks. Use the same prompt, files,
tools, and success criteria for both runs.

## Required Checks

- Parent: task decomposition, conflict resolution, scope control, validation,
  and final synthesis remain correct.
- Investigator: code-path and contract maps remain complete and evidence-backed.
- Builder: implementation stays within owned files and passes exact task tests.
- Reviewer: known correctness and security defects are found without inventing
  unsupported findings.
- Record task success, missing evidence, total tokens, latency, and cost.
- Compare the current reasoning effort and one level lower when supported.

Approve an update only when no required role regresses and the quality/cost
tradeoff is acceptable. Keep the previous registry revision as the rollback.
