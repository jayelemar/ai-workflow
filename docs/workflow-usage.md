# Workflow Usage

This guide explains how an operator invokes the existing prompt-driven
workflow. The canonical prompts remain authoritative for stage behavior,
schemas, validation, reviews, and final responses.

## Choose the Codex Mode

- Use Plan mode only for optional brainstorming before workflow intake. The
  product's `/plan` mode does not replace the repository's saved-plan stage.
- Use Agent mode for intake, specification, saved-plan creation, and explicit
  LOW or MEDIUM execution. Intake remains read-only because its canonical
  prompt enforces that boundary.
- Use Goal mode only for explicitly invoked HIGH execution. Start it with the
  exact command stored in the HIGH goal handoff.

Specifications, flow artifacts, plans, and checkpoints are files, so their
stages must run in a mode that can write them. A saved artifact never invokes
the next stage by itself.

## Follow the Stage Sequence

| Classification | Required sequence                                                                      |
| -------------- | -------------------------------------------------------------------------------------- |
| LOW            | Intake -> saved plan -> `execute <plan-file>`                                          |
| MEDIUM         | Intake -> finalized spec -> saved plan and required artifacts -> `execute <plan-file>` |
| HIGH           | Intake -> finalized spec -> saved plan and goal handoff -> exact saved `/goal` command |

Invoke each arrow as a separate user action. If repository evidence materially
changes the classification, behavior, risk, dependency, or repository
boundary, return to the appropriate earlier stage instead of absorbing the
change during execution.

## Run Intake

Run intake in Agent mode. The wrapper invokes the canonical read-only
classifier and returns the classification, reason, missing decision, and next
action.

### Feature

```text
Use `.ai/wrappers/feature-intake.md`.

Target: Feature: <name>

Evidence:
- Problem or user need: <need>
- Desired outcome: <outcome>
- Target roles: <roles>
- Proposed behavior or user flow: <flow>
- Acceptance expectations: <expectations>
- UI or UX reference: <reference or N/A>
- Auth, data, API, integration, and release constraints: <constraints>
- Non-goals and related existing behavior: <boundaries>
```

### Bugfix

```text
Use `.ai/wrappers/bug-intake-rca.md`.

Target: Bug: <name>

Evidence:
- Reproduction: <steps>
- Expected behavior: <expected>
- Actual behavior: <actual>
- Affected users, roles, routes, services, and data: <scope>
- Logs or errors: <evidence or unavailable>
- Screenshot or recording: <reference or unavailable>
- Recent related changes: <changes or unknown>
```

Bug intake does not claim an RCA from an assertion or correlation. The bugfix
specification stage must establish the causal mechanism from inspected or
supplied evidence.

## Finalize a MEDIUM or HIGH Specification

Stay in the intake conversation when practical, but supply the wrapper's
portable inputs explicitly. Do not rely only on phrases such as "the context
above."

Ask only material unresolved product-behavior questions, one at a time. For
each question, request a recommended default and a one-sentence reason. The
agent should inspect discoverable repository facts rather than asking the
operator for them.

### Feature Specification

```text
Use `.ai/wrappers/generate-feature-spec.md`.

Name: <kebab-case-name>
Classification: <MEDIUM-or-HIGH-from-intake>
Request and decisions: Use the feature request, evidence, and operator decisions in this thread.

Ask only material unresolved product-behavior questions, one at a time.
For each question, provide a recommended default and a one-sentence reason.
Inspect the repository instead of asking about discoverable facts.
Do not over-engineer, create a plan, or edit application code.
```

### Bugfix Specification

```text
Use `.ai/wrappers/generate-bugfix-spec.md`.

Name: <kebab-case-name>
Classification: <MEDIUM-or-HIGH-from-intake>
Request and decisions: Use the expected behavior, constraints, and operator decisions in this thread.
Bug evidence: Use the supplied reproduction evidence and evidence established through repository inspection.

Ask only material unresolved product-behavior questions, one at a time.
For each question, provide a recommended default and a one-sentence reason.
Inspect the repository instead of asking about discoverable facts.
If the RCA evidence gate is not satisfied, stop and identify the exact missing evidence.
Do not over-engineer, create a plan, or edit application code.
```

