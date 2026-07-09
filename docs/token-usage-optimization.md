# Token Usage Optimization Reference

Created: 2026-07-08
Last Updated: 2026-07-09

## Purpose

Record the token-efficiency audit for the Gondoor AI coding workflow and keep a
single reference for future workflow simplification.

This document compares the current default choices:

- Native Codex CLI `/plan`
- Manual plan-bound execution (`spec -> plan -> execute` in one conversation)
- Gondoor harness with native shared `.ai/instructions` guidance

It also keeps historical notes for external skill/plugin workflows and the
removed harness-plus-Superpowers combination so future audits do not reintroduce
the most expensive pattern by accident. The shared Superpowers install,
profile config entries, and plugin caches were removed after the harness
stopped depending on them.

The goal is not to prove one workflow is better in every case. The goal is to
choose the cheapest workflow that still gives enough planning, execution, and
review quality for the task risk.

Treat `token-usage.jsonl` entries as measurement data: keep them compact,
append-only, and useful for comparing workflow changes over time.

As of 2026-07-09, the runner ledger still starts only when the workflow runner
starts. That means runner-managed measurements do not automatically include the
earlier spec or plan conversation unless those stages were also recorded
manually. Manual mode now needs tracked stage checkpoints for fair
`spec -> plan -> execute` comparisons, either via repo-local hooks or the
manual checkpoint script.

## Evidence Used

Static files inspected:

- `.codex/AGENTS.md`
- `.ai/AGENTS.md`
- `.ai/instructions/index.md`
- `.ai/instructions/ai-workflow.md`
- `.ai/scripts/workflow-runner.ts`
- `.ai/scripts/workflow-runner/*.ts`
- `.ai/prompts/*.md`
- `.ai/wrappers/*.md`
- Native shared guidance under `.ai/instructions/shared/*.md`
- Previously inspected Superpowers skills before removal for historical
  comparison only
- Codex config files checked for hooks and slash-command behavior
- Shared Codex/Claude profile config, active skill, and plugin cache locations
  checked after Superpowers removal

Runtime token ledgers inspected:

- `.ai/artifacts/admin-users-active-ban-details/logs/token-usage.jsonl`
- `.ai/artifacts/market-research-competitive-gap-upgrade/logs/token-usage.jsonl`

Official Codex references:

- `/plan` is a native slash command that switches the active conversation into
  plan mode and asks Codex to propose a plan before implementation:
  `https://developers.openai.com/codex/cli/slash-commands`
- Codex supports config hooks, but no active local/project hooks were found in
  this repository at the time of audit:
  `https://developers.openai.com/codex/config-reference`

## Measured Token Usage

The strongest signal is from local workflow token ledgers.

| Workflow Artifact | Successful LLM Calls | Input Tokens | Uncached Input | Total Tokens |
| --- | ---: | ---: | ---: | ---: |
| `admin-users-active-ban-details` completed workflow | 24 | 34.3M | 2.25M | 34.6M |
| `market-research-competitive-gap-upgrade` full workflow | 126 | 453.0M | 24.9M | 455.2M |

The completed `admin-users-active-ban-details` run had strong cache efficiency:
32.1M of 34.3M input tokens were cached, or roughly 93.5%. It was still
expensive because the workflow made 24 fresh LLM calls and repeatedly reloaded
large stage context.

Stage-level hotspots from the completed `admin-users-active-ban-details`
workflow:

| Stage | Calls | Avg Input | Max Input | Total Tokens |
| --- | ---: | ---: | ---: | ---: |
| `execute-plan` | 3 | 4.16M | 5.86M | 12.5M |
| `plan-validator` | 8 | 1.35M | 1.65M | 10.9M |
| `fix-plan` (legacy, now folded into validator preflight) | 7 | 0.64M | 0.92M | 4.5M |
| `review-changes` | 3 | 1.31M | 1.51M | 4.0M |
| `review-quality` | 1 | 1.45M | 1.45M | 1.5M |
| `sync-plan-artifacts` | 1 | 0.81M | 0.81M | 0.8M |
| `commit-summary` | 1 | 0.32M | 0.32M | 0.3M |

Stage-level hotspots from the `market-research-competitive-gap-upgrade` full
workflow:

| Stage | Calls | Avg Input | Max Input | Total Tokens |
| --- | ---: | ---: | ---: | ---: |
| `execute-plan` | 45 | 6.34M | 17.02M | 286.3M |
| `review-changes` | 50 | 2.23M | 3.71M | 112.0M |
| `review-quality` | 14 | 2.94M | 4.34M | 41.4M |
| `plan-validator` | 5 | 1.82M | 2.10M | 9.2M |
| `fix-plan` (legacy, now folded into validator preflight) | 4 | 1.04M | 1.13M | 4.2M |

