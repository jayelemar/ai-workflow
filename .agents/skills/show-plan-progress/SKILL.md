---
name: show-plan-progress
description: Report evidence-backed completion percentages for an existing implementation plan. Use when the user asks for plan progress or completion coverage; read-only, without implementing or running checks or reviews.
---

# Show Plan Progress

Assess verified criteria coverage, not effort completed or time remaining.
This skill is read-only: do not modify plans, application files, Git state, or
configuration; run implementation, tests, or reviews; start a Goal; publish; or
create progress sidecars or tracking files. Missing evidence stays missing.

## Assess the criteria

- Select the plan from the request or unambiguous conversation context. If
  selection is ambiguous, ask for the plan rather than choosing arbitrarily.
  Read the entire plan, its required referenced specifications, and applicable
  repository instructions before assessing it.
- Inventory distinct, independently verifiable criteria already required by
  the plan, including required validation and completion conditions. Split
  compound requirements consistently when they can pass or fail independently.
  Deduplicate repeats; count constituent criteria without also counting their
  parent milestone. Do not introduce effort points, time estimates, code volume,
  test counts, or subjective partial-completion estimates.
- Assign each criterion exactly once to non-review work or review. Preserve
  every mandatory review, including required independent review; manual review
  cannot replace it. Exclude optional and confirmed inapplicable requirements,
  explaining material exclusions. Required blocked items remain in the inventory
  and denominator. Delivery permission alone is not a completion criterion.
- Classify each criterion as Verified (sufficient current evidence), Incomplete
  (known unmet), Unverified (missing or inconclusive evidence), or Blocked (an
  identified obstacle prevents completion or verification). Count only Verified
  non-review criteria. Keep a criterion-to-source/evidence mapping in the
  assessment, without saving it as a tracking artifact.
- Evidence must establish the required outcome for the current implementation,
  scope, and environment. A checked task, existing code, or historical passing
  test alone does not suffice when required evidence is absent or invalidated.
  Reopen criteria when review findings or later changes invalidate their evidence.
  Explain denominator changes from approved scope changes or corrected counting.

## Calculate coverage

Reserve 90% for implementation and required non-review completion criteria,
and 10% for the entire review cycle, including the user's post-implementation
`/review` and acceptance that the cycle is finished.

`overall = floor((verified non-review criteria / total required non-review criteria) * 90 + review credit)`

Review credit is either 0 or 10. It stays 0 while the cycle is pending or
ongoing. Award 10 only when all required reviews are satisfied, blocking findings
are resolved, affected checks pass, and the user accepts the review cycle as
finished for the current implementation. One passing review does not establish
that acceptance. Multiple `/review` rounds add no credit and never change the
denominator. If evidence supporting review completion is invalidated, reopen
the cycle and withhold its credit.

Map review findings to existing criteria rather than counting each finding as
a new requirement. Do not expand scope for unrelated suggestions. Report required
independent review and the user's manual review separately; show rounds and
remaining blocking findings only when supported by reliable evidence.

Round down to a whole percentage; never report 100% before all non-review
criteria are Verified and the full review credit is earned. If the inventory is
incomplete, the denominator is zero, or a complete, defensible assessment cannot
be made, report exactly “Overall completion not yet measured.” Explain the gap
without inventing an overall percentage. Missing evidence for individual criteria
can be classified Unverified when the inventory itself is complete.

## Present the result

Read and use [Show Summary](../show-summary/SKILL.md) to format the assessed
results. Supply the calculated percentage, counts, evidence, and review decision
to that skill; it must not guess or recalculate the percentage. Preserve its
plain-text title and literal `--` supporting-line format. Include:

- The overall percentage in the title, or the exact unmeasured statement above.
- Verified/total non-review criterion counts and that this measures verified
  criteria coverage; do not invent a total for an incomplete inventory.
- Independent review status, manual review status, and whether the reserved
  10% is pending or earned, including reliable round and blocking-finding counts.
- Important remaining work, blockers, and concise evidence references or gaps
  sufficient to substantiate the assessment.
- Delivery authorization separately when relevant. A percentage grants no
  permission to commit, push, deploy, or publish; report any explicitly required
  delivery work using the plan's existing criteria.
