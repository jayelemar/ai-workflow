# Workflow Issue Tracker

Last reviewed: 2026-11-02

Track findings from the workflow audit and record evidence as each is resolved.
This document is an issue backlog, not an execution plan or workflow authority.
Preserve the existing `/plan` → saved plan → `/goal` flow. Completed saved-plan
implementations now suggest one copyable `/review ...` prompt.

## Status

All seven findings are resolved. WF-01 and WF-02 are recorded in the
project-local `.ai/plans/runtime-cleanup-fixes.md`; WF-03 through WF-07 are
recorded in `.ai/plans/workflow-backlog-fixes.md`. Both plans are ignored local
artifacts, not distributed shared source. Priority reflects the original audit,
not proof of an application vulnerability.

The former validation blocker was resolved with explicit user authorization:
`docs/workflow-usage.md` was restored and aligned with the current workflow;
the three historical document deletions were retained and staged in the nested
repository. At the implementation handoff, the new canonical worktree fixture
test was staged, live focused checks passed 123/123, and live full health passed.
Independent final review found no remaining actionable defects. No commit or PR
had been created at that point.

| ID    | Priority | Status   | Finding                                   |
| ----- | -------- | -------- | ----------------------------------------- |
| WF-01 | High     | Resolved | Unsupported sub-agent fork setting        |
| WF-02 | High     | Resolved | Cleanup scope includes active plans       |
| WF-03 | Medium   | Resolved | Health checks omit routes and config      |
| WF-04 | Medium   | Resolved | Local architecture guidance is stale      |
| WF-05 | Medium   | Resolved | Worktree context copy policy conflicts    |
| WF-06 | Medium   | Resolved | Setup rejects existing root instructions  |
| WF-07 | Lower    | Resolved | PR guidance restricts validation evidence |

## WF-01: Unsupported Sub-Agent Fork Setting

- Audit evidence before the fix: [AGENTS.md](../AGENTS.md) and
  [Codex setup guidance](codex-agent.md) prescribe `fork_turns: "4"`.
  The audit session's tool accepts only `"all"` or `"none"`; explicit model and
  effort overrides require `"none"` in that session.
- Impact: the prescribed spawn arguments cannot run in the observed runtime.
  This is a verified session mismatch, not a claim about every Codex version.
- Recommendation: align instructions with supported tool capabilities, keep
  explicit role settings where supported, and describe handling unavailable
  settings without silently changing the requested model or effort.
- Done when: both instruction sources agree, and a bounded delegation check
  confirms supported arguments, model, effort, and naming in the target client.
- Resolution (2026-11-02): both sources now require inspecting the
  exposed schema, use `fork_turns: "none"` for explicit role overrides in the
  audited runtime, and require explicit context for children without history.
  Existing role defaults remain unchanged; unavailable settings stop delegation
  without silent substitution.
- Validation: the accepted `scout_luna_high_runtime_check` call explicitly
  requested `gpt-6-luna`, `high`, and `fork_turns: "none"`; the child returned
  cited, read-only instruction-reading results. Accepted arguments and a
  completed task are available evidence, not independent attestation of the
  underlying execution model or proof about other clients. Guidance checks,
  84 focused tests, full health, and independent final review passed.

## WF-02: Cleanup Scope Includes Active Plans

- Audit evidence before the fix: [cleanup-local.mjs](../scripts/maintenance/cleanup-local.mjs)
  describes legacy cleanup but includes the live `plans/` directory. The
  [plan worktree cleanup utility](../prompts/worktree-cleanup.md)
  discovers every plan and explicitly rejects plan selection or exclusions.
- Impact: an authorized cleanup can remove active plans alongside historical
  records. Existing previews and confirmations reduce accidental execution;
  this finding concerns the breadth of the supported operation.
- Recommendation: support a selected plan, preserve active plans by default,
  and keep any bulk deletion explicitly requested and previewed. Decide the
  active/completed distinction before implementation.
- Done when: temporary-fixture checks prove selected cleanup preserves active
  and unrelated plans, cancellation preserves all targets, and bulk cleanup
  retains the existing containment, confirmation, and branch protections.
- Resolution (2026-11-02): legacy cleanup excludes `plans/` and
  rejects managed-root overlap through plan aliases before deletion or root
  creation, including filesystem casing and dangling case variants. The prompt
  utility now accepts one explicit `plan: .ai/plans/<plan-name>.md` or explicit
  `all-plans: true`; no selector only inventories. Selection, full inspection,
  exact confirmation, and reinspection define permission without status parsing.
  Unselected plans/worktrees/records, unmatched roots, non-plan entries, and all
  branches remain protected; shared ownership stops cleanup.
