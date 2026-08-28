# Workflow Usage

This operator guide provides copy-ready invocations. Canonical prompts own all
behavior, schemas, validation, review decisions, and final responses.

## Choose a Mode

- Use Agent mode for intake, specs, plans, and LOW/MEDIUM execution.
- Use Goal mode only for the exact HIGH command saved in `goal-handoff@2`.
- Product Plan mode is optional brainstorming and does not replace the saved
  plan stage.

## Intake

```text
Use `.ai/wrappers/feature-intake.md`.

Target: Feature: <name>
Evidence:
- Problem or user need: <need>
- Desired outcome: <outcome>
- Proposed behavior: <flow>
- Acceptance expectations: <expectations>
- Boundaries: <auth, data, integration, release, and non-goals>
```

```text
Use `.ai/wrappers/bug-intake-rca.md`.

Target: Bug: <name>
Evidence:
- Reproduction: <steps>
- Expected / actual: <behavior>
- Affected boundaries: <scope>
- Logs or errors: <evidence or unavailable>
```

## Finalize a MEDIUM/HIGH Spec

```text
Use `.ai/wrappers/generate-feature-spec.md`.

Name: <kebab-case-name>
Classification: <MEDIUM-or-HIGH>
Request and decisions: <portable request evidence and decisions>
```

For a bug, use `.ai/wrappers/generate-bugfix-spec.md` and include causal
evidence. The canonical spec prompt defines its evidence gate.

## Create a Saved Plan

```text
Use `.ai/wrappers/create-plan.md`.

Plan name: <kebab-case-name>
Supersedes: N/A
Classification: LOW | MEDIUM | HIGH
Spec: N/A: LOW | .ai/specs/<name>.spec.md
Flow artifacts: AUTO
```

The current plan template records `review-strategy@2` and its deterministic
automatic review budget. See [Create Plan](../prompts/workflow/create-plan.md) and the
[Plan Template](../templates/plan.template.md).

For a replan, reference the current root-level active plan and let the workflow
derive the revision name:

```text
Use `.ai/wrappers/create-plan.md`.

Plan name: AUTO
Supersedes: .ai/plans/<current-plan-name>.md
Classification: resolve from current finalized context
Spec: N/A: LOW | .ai/specs/<name>.spec.md
Flow artifacts: AUTO
```

The validated predecessor moves to
`.ai/artifacts/<current-plan-name>/superseded-plan.md`; only the successor stays
under `.ai/plans/`. Replanning reclassifies the actual successor scope and uses
`/goal` only when that result is HIGH.

## Execute LOW/MEDIUM

```text
Use `.ai/wrappers/execute-plan.md`.

Command: execute .ai/plans/<plan-name>.md
```

When MEDIUM execution returns a review action, respond only as directed by the
current [Review Contract](../prompts/workflow/review-changes.md). That prompt is the sole
source for statuses, round transitions, remediation, and risk decisions.

## Manual Review Until Clear

After any current plan has been implemented, run one independent review,
remediation, validation, and fresh-review loop with:

```text
Run `.ai/prompts/utilities/review-until-clear.md`.

Plan: .ai/plans/<plan-name>.md
```

This uses the locked workflow reviewer rather than the operator-only Codex UI
`/review` action. It leaves P3 findings advisory and stops only when no in-scope
P0–P2 remain or the canonical review contract requires a blocker.

For LOW, MEDIUM, and HIGH alike, if the same root-cause family remains blocking
in two fresh review rounds, stop incremental fixes, mark the current execution
`Blocked`, and return to planning with the saved architectural fallback and
round evidence. Reassess classification during replanning; no classification
may activate that fallback inside the blocked plan.

## Execute or Resume HIGH

Run the exact two-line command emitted by plan creation or returned by the
resume wrapper:

```text
/goal <exact saved goal>

plan: .ai/plans/<plan-name>.md
```

Before pausing or switching sessions, refresh portable evidence:

```text
Use `.ai/wrappers/goal-checkpoint.md`.

Goal name: <plan-name>
Exact goal: <saved objective>
```

Resume read-only analysis with:

```text
Use `.ai/wrappers/resume-goal.md`.

Goal name: <plan-name>
```

The [HIGH checkpoint contract](../prompts/workflow/goal-checkpoint.md) owns task and
commit evidence. The handoff itself does not copy policy.

## Optional Worktree and Delivery Utilities

```text
run .ai/prompts/utilities/prepare-worktree.md, plan: .ai/plans/<plan-name>.md
```

```text
Use `.ai/wrappers/create-pull-request.md`.

Base: AUTO
```

Worktree setup supports both a Git parent checkout and an unversioned
multi-repository coordination root. Neither utility starts implementation or
delivery without its documented explicit invocation.

## Local Workflow Cleanup

Preview or remove ignored workflow records together with task worktrees:

```text
Run `.ai/prompts/utilities/cleanup-workflow.md`.

Mode: preview | apply
```

In `apply` mode, clean task roots are already authorized. When dirty, locked,
or otherwise questionable task roots exist, the utility lists every issue and
waits for an explicit `yes` or `no` before deleting anything. `yes` includes
the listed task roots; `no` deletes the clean roots while preserving the listed
roots and their safely resolvable workflow context. Git branches are always
retained.
