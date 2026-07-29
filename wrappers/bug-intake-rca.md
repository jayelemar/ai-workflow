# Bug Intake and RCA Wrapper

Use this before creating a bugfix spec. Run it in Plan Mode or another
analysis-only session.

```text
RCA only. Do not write files, create a spec or plan, edit code, or run a
workflow.

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

Classify risk as LOW, MEDIUM, or HIGH using the operator-gated workflow rules.

When complete, return an Approval Brief containing only:
1. Confirmed facts and evidence-backed root cause
2. Rejected hypotheses
3. Recommended fix direction and constraints
4. Blast radius and risk rationale
5. Required regression tests and recovery/rollback risk
6. Recommended route: LOW, MEDIUM, or HIGH

Do not create any artifact. State unresolved decisions explicitly.
```

After the user explicitly invokes the next stage, use
`.ai/wrappers/generate-bugfix-spec.md` in a fresh spec conversation.
