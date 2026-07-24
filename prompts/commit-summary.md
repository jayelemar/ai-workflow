# Commit or Final Summary (State-Machine Driven)

This prompt either commits a reviewed task savepoint or, after every task has
already been committed, records the final no-commit summary.

It does NOT modify code.

For a normal `completed` plan, it creates exactly one local git commit from
runner-injected plan-owned paths by default. A task-savepoint plan may define an
explicit `## Commit Boundaries` entry for the current task; in that case, it
creates one local commit per listed boundary instead.

It does NOT perform validation or review.

It DOES run `git add` for files related to the completed plan implementation only.

It MUST NOT push. Auto-push is out of scope for this prompt.

In task savepoint mode, the runner may inject either:

* `Task savepoint current task` for a per-task local commit
* `Task savepoint aggregate summary` for the final aggregate-only summary

When `Task savepoint aggregate summary` is present, do NOT create a git commit. Verify no remaining plan-owned changes exist and summarize the task commits/artifacts only.

The runner is the sole writer for `.ai/artifacts/<plan-name>/execution-summary.md`. You may reference that runner-owned artifact path when needed, but do NOT write or edit it directly in this prompt.

---

## Instruction Loading

Read:

* `.codex/AGENTS.md`
* `.ai/instructions/shared/workflow-state.md`
* runner-owned context snapshot `.ai/artifacts/<plan-name>/state/context.md` as the primary current-state source
* the full plan file when the current task may define `## Commit Boundaries`,
  when exact plan edits are required, or when the snapshot is insufficient
* the repo-relative `*.spec.md` path(s) listed under the plan's `## Spec` section (if any)

Read the full plan before committing a task savepoint so you can determine
whether that current task defines explicit `## Commit Boundaries`.
Do not load full historical sections unless the snapshot is insufficient.
Do not inspect workflow `history` during normal commit-summary runs; use the
snapshot and the latest relevant event pointer first, then open only that exact
event artifact when specific evidence is needed.

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

## Workflow State

Expected: `completed`

IF Workflow State is not `completed`:

→ STOP (`plan is not ready for commit summary`)

---

Use the completed commit rules below.

---

## Commit Message Rules

For every allowed git commit, generate one conventional-commit subject line.

Format:

<type>(<scope>): <imperative summary>

Allowed types:

* feat
* fix
* refactor
* chore
* docs
* test

Rules:

* lowercase
* specific
* Task title provides semantic intent; reviewed staged diff remains the factual source for type, scope, and final wording.
* If staged work is narrower than the task title or needs more accurate wording, refine the subject and continue.
* Use the narrowest stable subsystem that owns the diff. Use feature scope only for genuinely cross-cutting work.
* Target 50 characters and never exceed 72 characters.
* MUST NOT include runner task IDs, workflow-only plan names, artifact paths, or stage names.
* MUST NOT add a task-intent mismatch stop. Existing unrelated-scope checks remain authoritative.
* MUST NOT mention implementation details unnecessarily
* MUST NOT combine multiple commit messages into one commit

Examples:

feat(site-editor): add hover click marker

fix(auth): correct token refresh handling

refactor(payment): simplify invoice calculation flow

### Commit Body Rules

For every created commit, generate:

* one conventional-commit subject line
* one concise GitHub-readable body with two to four concise `-` bullets

Use this exact command shape after the required `pnpm lint-staged` command has
completed successfully:

```bash
SKIP_LINT_STAGED=1 git commit --cleanup=verbatim -F - <<'EOF'
<generated subject>

<generated body>
EOF
```

Body rules:

* Always use two to four concise `-` bullets wrapped at 72 characters.
* State the outcome and why it matters.
* Mention useful validation when it adds review value.
* Include security, migration, or breaking-change context when applicable.
* Do not include workflow metadata such as plan name, task ID, task words, task artifact path, changed-file inventory, runner stage names, or `.ai/` artifact paths.
* Do not paste long file lists. The diff already records changed files.
* Do not include sections named `Plan`, `Task ID`, `Task words`, `Task artifact path`, `Changed files`, `Validation summary`, or `Review result`.

Allowed body example:

```text
- Connect issue widget to real support-ticket creation.
- Preserve attachment rollback and draft cleanup on failure.
- Validate staged changes with lint-staged before commit.
```

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

* runner-provided context snapshot
* latest relevant finalized event artifact
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

* runner-provided context snapshot
* latest relevant finalized event artifact
* runner-injected path-scoped `git status --short -- <plan-owned paths>`
* runner-injected path-scoped `git diff --name-status -- <plan-owned paths>`
* runner-injected path-scoped first `git add --all -- <plan-owned paths>`
* `pnpm lint-staged`
* runner-injected path-scoped second `git add --all -- <plan-owned paths>`
* runner-injected path-scoped `git diff --staged --name-status -- <plan-owned paths>`
* full `git diff --staged --name-status` to confirm the staged set contains only plan-owned paths
* the exact multiline `SKIP_LINT_STAGED=1 git commit --cleanup=verbatim -F - <<'EOF'` flow with `<generated subject>` and `<generated body>`

Do NOT use repository-wide `git add --all`.

If the runner-injected path list is present, do NOT stage paths outside that list.

If a changed file is not clearly related to the plan:

→ do not stage it
→ mention it as not staged

If no plan-related files can be staged:

→ output `STOP`
→ state blocking reason (`no plan-related files to stage`)
→ do not generate a commit message

`pnpm lint-staged` can take longer than a normal command-output window. Start
it once and wait or poll that same command until it exits; do not start a
second lint or commit command while it is still running.

