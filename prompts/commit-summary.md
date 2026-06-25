# Commit Summary (State-Machine Driven)

This prompt stages completed plan implementation files, then generates the final commit message and user-facing summary.

It does NOT modify code.

For `completed + commit-summary`, it DOES create exactly one local git commit from runner-injected plan-owned paths, unless final deployment validation has already passed and the plan needs only a final summary using the recorded commit.

For `deployment-validation + commit-summary`, it DOES create exactly one local git commit and update the plan with deployment-validation metadata.

It does NOT perform validation or review.

It DOES run `git add` for files related to the completed plan implementation only.

It MUST NOT push. Auto-push is out of scope for this prompt.

---

## Instruction Loading

Read:

* `.codex/AGENTS.md`
* `.ai/instructions/workflow-state.instructions.md`
* runner-owned context snapshot `.ai/state/workflow-runner/<plan-name>.context.md` as the primary current-state source
* the full plan file only when exact plan edits are required or the snapshot is insufficient
* `.ai/specs/<feature>.spec.md` (if exists)

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
* deployment-validation

IF Status is neither `completed` nor `deployment-validation`:

→ STOP (`plan is not ready for commit summary`)

---

Read:

## Next Action

Expected:

commit-summary

IF Next Action != commit-summary:

→ STOP (`unexpected next action for commit summary`)

If Status is `completed`, use the completed commit rules below.

If Status is `deployment-validation`, use the deployment-validation commit rules below.

If Status is `completed` and `## Deployment Validation` contains a recorded `Commit:` and `Status: passed`, do not create a second commit when no plan-owned changes remain. Produce the final completion summary using the recorded commit.

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

Commit-summary relies on the existing `## Files (MANDATORY)` list. It must not repair `## Files (MANDATORY)` as a late-stage metadata fix; if the list is wrong, route the plan back through review or execution.

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

and `## Deployment Validation` does NOT already contain both:

* Commit: <sha>
* Status: passed

Required behavior:

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
* Do not create a deployment-validation entry.
* Do not create more than one commit.
* Do not stage or commit `.ai/` files.

---

## Deployment Validation Commit Rules

Apply this section ONLY when the plan starts as:

## Status

deployment-validation

## Next Action

commit-summary

Required behavior:

1. Stage only plan-owned paths from the runner-injected path list.
2. Create exactly one local git commit from those staged changes.
3. MUST NOT push.
4. If `git commit` fails, output `STOP`, state the git failure, and do not record a commit hash.
5. After the commit succeeds, read the commit SHA and current branch.
6. Update the plan with:

## Deployment Validation

### Deployment Validation v1

* Commit: <sha>
* Branch: <branch>
* Commit Created At: <timestamp>
* Push Status: pending
* Deployment Status: pending
* Reason: <why deployed validation is required>
* Pending Validation: <specific validation to perform>
* Status: pending

7. Transition the plan to:

## Status

deployment-validation

## Next Action

unblock-plan

Rules:

* Preserve previous execution, review, validation, and blocker history.
* Append the next sequential `### Deployment Validation vX` entry if the section already exists.
* Do not overwrite an existing deployment-validation commit entry unless it belongs to the same current run and the previous `git commit` failed before a hash was recorded.
* The output must include the created commit SHA, branch, pending push/deploy status, and pending validation.

---

## Final Deployment Validation Summary Rules

Apply this section ONLY when the plan starts as:

## Status

completed

## Next Action

commit-summary

and `## Deployment Validation` already contains:

* Commit: <sha>
* Status: passed

Rules:

* Use the recorded commit for the final completion summary.
* If no plan-owned changes remain, do not create a second commit.
* Do not push.
* Do not alter the recorded deployment-validation evidence.

---

## Output (MANDATORY)

### Git Commit Message

<type>(<feature>): <summary>

---

### Summary

* ...
* ...
* ...