The plan, spec, implementation map, and current-state snapshot are not the main
problem by themselves. The main cost comes from repeatedly reloading them across
fresh `codex exec` stages and review loops. The retired Superpowers injection
made that worse by adding plugin guidance, skill-root paths, and optional
subagent workflows to already-large harness prompts.

## Removed Superpowers State

The harness no longer depends on the shared Superpowers plugin, and the shared
install was removed on 2026-07-09.

Removed shared state:

- `superpowers@openai-curated` plugin entries from shared Codex profile configs
  and old profile config backups.
- Superpowers-derived active skills from `/home/jetermulo/.agents/skills`.
- Codex and Claude Superpowers plugin cache, tmp, and data directories under
  shared account profiles.

Intentionally left alone:

- Project-local Superpowers docs or state outside the shared plugin install,
  such as unrelated project folders that merely contain `superpowers` in their
  path.

## Workflow Comparison

| Workflow | Estimated LLM Calls | Context Duplication | Token Efficiency | Complexity |
| --- | ---: | --- | --- | --- |
| Native Codex CLI `/plan` | 2-4 typical | Low | Best | Low |
| Manual plan-bound execution | 3-5 typical | Low-medium | Near-best | Medium |
| Harness with native shared guidance | 6-8 best case; much higher with loops | High | Poor for small and medium tasks; useful for high-risk workflow control | High |
| External skill/plugin workflow, manual only | Depends on explicitly installed skill and subagent use | Medium-high | Medium | Medium-high |
| Removed harness plus external skill injection | Harness stages plus skill and subagent calls | Very high | Worst | Very high |

## Native Codex CLI `/plan`

Expected behavior:

- One active conversation enters plan mode.
- Codex proposes a plan before implementation.
- Context is carried in the same session instead of rehydrated through separate
  workflow stages.
- Optional review can be requested later, but native `/plan` alone does not
  impose artifact sync, bounded plan-validator preflight, two-stage review, or
  a subagent tree.

Estimated cost profile:

- Initial prompt: system/developer context, AGENTS stack, user request, and
  files the agent chooses to inspect.
- Context loaded: selected project files and relevant instructions.
- Planning passes: usually 1.
- Review passes: 0 unless requested.
- Subagents: 0 unless explicitly used.
- Token efficiency: best for simple and medium tasks.

Use for:

- Small bugfixes.
- Narrow refactors.
- Routine frontend/backend changes.
- Tasks where strict artifact state, file locks, and staged review gates are
  not needed.

## Manual Plan-Bound Execution

Expected behavior:

- One active conversation creates a spec, creates a plan, and executes against
  that plan without invoking the workflow runner.
- The spec still defines behavior and the plan still defines execution intent.
- The conversation keeps context instead of rehydrating through separate runner
  stages.
- No runner-specific review gates, workflow state, task savepoints, or artifact
  sync are required unless the operator explicitly switches the task into the
  harness.

Estimated cost profile:

- Initial prompt: system/developer context, AGENTS stack, user request, chosen
  instructions, and the files the agent inspects.
- Context loaded: selected project files plus the spec and plan created in the
  same conversation.
- Planning passes: usually 1 spec pass plus 1 plan pass.
- Review passes: optional and conversation-local unless the operator chooses a
  separate review step.
- Subagents: 0 unless explicitly used.
- Token efficiency: near-best when the task needs more structure than `/plan`
  alone but not full runner bookkeeping.
- `create-plan` now supports an explicit execution mode split so manual plans
  can avoid runner-only workflow state by default.
- Manual mode should append `spec`, `plan`, and `execute` checkpoints into
  `.ai/artifacts/<plan-name>/logs/token-usage.jsonl` so the full lifecycle
  cost is visible.
- Repo-local Codex hooks can now auto-append those checkpoints when the
  operator uses the tracked spec, create-plan, and manual-execute prompt paths
  and the assistant emits the required completion markers.
- Those automatic checkpoints should count only when the stage artifact was
  actually written to disk. A completion marker without the matching spec or
  plan file should be treated as a skipped checkpoint, not a saved stage.

Use for:

- Medium tasks where a written spec and plan help, but runner-managed state is
  unnecessary.
- Work where the operator wants `spec -> plan -> execute` discipline without
  task savepoints, file locks, or harness review loops.
- Changes that stay understandable in one conversation even if they are larger
  than a trivial bugfix.