- Validation: 17 cleanup tests use disposable fixtures to prove legacy plan
  preservation and alias rejection while retaining preflight/failure coverage.
  Selection, cancellation, bulk scope, topology, and failure scenarios were
  inspected against the written prompt and guidance tests, not executed as an
  automated prompt cleanup. All 84 focused tests, full health, and diff whitespace
  checks passed. Independent reviewers exposed alias and case-equivalence gaps;
  both were fixed with failing regressions, then fresh reviewer
  `reviewer_sol_xhigh_case_review` found no blocking or actionable findings.
  No real plan/worktree cleanup was performed.

## WF-03: Health Checks Omit Routes And Configuration

- Audit evidence before the fix: the route parser in
  [health-check.mjs](../scripts/maintenance/health-check.mjs) accepts simple
  Markdown paths and `shared/` paths, but skips the local index's nested
  Electron `skills/.../SKILL.md` routes. Its canonical-source roots omit
  `.codex/config.toml`.
- Impact: a green health result does not establish that those skill routes
  resolve or that the Codex configuration is covered by source checks.
- Recommendation: validate nested instruction routes and include the tracked
  configuration in appropriate checks. Separate file/parse validity from
  runtime support; neither alone proves account or client capabilities.
- Done when: focused checks fail for missing nested routes and missing or
  malformed configuration, while valid standalone CI and local routing pass.

- Resolution (2026-11-02): nested routes now
  include `skills/.../SKILL.md`, reject traversal/absolute/escaping targets,
  and participate in existing routing/isolation checks. The tracked config is
  explicitly required and checked with pinned TOML parsing and documented
  field types; errors omit configuration excerpts. Static validity is distinct
  from runtime/model availability. All 47 health fixture checks pass, after
  first demonstrating failing regressions for the audit gaps. Standalone
  prepared copies pass actual default/full health in both layouts; consuming
  checkout default/full health and all 123 focused checks now also pass.

## WF-04: Local Architecture Guidance Is Stale

- Audit evidence before the fix: the consuming workspace's ignored `instructions/architecture.md`
  still uses `new-project`/`new-project-v2` framing and names
  `new-project-v2-desktop-poc-migration.md` as active. That plan was absent
  during the audit.
- Impact: agents can treat historical migration context as current authority.
- Recommendation: describe current Kelno structure and validation commands;
  derive the active plan from the request rather than a permanent architecture
  rule. Preserve useful historical context as explicitly historical material.
- Done when: local paths and commands match the consuming repository, and no
  missing or historical plan is presented as the active implementation plan.
- Placement: this is a project-local finding. The ignored instruction and plan
  are not expected to exist in a standalone checkout of this shared repository.

- Resolution (2026-11-02): ignored local
  architecture now describes current Kelno packages and valid manifest-backed
  commands, replaces absent API paths, selects the plan from each request, and
  labels older POC/migration context historical. Path, command, and nested/
  parent Git-isolation checks passed. No application build or runtime behavior
  was changed to validate this documentation.

## WF-05: Worktree Context Copy Policy Conflicts

- Audit evidence before the fix: worktree setup (now the
  [AI Worktree Setup skill](../.agents/skills/ai-worktree-setup/SKILL.md))
  requires mirroring the complete `.ai/` tree, including ignored records and
  nested Git entries. That includes installed dependencies when present, while
  later instructions prohibit copying caches and build outputs.
- Impact: setup carries unrelated context and dependencies into a task and
  gives conflicting instructions about the copy boundary. The audit did not
  establish that secret material was present or copied.
- Recommendation: define one consistent policy covering reusable guidance,
  required local instructions, the selected plan, relevant documentation, and
  any Git metadata required by health checks. Make broader snapshots explicit.
- Done when: a temporary worktree receives the required context without
  unrelated plans or dependencies, routing and health checks still work, and
  the source checkout remains unchanged.

- Resolution (2026-11-02): the prompt now
  selects canonical source, required local routes/references, one plan, and
  required docs/specs. Independent cloned metadata replaces raw Git mirroring;
  credentials, dependencies, caches, builds, and unrelated plans/records are
  excluded. Exact source working changes/deletions are retained. Three real
  disposable fixture checks pass, including single/multi layouts, preflight
  refusal, selected-file fidelity, exclusions, and unchanged source state.
  Tests execute the documented copy block and work without host RTK. Default
  and full health passed in both prepared layouts using isolated CI fixtures;
  no real task worktree was created.

