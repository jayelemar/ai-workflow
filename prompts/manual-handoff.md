# Manual Plan Handoff

Create or refresh the portable continuity record for an approved manual plan.
Use this explicitly before pausing manual work, ending the session, or
switching agent or provider.

## Instruction Loading

Read:

- `.codex/AGENTS.md`
- `.ai/instructions/index.md`
- the relevant routed instructions
- `.ai/plans/<plan-name>.md`
- the plan's spec
- `.ai/artifacts/<plan-name>/manual-handoff.md` when it already exists
- current Git state

If the plan does not declare `## Execution Mode` as `manual`, STOP. This
handoff is only for MEDIUM manual-plan continuity.

## Strict Constraints

- This is a handoff-only checkpoint. Do not implement plan tasks.
- Do not invoke the workflow runner.
- Do not create or update `.ai/artifacts/<plan-name>/state/*`,
  `.ai/artifacts/<plan-name>/events/*`, or runner review artifacts.
- Create or refresh only `.ai/artifacts/<plan-name>/manual-handoff.md`.
- The spec, plan, and current Git state remain authoritative; this handoff is
  a concise continuation aid.
- Never copy secrets, raw diffs, or full command output into the handoff.

## Required Handoff Content

Write concise, verified Markdown with exactly these sections:

```md
# Manual Handoff: <plan-name>

## Document Format

manual-handoff@1

## Plan

.ai/plans/<plan-name>.md

## Repository State

<current branch, relevant changed paths, and commit/working-tree summary>

## Verified Progress

<completed work and validation actually run>

## Decisions

<decisions that remain relevant; use None when none exist>

## Blockers

<current blockers or None>

## Next Action

<one concrete next action>
```

## Final Output

Return only:

`Manual handoff refreshed for .ai/plans/<plan-name>.md`