If the terminal session closes or loses stdin before it reports an exit status,
first confirm that no `lint-staged` or ESLint child process remains. Then run
`pnpm lint-staged` once more in a fresh terminal session and wait for its
confirmed result. Do not output `STOP` solely because a stale terminal session
has no exit status; output `STOP` only when the fresh run exits nonzero or the
process is still active and cannot be safely observed.

If the terminal command record reports that `pnpm lint-staged` exited with
code `0`, that is a confirmed successful result even if the interactive
terminal subsequently loses stdin. Restage and continue the commit; do not
output `STOP` or run a duplicate lint command in that case.

After `pnpm lint-staged` succeeds and the same plan-owned paths are restaged,
set `SKIP_LINT_STAGED=1` only on the final `git commit` or `git commit --amend`
command. The pre-commit hook still enforces branch, ignored-file, environment
file, and secret checks; this flag skips only the duplicate formatter/linter
pass. Do not use `HUSKY=0` or `--no-verify`.

---

## Completed Commit Rules

Apply this section ONLY when the plan starts as:

## Workflow State

completed

Required behavior:

If `Task savepoint aggregate summary` is present:

1. Do not run `git add`.
2. Do not run `git commit`.
3. Do not write `.ai/artifacts/<plan-name>/execution-summary.md`; the runner refreshes it after this stage.
4. Verify no remaining plan-owned changes exist.
5. Summarize the task commit SHAs and artifact paths.
6. MUST NOT push.

Otherwise, first check whether the full plan contains an explicit
`## Commit Boundaries` entry for the runner-injected current task.

If the current task has explicit commit boundaries:

1. Before staging, verify the entry targets the current task, has two to twelve
   dependency-ordered boundaries, and lists only paths within the
   runner-injected plan-owned path list. Each changed plan-owned path must be
   in exactly one boundary. If this is not true, output `STOP` with reason
   `invalid commit boundaries` and do not stage or commit.
2. Create one commit per boundary in the documented order. For each boundary,
   stage only its listed files or narrowly scoped file group, including its
   focused tests in the same commit.
3. Run `pnpm lint-staged` once, wait for it to exit, restage that same
   boundary, inspect its staged path list, and confirm every staged path
   belongs to that boundary and to the runner-injected plan-owned path list
   before creating one conventional commit using the required multiline
   command with `SKIP_LINT_STAGED=1`.
4. Before moving to the next boundary, confirm the preceding commit is clean
   and no files outside the runner-injected plan-owned path list are staged.
5. After the final boundary, confirm no plan-owned changes remain, report every
   created SHA and subject in documented order, and do not create an aggregate
   commit.

Otherwise:

1. Stage only plan-owned paths from the runner-injected path list.
2. Run `pnpm lint-staged` so formatting and lint fixes happen before commit.
3. Stage the same runner-injected plan-owned paths again, because lint-staged tasks may modify files after the first add.
4. Inspect the staged diff and confirm every staged path is in the runner-injected plan-owned path list.
5. If any staged path is outside the runner-injected path list, output `STOP` with reason `non plan-scoped staged changes detected` and do not commit.
6. Generate one conventional-commit subject line and one structured multiline body using the commit message rules.
7. Create one local git commit using:

```bash
SKIP_LINT_STAGED=1 git commit --cleanup=verbatim -F - <<'EOF'
<generated subject>

<generated body>
EOF
```

8. MUST NOT push.
9. Immediately run the runner-injected path-scoped `git status --short --`
   command. If it is clean, continue. If it contains only mechanical formatter
   or linter output from this commit path, repeat the scoped
   add/lint-staged/restage sequence, amend the just-created commit with
   `SKIP_LINT_STAGED=1 git commit --amend --no-edit`, and rerun that status
   check. Do not amend product behavior edited after review: output `STOP` with reason
   `plan-owned changes remain after commit-summary` instead.

Rules:

* Do not update the plan.
* Do not create more than one commit unless the current task has a valid
  explicit `## Commit Boundaries` entry; then create exactly one commit per
  listed boundary and no aggregate commit.
* Do not stage or commit `.ai/` files.
* If `pnpm lint-staged` or `git commit` fails, output `STOP` with the exact
  failure. The runner records the failed preflight, unstages the plan-owned
  paths, preserves `completed`, and lets the next runner
  invocation resume this stage without bypassing the hook.
* Do not write `.ai/artifacts/<plan-name>/execution-summary.md`; the runner
  refreshes it from completed task artifacts after each task savepoint commit.
* After successful commits, read the current branch. Output the created SHA and
  subject for a default task commit, or every created SHA and subject in order
  for explicit boundaries, followed by the user-facing summary.

---

## Output (MANDATORY)

Use this shared terminal-facing contract for non-review stages.

Rules:

* `**Summary**` starts with the stage result/state line, then at most 2-3 short high-signal bullets.
* Do not include a branch line in `**Key Details**`.

When `Task savepoint aggregate summary` is present:

* `**Summary**` starts with `FINAL SUMMARY RECORDED — no additional commit created.`
* `**Key Details**` starts with `Task commits complete`, then lists the task
  commit subjects or SHAs and the user-facing outcomes prefixed with `--`.
* Do not use `COMMIT CREATED` or a conventional-commit subject line.

Otherwise, `**Key Details**` must use a single conventional-commit subject line
followed by a short user-facing summary list prefixed with `--`.

**Plan**

.ai/plans/<plan-name>.md

**Summary**

* COMMIT CREATED (or `FINAL SUMMARY RECORDED — no additional commit created.` for an aggregate summary)
* stage result/state line first
* at most 2-3 short high-signal bullets

**Key Details**

<type>(<feature>): <summary> (or `Task commits complete` for an aggregate summary)
-- short user-facing outcome
-- short user-facing outcome
-- short user-facing outcome

**Next**

Workflow State: `completed`
