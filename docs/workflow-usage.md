# Workflow Usage

This operator guide provides copy-ready invocations. Canonical prompts own all
behavior, schemas, validation, review decisions, and final responses.

## Choose a Mode

- Use Agent mode for intake, specs, plans, and LOW/MEDIUM execution.
- Use Goal mode only for the exact HIGH command saved in `work-status@1`.
- Product Plan mode is optional brainstorming and does not replace the saved
  plan stage.

## Intake

Intake reports the recommended model and reasoning effort for the next writable
stage. LOW recommends the configured planning runtime; MEDIUM and HIGH
recommend the configured specification runtime. This is advisory only: switch
the model and effort manually when desired. Intake does not inspect or change
the active runtime, block specification or planning, or create a subagent.
When intake is decision-complete, its `Next action` is a complete
copy-pasteable prompt with the known intake details filled in: a plan invocation
for LOW, or the applicable feature- or bugfix-spec invocation for MEDIUM and
HIGH. If one material decision is missing, intake asks for only a
`Decision: <selected choice>` reply, retains the known evidence, and then
returns that writable-stage prompt; it does not repeat the intake template.

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

Supersedes: N/A
Classification: <MEDIUM-or-HIGH>
Request and decisions: <portable request evidence and decisions>
```

For a bug, use `.ai/wrappers/generate-bugfix-spec.md` and include causal
evidence. The canonical spec prompt defines its evidence gate.

Before creating a new spec file, specification returns one short, specific
filename recommendation and waits for an explicit `Use <name>.spec.md` reply.
No spec file is written before that selection.

On success, specification returns the finalized path followed by `Do this
next:` and a complete copy-pasteable create-plan invocation. That response does
not start planning; invoke the returned prompt explicitly.

Finalized specs are immutable. Reuse the existing spec path only for an exact
content match. For any content change—including corrected evidence or
root-cause analysis that preserves desired behavior—invoke specification with
the current spec path under `Supersedes`. The canonical spec prompt suggests
the next unused revisioned name and waits for confirmation; do not overwrite
the spec referenced by an existing plan.

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

Every new plan also links one stable
`.ai/artifacts/<work-item>/work-status.md`. Open this file for the complete
current goal, active plan, completed work, remaining work, changed or removed
tasks, blockers, and exact next action. Progress updates this status after each
task and never creates a new plan revision.

Every MEDIUM plan receives up to two automatic fresh rounds. A clear first
round completes review immediately; when the first round is blocking, the
second independently verifies remediation without requiring an operator risk
decision. Ordinary HIGH plans also receive two rounds, while elevated-risk HIGH
plans receive three.

Environment-dependent work must define a local, staging, and production
environment matrix in its finalized spec. Each required URL names its
non-secret configuration source and expected behavior. Missing or invalid
selected URLs must fail fast. Environment selection must be explicit and
project-defined, never inferred from framework-specific debug, release,
runtime, or build-mode flags. User-facing link flows also retain and validate
the specified browser fallback so a failed native handoff never becomes an
unplanned blank page.

Planning maps every spec acceptance criterion to owned work or an inspected
unchanged boundary and to required evidence. Manual, device, deployment, DNS,
TLS, or external-service evidence stays required when it proves an acceptance
criterion. If unavailable during execution or review, work is blocked rather
than completed with a deferred check.

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

Set `Spec` to the predecessor's exact spec path only when the complete spec is
unchanged. If any spec content changed, first finalize a new immutable spec
under an unused name and set `Spec` to that new path. The archived predecessor
continues to reference its original spec.

During execution or review, a material discovery that changes any spec content
stops with the complete specification invocation as the immediate next action.
Only a discovery that leaves the complete spec unchanged routes directly to
the AUTO replan invocation.

For LOW work, the workflow first reclassifies a material discovery. It creates
a typed spec before replanning when the discovery classifies as MEDIUM or HIGH;
only a discovery that remains LOW uses the LOW/no-spec replan.

The validated predecessor moves to
`.ai/artifacts/<current-plan-name>/superseded-plan.md`; only the successor stays
under `.ai/plans/`. Replanning reclassifies the actual successor scope and uses
`/goal` only when that result is HIGH.

Replanning also reconciles stable task IDs into the existing work status.
Unchanged completed tasks remain complete only while their behavior and
evidence remain valid. Affected tasks reopen, removed tasks retain a concise
reason, and new tasks receive IDs that have never been used. Plan and status
activate together or both remain unchanged.

## Execute LOW/MEDIUM

```text
Use `.ai/wrappers/execute-plan.md`.

Command: execute .ai/plans/<plan-name>.md
```

When MEDIUM execution returns a review action, respond only as directed by the
current [Review Contract](../prompts/workflow/review-changes.md). That prompt is the sole
source for statuses, round transitions, remediation, and risk decisions.

Every fresh review is bound to `review-input-fingerprint@1` evidence for the
exact plan-owned diff in each repository. Concurrent plan-owned drift makes a
returned report stale without consuming a round; unchanged unrelated work or
an audit-only HEAD change does not. Unreviewed-remediation risk acceptance is
available only for validated, P2-only remediation on a plan without a named
sensitive boundary. P0, P1, and sensitive-boundary remediation always requires
fresh independent clearance.

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

After plan creation, choose the emitted isolated-worktree setup command or the
direct current-checkout command. Worktree setup returns a task-local copy of
the exact two-line `/goal` invocation; it does not invoke that command. Direct
execution uses:

```text
/goal <exact saved goal>

plan: .ai/plans/<plan-name>.md
```

Before pausing or switching sessions, refresh portable evidence:

```text
Use `.ai/wrappers/goal-checkpoint.md`.

Work item: <stable-work-item-name>
Exact goal: <saved objective>
```

Resume read-only analysis with:

```text
Use `.ai/wrappers/resume-goal.md`.

Work item: <stable-work-item-name>
```

The [HIGH checkpoint contract](../prompts/workflow/goal-checkpoint.md) owns task
and commit evidence in stable work status. Status does not copy policy or
authorize execution.

## Optional Worktree and Delivery Utilities

Plan creation surfaces this worktree command alongside direct execution for
LOW, MEDIUM, and HIGH plans:

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
