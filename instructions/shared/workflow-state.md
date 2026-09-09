Version: 4.4
Last Updated: 2026-09-09

# Workflow Stage Instructions

## Authority

Only an explicit user invocation starts a stage. Saved specs, plans, flow
artifacts, handoffs, Git state, validation evidence, and reviews are durable
context, not transition authority.

## Stage Sequence

| Class    | Intake                   | Specification                    | Planning                                                                         | Execution                                                |
| -------- | ------------------------ | -------------------------------- | -------------------------------------------------------------------------------- | -------------------------------------------------------- |
| `LOW`    | Read-only classification | N/A                              | Explicitly create and save a compact plan                                        | Explicitly `execute <plan-file>`                         |
| `MEDIUM` | Read-only classification | Explicitly finalize a typed spec | Explicitly create required flow artifacts and save a plan                        | Explicitly `execute <plan-file>`                         |
| `HIGH`   | Read-only classification | Explicitly finalize a typed spec | Explicitly create required flow artifacts, save a plan, and initialize a handoff | Explicitly invoke the handoff's two-line `/goal` command |

Planning may create a missing required flow-artifact pair in the same explicit
invocation. Direct flow-artifact generation is also available but does not
start planning.

## Transition Rules

- Intake never writes the next-stage artifact.
- LOW never executes from a conversational plan.
- Finalizing or saving an artifact never starts the next stage.
- A material execution discovery returns to a newly invoked specification or
  planning stage. A qualifying correction under the table in `.ai/AGENTS.md`
  remains inside the already authorized execution stage.
- Finalized specs are immutable durable context. Reuse the same spec path only
  when the complete spec content is unchanged. Any requested content change,
  including evidence or root-cause context that preserves desired behavior,
  requires an explicitly invoked specification stage to save a new unused spec
  path before replanning; never rewrite the spec referenced by an existing plan
  revision.
- Replanning does not itself change classification. Planning reapplies the
  deterministic classifier, archives the predecessor only after the successor
  is valid, and leaves exactly one active plan revision for that work item.
- Review, checkpoint, and delivery actions remain part of their owning stage;
  none silently invokes delivery or another workflow stage.
- An explicit manual review may remediate an already implemented plan-owned
  diff, but it never starts an untouched plan or expands execution scope.

## Actionable Stops

- Whenever a workflow stage stops for a blocker, missing input, or required
  stage transition, its final response must state the exact blocker and then
  immediately provide `Do this next:` followed by the exact user action.
- When the action invokes another stage or resumes the current one, provide a
  complete copy-pasteable invocation with every currently known required input
  filled in. When an operator decision or external action must happen first,
  name that exact decision or action and include the invocation to resume.
- A durable `Next Action` or `Required Next Action` field follows the same
  contract. Do not reduce it to generic prose such as `return to planning`,
  `resolve the blocker`, or a request for the user to ask what to do next.
- Providing the invocation does not start or authorize that stage. The user
  must still invoke it explicitly.

## Material Discovery Routing

When execution or review stops for a material discovery, determine the next
action from the discovered content before constructing the actionable stop:

- If the discovery exposes an unresolved behavior, permission, or other
  material decision, stop and state the exact decision, bounded choices, and
  consequence of each choice. A finalized MEDIUM/HIGH spec has no open
  decisions, and LOW does not permit an unresolved behavior decision; therefore
  do not resume the current execution, review, or HIGH `/goal` stage with a
  `Decision:` input. Under `Do this next:`, provide one complete copy-pasteable
  next-stage invocation per choice:
  - for MEDIUM or HIGH, use
    `execute .ai/prompts/workflow/generate-spec.md` as the command with the
    exact current spec type, `Name: AUTO`, the exact current spec path under
    `Supersedes`, classification from the current discovery context, `Request
and decisions:` with that choice filled in, and complete bug evidence; or
  - for LOW, reapply the classifier with that choice. Use the current work-item
    name, `Supersedes: N/A`, the resulting MEDIUM or HIGH classification,
    `Request and decisions:` with that choice filled in, and complete bug
    evidence under `execute .ai/prompts/workflow/generate-spec.md`. If it
    instead remains LOW, use `execute .ai/prompts/workflow/create-plan.md`
    with `Plan name: AUTO`, the current active plan under `Supersedes`,
    `Classification: LOW`, `Spec: N/A: LOW`, and `Flow artifacts: AUTO`.

  The selected specification or LOW planning invocation is the only immediate
  action. A selected typed-spec invocation finalizes the decided immutable spec
  before a later explicit plan invocation. Do not provide execution, review,
  or `/goal` as an alternative immediate action.

