# Select Workflow

Classify every request before creating or changing a spec, plan, artifact, or
implementation file. This is a read-only intake stage.

## Strict Constraints

- Inspect only the request and repository evidence needed to classify it.
- Do not create, modify, or delete files.
- Do not create a spec, plan, artifact, or `/goal`; do not begin implementation.
- Do not guess when evidence does not establish the classification.

## Classification

Choose exactly one class:

| Class | Use when | Next authorized stage |
| --- | --- | --- |
| `LOW` | A narrow, understood, low-risk change has a bounded implementation and validation path. | Switch to Plan mode to create a compact plan, then switch to Agent mode and invoke `execute <plan-file>`. |
| `MEDIUM` | The work needs durable behavior definition, integration tracing, or more than LOW safeguards, but does not require HIGH-GOAL task commits. | Create a spec in the intake conversation, switch to Plan mode to create the plan, then switch to Agent mode and invoke `execute <plan-file>`. |
| `HIGH` | The work is long-running, exploratory, high-risk, cross-system, or needs task-level validation, review, and commits. | Create a spec in the intake conversation, switch to Plan mode to create the plan, then switch to Agent mode and invoke `/goal <description> <plan-file>`. |

Escalate immediately when new evidence supports a higher class. Do not downgrade
without documenting that the risk which justified the higher class is resolved.

Classify as at least `MEDIUM` before planning when the request needs a user
journey, implementation map, broad integration trace, cross-cutting risk
analysis, or another MEDIUM/HIGH safeguard. A small code diff does not avoid
this rule.

If the available request and read-only evidence cannot distinguish the classes,
STOP and ask for the exact missing decision input.

## Required Output

Return exactly these four lines:

```text
Classification: LOW | MEDIUM | HIGH
Reason: <concise evidence-based reason>
Missing decision: <None or the exact information required to classify>
Next action: <the exact next authorized stage>
```

## Input

Target:
<requested work>
