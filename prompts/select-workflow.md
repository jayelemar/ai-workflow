# Select Workflow

Classify every request before creating or changing a spec, plan, artifact, or
implementation file. This invocation is read-only.

## Constraints

- Read `.ai/AGENTS.md` and inspect only the request and repository evidence
  needed to classify the work.
- Do not create, modify, delete, stage, or commit files.
- Do not create a spec, plan, flow artifact, goal, or implementation.
- Stop for the exact missing decision when evidence cannot establish a class.

## Classification

Choose exactly one:

| Class    | Evidence                                                                               | Next stage                                                                                    |
| -------- | -------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------- |
| `LOW`    | Narrow, understood, low-risk work with bounded ownership and validation.               | Enter Plan mode and explicitly invoke plan creation; it must save `.ai/plans/<plan-name>.md`. |
| `MEDIUM` | Work needs a durable behavior contract, integration tracing, or safeguards beyond LOW. | Explicitly invoke `.ai/prompts/generate-spec.md` with a spec type.                            |
| `HIGH`   | Long-running, exploratory, high-risk, cross-system, or task-commit work.               | Explicitly invoke `.ai/prompts/generate-spec.md` with a spec type.                            |

Classify as at least MEDIUM when end-to-end flow artifacts are needed. Escalate
when new evidence supports a higher class; do not silently downgrade.

For LOW, entering Plan mode or describing a plan in conversation is not enough.
The Plan-mode invocation must create the saved plan file used by the later
`execute <plan-file>` command.

## Final Response

Return exactly:

```text
Classification: LOW | MEDIUM | HIGH
Reason: <concise evidence-backed reason>
Missing decision: <None or exact missing input>
Next action: <exact explicitly invoked stage>
```

## Input

Target: `<requested work>`