Avoid for:

- Large risky tasks that need strict plan-owned file boundaries.
- Work that benefits from task savepoints, resumable workflow state, or
  harness-managed review checkpoints.

Manual checkpoint commands:

```bash
pnpm exec tsx .ai/scripts/manual-token-usage.ts --plan <plan-name> --stage spec
pnpm exec tsx .ai/scripts/manual-token-usage.ts --plan <plan-name> --stage plan
pnpm exec tsx .ai/scripts/manual-token-usage.ts --plan <plan-name> --stage execute
```

## Harness With Native Shared Guidance

Expected behavior:

- The runner starts separate `codex exec` stages.
- Each stage receives a workflow prompt, active context packet, plan path,
  selected instructions, and stage-specific requirements.
- Draft plans can pass through `sync-plan-artifacts` and one bounded
  `plan-validator` preflight.
- Implementation can pass through `execute-plan`, combined `review-changes`,
  `scope-cleanup`, and `commit-summary`. `review-quality` remains only as a
  legacy resume path for in-flight split reviews.

Estimated cost profile:

- Initial prompt per stage: workflow prompt plus active context packet.
- Context loaded: AGENTS, workflow instructions, plan, spec, user journey,
  implementation map, state snapshot, staged diff, validation evidence, and
  relevant code files.
- Planning passes: at least 1 validation pass; can loop.
- Review passes: usually 1 combined stage.
- Subagents: not injected by default.
- Token efficiency: expensive but sometimes justified for high-risk work.

Use for:

- Large multi-file work with strict plan ownership.
- Work that benefits from file locks, state snapshots, and task savepoints.
- Risky changes where the audit trail matters more than token cost.

Avoid for:

- Simple fixes.
- One-file edits.
- Routine review-only work.

## External Skill Workflows (Manual Only)

Expected behavior:

- A specific skill or plugin workflow is invoked because the operator
  explicitly requested it or because the task clearly needs that specialized
  workflow.
- The selected skill may add design, planning, debugging, verification, review,
  or subagent steps.
- The harness does not inject this workflow. It is a separate manual choice.
- No shared Superpowers plugin remains installed. Any future Superpowers-style
  workflow requires explicit reinstall or a one-off setup outside the harness.

Estimated cost profile:

- Initial prompt: AGENTS plus selected skill/plugin instructions.
- Context loaded: chosen skill guidance, user request, relevant code files, and
  any generated design or plan docs.
- Planning passes: often more than 1 for non-trivial work.
- Review passes: may be per task when a subagent-driven workflow is selected.
- Subagents: explicit only.
- Token efficiency: worse than native `/plan`, usually better than the retired
  harness plus external skill injection pattern if contexts are curated.

Use for:

- Tasks where the skill guidance itself is valuable.
- Work that benefits from explicit TDD, systematic debugging, or independent
  subagent review.

Avoid for:

- Small changes where the mandatory skill chain adds more process than value.

## Removed: Harness Plus External Skill Injection

Expected behavior:

- Harness stages still run.
- External skill/plugin guidance is injected or invited inside those stages.
- Agents may reload skills in every fresh `codex exec` call.
- Harness review and plugin review can both apply.
- Harness task savepoints and plugin subagent task decomposition can stack.

Estimated cost profile:

- Initial prompt per stage: largest of all workflows.
- Context loaded: harness context plus selected skills and possible subagent
  task context.
- Planning passes: duplicated between harness plan validation and external
  plan/design skills when both apply.
- Review passes: duplicated between harness review and external
  spec/code-quality review.
- Subagents: optional but encouraged by both systems in some cases.
- Token efficiency: worst.

Historical use case:

- The task is very high risk.
- The user explicitly wants both systems.
- The expected quality gain is worth very high token cost.

Current policy:

- Do not combine the harness and external skill/plugin workflows automatically.
- Do not reinstall or re-enable shared Superpowers to satisfy normal harness
  stages.

## Expensive Patterns

### Duplicate Planning

Problem:

- Harness planning used to split validation and repair across separate fresh
  stages.
- External skill workflows can add brainstorming and plan-writing workflows.
- Native `/plan` may already have created an implementation plan.

Cost:

- High.

Replacement:

- For simple tasks, use native `/plan`.
- For medium tasks that benefit from a spec and plan but not runner state, use
  manual plan-bound execution.
- For harness tasks, allow one bounded preflight plus deterministic plan-shape
  checks.
- Do not run external skill planning inside harness planning unless explicitly
  requested.

### Duplicate Review

Problem:

- Harness used to run `review-changes` and `review-quality` as separate default
  stages.
