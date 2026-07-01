# Commit Summary (State-Machine Driven)

This prompt stages completed plan implementation files, then generates the final commit message and user-facing summary.

It does NOT modify code.

For `completed + commit-summary`, it DOES create exactly one local git commit from runner-injected plan-owned paths.

It does NOT perform validation or review.

It DOES run `git add` for files related to the completed plan implementation only.

It MUST NOT push. Auto-push is out of scope for this prompt.

In task savepoint mode, the runner may inject either:

* `Task savepoint current task` for a per-task local commit
* `Task savepoint aggregate summary` for the final aggregate-only summary

When `Task savepoint aggregate summary` is present, do NOT create a git commit. Verify no remaining plan-owned changes exist and summarize the task commits/artifacts only.

---

## Instruction Loading

Read:

* `.codex/AGENTS.md`
* `.ai/instructions/shared/workflow-state.md`
* runner-owned context snapshot `.ai/artifacts/<plan-name>/state/context.md` as the primary current-state source
* the full plan file only when exact plan edits are required or the snapshot is insufficient
* the repo-relative `*.spec.md` path(s) listed under the plan's `## Spec` section (if any)

Read the full plan only when exact plan edits are required or the snapshot is insufficient.
Do not load full historical sections unless the snapshot is insufficient.

---

## Plan Input (MANDATORY)

.ai/plans/<plan-name>.md

If not provided:

→ output `STOP`
→ state blocking reason (`plan file is required`)
→ do not proceed

---

## State Validation (MANDATORY)

Read:

## Status

Expected:

* completed

IF Status is not `completed`:

→ STOP (`plan is not ready for commit summary`)

---

Read:

## Next Action

Expected:

commit-summary

IF Next Action is not `commit-summary`:

→ STOP (`unexpected next action for commit summary`)

Use the completed commit rules below.

---

## Commit Message Rules

Generate exactly one commit message.

Format:

<type>(<feature>): <summary>

Allowed types:

* feat
* fix
* refactor
* chore
* docs
* test

Rules:

* lowercase
* concise
* specific
* derived from actual completed work
* MUST NOT mention implementation details unnecessarily
* MUST NOT include multiple commit messages

Examples:

feat(site-editor): add hover click marker

fix(auth): correct token refresh handling

refactor(payment): simplify invoice calculation flow

### Task Savepoint Commit Body

When `Task savepoint current task` is present, the commit message MUST include a body with:

* Plan name
* Task ID
* Task words
* Changed files
* Validation summary
* Review result
* Task artifact path

---

## Summary Rules

Generate a user-facing summary.

Audience:

* non-technical stakeholders
* project managers
* business users

Rules:

* short
* specific
* readable
* bullet list only
* describe outcomes, not implementation details
* avoid technical jargon where possible

Example:

* Added hover markers to improve page editing visibility.
* Improved element selection behavior in the site editor.
* Reduced confusion when identifying editable content.

---

## Source Material

Use:

* completed phases
* execution log
* review history
* spec goal

Do NOT use:

* unfinished work
* blocked items
* rejected approaches

---

## Git Add Rules (MANDATORY)

Before outputting the commit message and summary:

Commit-summary relies on `.ai/artifacts/<plan-name>/state/files.json` as the changed-file inventory and `.ai/artifacts/<plan-name>/state/file-ownership.json` as the ownership authority. It must not repair `files.json` as a late-stage metadata fix; if the list is wrong, route the plan back through review or execution.

1. Use the runner-injected `Plan-scoped commit boundary` when present.
2. Stage only the listed non-ignored plan-owned implementation paths.
3. Do not stage `.ai/` files.
4. Do not stage unrelated user changes.
5. Do not stage generated caches, local environment files, or build artifacts unless the plan explicitly requires them.
6. After the path-scoped git add, inspect the staged diff and unstage any staged hunk that is not clearly related to the current plan or spec.
7. Do not stop for clearly unrelated hunks; unstage them and continue with the remaining plan-related staged changes.

Use:

* plan completed phases
* execution log
* review history
* runner-injected path-scoped `git status --short -- <plan-owned paths>`
* runner-injected path-scoped `git diff --name-status -- <plan-owned paths>`
* runner-injected path-scoped `git add --all -- <plan-owned paths>`
* runner-injected path-scoped `git diff --staged --name-status -- <plan-owned paths>`
* runner-injected path-scoped `git commit -m "<generated message>" -- <plan-owned paths>`

Do NOT use repository-wide `git add --all`.

If the runner-injected path list is present, do NOT stage paths outside that list.

If a changed file is not clearly related to the plan:

→ do not stage it
→ mention it as not staged

If no plan-related files can be staged:

→ output `STOP`
→ state blocking reason (`no plan-related files to stage`)
→ do not generate a commit message

---

## Completed Commit Rules

Apply this section ONLY when the plan starts as:

## Status

completed

## Next Action

commit-summary

Required behavior:

If `Task savepoint aggregate summary` is present:

1. Do not run `git add`.
2. Do not run `git commit`.
3. Verify no remaining plan-owned changes exist.
4. Summarize the task commit SHAs and artifact paths.
5. MUST NOT push.

Otherwise:

1. Stage only plan-owned paths from the runner-injected path list.
2. Generate exactly one commit message using the commit message rules.
3. Create exactly one local git commit using:

git commit -m "<generated message>" -- <plan-owned paths>

4. MUST NOT push.
5. If `git commit` fails, output `STOP` and state the git failure.
6. After the commit succeeds, read the commit SHA and current branch.
7. Output the created commit SHA, branch, commit message, and user-facing summary.

Rules:

* Do not update the plan.
* Do not create more than one commit.
* Do not stage or commit `.ai/` files.

---

## Output (MANDATORY)

Use this shared terminal-facing contract for non-review stages.

Rules:

* `**Summary**` starts with the stage result/state line, then at most 2-3 short high-signal bullets.
* `**Key Details**` must use a single conventional-commit subject line followed by a short user-facing summary list prefixed with `--`.
* Do not include a branch line in `**Key Details**`.

**Plan**

.ai/plans/<plan-name>.md

**Summary**

* COMMIT CREATED
* stage result/state line first
* at most 2-3 short high-signal bullets

**Key Details**

<type>(<feature>): <summary>
-- short user-facing outcome
-- short user-facing outcome
-- short user-facing outcome

**Next**

Status:

* completed

Next Action:

commit-summary
