import { access, mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { tmpdir } from "node:os";

export type WorkflowTestWorkspace = {
  root: string;
  cleanup: () => Promise<void>;
};

export const setupWorkflowWorkspace = async ({
  prefix,
  directories = [".ai/plans"],
  prompts = {},
}: {
  prefix: string;
  directories?: string[];
  prompts?: Record<string, string>;
}): Promise<WorkflowTestWorkspace> => {
  const root = await mkdtemp(join(tmpdir(), prefix));
  await Promise.all(directories.map((directory) => mkdir(join(root, directory), { recursive: true })));
  await Promise.all(Object.entries(prompts).map(async ([name, content]) => {
    const promptPath = join(root, ".ai", "prompts", name);
    await mkdir(join(root, ".ai", "prompts"), { recursive: true });
    await writeFile(promptPath, content, "utf8");
  }));
  return { root, cleanup: () => rm(root, { recursive: true, force: true }) };
};

export const writeWorkflowPlan = async (
  root: string,
  planName: string,
  content: string,
): Promise<void> => {
  const plansDir = join(root, ".ai", "plans");
  await mkdir(plansDir, { recursive: true });
  await writeFile(join(plansDir, `${planName}.md`), content, "utf8");
  const specPath = content.match(/^\.ai\/specs\/[^\s`]+\.spec\.md$/m)?.[0];
  const artifactRoot = planName;
  const referencedArtifactRoot = content.match(/\.ai\/artifacts\/([^/]+)\/state\/workflow\.json/)?.[1];
  const workflowState = content.match(/## Workflow State\s*\n\s*([^\s]+)/)?.[1] ?? "draft-validation";
  const scopedFiles = Array.from(content.matchAll(/^\* Files:\s*(.+)$/gm))
    .flatMap((match) => match[1].split(","))
    .map((file) => file.trim().replace(/^`|`$/g, ""))
    .filter((file) => file.length > 0 && file !== "None");
  const changedFiles = scopedFiles.length > 0 ? scopedFiles : ["src/artifact-state.ts"];
  if (!specPath) return;
  await mkdir(dirname(join(root, specPath)), { recursive: true });
  await writeFile(join(root, specPath), "# Feature: Test\n\n## Document Format\n\nfeature-spec@1\n\n## Version\n\n1\n\n## Goal\n\nTest.\n\n## Inputs / Outputs\n\nNone\n\n## Behavior\n\nTest.\n\n## Edge Cases\n\nNone\n\n## Constraints\n\nNone\n\n## Acceptance Criteria\n\nPass.\n", "utf8");
  let hasExistingState = false;
  try {
    await access(join(root, ".ai", "artifacts", artifactRoot, "state", "workflow.json"));
    hasExistingState = true;
  } catch {
    // The first fixture write creates all mutable state sidecars below.
  }
  await writeWorkflowArtifactFiles(root, artifactRoot, {
    "user-journey.md": "# User Journey\n\n## Document Format\n\nuser-journey@1\n\n## Goal\n\n* Test.\n\n## Actors\n\n* Runner\n\n## Entry Points\n\n* Test\n\n## User Flows\n\n* Validate.\n\n## Mermaid Diagram\n\n```mermaid\nflowchart TD\n A-->B\n```\n\n## States\n\n* draft\n\n## Failures\n\n* invalid\n\n## Acceptance Scenarios\n\n* valid\n\n## Open Decisions\n\nNone\n",
    "implementation-map.md": "# Implementation Map\n\n## Document Format\n\nimplementation-map@1\n\n## Source Versions\n\nN/A: test fixture.\n",
    ...(hasExistingState ? {} : {
      "state/workflow.json": { documentFormat: "workflow-state@1", planPath: `.ai/plans/${planName}.md`, workflowState, latest: {}, history: [], unresolvedBlockers: [], updatedAt: "2026-07-01T00:00:00.000Z" },
      "state/file-ownership.json": { documentFormat: "file-ownership@1", planPath: `.ai/plans/${planName}.md`, owns: changedFiles, released: [], resolvedFiles: changedFiles, changedFiles, headSha: "abc123", updatedAt: "2026-07-01T00:00:00.000Z" },
      "state/files.json": { documentFormat: "files-state@1", created: [], modified: changedFiles, deleted: [], changedFiles, released: [], headSha: "abc123" },
    }),
    "state/context.md": "# Context\n",
  });
  if (referencedArtifactRoot && referencedArtifactRoot !== artifactRoot) {
    await writeWorkflowArtifactFiles(root, referencedArtifactRoot, {
      "user-journey.md": "# User Journey\n\n## Document Format\n\nuser-journey@1\n\n## Goal\n\n* Test.\n\n## Actors\n\n* Runner\n\n## Entry Points\n\n* Test\n\n## User Flows\n\n* Validate.\n\n## Mermaid Diagram\n\n```mermaid\nflowchart TD\n A-->B\n```\n\n## States\n\n* draft\n\n## Failures\n\n* invalid\n\n## Acceptance Scenarios\n\n* valid\n\n## Open Decisions\n\nNone\n",
      "implementation-map.md": "# Implementation Map\n\n## Document Format\n\nimplementation-map@1\n\n## Source Versions\n\nN/A: test fixture.\n",
    });
  }
  await mkdir(join(root, ".ai", "artifacts", artifactRoot, "events"), { recursive: true });
};

const workflowStateByPair: Record<string, string> = {
  "draft+sync-plan-artifacts": "draft-artifact-sync",
  "draft+plan-validator": "draft-validation",
  "approved+execute-plan": "approved",
  "active+execute-plan": "active",
  "blocked+execute-plan": "blocked",
  "blocked+unblock-plan": "blocked",
  "review+review-plan": "review",
  "reopening+reopen-plan": "reopening",
  "completed+commit-summary": "completed",
};

export const workflowStateForFixture = (
  status: string,
  nextAction: string,
  { unknown = "throw" }: { unknown?: "throw" | "pair" } = {},
): string => {
  const normalizedStatus = status.replaceAll("`", "");
  const normalizedNextAction = nextAction.replaceAll("`", "");
  const workflowState = workflowStateByPair[
    `${normalizedStatus}+${normalizedNextAction}`
  ];
  if (workflowState) return workflowState;
  if (unknown === "pair") return `${normalizedStatus}--${normalizedNextAction}`;
  throw new Error(
    `unknown test workflow pair: ${normalizedStatus} + ${normalizedNextAction}`,
  );
};

export const writeWorkflowArtifactFiles = async (
  root: string,
  planName: string,
  files: Record<string, string | Record<string, unknown> | unknown[]>,
): Promise<void> => {
  await Promise.all(Object.entries(files).map(async ([relativePath, value]) => {
    const absolutePath = join(root, ".ai", "artifacts", planName, relativePath);
    await mkdir(dirname(absolutePath), { recursive: true });
    const content = typeof value === "string"
      ? value
      : `${JSON.stringify(value, null, 2)}\n`;
    await writeFile(absolutePath, content, "utf8");
  }));
};

type ThinPlanArtifactOverrides = Partial<{
  status: string;
  nextAction: string;
  workflowState: string;
  latestValidationResult: string;
  latestReviewSummary: string;
  latest: Record<string, unknown>;
  history: string[];
  rawHistory: unknown[];
  unresolvedBlockers: string[];
  activeBlockers: string[];
  created: string[];
  modified: string[];
  deleted: string[];
  changedFiles: string[];
  owns: string[];
}>;

type ThinPlanArtifactProfile = "runner" | "review" | "plan-state";

export const createThinPlanArtifactWriter = (
  profile: ThinPlanArtifactProfile,
) => async (
  root: string,
  overrides: ThinPlanArtifactOverrides = {},
): Promise<void> => {
  await mkdir(join(root, ".ai", "specs"), { recursive: true });
  await writeFile(
    join(root, ".ai", "specs", "artifact-state.spec.md"),
    "# Feature: Artifact state\n\n## Document Format\n\nfeature-spec@1\n\n## Version\n\n1.0\n\n## Goal\n\nTest workflow artifacts.\n\n## Inputs / Outputs\n\nNone\n\n## Behavior\n\nDeterministic.\n\n## Edge Cases\n\nNone\n\n## Constraints\n\nNone\n\n## Acceptance Criteria\n\nArtifacts validate.\n",
    "utf8",
  );
  const changedFiles = overrides.changedFiles ?? overrides.modified ??
    (profile === "plan-state"
      ? [".ai/scripts/workflow/runner/plan/state.ts"]
      : ["src/artifact-state.ts"]);

  if (profile !== "review") {
    await mkdir(join(root, ".ai", "artifacts", "artifact-state", "events"), {
      recursive: true,
    });
  }

  await writeWorkflowArtifactFiles(root, "artifact-state", {
    "user-journey.md": "# User Journey: Artifact state\n\n## Document Format\n\nuser-journey@1\n\n## Goal\n\n* Validate fixtures.\n\n## Actors\n\n* Runner\n\n## Entry Points\n\n* Test\n\n## User Flows\n\n* Runner validates artifacts.\n\n## Mermaid Diagram\n\n```mermaid\nflowchart TD\n A-->B\n```\n\n## States\n\n* draft\n\n## Failures\n\n* invalid document\n\n## Acceptance Scenarios\n\n* valid bundle\n\n## Open Decisions\n\nNone\n",
  });

  if (profile === "review") {
    await writeWorkflowArtifactFiles(root, "artifact-state", {
      "implementation-map.md": "# Implementation Map\n\n## Document Format\n\nimplementation-map@1\n\n## Source Versions\n\nN/A: review fixture.\n",
      "state/context.md": "# Context\n",
      "state/file-ownership.json": {
        documentFormat: "file-ownership@1",
        planPath: ".ai/plans/artifact-state.md",
        owns: [],
        released: [],
        resolvedFiles: [],
        changedFiles,
        headSha: "abc123",
        updatedAt: "2026-07-01T00:00:00.000Z",
      },
      "state/workflow.json": {
        documentFormat: "workflow-state@1",
        planPath: ".ai/plans/artifact-state.md",
        workflowState: workflowStateForFixture(
          overrides.status ?? "review",
          overrides.nextAction ?? "review-plan",
        ),
        latest: {},
        history: [],
        unresolvedBlockers: [],
        updatedAt: "2026-07-01T00:00:00.000Z",
      },
      "state/files.json": {
        documentFormat: "files-state@1",
        created: overrides.created ?? [],
        modified: overrides.modified ?? ["src/artifact-state.ts"],
        deleted: overrides.deleted ?? [],
        changedFiles,
        released: [],
        headSha: "abc123",
      },
    });
    return;
  }

  if (profile === "plan-state") {
    await writeWorkflowArtifactFiles(root, "artifact-state", {
      "implementation-map.md": "# Implementation Map\n\n## Document Format\n\nimplementation-map@1\n\n## Source Versions\n\nN/A: workflow runner refactor.\n",
      "state/context.md": "# Context\n",
      "state/workflow.json": {
        documentFormat: "workflow-state@1",
        planPath: ".ai/plans/artifact-state.md",
        workflowState: overrides.workflowState ?? "review",
        latest: overrides.latest ?? {
          validation: {
            version: 1,
            result: "PASS",
            summary: "Focused plan checks passed.",
            evidence: ".ai/artifacts/artifact-state/events/validation-v1.md",
          },
          review: {
            version: 2,
            summary: "NEEDS FIX",
            decision: "active",
            evidence: ".ai/artifacts/artifact-state/events/review-v2.md",
            unresolvedFindings: ["Move state tests beside the plan module."],
          },
        },
        history: overrides.rawHistory ?? overrides.history ?? [
          ".ai/artifacts/artifact-state/events/validation-v1.md",
          ".ai/artifacts/artifact-state/events/review-v2.md",
        ],
        unresolvedBlockers: overrides.unresolvedBlockers ?? [
          "Move state tests beside the plan module.",
        ],
        updatedAt: "2026-07-19T00:00:00.000Z",
      },
      "state/file-ownership.json": {
        documentFormat: "file-ownership@1",
        planPath: ".ai/plans/artifact-state.md",
        owns: [".ai/scripts/workflow/runner/plan/state.ts"],
        released: [],
        resolvedFiles: [".ai/scripts/workflow/runner/plan/state.ts"],
        changedFiles: [".ai/scripts/workflow/runner/plan/state.ts"],
        headSha: "abc123",
        updatedAt: "2026-07-19T00:00:00.000Z",
      },
      "state/files.json": {
        documentFormat: "files-state@1",
        created: [],
        modified: [".ai/scripts/workflow/runner/plan/state.ts"],
        deleted: [],
        changedFiles: [".ai/scripts/workflow/runner/plan/state.ts"],
        released: [],
        headSha: "abc123",
      },
    });
    return;
  }

  await writeWorkflowArtifactFiles(root, "artifact-state", {
    "implementation-map.md": "# Implementation Map\n\n## Document Format\n\nimplementation-map@1\n\n## Source Versions\n\nN/A: internal workflow automation only.\n",
    "state/context.md": "# Context\n\n(empty)\n",
    "state/workflow.json": {
      documentFormat: "workflow-state@1",
      planPath: ".ai/plans/artifact-state.md",
      workflowState: workflowStateForFixture(
        overrides.status ?? "review",
        overrides.nextAction ?? "review-plan",
        { unknown: "pair" },
      ),
      latest: overrides.latest ?? {
        validation: {
          version: 2,
          result: overrides.latestValidationResult ?? "PASS",
          summary: "Required checks passed.",
          evidence: ".ai/artifacts/artifact-state/events/validation-v2.md",
        },
        review: {
          version: 3,
          summary: overrides.latestReviewSummary ?? "NEEDS FIX",
          decision: "active",
          evidence: ".ai/artifacts/artifact-state/events/review-v3.md",
          unresolvedFindings: ["Fix the artifact state reader."],
        },
      },
      history: overrides.rawHistory ?? overrides.history ?? [
        ".ai/artifacts/artifact-state/events/validation-v2.md",
        ".ai/artifacts/artifact-state/events/review-v3.md",
      ],
      unresolvedBlockers: overrides.activeBlockers ?? [
        "Blocker v1 | owner plan still active",
      ],
      updatedAt: "2026-07-01T00:00:00.000Z",
    },
    "state/file-ownership.json": {
      documentFormat: "file-ownership@1",
      planPath: ".ai/plans/artifact-state.md",
      owns: overrides.owns ?? changedFiles,
      released: [],
      resolvedFiles: overrides.owns ?? changedFiles,
      changedFiles,
      headSha: "abc123",
      updatedAt: "2026-07-01T00:00:00.000Z",
    },
    "state/files.json": {
      documentFormat: "files-state@1",
      created: overrides.created ?? [],
      modified: overrides.modified ?? ["src/artifact-state.ts"],
      deleted: overrides.deleted ?? [],
      changedFiles,
      released: [],
      headSha: "abc123",
    },
  });
};
