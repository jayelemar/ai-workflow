# AI Workflow Simplification Implementation Plan

Status: Complete

Plan type: Standalone living implementation plan for native Codex Goal mode.
This file is not a `plan-manifest@5` artifact and must not activate the existing
`.ai` workflow.

## Goal

Replace the current artifact-heavy `.ai` workflow with a small, progressive
workflow that:

- performs bounded, understood work directly without persistent workflow
  artifacts;
- uses one living plan for complex, ambiguous, or long-running work;
- adds independent review only for sensitive or materially uncertain changes;
- relies on native Codex planning, Goal mode, Git diff scopes, and worktrees;
- preserves repository, security, validation, and delivery safeguards; and
- removes the legacy state synchronization, review state machine, role locks,
  wrappers, and contract tests that exist only to support the old workflow.

The implementation must replace the old workflow. It must not add a simplified
path while leaving the old path active.

## Authorization and Execution Boundary

Execute this plan with native Codex Goal mode. The goal invocation explicitly
authorizes changes inside the `.ai` repository that are required by this plan.
It does not authorize changes in application repositories, deletion of ignored
project-local workflow records, commits, pushes, pull requests, deployments, or
other delivery actions.

Use this invocation after the plan has been reviewed:

```text
/goal Implement the workflow simplification described in .ai/docs/ai-workflow-simplification-plan.md. Replace the existing workflow rather than layering a second workflow on top. Preserve the safety controls named in the plan, validate the replacement, remove obsolete workflow files and tests, and finish only when every required acceptance criterion passes.
```

## Source Material

