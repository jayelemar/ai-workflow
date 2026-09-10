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

## Next-Stage Runtime Recommendation

After classification, resolve the next writable stage: `planning` for LOW and
`specification` for MEDIUM or HIGH. Read that stage's tier and reasoning effort
from `.ai/config/agent-models.toml`, then map the tier to its full model ID.
Report the result as a recommendation only. Do not inspect or change the active
runtime, block the next stage, or create a subagent. If the mapping is missing
or invalid, report that exact configuration problem instead of inventing a
runtime.

## Copy-Pasteable Next Action

Derive one safe kebab-case work-item name from `Target`. Preserve the complete
known target, evidence, decisions, constraints, and acceptance expectations in
the next-stage input; do not replace concrete intake evidence with a summary
that loses information.

- For LOW, emit a complete `.ai/wrappers/create-plan.md` invocation with the
  derived name, `Supersedes: N/A`, `Classification: LOW`, `Spec: N/A: LOW`, and
  `Flow artifacts: AUTO`.
- For MEDIUM or HIGH feature intake, emit a complete
  `.ai/wrappers/generate-feature-spec.md` invocation with the derived name,
  `Supersedes: N/A`, the resolved classification, and the supplied feature
  request, decisions, constraints, and acceptance expectations.
- For MEDIUM or HIGH bugfix intake, emit a complete
  `.ai/wrappers/generate-bugfix-spec.md` invocation with the derived name,
  `Supersedes: N/A`, the resolved classification, expected behavior,
  constraints, and acceptance expectations under `Request and decisions`, and
  all supplied reproduction, actual behavior, logs, affected-boundary, recent-
  change, and causal evidence under `Bug evidence`.

If `Missing decision` is not `None`, do not fabricate a writable-stage
invocation. Instead, make `Next action` a complete copy-pasteable invocation of
the same intake wrapper with all known input preserved and the exact missing
decision requested. The user must explicitly invoke that prompt; returning it
does not start another stage.

## Final Response

Return exactly, with `Next action` containing one complete prompt rather than a
wrapper path or generic instruction:

````text
Classification: LOW | MEDIUM | HIGH
Reason: <concise evidence-backed trigger>
Missing decision: <None or exact missing input>
Recommended next-stage runtime: <full model ID> / <reasoning effort>
Next action:
```text
<complete copy-pasteable prompt with every known input filled in>
```
````

The writable-stage prompts have these exact shapes:

### LOW

```text
Use `.ai/wrappers/create-plan.md`.

Plan name: <derived-kebab-case-name>
Supersedes: N/A
Classification: LOW
Spec: N/A: LOW
Flow artifacts: AUTO
```

### MEDIUM/HIGH Feature

```text
Use `.ai/wrappers/generate-feature-spec.md`.

Name: <derived-kebab-case-name>
Supersedes: N/A
Classification: <MEDIUM | HIGH>
Request and decisions: <complete known feature intake>
```

### MEDIUM/HIGH Bugfix

```text
Use `.ai/wrappers/generate-bugfix-spec.md`.

Name: <derived-kebab-case-name>
Supersedes: N/A
Classification: <MEDIUM | HIGH>
Request and decisions: <complete known expected behavior, constraints, and acceptance expectations>
Bug evidence: <complete supplied reproduction and causal evidence>
```

## Input

Intake type: `feature | bugfix`
Target: `<requested work>`
Evidence: `<complete supplied intake evidence>`
