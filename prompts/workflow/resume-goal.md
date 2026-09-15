# Resume Goal

Return the exact saved action for a HIGH work item without executing it. Read
`.ai/AGENTS.md` before inspecting workflow evidence.

## Input

- Work item: `<stable-kebab-case-work-item>`

## Rules

1. Read `.ai/artifacts/<work-item>/work-status.md`.
2. Require `work-status@1` and resolve exactly one root-level active
   `plan-manifest@5` whose lineage, status link, spec, classification, and
   ordered task IDs match it.
3. Verify repository evidence and positive, strictly increasing review rounds.
   Recompute current `review-input-fingerprint@1` evidence before trusting
   recorded review clearance.
4. If any status, plan, review, or worktree report uses an older contract,
   return exactly: `Legacy workflow artifact: <path> uses <format>; replan using
the current contract before execution or resume.` Never migrate, overwrite,
   or delete it.
5. Return status's exact `## Next Action` without invoking it. Stop; status is
   evidence, not transition authority.

## Final Output

Return only status's exact `## Next Action`, or the exact legacy response.
