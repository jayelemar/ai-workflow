# Generate Feature Spec Wrapper

Use .ai/prompts/generate-spec.md.

Feature: <feature name>

Load:
.ai/instructions/shared/reasoning-quality.md

Apply shared reasoning-quality guidance for analysis and edge-case checks.

Objective:
Create a specification file only.

Strict Constraints:
- Do not edit, modify, or delete any part of the codebase.
- Do not propose or apply code changes.
- Do not create a plan.
- Limit output strictly to the spec creation process.

Requirements Interview Gate:
- When the operator asks to "Grill me on this spec", interview before writing
  the spec.
- Ask one question at a time.
- Resolve every material unknown about behavior, roles, permissions, success
  criteria, failures, edge cases, non-goals, and validation expectations.
- Do not infer product behavior from codebase context.
- Do not write the spec until those decisions are explicit.

Source Material:
- You may inspect the codebase to identify current implementation facts.
- You may inspect `.ai/instructions/**/*.md` when relevant.
- Exclude `.ai/artifacts` from broad searches unless a saved plan explicitly
  requires a flow artifact.
- Do not infer desired behavior from codebase context.
- Desired behavior must come from the user-provided details below.
- If desired behavior, edge cases, or acceptance criteria are unclear, STOP and ask.

Spec Input:

# Spec: <feature-name>

## Goal

<What new capability or behavior should exist?>

## Expected Behavior

<How should the system behave after the change? Be concrete.>

## Acceptance Criteria

- <A pass/fail requirement>
- <Another pass/fail requirement>

## Edge Cases

- <Empty/invalid input behavior>
- <Permission/state/loading/error behavior>
- <Anything that must not regress>

## Known Decisions

- <Explicit behavior already decided>
- <Explicit rule or constraint already decided>

## Validation Expectations

- <Expected automated validation>
- <Expected manual check, if needed>

Unknowns:
- Treat anything not listed above as unknown.
- Ask clarifying questions before finalizing the spec if any unknown affects
  behavior, edge cases, acceptance criteria, permissions, or failure states.
- Do not add file scope. File scope belongs in the implementation plan after
  repository inspection.

Details:
<details>

Process Requirements:
- Define expected behavior.
- Define inputs and outputs.
- Define edge cases.
- Define failure behavior.
- Define acceptance criteria.
- Convert behavior into deterministic IF/THEN rules.
- Keep implementation files, code changes, and commands out of the spec unless
  the operator explicitly supplies them as a non-negotiable constraint.
- Ask clarifying questions only for missing behavior decisions, not for facts that can be inspected from the repo.

Output:
Save the finalized spec to:
.ai/specs/<feature-name>.spec.md

Then append the manual token checkpoint:
`pnpm exec tsx .ai/scripts/workflow/telemetry/manual-token-usage.ts --plan <feature-name> --stage spec`

If the spec is completed successfully, end the final response with exactly:
`Spec saved to .ai/specs/<feature-name>.spec.md`
