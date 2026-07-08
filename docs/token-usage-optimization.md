# Token Usage Optimization Reference

Created: 2026-07-08
Last Updated: 2026-07-08

## Purpose

Record the token-efficiency audit for the Gondoor AI coding workflow and keep a
single reference for future workflow simplification.

This document compares:

- Native Codex CLI `/plan`
- Gondoor harness only
- Superpowers only
- Gondoor harness plus Superpowers

The goal is not to prove one workflow is better in every case. The goal is to
choose the cheapest workflow that still gives enough planning, execution, and
review quality for the task risk.

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
- Superpowers skills under `/home/jetermulo/.agents/skills`
- Codex config files checked for hooks and slash-command behavior

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
| `fix-plan` | 7 | 0.64M | 0.92M | 4.5M |
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
| `fix-plan` | 4 | 1.04M | 1.13M | 4.2M |

The plan, spec, implementation map, and current-state snapshot are not the main
problem by themselves. The main cost comes from repeatedly reloading them across
fresh `codex exec` stages, review loops, and optional subagent workflows.

## Workflow Comparison

| Workflow | Estimated LLM Calls | Context Duplication | Token Efficiency | Complexity |
| --- | ---: | --- | --- | --- |
| Native Codex CLI `/plan` | 2-4 typical | Low | Best | Low |
| Harness only | 6-8 best case; much higher with loops | High | Poor for small and medium tasks; useful for high-risk workflow control | High |
| Superpowers only | 4-8 setup calls plus `3N+2` task/review calls for N subagent tasks | Medium-high | Medium | Medium-high |
| Harness + Superpowers | Harness stages plus skill and subagent calls; measured 24-call admin workflow and 126-call full workflow | Very high | Worst | Very high |

## Native Codex CLI `/plan`

Expected behavior:

- One active conversation enters plan mode.
- Codex proposes a plan before implementation.
- Context is carried in the same session instead of rehydrated through separate
  workflow stages.
- Optional review can be requested later, but native `/plan` alone does not
  impose a plan-validator, fix-plan, artifact-sync, two-stage review, or
  subagent tree.

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

## Harness Only

Expected behavior:

- The runner starts separate `codex exec` stages.
- Each stage receives a workflow prompt, active context packet, plan path,
  selected instructions, and stage-specific requirements.
- Draft plans can pass through `sync-plan-artifacts`, `plan-validator`, and
  `fix-plan`.
- Implementation can pass through `execute-plan`, `review-changes`,
  `review-quality`, `scope-cleanup`, and `commit-summary`.

Estimated cost profile:

- Initial prompt per stage: workflow prompt plus active context packet.
- Context loaded: AGENTS, workflow instructions, plan, spec, user journey,
  implementation map, state snapshot, staged diff, validation evidence, and
  relevant code files.
- Planning passes: at least 1 validation pass; can loop.
- Review passes: usually 2 stages.
- Subagents: optional, depending on prompt and task shape.
- Token efficiency: expensive but sometimes justified for high-risk work.

Use for:

- Large multi-file work with strict plan ownership.
- Work that benefits from file locks, state snapshots, and task savepoints.
- Risky changes where the audit trail matters more than token cost.

Avoid for:

- Simple fixes.
- One-file edits.
- Routine review-only work.

## Superpowers Only

Expected behavior:

- A mandatory skill check happens before action.
- Creative or behavior-changing work can trigger brainstorming, plan writing,
  execution guidance, verification, and review skills.
- Subagent-driven development can create one implementer and two reviewers per
  task, plus a final reviewer.

Estimated cost profile:

- Initial prompt: AGENTS plus selected skill files.
- Context loaded: chosen skills, user request, relevant code files, and
  generated design/plan docs.
- Planning passes: often more than 1 for non-trivial work.
- Review passes: often per task when subagent-driven development is used.
- Subagents: common for implementation plans.
- Token efficiency: worse than native `/plan`, usually better than current
  harness plus Superpowers if contexts are curated.

Use for:

- Tasks where the skill guidance itself is valuable.
- Work that benefits from explicit TDD, systematic debugging, or independent
  subagent review.

Avoid for:

- Small changes where the mandatory skill chain adds more process than value.

## Harness Plus Superpowers

Expected behavior:

- Harness stages still run.
- Superpowers guidance is injected or invited inside those stages.
- Agents may reload skills in every fresh `codex exec` call.
- Harness review and Superpowers review can both apply.
- Harness task savepoints and Superpowers subagent task decomposition can stack.

