Version: 3.2
Last Updated: 2026-08-24

# Workflow Stage Instructions

## Authority

The explicit user invocation controls each stage. Finalized specs, saved plans,
flow artifacts, Git state, validation evidence, and review/checkpoint artifacts
provide durable context only; none authorizes a transition by itself. There is
no workflow runner, transition state, event journal, or sidecar authority.

## Stage Matrix

| Class    | Read-only intake result                | Next explicitly invoked stage                                           | Planning                                                                        | Explicit execution                                                |
| -------- | -------------------------------------- | ----------------------------------------------------------------------- | ------------------------------------------------------------------------------- | ----------------------------------------------------------------- |
| `LOW`    | classification and repository evidence | explicitly invoke plan creation                                         | save a compact `.ai/plans/<plan-name>.md` reference                             | `execute <plan-file>`                                             |
| `MEDIUM` | classification and missing decisions   | invoke the spec prompt and finalize `feature-spec@1` or `bugfix-spec@1` | reuse or create required flow artifacts, then save `plan-manifest@2`            | `execute <plan-file>`                                             |
| `HIGH`   | classification and missing decisions   | invoke the spec prompt and finalize `feature-spec@1` or `bugfix-spec@1` | reuse or create required flow artifacts, then save the plan and initial handoff | two-line `/goal <exact-goal>` plus `plan: <plan-file>` invocation |

After finalizing a MEDIUM/HIGH spec, explicitly invoke plan creation. When the
spec requires end-to-end tracing, create-plan applies the canonical
flow-artifact prompt and saves both `user-journey@1` and
`implementation-map@1` before the plan if a complete pair is not already
available. A direct flow-artifact invocation may pre-create the pair but is not
required.

## Rules

- Intake is read-only and stops for unresolved classification or behavior
  decisions. It must not save the next artifact in the same invocation.
- LOW cannot execute from a conversational plan. Plan creation must save the
  plan file named by the later `execute <plan-file>` invocation.
- A saved or finalized artifact never starts the next stage. The user must
  explicitly invoke the spec, planning, or execution stage. A standalone
  flow-artifact invocation does not start planning.
- First classify an execution discovery using `.ai/AGENTS.md`. A qualifying
  corrective deviation stays in the current execution stage and requires no
  additional operator approval. Only a material discovery returns work to the
  appropriate explicit stage. Classification escalates when newly established
  risk requires it.
- The five MEDIUM review statuses are `Ready to complete`, `Fix required`,
  `Awaiting operator decision`, `Completed by operator`, and `Blocked`. After
  all MEDIUM implementation, a mandatory independent reviewer checks the
  cumulative plan-owned diff. In-scope blocking findings from rounds 1 and 2
  are fixed, validated, and automatically re-reviewed. After remediation and
  passing validation for blocking round 3, pause before the next reviewer and
  require one of the three exact checkpoint tokens defined by the shared review
  prompt. `REVIEW_NEXT_ROUND` authorizes one round and returns a later blocking
  result to a checkpoint; `REVIEW_UNTIL_CLEAR` persists and repeats safe review
  cycles until clear or stopped; `END_REVIEW` uses the disclosed operator-ended
  path.
- HIGH execution reads each saved task and delegation decision before work.
  Required delegation, validation, actual-diff review, and one task-scoped
  commit remain mandatory under the HIGH commit protocol. After all task
  commits, a mandatory independent reviewer checks the cumulative whole-plan
  diff. Blocking remediation repeats validation and creates a review-round
  commit per changed repository before automatic re-review or a continuation
  checkpoint. Rounds 1 and 2 continue automatically; blocking round 3 requires
  operator direction. Every later blocking result follows the recorded
  one-round or until-clear authorization only after its remediation commits and
  validation succeed.
- HIGH task paths are the expected staging and review boundary. When a
  dependent task exposes a spec-conflicting internal interface in a committed
  earlier task, the qualifying correction protocol may reopen that path,
  validate both affected task contracts, create one focused `fix` commit, and
  then resume the dependent task.
- Final MEDIUM and HIGH review uses the locked `reviewer` role from
  `.ai/config/agent-models.toml`. `P0`, `P1`, and `P2` block completion; `P3`
  is advisory and remains recorded.
- HIGH planning creates `.ai/artifacts/<plan-name>/goal-handoff.md` as portable
  context. It does not authorize implementation or replace `/goal`.

## Anti-Patterns

- Creating a spec during read-only intake.
- Treating `saved`, `finalized`, or conversational agreement as execution
  authorization.
- Introducing runner selection, persisted transition state, event history,
  sidecars, or a pre-execution approval gate.
