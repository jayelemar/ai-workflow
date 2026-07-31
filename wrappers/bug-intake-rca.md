# Bug Intake and RCA Wrapper

Use this for bugs, regressions, and incidents before the next saved workflow
artifact. It is a read-only RCA that includes the universal workflow
classification.

```text
RCA and classification only. Do not write files, create a spec or plan, edit
code, or begin implementation.

Bug: <bug name>

Evidence:
- Environment/time and production URL: <details or N/A>
- Affected users, roles, routes, services, and data: <details>
- Reproduction: <steps or N/A>
- Expected behavior: <details>
- Actual behavior: <details>
- Console errors, network data, and service logs: <details or N/A>
- Screenshot/recording and recent related changes: <details or N/A>

Inspect relevant code and supplied evidence. Do not claim production
reproduction unless the evidence proves it. Ask one question at a time only
when missing evidence or expected behavior prevents an evidence-backed RCA.

When the evidence is sufficient, apply the exact classification, escalation,
LOW-to-MEDIUM safeguard, uncertainty stop, and next-stage rules in
`.ai/prompts/select-workflow.md`. Do not use a separate RCA risk scheme.

When complete, return an Intake Brief followed by the exact four-line
classification output:

1. Confirmed facts and evidence-backed root cause
2. Rejected hypotheses
3. Recommended fix direction and constraints
4. Required regression tests and recovery/rollback risk

```text
Classification: LOW | MEDIUM | HIGH
Reason: <concise evidence-based reason>
Missing decision: <None or the exact information required to classify>
Next action: <the exact next authorized stage>
```

Do not create any artifact. State unresolved decisions explicitly.
```

Follow the classifier's next action. LOW switches to Plan mode for its compact
plan. MEDIUM and HIGH create the bugfix spec in the same intake conversation.
