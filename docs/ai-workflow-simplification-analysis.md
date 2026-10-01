# AI Workflow Simplification Analysis

Date: 2026-09-23

## Executive Summary

The `.ai` workflow is intentionally careful, but it is over-engineered for
routine and most medium-sized application changes. Its strongest safeguards are
appropriate for authentication, authorization, payments, secrets, migrations,
destructive operations, and other sensitive boundaries. The problem is that
the supporting control plane is much larger and more rigid than necessary to
preserve those safeguards.

The recommended direction is:

- allow small, understood changes to proceed directly with validation;
- use one living plan for complex or ambiguous work;
- add `/goal` and an independent review only for sensitive or long-running
  work;
- keep durable repository conventions in a concise `AGENTS.md`;
- package reusable workflow guidance as a skill; and
- remove duplicated status, activation, fingerprint, and review-state
  machinery once the simpler path is proven.

This would preserve the workflow's important safety properties while reducing
operator turns, prompt context, maintenance cost, and workflow-only failure
modes.

## Scope and Method

This analysis reviewed the workflow's governing instructions, workflow prompts,
templates, runtime scripts, contract tests, wrappers, and operator guide. It
also compared the design with the current official Codex documentation fetched
on 2026-09-23.

The measured core workflow slice contains:

| Area                   |     Lines |
| ---------------------- | --------: |
| Governance             |       521 |
| Workflow prompts       |     1,561 |
| Templates              |       193 |
| Workflow runtime       |       781 |
| Workflow tests         |     2,517 |
| Wrappers               |        88 |
| Operator documentation |       272 |
| **Total**              | **5,933** |

These figures cover 33 core files and exclude several utility prompts, shared
application instructions, and maintenance utilities. They therefore represent
a conservative measurement of workflow complexity.

## Findings

### 1. Workflow state is represented in too many places

Desired behavior, execution scope, progress, review state, and repository state
are distributed across several independently validated representations:

- finalized specification;
- user journey and implementation map;
- plan manifest;
- stable work status;
- session plan indicator;
- implementation review report;
- Git state; and
- review-input fingerprints.

Each representation is reasonable in isolation. Together they create a
distributed consistency problem inside a local development workflow. The
workflow consequently needs transactional activation, repeated consistency
checks, resume protocols, stale-evidence handling, and extensive contract
tests.

This is cascading complexity: machinery is added to keep earlier workflow
machinery synchronized.

Relevant sources:

- [Workflow contracts](../README.md#current-contracts)
- [Plan activation](../prompts/workflow/create-plan.md#plan-activation)
- [Plan template](../templates/plan.template.md)
- [Work-status template](../templates/work-status.template.md)
- [Review fingerprints](../prompts/workflow/review-changes.md#review-input-fingerprints)

### 2. The workflow requires too many operator interactions before useful work

Every stage boundary requires another explicit invocation. MEDIUM and HIGH work
also introduces a separate filename-confirmation interaction before the spec
can be written. This creates ceremony before implementation even when the goal,
constraints, and acceptance criteria are already clear.

Explicit authorization is valuable for destructive operations, deployment,
delivery, and unresolved product decisions. It provides much less value between
routine analysis, specification, planning, and implementation when those
actions remain inside the same local repository and user request.

Relevant sources:

- [Workflow sequence](../README.md#workflow)
- [Stage transitions](../instructions/shared/workflow-state.md#stage-sequence)
- [Filename confirmation](../prompts/workflow/generate-spec.md#filename-confirmation-gate)

### 3. Review administration is more complex than review itself

The review protocol includes custom fingerprints, locked reviewer runtimes,
round budgets, exact state transitions, special authorization tokens,
root-cause-family accounting, risk acceptance, and stale-review recovery.

The intent is sound: reviewers should inspect the correct diff, remediation
should be rechecked, and unresolved serious findings should block completion.
However, most of those guarantees can be obtained more simply by:

1. pausing plan-owned writers;
2. reviewing an explicit Git base, commit, or uncommitted diff;
3. fixing blocking findings;
4. rerunning affected validation; and
5. performing one follow-up independent review when remediation warrants it.

Codex already supports review against a base branch, a commit, or uncommitted
changes. Isolated worktrees and exclusive file ownership are a simpler way to
prevent concurrent drift than maintaining a workflow-specific content digest.

Relevant sources:

- [Review protocol](../prompts/workflow/review-changes.md)
- [Official Codex code review documentation](https://learn.chatgpt.com/docs/code-review)

### 4. Prompt wording and orchestration details have become product contracts

The workflow tests exact response shapes, transition language, artifact
versions, agent naming, session reuse, risk tokens, and review accounting. This
makes wording changes and process simplification expensive even when no
application safety guarantee changes.

The workflow also fixes role models, reasoning efforts, fork depth, name
formats, and agent-session continuation behavior. These are useful operational
defaults, but they should not normally determine whether application work is
correct or complete.

Relevant sources:

- [Stage contract tests](../scripts/workflow/stage-contract.test.mjs)
- [Agent model configuration](../config/agent-models.toml)
- [Subagent lifecycle](../instructions/shared/ai-workflow.md#subagent-identity-and-session-lifecycle)

### 5. The workflow's internal complexity conflicts with its own proportionality

principle

The workflow correctly tells application work to prefer the smallest mechanism
that satisfies an evidenced requirement. That same standard should be applied
to the workflow itself.

Several workflow mechanisms appear designed for possible concurrency,
interruption, lineage ambiguity, stale review evidence, and operator misuse
rather than failures shown to occur frequently in this repository. A mechanism
should remain mandatory only when removing it would create a demonstrated and
material failure mode.

Relevant sources:

- [Global invariants](../AGENTS.md#global-invariants)
- [Reasoning proportionality](../instructions/shared/reasoning-quality.md#rules)
- [Review proportionality gate](../prompts/workflow/review-changes.md#proportionality-and-over-engineering-gate)

## Alignment With Official Codex Guidance

Current Codex guidance recommends a lighter default:

- Provide a clear goal, relevant context, constraints, and a definition of
  done. Plan first when work is complex or ambiguous.
- Use only the prompt structure that helps the task; a rigid formula is not
  required.
- Keep `AGENTS.md` practical and concise, and add durable rules in response to
  repeated mistakes.
- Use skills for repeatable workflows so detailed instructions load through
  progressive disclosure.
- For long-running work, give `/goal` an outcome, constraints, and verification,
  then continue in the same session.
- Use Codex's built-in diff review scopes rather than recreating review
  selection in prompt state.

Official sources:

- [Codex best practices](https://learn.chatgpt.com/guides/best-practices)
- [Prompting](https://learn.chatgpt.com/docs/prompting)
- [Custom instructions with AGENTS.md](https://learn.chatgpt.com/docs/agent-configuration/agents-md)
- [Build skills](https://learn.chatgpt.com/docs/build-skills)
- [Long-running work](https://learn.chatgpt.com/docs/long-running-work)
- [Code review](https://learn.chatgpt.com/docs/code-review)

The Codex best-practices guide also links to an ExecPlan cookbook recipe. That
recipe is now marked archived, so it should not be treated as current product
contract documentation. Its useful architectural idea is nevertheless simple:
one self-contained living plan can carry context, progress, decisions,
discoveries, and validation for long-running work.

- [Archived ExecPlan cookbook recipe](https://developers.openai.com/cookbook/articles/codex_exec_plans)

## Recommended Workflow

Use three execution shapes rather than three artifact-heavy classifications:

| Work shape                | Flow                                                  | Persistent workflow artifacts   |
| ------------------------- | ----------------------------------------------------- | ------------------------------- |
| Small and understood      | Implement, validate, summarize                        | None                            |
| Complex or ambiguous      | `/plan`, implement, validate                          | One living plan                 |
| Sensitive or long-running | Living plan, `/goal`, validate, independent `/review` | Plan and optional review report |

Sensitivity should be a narrow flag rather than a general complexity class. It
applies when work changes authentication, authorization, payments, secrets,
migrations, destructive behavior, or another explicitly named security or
trust boundary.

### One living plan

For work that needs a durable artifact, use one file such as:

```text
.ai/plans/<work-item>.md
```

It should contain only:

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

The plan should be updated as work proceeds. User journeys, implementation
ownership, environmental matrices, rollback notes, or security checks should
appear as optional sections only when the changed boundary requires them.

### Simplified review rule

For ordinary changes, require an implementation self-check and the relevant
tests. Require an independent review when:

- a sensitive boundary changes;
- multiple repositories must remain compatible;
- the change is destructive or migrates persisted data;
- the user explicitly requests independent review; or
- the implementer identifies material uncertainty.

The review loop should be:

1. inspect the exact Git diff;
2. report concrete, prioritized findings;
3. correct blocking findings;
4. rerun affected checks; and
5. perform a fresh follow-up review when fixes materially changed the reviewed
   boundary.

No custom review digest, automatic round budget, or risk-decision token is
needed when writers are paused and the review scope is an explicit Git diff.

### Progressive disclosure through a skill

Keep `AGENTS.md` focused on durable repository invariants and route the reusable
workflow through a repository skill:

```text
.agents/skills/change-workflow/
├── SKILL.md
└── references/
    ├── plan-template.md
    └── review-checklist.md
```

The skill description should trigger only for planning, long-running
implementation, or sensitive changes. Detailed planning and review instructions
would then load only when relevant.

## What to Preserve

The following controls provide meaningful value and should survive
simplification:

- preserve unrelated user changes;
- never push, open a pull request, deploy, or perform destructive work without
  appropriate authorization;
- use routed, area-specific repository conventions;
- connect validation to observable behavior and acceptance criteria;
- verify authentication, authorization, and private-data protection when those
  boundaries are affected;
- prevent concurrent agents from writing the same files;
- use isolated worktrees for genuinely parallel implementation;
- require independent review for sensitive changes; and
- disclose skipped checks, unavailable evidence, and residual risk.

## Suggested Migration Sequence

1. **Remove LOW workflow persistence.** Let bounded, understood work use normal
   Codex implementation and validation without a saved plan or status file.
2. **Pilot one living plan.** Use it for ordinary complex work while leaving the
   current sensitive workflow available temporarily.
3. **Adopt native review scopes.** Compare built-in `/review` results with the
   custom review path on representative changes.
4. **Move reusable guidance into a skill.** Reduce root instructions and remove
   wrapper-only prompt files.
5. **Collapse sensitive work onto the living plan.** Add conditional security,
   migration, and external-evidence sections rather than separate artifact
   types.
6. **Retire synchronization machinery.** Remove stable work status, activation,
   custom fingerprints, exact transition tokens, and their contract tests after
   the replacement path demonstrates equivalent safety.
7. **Keep a small regression suite.** Test only consequential guarantees such
   as scope protection, authorization boundaries, validation requirements, and
   no automatic delivery.

## Expected Result

A reasonable target is 800 to 1,500 lines for the complete workflow, including
its focused tests. That represents an estimated 70% to 80% reduction from the
measured core while retaining the controls that directly protect application
behavior, credentials, private data, repository integrity, and delivery
authority.

Success should be measured by outcomes rather than line reduction alone:

- fewer user interactions before implementation begins;
- less workflow context loaded for ordinary work;
- fewer failures caused only by stale or mismatched workflow artifacts;
- no regression in sensitive-boundary review quality;
- clear validation evidence at completion; and
- easier maintenance of the workflow by someone who did not design it.
