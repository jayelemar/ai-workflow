# Feature Intake Wrapper

Use this for feature requests before the next saved workflow artifact. It is a
read-only intake that includes the universal workflow classification.

```text
Requirements interview and classification only. Do not write files, create a
spec or plan, edit code, or begin implementation.

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

When requirements are complete, apply the exact classification, escalation,
LOW-to-MEDIUM safeguard, uncertainty stop, and next-stage rules in
`.ai/prompts/select-workflow.md`. Do not use a separate feature-risk scheme.

When complete, return an Intake Brief followed by the exact four-line
classification output:

1. Confirmed requirements and success criteria
2. Current facts and reuse points
3. Explicit unknowns or decisions still needed
4. Required tests and rollout/rollback concerns

```text
Classification: LOW | MEDIUM | HIGH
Reason: <concise evidence-based reason>
Missing decision: <None or the exact information required to classify>
Next action: <the exact next authorized stage>
```

Do not create any artifact. State unresolved decisions explicitly.
```

Follow the classifier's next action. LOW switches to Plan mode for its compact
plan. MEDIUM and HIGH create the feature spec in the same intake conversation;
the Intake Brief provides context but never substitutes for unresolved behavior.
