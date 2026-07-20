import {
  workflowStateForFixture,
  writeWorkflowPlan,
} from "./workspace.ts";

const thinPlanContractSection = () => `## Workflow Content Rules

thin-plan-v1
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
) => writeWorkflowPlan(root, planName, canonicalizeWorkflowForTest(content));

export const planWith = (
  status: string,
  nextAction: string,
  extra = "",
) => `# Plan

${thinPlanContractSection()}

## Workflow State

${workflowStateForTest(status, nextAction)}

## Files (MANDATORY)

### Created files

* .ai/scripts/workflow/runner/__tests__/integration/runner.test.ts

### Modified files

* .ai/scripts/workflow/runner.ts

### Deleted files

* None

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

${thinPlanContractSection()}

## Workflow State

${workflowStateForTest(status, nextAction)}

## Files (MANDATORY)

### Created files

${(files.created?.length ? files.created : ["None"])
  .map((file) => `* ${file}`)
  .join("\n")}

### Modified files

${(files.modified?.length ? files.modified : ["None"])
  .map((file) => `* ${file}`)
  .join("\n")}

### Deleted files

${(files.deleted?.length ? files.deleted : ["None"])
  .map((file) => `* ${file}`)
  .join("\n")}

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

export const thinPlanV2Manifest = (
  status = "draft",
  nextAction = "plan-validator",
  extra = "",
) => `# Plan: artifact-state

## Workflow Content Rules

thin-plan-v2

## Workflow State

${workflowStateForTest(status, nextAction)}

## Spec

.ai/specs/artifact-state.spec.md

## Artifacts

* User journey: .ai/artifacts/artifact-state/user-journey.md
* Implementation map: .ai/artifacts/artifact-state/implementation-map.md
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
