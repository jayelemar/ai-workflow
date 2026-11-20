# AI Repository Guidance

This nested `.ai` Git repository provides reusable Codex instructions, planning
and execution skills, independent utilities, and self-contained health checks.
[AGENTS.md](AGENTS.md) owns behavior and action boundaries.

## Setup

To connect this workspace to the shared Codex instructions and skills,
ask Codex to run [Local Codex Setup](prompts/setup-local-codex.md).
If local instructions are missing, that prompt bootstraps them with one creation
approval, then continues setup in the same session.

For manual setup, run from the containing project root (Git or unversioned):

```bash
rtk proxy corepack pnpm@10.34.4 --dir .ai setup:codex
```

Restart Codex from the trusted project root afterward. The utility preserves
root guidance and installs project-local routing, skill links, and configuration.
Read [Codex Setup](docs/codex-setup.md) before running setup for requirements,
installed files, account mappings, conflict recovery, and verification.

## Workflow

| Work type          | Use when                                                                                                                                | Artifact        | Review                   |
| ------------------ | --------------------------------------------------------------------------------------------------------------------------------------- | --------------- | ------------------------ |
| Direct             | The outcome is bounded and understood                                                                                                   | None            | Self-review              |
| Standard planned   | Work is complex, ambiguous, cross-cutting, or lengthy                                                                                   | One living plan | Self-review              |
| Controlled planned | Authentication, authorization, payments, secrets, migrations, destructive behavior, or another named security or trust boundary changes | One living plan | Independent final review |

[Brainstorm](.agents/skills/brainstorm/SKILL.md) keeps exploration read-only until
the explicit `CREATE_PLAN` command hands the discussion to Create Plan.

[AGENTS.md](AGENTS.md) owns execution, required evidence, and completion for
native Execute plan, `/goal`, and ordinary implementation requests. The
[Create Plan skill](.agents/skills/create-plan/SKILL.md) creates and refines plans;
[Plan Review](instructions/shared/plan-review.md) owns detailed review procedures.
No workflow state machine or companion status artifacts are maintained. Planned
execution records disposable local resources only when needed, under
[Task Resources](instructions/shared/task-resources.md). Skills
do not automatically chain actions or grant delivery, installation, or cleanup
authority.

Useful invocations:

```text
Fix the duplicate receipt import. Preserve existing authorization and run the focused receipt tests.

$brainstorm Explore this ticket.

CREATE_PLAN

$create-plan Save a plan for the requested change.

/goal Implement .ai/plans/example-change.md. Preserve its boundaries, keep the plan updated, run every required validation, and finish only when its definition of done is proven.

$worktree-setup plan: .ai/plans/example-change.md

$git-commit Prepare commits for these changes.

$pull-request

$show-summary

$show-plan-progress

$manual-qa-checklist
```

Use native Execute plan, `/goal`, or a normal request to implement a saved plan.
All follow the same execution rules; controlled work requires independent final review.
Prepare worktrees after saving the plan and before starting its Goal; use the
preparation result's prompt with its explicit worktree paths. Matching interrupted
setups can be resumed after Git and context verification. Setup finishes with
copied `.ai/`, `.agents/`, and `AGENTS.override.md` excluded from application Git
status through repository-local rules shared by its worktrees. Tracked files
remain visible, and the nested `.ai` keeps its own Git status. Setup provides
verified isolation and selected context, without workflow health or dependency
installation; implementation handles dependencies and application validation. Finish or stop the
current Goal before starting another. Give each new outcome its own plan,
restate still-applicable decisions, and reference that new plan explicitly.

Before a main-checkout or worktree execution creates its first local Docker
resource or dedicated iOS Simulator, follow
[Task Resources](instructions/shared/task-resources.md). Initialize with the
original workspace/source plan and exact execution root, then pass its exact
`TASK_RESOURCES_CONTEXT` JSON to fixtures and other child commands. Worktree
setup carries the original source identity in its handoff; the copied workflow
never owns a second resource record. Planning and worktree-only setup create no
resource artifact. Version 1 rejects tracked Android and other unsupported
providers explicitly.

