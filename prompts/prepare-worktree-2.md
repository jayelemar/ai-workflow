# Prepare a Worktree for Any Saved Plan

Create a fully prepared Codex CLI worktree for a saved plan. This prompt only
sets up the worktree; it never executes the plan.

## Input

Read the plan reference from the user's invocation:

```text
Plan file: .ai/plans/<plan-name>.md
```

Accept either that repository-relative path or the bare `<plan-name>`. For a
bare name, resolve `.ai/plans/<plan-name>.md`.

If no plan was supplied, inspect `.ai/plans/*.md` without modifying anything.
Use the only plan when exactly one exists. When there are zero or multiple
candidates, stop and ask the user for one plan file; list only the candidate
paths and do not choose by recency.

## Resolve the Setup Dynamically

1. Resolve the **primary checkout** for the active Git repository. Start with
   `git rev-parse --git-common-dir`, then inspect `git worktree list --porcelain`
   and select the one worktree whose Git directory is that common directory
   itself (not a linked-worktree metadata directory). Do not use the active
   linked worktree as the source, even when the prompt is invoked from one.
   Do not hardcode a repository, user, plan, branch, model, or objective.
2. Validate that the selected file exists inside the primary checkout's
   `.ai/plans/` directory, declares `plan-manifest@2`, and has exactly one
   `LOW`, `MEDIUM`, or `HIGH` classification. A plan reference inside a linked
   worktree is not a valid source: stop and require its plan bundle to be
   transferred to the primary checkout's `.ai/` directory first.
3. Derive the canonical plan name from `# Plan: <plan-name>`. Require it to be
   a safe kebab-case path segment and to match the plan filename.
4. Read the plan's declared spec and artifact paths. Validate every artifact
   required by its classification before creating the worktree:
   - LOW: saved plan only.
   - MEDIUM: readable saved spec and plan.
   - HIGH: readable saved spec, plan, and
     `.ai/artifacts/<plan-name>/goal-handoff.md` using `goal-handoff@1`.
5. Derive these values:
   - worktree root: `<primary-checkout>/.worktrees`
   - worktree path: `<primary-checkout>/.worktrees/<plan-name>`
   - the path must be an immediate child of the primary checkout's
     `.worktrees/` directory; never nest a new worktree under another
     worktree, and never use a singular `.worktree/` directory
   - branch type: resolve the conventional purpose from the saved artifacts;
     `bugfix-spec@1` maps to `fix`, `feature-spec@1` maps to `feat`, and
     maintenance-only work maps to `chore` unless a narrower conventional
     type such as `docs`, `refactor`, `test`, `perf`, `ci`, or `build` applies
   - branch: `<branch-type>/<plan-name>`
   - never use agent, model, vendor, or tool identity prefixes such as
     `codex/`, `claude/`, or `agent/`; if the purpose is ambiguous, stop and
     ask for the branch type
6. Resolve the Codex parent runtime from `.ai/config/agent-models.toml` by
   mapping `[roles.parent].tier` to `[tiers.<tier>].model` and reading the
   parent's `reasoning_effort`. Do not silently substitute a model or effort.
7. Resolve the exact execution handoff without authorizing or running it:
   - LOW or MEDIUM: `execute <selected-plan-path>`.
   - HIGH: the single command under `## Next Action` in the validated goal
     handoff. Confirm it is a `/goal` command and references the selected plan.

If any required metadata is missing, malformed, conflicting, or outside the
repository, stop before creating the worktree and report the exact problem.

## Setup Requirements

1. Read and follow the source repository's `AGENTS.md` and its referenced
   instruction entrypoints before acting. Prefix shell commands with `rtk`
   when the repository requires it.
2. This is setup only. Do not run `execute`, `/goal`, application validation,
   implementation, deployment, database changes, or external-service
   mutations.
3. Use the primary checkout's current `HEAD` as the worktree base. Do not
   fetch, pull, merge, rebase, commit, push, reset, or modify the source
   checkout.
4. Before creating anything:
   - Confirm the selected source is the primary checkout and contains the plan;
     do not derive either source or target from a linked worktree path.
   - Confirm the tracked and non-ignored source working tree is clean.
   - Record the source branch and base commit.
   - Confirm the primary checkout ignores `.worktrees/`; reject an unignored
     singular `.worktree/` location rather than creating there.
   - Confirm the derived worktree path does not exist.
   - Confirm the derived local branch does not exist and is not registered in
     another worktree.
   - On a collision, stop safely. Do not delete, overwrite, prune, reset,
     detach, or reuse anything.
5. Create the worktree root if needed, then create a new worktree at the
   derived path and branch from the recorded source `HEAD`.
6. Mirror the complete source `.ai/` tree into the new worktree. Include
   ignored, hidden, generated, artifact, log, prompt, wrapper, spec, plan, and
   instruction files. Preserve relative paths, timestamps, permissions, and
   safe symlinks. The source `.ai/` directory can itself be an ignored nested
   Git repository, so do not use Git file lists or an ordinary glob such as
   `.ai/*`: either can omit required ignored or dot-prefixed entries. Create
   the target `.ai/` directory only after confirming it is absent, then copy
   the _contents_ with trailing slashes using an archive-preserving command
   equivalent to:

   ```bash
   rsync -aH --safe-links '<primary-checkout>/.ai/' '<worktree>/.ai/'
   ```

   Never exclude `.git`, hidden paths, `node_modules`, or any other source
   `.ai/` entry from this mirror. Never print file contents.