- [Workflow simplification analysis](ai-workflow-simplification-analysis.md)
- [Repository authority](../AGENTS.md)
- [Current workflow usage](workflow-usage.md)
- [Codex best practices](https://learn.chatgpt.com/guides/best-practices)
- [Prompting](https://learn.chatgpt.com/docs/prompting)
- [Custom instructions with AGENTS.md](https://learn.chatgpt.com/docs/agent-configuration/agents-md)
- [Build skills](https://learn.chatgpt.com/docs/build-skills)
- [Long-running work](https://learn.chatgpt.com/docs/long-running-work)
- [Code review](https://learn.chatgpt.com/docs/code-review)

## Decisions

These decisions are final for this implementation:

1. **No workflow for routine work.** A direct user request authorizes normal
   implementation within its stated scope. The agent inspects, implements,
   validates, and reports without creating a spec, plan, status, flow map, or
   review artifact.
2. **One living plan for planned work.** Complex, ambiguous, or long-running
   work uses one Markdown plan. The same file records goal, boundaries,
   decisions, progress, discoveries, validation, and outcome.
3. **Two risk modes only.** Planned work is either `standard` or `controlled`.
   Controlled mode applies when a change affects authentication,
   authorization, payments, secrets, migrations, destructive behavior, or
   another explicitly named security or trust boundary.
4. **Native Goal mode owns progress.** Do not create a parallel durable status
   file or mirror Goal-mode progress into repository state.
5. **Review the Git diff.** Review uses an explicit base, commit, or uncommitted
   diff after plan-owned writers are paused. No custom content fingerprint is
   maintained.
6. **Review is proportional.** Standard work receives implementation
   self-review and required validation. Controlled work receives one
   independent final review. A fresh follow-up review is required only when
   remediation materially changes the reviewed boundary.
7. **No workflow-specific model locks.** Use current Codex configuration and
   task-appropriate reasoning. Reviewer independence is required for controlled
   work, but its model identifier, name format, fork count, and session identity
   are not correctness conditions.
8. **No automatic delivery.** The workflow never commits, pushes, opens a pull
   request, deploys, or mutates shared external state unless the user explicitly
   requests that action.
9. **Legacy local records are preserved.** Existing ignored `plans/`, `specs/`,
   `artifacts/`, `logs/`, `state/`, and `tmp/` content is not migrated or
   deleted automatically. It cannot authorize new execution after the new
   workflow becomes active.
10. **No compatibility layer.** Do not keep legacy prompts, wrappers, schemas,
    or transition code as an alternative execution path. Historical findings
    documentation may continue to name them.

## Target Workflow

### Direct work

Use for bounded work with a clear requested outcome and no unresolved material
decision:

```text
request -> inspect -> implement -> validate -> self-review -> report
```

Persistent workflow artifacts: none.

### Standard planned work

Use when the work is complex, ambiguous, cross-cutting, or long-running but
does not change a controlled boundary:

```text
native plan -> one living plan -> /goal -> validate -> self-review -> report
```

Persistent workflow artifacts: one living plan.

### Controlled planned work

Use when a named security, trust, destructive, migration, or payment boundary
changes:

```text
native plan -> one living plan -> /goal -> validate -> independent review -> report
```

Persistent workflow artifacts: one living plan. A separate review report is
optional and should exist only when the user needs durable review evidence.

## Living Plan Contract

When the user requests a saved plan and does not provide a path, use one safe
kebab-case file under `.ai/plans/`. The directory remains ignored because its
contents are project-local. A plan for changing the reusable `.ai` repository
itself may instead be tracked under `.ai/docs/`, as this plan is.

The plan contains the smallest applicable subset of these sections:

```md
# <Outcome>

## Goal

## Boundaries and Non-Goals

## Decisions

## Tasks and Progress

## Validation

## Discoveries

## Outcome
```

Rules:

- Update the same file as work progresses.
- Do not create a separate status, journey, implementation map, or review-state
  file.
- Add environment, migration, rollback, security, or cross-repository sections
  only when the changed boundary requires them.
- Keep tasks outcome-oriented and validation observable.
- Record a material discovery in the plan. Ask the user only when it creates a
  genuinely unresolved behavior, permission, destructive, or external-action
  decision.
- Use Git history when the plan is tracked. For ignored project-local plans,
  the current living document is sufficient unless the user explicitly asks
  for durable history.

## Safety Invariants to Preserve

The replacement is incomplete unless all of these remain true:

- Inspect evidence before reaching conclusions.
- Keep changes within the user request and saved plan when one exists.
- Preserve unrelated user work and existing dirty-tree changes.
- Route to the narrow project instructions applicable to changed code.
- Keep authentication and access control working when affected.
- Protect private client, user, firm, credential, and configuration data.
- Run the smallest sufficient validation that proves the changed behavior.
- Treat missing evidence for a required acceptance criterion as a blocker.
- Disclose optional checks that were not run and the residual risk.
- Prevent concurrent agents from editing the same file.
- Use isolated worktrees when independent implementations genuinely run in
  parallel.
- Require explicit authority before destructive actions or external mutations.
- Require explicit delivery authority before commits, pushes, pull requests,
  deployments, or releases.
- Do not introduce a workflow runner, durable transition state, telemetry
  ledger, or replacement status database.

## Target Source Layout

The preferred final workflow surface is:

```text
.ai/
├── AGENTS.md
├── README.md
├── .agents/
│   └── skills/
│       └── change-workflow/
│           ├── SKILL.md
│           ├── agents/
│           │   └── openai.yaml
│           └── references/
│               ├── plan-template.md
│               └── review-checklist.md
├── docs/
│   ├── codex-agent.md
│   ├── workflow-usage.md
│   ├── ai-workflow-simplification-analysis.md
│   └── ai-workflow-simplification-plan.md
├── instructions/
│   ├── index.md
│   └── shared/
│       └── <application engineering instructions>
├── prompts/
│   └── utilities/
│       └── <independent utilities that remain useful>
└── scripts/
    ├── maintenance/
    └── setup/
```

Because `.ai` is a nested repository, the containing workspace's generated
`AGENTS.override.md` continues to route agents to `.ai/AGENTS.md`. That file
must explicitly route planning, planned execution, and controlled work to the
canonical skill. Do not add another generated parent-side workflow copy or a
skill synchronization mechanism.

## File Disposition

### Add

- `.agents/skills/change-workflow/SKILL.md`
- `.agents/skills/change-workflow/agents/openai.yaml`
- `.agents/skills/change-workflow/references/plan-template.md`
- `.agents/skills/change-workflow/references/review-checklist.md`

The skill must use progressive disclosure: its metadata explains when it
applies, its main file contains the compact workflow, and references contain
only the plan and review detail needed for those tasks. Follow the repository's
available skill-creation guidance when authoring it.

### Rewrite or materially simplify

- `.gitignore`: allowlist the canonical `.agents/skills/` source while keeping
  project-local plan and generated-data roots ignored.
- `AGENTS.md`: retain repository boundary and safety invariants; replace staged
  workflow contracts with direct/planned/controlled routing.
- `README.md`: describe the three target execution shapes and remove legacy
  schemas, stage arrows, role sessions, activation, fingerprints, and review
  tokens.
- `docs/workflow-usage.md`: become a short guide for direct work, native
  planning, the living-plan format, `/goal`, controlled review, and optional
  delivery.
- `docs/codex-agent.md`: retain safe project-root setup and explain how
  `.ai/AGENTS.md` routes to the nested canonical skill.
- `instructions/index.md`: continue routing application instructions and route
  workflow-source testing appropriately without loading retired workflow
  protocols.
- `instructions/shared/testing.md`: recognize `.agents/skills/` as workflow
  source and keep validation proportional.
- `instructions/shared/delivery-hygiene.md`: retain focused delivery and risk
  reporting, but remove mandatory workflow trailers and plan-revision metadata.
- `prompts/README.md`: index only independent utilities that remain.
- `prompts/utilities/commit-organizer.md`: remove workflow-specific Git
  trailers while retaining focused commit guidance.
- `prompts/utilities/pull-request-creation.md`: consume repository evidence and
  validation directly rather than depending on plan/status schemas.
- `scripts/maintenance/health-check.mjs` and its tests: recognize the skill
  source, stop requiring wrappers and retired workflow paths, retain source
  allowlisting, ignored-local-data checks, reference checks, formatting, and
  full test execution.
- `package.json`: remove legacy workflow commands and test entries; retain only
  scripts with a supported purpose.
- `.github/workflows/health.yml` and relevant fixtures: run the reduced health
  and test surface.

### Remove after replacement guidance exists

- `prompts/workflow/`
- `wrappers/`
- `templates/plan.template.md`
- `templates/work-status.template.md`
- `scripts/workflow/activate-plan.mjs`
- `scripts/workflow/activate-plan.test.mjs`
- `scripts/workflow/review-fingerprint.mjs`
- `scripts/workflow/review-fingerprint.test.mjs`
- `scripts/workflow/prepare-worktree-topology.test.mjs`
- `scripts/workflow/stage-contract.test.mjs`
- `instructions/shared/ai-workflow.md`
- `instructions/shared/workflow-state.md`
- `instructions/shared/flow-trace-artifacts.md`
- `instructions/shared/reasoning-quality.md` after its useful proportionality
  and evidence rules have moved to `AGENTS.md` or the skill
- `config/agent-models.toml`
- `config/agent-model-evals.md`
- `scripts/models/update-agent-models.mjs`
- `scripts/models/update-agent-models.test.mjs`
- `prompts/utilities/review-until-clear.md`
- `prompts/utilities/prepare-worktree.md`
- `prompts/utilities/cleanup-workflow.md`
- `scripts/maintenance/cleanup-workflow.mjs`
- `scripts/maintenance/cleanup-workflow.test.mjs`

Retain `scripts/maintenance/cleanup-local.mjs` as an explicitly invoked legacy
record cleanup utility. Rename its user-facing description to make clear that
it is not part of active workflow execution. It must remain preview-first and
must never delete local records automatically.

Retain independent instruction management, skill discovery, AGENTS override
setup, commit organization, and pull-request utilities when they remain useful
without legacy workflow contracts.

## Tasks and Progress

- [x] **T1 — Establish the replacement skill and living-plan contract.** Add
      the skill and its two references. Cover direct, standard planned, and
      controlled planned work; proportional validation; independent review; and
      explicit delivery boundaries. Do not modify the old workflow yet.
- [x] **T2 — Switch governance and user documentation.** Rewrite `AGENTS.md`,
      `README.md`, workflow usage, instruction routing, and Codex setup so the new
      skill is the sole active workflow guidance. Preserve application-area routes
      and security/testing/delivery safeguards.
- [x] **T3 — Retire legacy execution and review contracts.** Remove workflow
      prompts, wrappers, templates, activation, fingerprinting, role locks, model
      updater code, and their tests. Remove all active references to their schemas,
      states, tokens, and commands.
- [x] **T4 — Simplify dependent utilities.** Remove workflow-bound worktree,
      review-until-clear, and cleanup machinery. Remove commit trailers and make
      pull-request preparation depend on the actual Git diff and validation
      evidence. Preserve preview-first legacy local-record cleanup.
- [x] **T5 — Reduce maintenance checks.** Update `.gitignore`, health checks,
      package scripts, CI, and fixtures. Replace broad stage-contract assertions
      with focused tests for source discovery, safe instruction routing, ignored
      local records, no automatic delivery, and required validation/sensitive
      review guidance.
- [x] **T6 — Validate the final system and close the plan.** Run every required
      check, inspect the complete diff for preserved safety invariants and unrelated
      changes, record discoveries and decisions in this file, and complete the
      outcome section. Do not commit or deliver without a separate explicit user
      request.

Only one task may actively edit a file at a time. Parallel work, if used, is
limited to read-only research or review unless file ownership is disjoint and
explicit.

## Validation

### Required automated checks

Run from `.ai`:

```text
rtk pnpm exec prettier --check .
rtk pnpm test:focused
rtk pnpm health
rtk pnpm health:full
rtk git diff --check
```

Run the health check by absolute path from outside `.ai`, preserving the
existing portability guarantee:

```text
rtk node /Users/jetermulo/projects/mobii/myuse/.ai/scripts/maintenance/health-check.mjs
rtk node /Users/jetermulo/projects/mobii/myuse/.ai/scripts/maintenance/health-check.mjs --full
```

If package scripts change names, update these commands in this plan before
completion and run their exact replacements. Never silently omit a required
check.

### Required absence checks

Outside the analysis and this migration plan, active source must not reference:

```text
plan-manifest@5
work-status@1
implementation-review@3
review-input-fingerprint@1
review-strategy@2
user-journey@1
implementation-map@1
worktree-setup@1
REVIEW_ONE_MORE
REVIEW_UNTIL_CLEAR
ACCEPT_UNREVIEWED_REMEDIATION
Workflow-Work-Item
Workflow-Spec
Workflow-Plan-Revision
```

Verify with a repository search that explicitly excludes:

- `docs/ai-workflow-simplification-analysis.md`; and
- `docs/ai-workflow-simplification-plan.md`.

Also verify that active source contains no reference to removed prompt,
wrapper, template, configuration, or script paths.

### Required behavioral review

Inspect the final instructions and skill against these scenarios:

1. **Small bug fix:** implementation proceeds directly and creates no workflow
   artifact.
2. **Complex feature:** native planning creates one living plan, and `/goal`
   can execute using that plan without a status sidecar.
3. **Authentication change:** the plan is controlled, relevant security and
   validation instructions load, and an independent final review is required.
4. **Review remediation:** blocking findings are fixed and affected validation
   reruns; a fresh reviewer is used only when the reviewed boundary materially
   changed.
5. **Dirty worktree:** unrelated changes are preserved and excluded from
   plan-owned edits and review findings.
6. **Delivery request absent:** no commit, push, pull request, deployment, or
   external mutation occurs.
7. **Legacy local records present:** they remain untouched and cannot authorize
   execution.
8. **Nested repository use:** the containing workspace's `AGENTS.override.md`
   can route to `.ai/AGENTS.md`, which can route to the canonical nested skill
   without copying it into the parent repository.

## Acceptance Criteria

The goal is complete only when:

- Direct work requires no `.ai` workflow artifact.
- Planned work uses exactly one living plan and no status sidecar.
- Controlled work is triggered only by a named sensitive boundary.
- Independent review uses the actual Git diff and no custom fingerprint.
- No legacy workflow state machine, review budget, exact transition token,
  plan activation, or agent-model lock remains active.
- The canonical skill and references are the only reusable execution workflow.
- Root instructions are materially smaller and contain only durable rules and
  routing.
- Application instruction routing remains intact.
- Authentication, access-control, private-data, validation, unrelated-work,
  destructive-action, and delivery protections remain explicit.
- Existing ignored local workflow records are preserved.
- Every required automated and behavioral validation passes.
- The final report names changed scope, validations performed, any optional
  checks not run, and known limitations.

## Non-Goals

- Changing application code in `frontend/`, `server/`, `admin-api/`, or
  `admin-web/`.
- Automatically deleting or migrating ignored local workflow records.
- Adding a workflow service, runner, database, telemetry system, hook, or MCP
  server.
- Preserving legacy artifact execution compatibility.
- Changing Codex product behavior, global user configuration, or workspace
  administrator policy.
- Automatically committing or delivering the simplification.

## Discoveries

- The current health check treats prompts, wrappers, templates, and workflow
  scripts as canonical tracked source. It must change in the same diff as their
  removal.
- The current worktree, cleanup, commit, and review utilities depend on legacy
  plan/status contracts. Removing only `prompts/workflow/` would leave broken
  active references.
- The model registry is referenced by workflow prompts, shared instructions,
  model-update scripts, tests, and documentation. Removing role locks requires
  retiring the registry and its updater together.
- `.gitignore` currently does not allow a canonical `.agents/skills/` tree, so
  skill creation and source allowlisting must be coordinated.
- The containing-workspace bootstrap already routes through `.ai/AGENTS.md`.
  This allows the nested canonical skill to remain in `.ai` without adding a
  second parent-side copy.
- The repository skill-authoring guidance generates `agents/openai.yaml` for
  UI discovery. It is reusable skill metadata, not workflow state, and belongs
  beside `SKILL.md`.
- The system Python lacked the skill validator's PyYAML dependency. Validation
  therefore ran from an isolated temporary virtual environment; no repository
  dependency was added.
- A permanent blacklist of retired workflow paths would preserve legacy
  knowledge in the health checker and would reject ignored records that this
  plan requires preserving. The final health check validates canonical tracked
  source and ignored local roots instead; retired-path absence is a one-time
  migration check.
- The existing CI job already invokes `health:full` generically. Its command did
  not need replacement; only its instruction fixture changed with the reduced
  source surface.
- Repository-wide formatting exposed a pre-existing Markdown parse issue in the
  TestFlight runbook where a wrapped `>` became a block quote. The sentence was
  minimally rephrased without changing its deployment instruction so required
  health validation could cover the complete tracked source tree.

## Outcome

Completed on 2026-09-23.

- Replaced the staged workflow with one progressively disclosed
  `change-workflow` skill, its living-plan and controlled-review references,
  and standard Codex UI metadata.
- Made direct, standard planned, and controlled planned work the only active
  execution shapes. Native Goal mode owns runtime progress; Git owns change
  evidence.
- Rewrote repository authority and user guidance, retained narrow application
  instruction routing, simplified independent delivery utilities, and removed
  the legacy prompts, wrappers, state contracts, role/model locks, transition
  scripts, cleanup orchestration, and their tests.
- Reduced maintenance to canonical-source tracking, ignored-local-record
  protection, reference and instruction-route checks, formatting, focused
  guidance checks, setup coverage, and preview-first legacy cleanup.
- Preserved ignored legacy records. They are tolerated by health checks and do
  not authorize execution.

Validation completed:

- `rtk pnpm exec prettier --check .` passed.
- `rtk pnpm test:focused` passed all 72 tests.
- `rtk pnpm health` and `rtk pnpm health:full` passed.
- Both absolute-path health commands passed from outside `.ai`.
- `rtk git diff --check` and `rtk git diff --cached --check` passed.
- The Codex skill creator's `quick_validate.py` reported `Skill is valid!` from
  an isolated temporary environment.
- Required legacy-contract and removed-path searches returned no matches
  outside the two migration documents.
- The eight required behavioral scenarios passed manual inspection against the
  final authority, skill, references, usage guide, setup guide, and focused
  tests.

No optional checks were deferred. No application repository was changed. The
TestFlight runbook received one minimal Markdown correction discovered by the
required repository-wide formatter; its deployment behavior is unchanged.
Plan-owned changes are staged only because the health check requires reusable
source to be Git-tracked. No commit, push, pull request, deployment, or external
mutation was performed.