- External subagent-driven workflows can add spec review and code-quality review
  per task.

Cost:

- High.

Replacement:

- Use one review system per task.
- Harness combined review is the review system for `review + review-plan`.
- Do not inject a second subagent or plugin review system into harness review
  stages.
- For routine changes, use one final review.

### Repeated Fresh Context Rehydration

Problem:

- Every runner stage starts fresh and reloads prompts, instructions, plan state,
  specs, diffs, and artifacts.

Cost:

- High.

Replacement:

- Use snapshot-first prompts.
- Load exact plan sections and event artifacts only when needed.
- Use manual plan-bound execution when the work needs a spec and plan but not
  fresh runner stages.
- Prefer one native conversation for smaller tasks.

### Over-Application Of User-Facing Artifacts

Problem:

- User journey and implementation map artifacts are valuable for product flows,
  but expensive when applied to narrow bugfixes.

Cost:

- Medium-high.

Replacement:

- Require user journey and implementation map only for user-facing multi-route
  or multi-state work.
- For simple fixes, use a compact acceptance checklist in the plan/spec.

### Runner-Oriented Plan Creation For Manual Work

Problem:

- This was previously a mismatch: manual plan-bound execution was allowed, but
  `create-plan.md` still wrote runner-specific state and artifact scaffolding
  by default.

Cost:

- Medium.

Replacement:

- Implemented on 2026-07-09.
- `create-plan` now supports explicit `manual` and `runner-managed` modes.
- Manual mode keeps the same spec and plan discipline but records runner-only
  artifact entries as `N/A: manual plan-bound execution` instead of creating
  runner state by default.

### Large Prompt Contracts

Problem:

- Workflow prompts repeat similar STOP rules, validation rules, review rules,
  and artifact rules.

Cost:

- Medium.

Replacement:

- Keep one canonical compact workflow-state reference.
- Make prompt files shorter and stage-specific.
- Move optional detail into references loaded only on failure or high risk.

### Late Token Guardrails

Problem:

- Guardrails are helpful but can trigger after the workflow already spent a lot.

Cost:

- Medium.

Replacement:

- Keep snapshot-first behavior as the default, not only after a warning.
- Lower warning thresholds when measured stages remain multi-million-token.

### Artifact Accumulation

Problem:

- Event artifacts are compact individually, but many events become a large
  history that can be repeatedly rediscovered or reloaded.

Cost:

- Medium.

Replacement:

- Keep `.ai/artifacts/<plan>/state/context.md` as the current source of truth.
- Load only the latest relevant event unless investigating a historical failure.

## Ranked Optimization Plan

| Rank | Recommendation | Expected Savings | Tradeoff |
| ---: | --- | --- | --- |
| 1 | Stop combining harness review with separate plugin/subagent review by default | Implemented high savings | Less layered review |
| 2 | Collapse validation and repair into one bounded `plan-validator` preflight | High | Fewer automatic repair attempts |
| 3 | Merge `review-changes` and `review-quality` for routine tasks | Implemented high savings | Less separation between spec and quality review |
| 4 | Support explicit manual plan-bound execution without runner-only artifacts | Implemented high savings | Two plan-creation modes instead of one |
| 5 | Use native `/plan` or manual plan-bound execution for non-runner tasks | High | Less workflow bookkeeping |
| 6 | Remove always-on external skill injection from harness stages | Implemented high savings | Harness prompts rely on native shared guidance |
| 7 | Gate `user-journey.md` and `implementation-map.md` generation | Implemented medium-high savings | Less product traceability on small tasks |
| 8 | Remove duplicated prompt payload from runner stages | Implemented medium-high savings | Less self-contained stage prompts |
| 9 | Lower token guardrail thresholds and make snapshot-first default | Medium | More early summarization |
| 10 | Keep only rolling state plus latest event in normal prompts | Implemented medium | Less inline history |
| 11 | Shorten duplicated workflow rules across prompts | Implemented medium | More reliance on shared references |
| 12 | Keep hooks absent or minimal | Low | None; hooks were not a current cost driver |

Priority 2 is implemented. Draft validation now uses one bounded
`plan-validator` preflight so plan repair stays available without repeated
fresh-stage context rehydration.

Priority 3 is implemented. Normal `review + review-plan` entries now run one
combined harness review and route directly to either `active + execute-plan` or
`completed + commit-summary`; `review-quality` remains available only for
legacy split-review resume.

Priority 1 is implemented. Harness review remains the review system for
`review + review-plan`; a second subagent or plugin review system is not
injected into the default runner review path.

