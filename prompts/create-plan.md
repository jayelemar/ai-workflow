# Create Plan

Create one saved `plan-manifest@2` in Plan mode. This stage runs only when the
user explicitly invokes plan creation after read-only intake and, for MEDIUM or
HIGH, after the required spec and flow-artifact stages are finalized.

## Input

```text
Classification: LOW | MEDIUM | HIGH
Spec: .ai/specs/<name>.spec.md | N/A: LOW
Flow artifacts: .ai/artifacts/<name>/ | N/A: <concrete reason>
```

Read `.ai/AGENTS.md`, `.ai/instructions/index.md`, the routed workflow,
reasoning, testing, and delivery instructions, plus every finalized input.
Inspect repository facts needed for concrete ownership, contracts, dependencies,
validation, Git roots, and integration bases.

## Preconditions

- LOW uses classifier evidence and does not create a spec.
- MEDIUM/HIGH requires one readable `feature-spec@1` or `bugfix-spec@1` with
  `Open Decisions` equal to `None`.
- When flow tracing is required, both `user-journey@1` and
  `implementation-map@1` must be readable and complete.
- Stop for missing desired behavior, unresolved decisions, or an integration
  base that cannot be identified. Do not infer or silently default it.

## Planning Contract

Use `.ai/templates/plan.template.md` exactly and save:

`.ai/plans/<plan-name>.md`

- Declare every Git repository by stable ID, explicit root, and explicit
  integration-base ref. A repository root must resolve to a Git worktree.
- Do not use a hard-coded base candidate order. Save the base established by
  repository evidence or supplied by the user.
- Reconcile desired behavior with current ownership, public/internal contracts,
  framework conventions, data and service boundaries, and exact validation.
- Do not add behavior beyond the finalized spec or LOW request.
- LOW plans stay compact. MEDIUM/HIGH plans include sufficient ownership and
  validation to execute without new behavior decisions.
- A cross-repository outcome must be represented by dependent steps. For HIGH,
  each task declares exactly one repository ID; split any cross-repository task
  into dependent tasks before saving.
- Every HIGH task declares owned files, exact validation, commit purpose, and a
  deterministic delegation decision of `REQUIRED` or `NONE`. Never use
  `OPTIONAL` or defer the decision to execution.
- Use `REQUIRED` for every applicable rule: independent evidence across three
  or more source areas requires an `investigator`; implementation isolated
  from every other task with no shared file ownership requires a `builder`;
  authentication, authorization, payments, secrets, migrations, destructive
  behavior, or external security boundaries require a `reviewer`.
- Create no workflow state, sidecar, event log, preview, validator artifact, or
  progress record.

## HIGH Handoff

For HIGH only, create `.ai/artifacts/<plan-name>/goal-handoff.md` using
`.ai/prompts/goal-checkpoint.md`. Link the finalized spec and saved plan, record
the current repository state and `No implementation started`, use `Awaiting
explicit /goal invocation` as the only blocker, and name `/goal <description>
<plan-file>` as the next action. Use the checkpoint content and unchanged HIGH
commit protocol, then return to this prompt. Do not create a handoff for LOW or
MEDIUM.

## Stage Boundary

Saving a plan does not implement it. The next stage must be explicitly invoked:

- LOW/MEDIUM: `execute .ai/plans/<plan-name>.md`
- HIGH: `/goal <description> .ai/plans/<plan-name>.md`

Do not add a preview, approval, or plan-validation gate. Manual token telemetry
is optional and never affects the saved plan or next stage.

## Final Response

Return exactly:

`Plan saved to .ai/plans/<plan-name>.md [<classification>]`
