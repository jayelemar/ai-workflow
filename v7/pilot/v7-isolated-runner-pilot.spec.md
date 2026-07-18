# V7 Isolated Runner Pilot

workflow: v7-isolated-runner-pilot-v2

## Goal

Prove a HIGH-risk V7 lifecycle can record exact dedicated Codex sessions,
pass Plan Review, and reach Completion Summary without changing application
code or invoking the legacy workflow runner.

## Inputs / Outputs

- Input: normalized workflow `v7-isolated-runner-pilot-v2`, run revision `1`, and
  one fresh dedicated Codex session ID for every Codex-backed stage.
- Output: immutable V7 state, append-only SHA-256 hash-chained ledger, and
  regenerated report at `.ai/artifacts/v7-isolated-runner-pilot-v2/v7/runs/1/`.

## Rules

- Every Codex call is analysis-only and runs in a read-only sandbox.
- The pilot must not modify application code, tests, routes, database files,
  migrations, generated files, active wrappers, prompts, or legacy runner.
- Plan Review must return `OKAY` in a fresh dedicated session.
- Stages with no Codex work record a `zero-token` reason.

## Deterministic Rules

- A material finding is any finding that prevents one acceptance criterion from
  being proved, permits an out-of-scope file change, omits required exact
  session/token evidence, or leaves a lifecycle transition undefined.
- IF a Codex stage session is missing, outside this workspace, unreadable, or
  has no positive total tokens, THEN record `usage-unavailable` and block.
- IF Plan Review finds material findings, THEN record that Plan Review attempt
  as `succeeded` with `reviewResult: findings`. HIGH or non-deterministic
  findings enter Decision Needed; deterministic LOW/MEDIUM findings may repair
  only `.ai/v7/pilot/v7-isolated-runner-pilot.spec.md`,
  `.ai/v7/pilot/v7-isolated-runner-pilot.plan.md`, and
  `.ai/artifacts/v7-isolated-runner-pilot-v2/v7/` during this planning gate, then
  retry in a fresh session. The pilot never repairs application code, active
  runner files, foundation planning artifacts, or unrelated V7 sources.
- Retry count is unbounded. IF repair changes no allowed file, OR a fresh retry
  returns the same material-finding fingerprint, THEN record the successful
  Plan Review finding result, enter Decision Needed with
  `review-no-progress`, and require an operator resolution plus a fresh
  dedicated Plan Review session. It never records `blocked` for that condition.
- IF Plan Review returns material findings, THEN do not advance to Plan Setup.
- IF Plan Review returns `OKAY`, THEN advance directly to Plan Setup.
- Feature Intake, Specification Generation, Plan Creation, Plan Review, Plan
  Validation, Task Implementation, Task Verification, and Task Review each
  require distinct dedicated Codex sessions with positive token totals. Each
  attempt writes its exact ID to ledger `sessionId`; retries allocate a new ID
  for that same stage.
- Only Plan Setup, Task Commit, and Completion Summary use `zero-token` in the
  successful pilot path, with a non-empty read-only-pilot reason. Decision
  Needed, Pre-Run Artifact Repair, and Blocker Resolution are no-Codex stages
  only when their defined route is reached; they never substitute for a
  Codex-backed stage.
- After Plan Review `OKAY`, stage completion follows this exact order: Plan
  Setup (zero-token) → Plan Validation (Codex) → Task Implementation (Codex)
  → Task Verification (Codex) → Task Review (Codex) → Task Commit (zero-token)
  → Completion Summary (zero-token) → completed.
- Token evidence source is the exact session JSONL below
  `/home/jetermulo/.codex-work/sessions/` whose `session_meta.session_id`
  equals the requested ID and whose `session_meta.cwd` equals this repository
  root. Required numeric fields are input, cached input, output, reasoning,
  and total tokens; total must be greater than zero.
- Every ledger record uses SHA-256 over its canonical JSON payload and names
  the preceding record hash. IF a record is changed, missing, truncated, or
  reordered, THEN the report marks the chain invalid, the pilot cannot satisfy
  its acceptance criteria, and no later lifecycle stage may begin.
- Canonical payload is UTF-8 RFC 8785 canonical JSON of the ledger record,
  excluding `contentHash`; no `JSON.stringify` field-order convention is used.
- SHA-256 digest representation is lowercase hexadecimal with no prefix.
- Material-finding fingerprint is sorted `severity:code` values joined by `|`.
  A fresh retry repeats findings only when its fingerprint equals the prior
  material-finding fingerprint for that stage.

## Acceptance Criteria

- The lifecycle report has a verified hash chain.
- Intake, specification, plan creation, and Plan Review have exact sessions
  with positive token totals.
- The pilot reaches Completion Summary with no unredacted prompt/model output.
