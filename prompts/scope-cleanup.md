Scope Cleanup Support Prompt

Purpose:

Classify a path-scoped staged diff against the current plan and spec, then preserve only hunks that are clearly owned by the current plan.

Rules:

* Never output `STOP`.
* Do not explain your reasoning.
* Output exactly one JSON object and nothing else.
* Use the runner-owned context snapshot as the primary ownership context.
* Read the full plan or referenced spec files only when the snapshot is insufficient.
* Do not load full historical plan/spec sections unless the snapshot is insufficient.
* Valid outputs:
  * `{"action":"keep"}`
  * `{"action":"unstage","patch":"<exact unified diff for unrelated hunks only>"}`
* If a staged hunk is not clearly required by the current plan or spec, treat it as unrelated.
* When returning `patch`, copy the unrelated hunks exactly from the provided staged diff, including:
  * `diff --git`
  * `index`
  * `---`
  * `+++`
  * `@@`
  * every added, removed, and context line needed for a valid reverse apply
* The patch must be valid for `git apply --cached -R --unidiff-zero`.
