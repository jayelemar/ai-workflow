# Create Plan Wrapper

Use `.ai/prompts/create-plan.md` in Plan mode after the intake conversation
has saved the required spec for MEDIUM or HIGH work.

Classification:
`LOW | MEDIUM | HIGH`

Inputs:

- LOW: classifier result and request context.
- MEDIUM/HIGH: saved spec path. HIGH also requires a `REQUIRED` or `NONE`
  delegation decision for every task, using the plan-template rubric.

Create and save the plan only. For HIGH, also create the initial
`.ai/artifacts/<plan-name>/goal-handoff.md` with the approved pre-execution
state; it does not authorize implementation. Do not implement, review a
speculative plan, or request a separate approval. After saving, the user
explicitly invokes either `execute <plan-file>` for LOW/MEDIUM or `/goal
<description> <plan-file>` for HIGH.
