# Agent Model Update Evals

Before applying a newly detected model mapping, compare the locked models with
the candidates on representative completed tasks. Use the same prompt, files,
tools, and success criteria for both runs.

## Required Checks

- Parent: task decomposition, conflict resolution, scope control, validation,
  and final synthesis remain correct.
- Specification and planning: the advisory stage mappings remain appropriate
  for deterministic behavior definition and executable task decomposition.
- Scout: code-path and contract maps remain complete and evidence-backed.
- Builder: Luna XHigh implementation stays within owned files and passes exact
  task tests. When a completed Luna result has failed or incomplete exact
  acceptance or validation evidence, evaluate the single Terra High retry with
  identical assignment and file ownership. Do not evaluate availability
  substitution, repeated Luna attempts, or additional retries.
- Reviewer: known correctness and security defects are found without inventing
  unsupported findings.
- Record each actual builder attempt's model, reasoning effort, task success,
  missing evidence, total tokens, latency, and cost.
- Compare the current reasoning effort and one level lower when supported.

Approve an update only when no required role regresses and the quality/cost
tradeoff is acceptable. Keep the previous registry revision as the rollback.
