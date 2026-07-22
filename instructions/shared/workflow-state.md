Version: 3.0
Last Updated: 2026-07-22

# Workflow State Instructions

## Authority

The workflow runner is the sole normal writer of a runner-managed plan's
`## Workflow State`, `workflow.json`, latest-event records, event history,
blockers, and context snapshot. A stage agent may write implementation files
and only the exact event artifact named in its runner-issued descriptor. It
must never edit routing documents, phases, task IDs, task boundaries, or
inline history sections.

The runner validates the reserved event and finalizes every allowed transition
through its transition journal. No prompt, terminal summary, or partial
sidecar is a transition authority.

## Canonical State Matrix

`.ai/scripts/workflow/contracts/stage.ts` is executable source.

| Workflow State | Routed Stage | Valid event outcomes |
| --- | --- | --- |
| `draft-artifact-sync` | `sync-plan-artifacts` | `ready`, `retry` |
| `draft-validation` | `plan-validator` | `approved`, `retry`, `blocked` |
| `approved` / `active` | `execute-plan` | `review-ready`, `active`, `blocked` |
| `blocked` | `unblock-plan` | `active`, `blocked` |
| `review` | `review-changes` | `active`, `completed` |
| `reopening` | `reopen-plan` | `active` |
| `completed` | `commit-summary` | terminal |

## Event Contract

Each nonterminal stage receives `{ stage, sourceWorkflowState, version,
eventPath }` from the runner. Its event must use the matching `# <Stage> vN`
title and non-empty `## Outcome`, `## Summary`, and `## Evidence` sections.
Failed review and reopen events require `## Remediation`; event artifacts hold
all detailed findings, validation, blockers, and risks.

The runner writes only canonical latest records: `version`, `outcome`,
`summary`, and `evidence`, plus `unresolvedFindings` for a failed review. It
rebuilds context from that finalized state.

## Recovery

Normal runs never strip inline sections or infer a state handoff from agent
output. Restart recovery uses only the exact transition journal. Existing
malformed plans require the explicit workflow artifact migration command; they
are not repaired automatically during a stage.