## Skills and Utilities

| Skill                                                              | Purpose                                               |
| ------------------------------------------------------------------ | ----------------------------------------------------- |
| [Brainstorm](.agents/skills/brainstorm/SKILL.md)                   | Explore ideas; plan only after `CREATE_PLAN`          |
| [Create Plan](.agents/skills/create-plan/SKILL.md)                 | Create, revise, and review implementation plans       |
| [Worktree Setup](.agents/skills/worktree-setup/SKILL.md)           | Prepare native worktrees and independent task context |
| [Git Commit](.agents/skills/git-commit/SKILL.md)                   | Organize and create authorized local commits          |
| [Pull Request](.agents/skills/pull-request/SKILL.md)               | Preview a PR and publish after exact-preview approval |
| [Show Summary](.agents/skills/show-summary/SKILL.md)               | Show a short, nontechnical summary in chat            |
| [Show Plan Progress](.agents/skills/show-plan-progress/SKILL.md)   | Show evidence-backed completion coverage for a plan   |
| [Manual QA Checklist](.agents/skills/manual-qa-checklist/SKILL.md) | Show numbered manual test steps and expected results  |

Skills match ordinary requests and explicit `$skill-name` invocation. Local
setup, read-only skill discovery, instruction management, worktree update review,
and selected worktree cleanup remain [independent prompts](prompts/README.md).

[Review Worktree Updates](prompts/review-worktree-updates.md) reviews task-owned
documentation and instruction changes for return to the original workspace.
Invoke it explicitly; every parent file change requires its own explanation and
approval. Plans remain excluded. Setup, implementation completion, and cleanup
do not invoke it automatically.

```text
Run `.ai/prompts/review-worktree-updates.md`.
worktree: .worktrees/<task-name>
```

## Instructions and Repository Boundary

The ignored `instructions/index.md` routes only relevant guidance by affected
code and capabilities, combining application types for mixed work. Portable
principles live in `instructions/shared/`; reusable application guidance lives
in `mobile/`, `desktop/`, `web/`, and `server/`, with framework guidance nested
under its application type. Project paths, commands, and ownership belong in
ignored `instructions/local/`, including `local/architecture.md` and
`local/desktop.md`. These are ordinary instructions, without skill metadata or
discovery links.

The nested `.gitignore` allowlists reusable source, including all five reusable
instruction roots. The router, local instructions, living plans, and legacy
records remain ignored and untracked. A Git parent must not track `.ai` paths.

## Cleanup

Ignored legacy records cannot authorize execution. Preserve them unless cleanup
is explicitly requested. Preview legacy cleanup from `.ai` with
`rtk proxy pnpm cleanup:local`; use `--apply` only with explicit deletion
authority. Its [implementation](scripts/maintenance/cleanup-local.mjs) owns
containment checks and excludes the entire `plans/` tree, including linked,
hidden, and nested entries. It also preserves resource manifests, their containing
artifact directories, and the resource coordination lock, including malformed or
unresolved evidence. It never operates Docker or Simulator providers.

For selected plans, use [Clean Plan Worktrees and Records](prompts/worktree-cleanup.md):

```text
Run `.ai/prompts/worktree-cleanup.md`.
plan: .ai/plans/<plan-name>.md
```

To include all plans except named ones, use:

```text
Run `.ai/prompts/worktree-cleanup.md`.
include everything except saved-outfit-details.md and platform-services-mobile.md
```