## WF-06: Setup Rejects Existing Root Instructions

- Audit evidence before the fix: [agents-override.mjs](../scripts/setup/agents-override.mjs) treats
  any parent-root `AGENTS.md` as a conflict. The audited workspace has such a
  file containing tool-generated guidance.
- Impact: setup would reject the current workspace even if its existing
  override were otherwise correct. This conclusion comes from source inspection;
  setup was not run against the workspace during the audit.
- Recommendation: define deliberate coexistence and instruction routing,
  preserving root guidance and custom overrides rather than overwriting them
  or classifying every root instruction file as legacy.
- Done when: isolated setup tests cover coexistence, repeat execution, retained
  custom guidance, and refusal of unsafe or genuinely conflicting targets.

- Resolution (2026-11-02): setup accepts
  regular root guidance, explicitly routes it before workflow instructions,
  and preserves accepted custom overrides byte-for-byte. Only the exact old
  generated template is upgraded; ambiguous routing and unsafe/genuine legacy
  targets fail before managed writes. All 48 setup fixture checks pass after
  failing regression checks first proved the old behavior. Existing-root,
  later-added-root, custom-guidance, idempotence, and linked-worktree cases use
  disposable repositories. Real workspace setup was not run.

## WF-07: PR Guidance Restricts Validation Evidence

- Audit evidence before the fix: PR creation guidance (now the
  [AI PR skill](../.agents/skills/ai-pr/SKILL.md))
  forbids validation, risk, migration, and deferred-work sections.
  [Shared delivery guidance](../instructions/shared/delivery-hygiene.md)
  expects relevant evidence in delivery descriptions and checks each PR for
  explicit validation evidence.
- Impact: agents receive competing guidance about what reviewers should see.
  Validation can be recorded in commit descriptions, but the PR format still
  limits a concise, self-contained review handoff.
- Recommendation: permit concise validation and relevant risk information
  while keeping descriptions proportional to the change.
- Done when: both sources agree, and examples for simple and sensitive changes
  distinguish completed checks from deferred evidence without mandatory filler.

- Resolution (2026-11-02): PR and shared
  delivery guidance now agree on concise validation evidence and relevant
  risks/migrations/recovery information. Simple and sensitive examples
  distinguish completed, required missing, and optional deferred checks.
  Targeted delivery-guidance checks passed; no live PR was created.

## Resolved Before This Backlog

- Saved-plan completion now produces one fenced, copyable `/review ...` prompt
  containing the repository, plan, Git target, and review instructions.
- Implemented in commit `b6b4997`, submitted as PR #27 from `development` to
  `master`. PR creation was verified; merge status is not asserted here.

## Final Validation

- First independent review found two implementation defects: the documented
  routing block's blank line was rejected by setup, and a byte-identical tracked
  root instruction file lost its restrictive source permissions during worktree
  copying. Both were reproduced with failing regressions and corrected.
- Updated health/setup/worktree suites pass 98 checks on Node 20.20.2; affected
  setup/worktree suites pass 51 on Node 24.19.0. After remediation, actual
  default/full health passed for both topologies with CI and actual local
  routing in isolated sources. Fixture sources retained committed baseline
  documents; consuming-checkout checks subsequently passed after the user
  authorized restoring the active guide and staging the historical removals.
- Fresh independent remediation reviewer
  `reviewer_sol_xhigh_workflow_remediation` reported no actionable findings and
  independently passed all 98 changed-boundary checks on Node 20.20.2. Both
  initial review defects are resolved. The final live
  `rtk proxy corepack pnpm@10.34.4 --dir .ai test:focused` passes 123/123 and
  `rtk proxy corepack pnpm@10.34.4 --dir .ai health:full` passes. Formatting and
  both repositories' diff checks pass; ignored local instructions/plan remain
  untracked and the parent application is unchanged. All acceptance evidence is
  complete; changes remained uncommitted at the implementation handoff.

## Maintaining This Tracker

The person or agent implementing a finding updates its status and records the
resolution, validation evidence, and commit or PR reference in that finding.
Recheck the evidence against current files before starting; this is a dated
audit snapshot. Keep project-local fixes local, and update shared policy only
when the requested scope includes it. No finding authorizes cleanup, delivery,
or application changes by itself.