7. Mirror every `.env` and `.env.*` file from anywhere below the source into
   the same relative path in the worktree:
   - Exclude `.git`, `.worktrees`, worktree metadata, `node_modules`, `.next`,
     coverage, `dist`, `build`, and cache directories.
   - Copy files rather than symlinking them to the source.
   - Preserve permissions and never display, diff, log, summarize, or expose
     their contents or values.
   - Never stage or commit secret environment files.
8. Verify the mirrors without revealing contents:
   - Prove the source and target `.ai/` trees match using an archive-preserving
     checksum dry run with the same trailing-slash source and target paths; it
     must report no missing, extra, or changed entry. A file count, Git status,
     or a comparison that ignores dot-prefixed, ignored, nested-Git, or
     dependency entries is insufficient. Use a command equivalent to:

     ```bash
     rsync -aHncni --delete --safe-links '<primary-checkout>/.ai/' '<worktree>/.ai/'
     ```

     It must produce no itemized changes before setup can continue.

   - Compare environment-file relative paths and checksums.
   - Report only the environment-file count.
   - Confirm every copied untracked environment file is ignored by Git. If one
     is not ignored, stop and report only its relative path.
9. Prepare dependencies inside the worktree without reusing or symlinking the
   source dependency directory:
   - Initialize submodules only when `.gitmodules` exists.
   - Resolve repository runtime pins such as `.nvmrc`, `.node-version`, or
     equivalent tool configuration. When multiple pins exist, require them to
     agree. Activate the pinned runtime for installation and all setup checks;
     do not silently use a different ambient runtime.
   - Detect the repository's declared package manager from `packageManager`
     and its lockfile. If they conflict, stop instead of guessing.
   - Verify the pinned runtime and declared package-manager version exist and
     satisfy the repository's engine constraints.
   - Install with the lockfile-preserving command appropriate to that manager,
     such as `pnpm install --frozen-lockfile`, `npm ci`,
     `yarn install --immutable`, or `bun install --frozen-lockfile`.
10. Prepare Codex support:
    - Create a worktree-local `.codex/` directory. When the source has
      `.codex/config.toml`, copy only that portable project configuration as a
      regular file without displaying its contents. Never copy or symlink
      `.codex/state`, `.codex/hooks`, authentication data, caches, or other
      machine/session state. Stop if the configuration embeds a credential or
      a source-worktree-specific absolute path.
    - Verify the exact worktree is registered as trusted in the user-level
      Codex configuration so its project-scoped `.codex/config.toml` is loaded.
      Add only the exact `projects.<worktree-path>.trust_level = "trusted"`
      entry when it is missing; preserve every existing user setting and never
      display credentials or unrelated configuration.
    - When `.ai/package.json` provides `setup:agents-override`, run it from the
      worktree and verify the resulting root `AGENTS.override.md` is a regular,
      ignored local file that points to the worktree's own `.ai` instructions.
      Do not create an `AGENTS.md` file inside `.codex/`.
    - When the source has project-local `.agents/skills`, mirror that skills
      tree as independent files, verify it is ignored, and confirm its skill
      manifest count and dry-run comparison. Do not copy `.agents` state,
      `.claude`, or other agent/session data unless checked-in repository
      instructions explicitly require them.
    - Verify `codex --version` and `codex login status` without printing tokens
      or credentials.
    - For HIGH, verify `codex features list` reports both `goals` and
      `multi_agent` enabled. Treat missing required features as a blocker.
    - For LOW or MEDIUM, report those feature states when available, but do not
      require HIGH-only goal support.
    - Verify the selected plan, its required spec/artifacts,
      `.ai/AGENTS.md`, `.ai/instructions/index.md`, and
      `.ai/config/agent-models.toml` are readable in the worktree when those
      files are part of the source workflow.
    - Verify every absolute instruction reference from `AGENTS.md` is readable.
11. Run setup validation only:
    - Confirm the worktree is registered by `git worktree list`.
    - Confirm its branch and base commit match the derived and recorded values.
    - Confirm the worktree-local `.codex/config.toml` and generated instruction
      override are ignored and that no copied Codex path resolves into the
      source worktree.
    - Confirm copied project-local skills are ignored, match the source, and do
      not resolve into the source worktree.
    - Confirm dependency installation did not change tracked application
      files. If it did, leave the changes intact and report them as a blocker.
    - Run `git status --short --branch` without staging anything.
12. If setup fails after worktree creation, leave the worktree intact and
    report the failed step. Never automatically remove it or expose secrets.

## Completion Output

Return a concise readiness report containing:

- Selected plan, classification, and required spec/artifacts
- Worktree path, branch, and base commit SHA
- `.ai/` mirror verification result and environment-file count
- Dependency installation result
- Codex login and required feature readiness
- Resolved parent model and reasoning effort
- Git status and non-secret warnings

Then print paste-ready commands using the resolved values:

```bash
cd '<resolved-worktree-path>'
codex -m '<resolved-parent-model>' -c model_reasoning_effort='<resolved-parent-reasoning-effort>'
```

Finally print the exact resolved execution handoff in a separate text block.
Clearly state that the setup did not run it and that the user must invoke it in
the new Codex session to authorize implementation.
