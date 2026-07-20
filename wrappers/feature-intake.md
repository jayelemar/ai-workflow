# Feature Intake Wrapper

Use this before creating a feature spec. Run it in Plan Mode or another
analysis-only session.

```text
Requirements interview only. Do not write files, create a spec or plan, edit
code, or run a workflow.

Feature: <feature name>

Context:
- Problem/user need: <details>
- Desired outcome: <details>
- Environment/URL: <details or N/A>
- Target roles: <details>
- Proposed behavior or user flow: <details>
- Acceptance criteria: <details>
- UI/UX reference: <details or N/A>
- Auth, data, API, integration, and release constraints: <details or N/A>
- Non-goals and existing related behavior: <details or N/A>

Inspect relevant code only to establish current facts and reuse points. Do not
infer desired behavior from the codebase. Ask one question at a time until all
material behavior, roles, permissions, success criteria, failures, edge cases,
non-goals, and validation expectations are explicit.

Classify risk:
- LOW: isolated additive behavior; no auth, database, API contract, shared
  behavior, or broad impact.
- MEDIUM: multiple files, shared behavior, a new dependency, cross-feature
  interaction, or unclear regression risk.
- HIGH: auth/RLS/permissions, database or migration, payments, public/shared
  contract, destructive data, external integration, multi-route flow, or broad
  customer impact.

When complete, return an Approval Brief containing only:
1. Confirmed requirements and success criteria
2. Current facts and reuse points
3. Explicit unknowns or decisions still needed
4. Risk class and rationale
5. Recommended route: LOW direct, MEDIUM manual, or HIGH runner-managed
6. Required tests and rollout/rollback concerns

Do not create any artifact. Stop for `APPROVE DIRECTION`.
```

After the operator approves, use
`.ai/wrappers/generate-feature-spec.md` in an agent session. Provide the
approved brief as context; it is not a substitute for any still-unknown desired
behavior.
