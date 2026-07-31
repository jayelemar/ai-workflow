# Create Plan Wrapper

Use `.ai/prompts/create-plan.md` in Plan mode after the intake conversation
has saved the required spec for MEDIUM or HIGH work.

Classification:
`LOW | MEDIUM | HIGH`

Inputs:

- LOW: classifier result and request context.
- MEDIUM/HIGH: saved spec path. HIGH also requires a `REQUIRED` or `NONE`
  delegation decision for every task, using the plan-template rubric.

Create and save the plan only. Do not implement, review a speculative plan, or
request a separate approval. After it is saved, the user explicitly invokes either
`execute <plan-file>` for LOW/MEDIUM or `/goal <description> <plan-file>` for
HIGH.