Estimated cost profile:

- Initial prompt per stage: largest of all workflows.
- Context loaded: harness context plus selected skills and possible subagent
  task context.
- Planning passes: duplicated between harness plan validation and Superpowers
  plan/design skills when both apply.
- Review passes: duplicated between harness two-stage review and Superpowers
  spec/code-quality review.
- Subagents: optional but encouraged by both systems in some cases.
- Token efficiency: worst.

Use only when:

- The task is very high risk.
- The user explicitly wants both systems.
- The expected quality gain is worth very high token cost.

Default decision:

- Do not combine the harness and Superpowers automatically.

## Expensive Patterns

### Duplicate Planning

Problem:

- Harness planning uses plan validation and fix-plan loops.
- Superpowers can add brainstorming and plan-writing workflows.
- Native `/plan` may already have created an implementation plan.

Cost:

- High.

Replacement:

- For simple tasks, use native `/plan`.
- For harness tasks, allow one bounded preflight plus deterministic plan-shape
  checks.
- Do not run Superpowers planning inside harness planning unless explicitly
  requested.

### Duplicate Review

Problem:

- Harness has `review-changes` and `review-quality`.
- Superpowers subagent-driven development adds spec review and code-quality
  review per task.

Cost:

- High.

Replacement:

- Use one review system per task.
- For routine changes, use one final review.
- For high-risk harness work, keep a single combined harness review unless a
  second review is justified by security, auth, data loss, migrations, or
  cross-package behavior.

### Repeated Fresh Context Rehydration

Problem:

- Every runner stage starts fresh and reloads prompts, instructions, plan state,
  specs, diffs, and artifacts.

Cost:

- High.

Replacement:

- Use snapshot-first prompts.
- Load exact plan sections and event artifacts only when needed.
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
| 1 | Stop combining harness review with Superpowers subagent review by default | High | Less layered review |
| 2 | Collapse `plan-validator` and `fix-plan` loops into one bounded preflight | High | Fewer automatic repair attempts |
| 3 | Merge `review-changes` and `review-quality` for routine tasks | High | Less separation between spec and quality review |
| 4 | Use native `/plan` for small and medium tasks | High | Less workflow bookkeeping |
| 5 | Remove always-on Superpowers injection from harness stages | High | Skills become opt-in or task-triggered |
| 6 | Gate `user-journey.md` and `implementation-map.md` generation | Medium-high | Less product traceability on small tasks |
| 7 | Lower token guardrail thresholds and make snapshot-first default | Medium | More early summarization |
| 8 | Keep only rolling state plus latest event in normal prompts | Medium | Less inline history |
| 9 | Shorten duplicated workflow rules across prompts | Medium | More reliance on shared references |
| 10 | Keep hooks absent or minimal | Low | None; hooks were not a current cost driver |

## Recommended Default Policy

Use this routing table before starting work:

| Task Type | Recommended Workflow |
| --- | --- |
| Tiny one-file fix | Native `/plan` or direct implementation |
| Small/medium bugfix | Native `/plan`, then optional one review |
| Narrow refactor | Native `/plan`, targeted validation |
| User-facing multi-screen change | Harness only, with gated artifacts |
| High-risk auth/security/migration work | Harness only, one strong review or explicitly justified second review |
| Work needing a specific Superpowers skill | Superpowers only or native flow plus that one skill |
| Very high-risk work where user explicitly wants both systems | Harness plus Superpowers |

## Existing Implemented Optimizations

Already implemented in the workflow docs/runner at the time of this reference:

- Generic workflow token guardrails for guarded stages.
- Baseline snapshot-first guidance.
- Lower warning thresholds:
  - Stage input warning: `1_000_000`
  - Stage uncached input warning: `75_000`
- Compact validation evidence guidance.
- Event artifact size caps:
  - Event artifacts capped at 20 KB.
  - Extracted event summaries capped at 1 KB.

Still recommended:

- Tune routine review model/reasoning settings.
- Avoid combining harness plus Superpowers by default.
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

- Harness plus Superpowers.

Primary simplification:

- Do not stack planning systems.
- Do not stack review systems.
- Do not stack subagent orchestration systems.
- Use the harness when its state machine is worth the cost; otherwise delegate
  planning and review back to native Codex features.
