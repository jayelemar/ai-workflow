# Generate Bugfix Spec Wrapper

Use .ai/prompts/generate-spec.md.

Bugfix: <bug name>

Objective:
Create a specification file only.

Strict Constraints:
- Do not edit, modify, or delete any part of the codebase.
- Do not propose or apply code changes.
- Do not create a plan.
- Limit output strictly to the spec creation process.

RCA Evidence Gate:
- Create a spec only when the supplied evidence establishes an evidence-backed
  RCA and fix direction.
- If the RCA is not established, do not create a spec. Ask for missing
  evidence or return to RCA-only analysis.
- Production evidence may be `N/A: not a production issue`, but Codex must not
  claim production reproduction without supplied evidence.

Source Material:
- You may inspect the codebase to confirm current behavior, affected files, routes, tests, logs, and reproduction facts.
- You may inspect `.ai/instructions/**/*.md` when relevant.
- Exclude `.ai/artifacts` from broad searches unless a saved plan explicitly
  requires a flow artifact.
- Do not infer desired behavior from the codebase.
- Expected behavior must come from the user-provided details below.
- If expected behavior, edge cases, constraints, or acceptance criteria are unclear, STOP and ask.

Production Evidence:

- Environment and time observed: <production URL/environment and time, or N/A>
- Affected users, roles, routes, services, or data: <details>
- Screenshot or recording: <path, URL, or N/A>
- Console errors: <details or N/A>
- Network request/response: <details or N/A>
- Application/service logs: <details or N/A>

Details:
<extra context>

Current Behavior:
<what is happening>

Expected Behavior:
<what should happen>

Reproduction:
<steps, input, route, logs, or error>

Constraints:
<what must not change>

RCA:
<approved root cause and fix direction>

Known Decisions:
- <explicit rule already decided>
- <explicit constraint already decided>

Unknowns:
- Treat anything not listed in Expected Behavior, Constraints, or Known Decisions as unknown.
- Ask clarifying questions before finalizing the spec if any unknown affects behavior, edge cases, or acceptance criteria.

Process Requirements:
- Confirm the bug is described as current behavior vs expected behavior.
- Confirm supplied evidence supports the RCA. If it does not, STOP and return
  to RCA-only analysis instead of inventing a root cause.
- Define exact IF/THEN behavior for the fix.
- Define edge cases and failure behavior.
- Define acceptance criteria.
- Ask clarifying questions only for missing behavior decisions, not for facts that can be inspected from the repo.

Output:
Save the finalized spec to:
.ai/specs/<bug-name>.spec.md

Then append the manual token checkpoint:
`pnpm exec tsx .ai/scripts/workflow/telemetry/manual-token-usage.ts --plan <bug-name> --stage spec`

If the spec is completed successfully, end the final response with exactly:
`Spec saved to .ai/specs/<bug-name>.spec.md`