That utility owns inventory, exact confirmation, reinspection, and branch
retention. Deliberate `all-plans: true` and the exclusion form include active
plans unless excluded. Exclusions preserve those plans, their worktrees, and
owned records and every execution/resource. With no selector, it only inventories
and shows examples. The complete preview includes recorded Docker resources and
dedicated devices; after the same exact confirmation, resources are deleted
before worktrees, and plans/evidence last. Source checkouts, branches, runtimes,
and shared/base images survive. Failure or unexpected sharing keeps the plan
and artifact for recovery; see [Task Resources](instructions/shared/task-resources.md#recovery).

### Task resource verification map

| Entry/state                         | Expected result                                                                                                                    | Verification / prerequisites                                                                                                                                                   |
| ----------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| Main or prepared-worktree execution | First allocation initializes one source manifest; executions and resources stay isolated; children receive context                 | Original helper `init`, `--help`, and maintained `scripts/resources/store.test.mjs` and `providers.test.mjs`; readable source plan and writable canonical artifact/marker/lock |
| Selected cleanup / exclusions       | Inventory includes all selected executions; excluded resources survive; `CANCEL` changes nothing; changed preview refuses deletion | Original helper `inventory` with repeated selected `--plan`, then prompt-owned `cleanup-confirmed`; stopped agents/tests and available matching local providers                |
| Failure / retry                     | Partial cleanup retains plan/artifact; exact-ID retry tolerates absence; shared images remain with evidence                        | `reconcile`, `release`, and a fresh inventory under [recovery guidance](instructions/shared/task-resources.md#recovery); never infer ownership from names                      |
| Explicit resume                     | Ownership, provider identity and current use are checked before activation; provider changes block allocation                      | Original helper `init --resume`, manager/store/CLI tests, and available matching local providers                                                                               |
| Final file phase                    | Only confirmed cleanup transitions are accepted; the existing lock protects worktrees, plans and records until removal finishes    | `verifyFileCleanupUnlocked`, manager filesystem regressions and the cleanup prompt; retain the original preview and successful cleanup result                                  |
| Normal tracked fixture teardown     | Only bound allocations are removed after verification; refusal cannot reach raw Docker fallback                                    | `scripts/resources/disposal.test.mjs`, `fixtures.test.mjs`, `compose.test.mjs`, and the standalone native Docker harness                                                       |
| Fast repository verification        | Schema, record, provider-boundary, cleanup preservation, and guidance regressions pass                                             | `rtk proxy pnpm health` and `rtk proxy pnpm test:focused` from `.ai`; installed pinned dependencies                                                                            |
| Real lifecycle evidence             | Disposable local Docker/iOS creation, confirmation/refusal, deletion, and preservation are verified                                | Explicit disposable provider smoke named by the executing plan; local Docker and selected installed iOS runtime; mocked tests alone leave this unverified                      |

All provisioning code, dependencies, and verification live in `.ai`; no application
package or server checkout is required. CLI tests use arbitrary configuration
paths and standalone Docker operations. These checks cover resource lifecycle;
product authentication and application behavior remain outside this change.
No real provider call runs as part of a documentation check or worktree setup.

The explicit native harness is `scripts/resources/smoke.mjs`. From the original
workspace, run `rtk proxy node .ai/scripts/resources/smoke.mjs --docker --fixture-id <fresh-UUID>`
or `rtk proxy node .ai/scripts/resources/smoke.mjs --ios --fixture-id <fresh-UUID> --device-type <installed-device-type> --runtime <installed-iOS-runtime>`.
Use `rtk proxy node .ai/scripts/resources/smoke.mjs --docker --ports-only --fixture-id <fresh-UUID>`
to verify two simultaneous tasks receive distinct actual loopback ports and
private Compose resources from the same fixed-port source configuration.
Use `rtk proxy node .ai/scripts/resources/smoke.mjs --docker --recovery-only --fixture-id <fresh-UUID>`
to interrupt disposable containers before startup and verify exact-ID recovery
through reconciliation and bound disposal, including uninitialized network metadata.
Select the device-testing platform first. These commands create and remove only
their own disposable fixtures; they preserve evidence on failure. Record the
chosen command and fixture UUID in the executing plan before running it.

## Checks

The independent package requires Node `>=20.20.2` and pins its toolchain. From
the containing workspace:

```bash
rtk proxy corepack pnpm@10.34.4 --dir .ai --ignore-workspace install --frozen-lockfile
rtk proxy corepack pnpm@10.34.4 --dir .ai health
rtk proxy corepack pnpm@10.34.4 --dir .ai health:full
rtk proxy corepack pnpm@10.34.4 --dir .ai test:focused
```

Dependency installation enables Husky hooks in this nested repository.
Before a commit, the hook runs `pnpm health` for source, routing, configuration,
and formatting checks. Before a push, it runs `pnpm health:push`: static health checks always run,
and changed files across every pushed ref select the affected test suites.
Ordinary skills and documentation run the fast guidance tests. Setup code and
the setup reference run setup regressions; worktree setup instructions run
the worktree regressions, including executable Markdown. Hook and health
changes run their respective tests. Committed differences from a pushed ref to the current checkout, plus local
tracked and untracked edits, are included because tests execute the current checkout.

New remote refs, unavailable comparison commits, unknown file types, toolchain
changes, and direct invocation without Git's ref input fall back to the full
suite. Ref deletions still run static health. This selection reduces routine
push time; it does not run every regression on every push. Use `pnpm health:full`
for explicit comprehensive validation. No validation cache or remote fetch is used. A failed check stops the Git operation. Validation runs
locally; no GitHub Actions workflow or separate CI instruction index is needed.
Keep the ignored `instructions/index.md` current when instructions change.

Health can also run anywhere with
`rtk proxy node /absolute/path/to/.ai/scripts/maintenance/health-check.mjs`
(add `--full` for full checks). It validates tracked source, contained
instruction routes, and `.codex/config.toml` syntax and documented field types
using a pinned TOML parser; errors omit config excerpts. Static checks do not
prove model availability, account permission, or client support.

Health also validates local Markdown links and images in `AGENTS.md`, `README.md`,
skills, docs, instructions (including ignored local/index files), and prompts.
Inline and reference-style destinations resolve relative to their document;
leading-slash paths resolve from the workflow root. Query strings are ignored
for path lookup, and URL-encoded paths and fragments are decoded. Files and
directories must exist. Fragments targeting Markdown files must match a generated
heading ID, including formatted headings, setext headings, and duplicate suffixes.
Markdown parsing reuses the installed Prettier plugin, so code examples, nested
fences, inline code, and comments do not introduce links or headings.

Diagnostics identify the source file and line plus the missing target or heading,
without query values or source excerpts. Default health, pre-commit, and pre-push
all include this check. It remains offline and read-only: external URLs, links
outside this repository (including symlinks to sibling application files), and
ignored runtime-data roots such as `plans/` and `artifacts/` are excluded.
Fragments on non-Markdown targets and raw HTML links are not inspected. Markdown
fragments must name generated headings; custom HTML anchors are not recognized.
Valid references do not prove the documented behavior is correct;
use the relevant tests and review evidence for that. Documentation commands are
never executed by the reference check.

### Skill authoring validation

The skill-creator Python validator requires PyYAML. To recreate its local
environment, run from the `.ai` directory with Python 3 and pip available:

```bash
python3 -m venv .venv-skill-validator
.venv-skill-validator/bin/python -m pip install -r scripts/maintenance/requirements-skill-validator.txt
```

Then use that environment's Python to run `scripts/quick_validate.py` from the
installed `skill-creator` skill, passing the skill directory to validate. For
example, replace `<skill-creator-directory>` with its installed location:

```bash
.venv-skill-validator/bin/python "<skill-creator-directory>/scripts/quick_validate.py" .agents/skills/manual-qa-checklist
```

The pinned [dependency file](scripts/maintenance/requirements-skill-validator.txt)
is reusable source. `.venv-skill-validator/` remains ignored local data and is
recreated on each machine. PyYAML is needed only for this validator; normal skill
use and the Node health checks do not require it.