Use "finalized spec" after this stage. Do not call an artifact "approved"
unless an operator actually approved it; approval is not a workflow gate.

## Create the Saved Plan

Run plan creation in Agent mode. Use `AUTO` so the canonical prompt decides
whether it must reuse or create `user-journey@1` and
`implementation-map@1`. A separate flow-artifact invocation is optional.

### LOW

```text
Use `.ai/wrappers/create-plan.md`.

Plan name: <kebab-case-name>
Classification: LOW
Spec: N/A: LOW
Flow artifacts: AUTO
```

### MEDIUM or HIGH

```text
Use `.ai/wrappers/create-plan.md`.

Classification: <MEDIUM-or-HIGH>
Spec: .ai/specs/<name>.spec.md
Flow artifacts: AUTO
```

Plan creation saves the plan and any required planning artifacts. It does not
authorize implementation.

## Execute LOW or MEDIUM

Invoke the saved plan in Agent mode. Do not implement the plan manually outside
the canonical execution prompt.

```text
Use `.ai/wrappers/execute-plan.md`.

Command: execute .ai/plans/<plan-name>.md
```

LOW completion includes its required self-check. MEDIUM completion includes
the configured independent whole-plan review and blocking-finding remediation
loop.

## Execute HIGH

Before HIGH execution, use a clean dedicated feature branch or worktree in
every repository the plan owns. The task commit protocol pauses before a commit
on `main`, `dev`, `development`, or `staging`, so those branches interrupt an
otherwise autonomous goal.

Immediately after plan creation, copy the HIGH response. It contains only the
exact two-line `/goal` invocation with the finalized spec's goal text verbatim
and the saved plan reference:

```text
/goal <exact-goal>

plan: <plan-file>
```

When resuming later, retrieve the same exact goal command from the portable
handoff:

```text
Use `.ai/wrappers/resume-goal.md`.

Goal name: <plan-name>
```

Run the returned two-line invocation verbatim. Do not replace it with a second
handwritten execution protocol. The handoff already owns task delegation,
task-scoped validation and review, one local commit per task, progress evidence,
and the independent final-review loop.

Task path lists are review and staging boundaries, not immutable ownership. If
a dependent task reveals that an earlier task's internal interface cannot
satisfy behavior already fixed by the finalized spec, HIGH execution records a
corrective deviation, reopens only the necessary prior-task files, reruns both
affected contracts, obtains a fresh review, and creates a focused fix commit.
This spec-preserving correction does not require an extra operator approval or
a new planning invocation. New behavior, repositories, integrations,
migrations, permissions, secrets, or risk classes still return to planning.

## Checkpoint and Resume HIGH Work

Before pausing a goal, ending the session, or switching provider or account,
refresh its portable handoff:

```text
Use `.ai/wrappers/goal-checkpoint.md`.

Goal name: <plan-name>
Exact goal: <saved objective>
```

After the checkpoint is saved, pause the active goal. In a new session, invoke
`resume-goal.md` with the same goal name, re-check the reported repository
state, and run its returned command exactly.

## Create a Pull Request

After the branch's commits and required reviews are complete, optionally invoke
the pull request workflow in Agent mode:

```text
Use `.ai/wrappers/create-pull-request.md`.

Base: AUTO
```

The prompt inspects the complete branch diff and proposes a conventional title
plus a description containing only `## Summary`, with a dynamic number of
outcome-focused bullets based on the complete diff. It waits for explicit
approval before pushing the branch or creating the pull request and never
changes the existing commits.

## Keep Prompt Authority Singular

- Use the wrapper inputs to provide request-specific evidence and decisions.
- Let canonical prompts own stage rules, schemas, validation, review, and final
  responses.
- Use "classified request," "finalized spec," and "saved plan" consistently.
- Never treat a conversational plan or saved artifact as execution authority.
- Do not copy the HIGH task commit protocol into an operator prompt; read it
  from the saved handoff.

## OpenAI References

- [Slash commands](https://learn.chatgpt.com/docs/reference/slash-commands)
- [Follow a goal](https://learn.chatgpt.com/use-cases/follow-goals)
