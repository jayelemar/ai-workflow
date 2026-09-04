# Select Workflow

Classify every request before creating or changing a spec, plan, artifact, or
implementation file. This invocation is read-only.

Read `.ai/AGENTS.md` and inspect only the request and repository evidence needed
to classify the work. Do not write files or start another stage. Stop for the
exact missing decision when evidence cannot establish a class.

## Deterministic Classification

Apply these rules in order:

1. Choose `HIGH` when execution spans multiple repositories; includes a
   migration or destructive behavior; crosses an authentication,
   authorization, payment, secret, or other external security boundary; or
   requires independently committed task workflows.
2. Otherwise choose `LOW` only when the work is bounded, understood, contained
   in one repository, has no migration or destructive behavior, has no external
   integration, and has no unresolved behavior decision.
3. Choose `MEDIUM` for everything else.

End-to-end tracing is incompatible with LOW. Escalate when new evidence matches
a higher-class trigger; never silently downgrade.

## Final Response

Return exactly:

```text
Classification: LOW | MEDIUM | HIGH
Reason: <concise evidence-backed trigger>
Missing decision: <None or exact missing input>
Next action: <exact explicitly invoked stage>
```

## Input

Target: `<requested work>`