- For MEDIUM or HIGH, if any finalized spec content must change—including
  evidence, root-cause analysis, rejected hypotheses, constraints, acceptance
  criteria, or desired behavior—route first to an explicitly invoked
  `.ai/prompts/workflow/generate-spec.md` stage. Provide `Do this next:` plus a
  complete copy-pasteable spec invocation with:
  - `execute .ai/prompts/workflow/generate-spec.md` as the command;
  - the exact spec type;
  - `Name: AUTO`;
  - the exact current spec path under `Supersedes`;
  - classification determined from the current discovery context;
  - the complete request and decisions; and
  - bug evidence.

  Incorporate the material discovery into those complete inputs. Do not derive
  a successor name or provide create-plan as the immediate action; the owning
  specification prompt must resolve and finalize the new immutable spec first.

- For MEDIUM or HIGH, if the complete finalized spec remains authoritative
  without content changes, route directly to an explicitly invoked
  `.ai/prompts/workflow/create-plan.md` stage. Its invocation uses:
  - `Plan name: AUTO`;
  - the current active plan under `Supersedes`;
  - `Classification: resolve from current finalized context`;
  - the exact finalized spec path; and
  - `Flow artifacts: AUTO`.
- For LOW, reapply the deterministic classifier to the material discovery
  before constructing the next action. If it remains LOW, route directly to
  create-plan with `Plan name: AUTO`, the current active plan under
  `Supersedes`, `Classification: LOW`, `Spec: N/A: LOW`, and `Flow artifacts:
AUTO`. If it classifies as MEDIUM or HIGH, route first to an explicitly
  invoked `.ai/prompts/workflow/generate-spec.md` stage. Under `Do this next:`,
  provide a complete copy-pasteable invocation with:
  - `execute .ai/prompts/workflow/generate-spec.md` as the command;
  - the exact spec type;
  - `Name: <current work item name>`;
  - `Supersedes: N/A`;
  - the resolved classification; and
  - complete request, decisions, and bug-evidence inputs.

  Do not provide create-plan as the immediate action; finalize the typed spec
  first.

This routing chooses only the next explicit stage. It never invokes that stage
or authorizes a later one.

## Superseded Plan Resolution

Only a root-level `.ai/plans/<name>.md` file is active. When an invocation
references a missing former active plan, inspect
`.ai/artifacts/<name>/superseded-plan.md` and the lineage of root-level active
plans. Treat it as superseded only when exactly one active plan has the same
work-item name and lists that archive in its ordered history. Return
`Superseded plan: <former path> -> <active path>`, then `Do this next:` and the
active plan's exact `execute` invocation for LOW/MEDIUM or validated two-line
`/goal` invocation for HIGH. Do not start it.

Missing, malformed, cyclic, duplicate, or ambiguous lineage is a blocker. Name
the conflicting paths and require an explicit create-plan repair; never choose
by modification time, filename sorting, or conversation recency.

## Anti-Patterns

- Creating a spec during intake.
- Treating `saved` or `finalized` as execution authorization.
- Introducing runner selection, persisted transition state, event history,
  sidecars, or a pre-execution approval gate.