Priority 4 is implemented. `create-plan` now supports explicit `manual` and
`runner-managed` execution modes so manual plans do not create runner-only
workflow state by default.

Priority 7 is implemented. Flow-trace artifacts are now required only for
scopes that need end-to-end flow mapping; narrow user-facing work can record
`N/A: <concrete reason>` instead of creating `user-journey.md` and
`implementation-map.md`.

Priority 8 is implemented. Runner-generated stage prompts now reference the
controlling prompt path and rely on the warm-loaded prompt file in the Active
Context Packet instead of embedding the full workflow prompt body a second
time.

Priority 11 is implemented. Shared flow-trace scope classification and
`user-journey.md` / `implementation-map.md` policy now live in
`.ai/instructions/shared/flow-trace-artifacts.md` so create-plan, sync,
validator, and review prompts can load one shared baseline instead of carrying
duplicated rule blocks.

Priority 10 is implemented. The workflow context snapshot now carries the
latest relevant workflow event pointer, and normal runner prompts are directed
to use rolling snapshot state plus that exact event before touching workflow
history.

Current recommendation:

- Default to native `/plan` for small routine work.
- Use manual plan-bound execution when you want `spec -> plan -> execute`
  discipline without runner-managed state.
- Use the harness only when you explicitly want runner-managed workflow
  behavior for a large fix or new feature.

Next optimization needed:

- Trim the legacy `review-quality` resume path further so it loads only the
  extra state needed for already-split reviews.
- After that, reduce commit-summary source reads to the minimum completed-state
  evidence needed for commit generation and aggregate summaries.

Priority 6 is implemented. Harness-generated prompts now load native
`.ai/instructions/shared/reasoning-quality.md` and
`.ai/instructions/shared/debugging.md` guidance instead of injecting
`.ai/prompts/superpowers.md`, skill roots, or default subagent guidance.

## Recommended Default Policy

Use this routing table before starting work:

| Task Type | Recommended Workflow |
| --- | --- |
| Tiny one-file fix | Native `/plan` or direct implementation |
| Small/medium bugfix | Native `/plan`, then optional one review |
| Narrow refactor | Native `/plan`, targeted validation |
| User-facing multi-screen change | Harness only, with gated artifacts |
| High-risk auth/security/migration work | Harness only, one strong review or explicitly justified second review |
| Work needing a specific external skill | Native flow plus that one explicitly available skill, or standalone skill workflow |
| Very high-risk work where user explicitly wants both systems | Manually composed harness plus explicit external skill setup; never default injection |

## Existing Implemented Optimizations

Already implemented in the workflow docs/runner at the time of this reference:

- Generic workflow token guardrails for guarded stages.
- Baseline snapshot-first guidance.
- Lower warning thresholds:
  - Stage input warning: `1_000_000`
  - Stage uncached input warning: `75_000`
- Compact validation evidence guidance.
- Native shared reasoning/debugging guidance in harness prompts instead of
  always-on external prompt-layer skill injection.
- Shared Superpowers plugin config, active skills, and plugin caches removed
  after harness dependency removal.
- Event artifact size caps:
  - Event artifacts capped at 20 KB.
  - Extracted event summaries capped at 1 KB.

Still recommended:

- Tune routine review model/reasoning settings.
- Reduce duplicate planning and review gates.
- Route small tasks to native Codex workflows.
- Treat the 24-call `admin-users-active-ban-details` result as evidence that
  high cache rates do not compensate for repeated stage rehydration.

## Acceptance Checks For Future Optimization

Use these checks after changing workflow behavior:

- Token ledger shows lower uncached stage input on the next comparable run.
- Runner still writes `.ai/artifacts/<plan-name>/state/context.md`.
- Review and execution still receive required plan, spec, snapshot, and scoped
  instruction context.
- Validation quality is unchanged or the quality tradeoff is explicitly
  accepted.
- Simple tasks do not trigger multi-stage planning and review unless requested.
- No ordinary application commit stages `.ai/` artifacts.

## Final Verdict

Most token-efficient:

- Native Codex CLI `/plan`.

Best balance of quality and cost:

- Native `/plan` plus one review pass for routine work.
- Simplified harness-only for high-risk, multi-file, stateful work.

Most expensive:

- Harness plus external plugin or subagent systems, especially if an external
  plugin layer is reinstalled and loaded inside harness stages.

Primary simplification:

- Do not stack planning systems.
- Do not stack review systems.
- Do not stack subagent orchestration systems.
- Use the harness when its state machine is worth the cost; otherwise delegate
  planning and review back to native Codex features.
