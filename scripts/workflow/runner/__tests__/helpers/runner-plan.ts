import {
  workflowStateForFixture,
  writeWorkflowPlan,
} from "./workspace.ts";

const thinPlanContractSection = () => `## Workflow Content Rules

thin-plan
`;

const workflowStateForTest = (status: string, nextAction: string): string =>
  workflowStateForFixture(status, nextAction, { unknown: "pair" });

export const canonicalizeWorkflowForTest = (content: string) =>
  content.replace(
    /## Status\s*\n\s*`?([^\n`]+)`?\s*\n\s*## Next Action\s*\n\s*`?([^\n`]+)`?/g,
    (match, status: string, nextAction: string) => {
      try {
        return `## Workflow State\n\n${workflowStateForTest(status.trim(), nextAction.trim())}`;
      } catch {
        return match;
      }
    },
  );

export const writeWorkflowRunnerPlan = async (
  root: string,
  planName: string,
  content: string,
) =>
  writeWorkflowPlan(
    root,
    planName,
    canonicalizeWorkflowForTest(content).replaceAll(
      ".ai/artifacts/artifact-state",
      `.ai/artifacts/${planName}`,
    ),
  );

export const planWith = (
  status: string,
  nextAction: string,
  extra = "",
) => `# Plan

## Document Format

plan-manifest@1

${thinPlanContractSection()}

## Execution Mode

runner-managed

## Workflow State

${workflowStateForTest(status, nextAction)}

## Spec

.ai/specs/artifact-state.spec.md

## Artifacts

* User journey: .ai/artifacts/artifact-state/user-journey.md
* Implementation map: .ai/artifacts/artifact-state/implementation-map.md
* Manual handoff: N/A: runner fixture
* Workflow state: .ai/artifacts/artifact-state/state/workflow.json
* File ownership: .ai/artifacts/artifact-state/state/file-ownership.json
* Files: .ai/artifacts/artifact-state/state/files.json
* Context: .ai/artifacts/artifact-state/state/context.md
* Events: .ai/artifacts/artifact-state/events/

## Phases

### Implementation

* Objective: Exercise runner fixtures.

${extra}
`;

export const planWithFileScope = (
  status: string,
  nextAction: string,
  files: {
    created?: string[];
    modified?: string[];
    deleted?: string[];
  },
  extra = "",
) => `# Plan

## Document Format

plan-manifest@1

${thinPlanContractSection()}

## Execution Mode

runner-managed

## Workflow State

${workflowStateForTest(status, nextAction)}

## Spec

.ai/specs/artifact-state.spec.md

## Artifacts

* User journey: .ai/artifacts/artifact-state/user-journey.md
* Implementation map: .ai/artifacts/artifact-state/implementation-map.md
* Manual handoff: N/A: runner fixture
* Workflow state: .ai/artifacts/artifact-state/state/workflow.json
* File ownership: .ai/artifacts/artifact-state/state/file-ownership.json
* Files: .ai/artifacts/artifact-state/state/files.json
* Context: .ai/artifacts/artifact-state/state/context.md
* Events: .ai/artifacts/artifact-state/events/

## Phases

### Implementation

* Objective: Exercise file scope fixtures.
* Files: ${(files.created ?? []).concat(files.modified ?? [], files.deleted ?? []).join(", ") || "None"}

${extra}
`;

export const planWithTaskSavepoints = (
  status: string,
  nextAction: string,
  extra = "",
) =>
  planWithFileScope(
    status,
    nextAction,
    {
      modified: ["src/task-work.ts"],
    },
    `## Phases

### Implementation

* Objective: Complete task-savepoint work.
* Tasks:
  1. [task:01-backend-endpoints] Add backend endpoints
  2. [task:02-web-surface] Add web surface
* Expected Outcome: Task savepoints complete.

${extra}`,
  );

export const planWithEllipsizedTaskSavepoints = (
  status: string,
  nextAction: string,
  extra = "",
) =>
  planWithFileScope(
    status,
    nextAction,
    {
      modified: ["src/task-work.ts"],
    },
    `## Phases

### Implementation

* Objective: Complete task-savepoint work.
* Tasks:
  1. [task:01-option-management] Add and pass regression coverage in...
  2. [task:02-web-surface] Add web surface
* Expected Outcome: Task savepoints complete.

${extra}`,
  );

export const thinPlanManifest = (
  status = "draft",
  nextAction = "plan-validator",
  extra = "",
) => `# Plan: artifact-state

## Document Format

plan-manifest@1

## Workflow Content Rules

thin-plan

## Execution Mode

runner-managed

## Workflow State

${workflowStateForTest(status, nextAction)}

## Spec

.ai/specs/artifact-state.spec.md

## Artifacts

* User journey: .ai/artifacts/artifact-state/user-journey.md
* Implementation map: .ai/artifacts/artifact-state/implementation-map.md
* Manual handoff: N/A: runner fixture
* Workflow state: .ai/artifacts/artifact-state/state/workflow.json
* File ownership: .ai/artifacts/artifact-state/state/file-ownership.json
* Files: .ai/artifacts/artifact-state/state/files.json
* Context: .ai/artifacts/artifact-state/state/context.md
* Events: .ai/artifacts/artifact-state/events/

## Workflow State Rules

Artifact state is authoritative for workflow history, blockers, ownership, and file inventory.

## Phases

### Preparation

* Objective: Inspect current workflow state.
* Tasks:
  1. Inspect .ai/artifacts/artifact-state/state/workflow.json.
* Expected outcome: Current state is understood.

### Implementation

* Objective: Implement artifact-backed state.
* Tasks:
  1. [task:01-artifact-state] Implement artifact-backed state in .ai/scripts/workflow/runner.ts.
* Expected outcome: Artifact-backed state is implemented.

### Validation

* Objective: Validate workflow runner behavior.
* Tasks:
  1. Run workflow runner tests.
* Expected outcome: Workflow runner tests pass.

${extra}
`;
