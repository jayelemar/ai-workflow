import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
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

export const createThinPlanV2ArtifactWriter = (
  profile: ThinPlanArtifactProfile,
) => async (
  root: string,
  overrides: ThinPlanArtifactOverrides = {},
): Promise<void> => {
  const changedFiles = overrides.changedFiles ?? overrides.modified ??
    (profile === "plan-state"
      ? [".ai/scripts/workflow/runner/plan/state.ts"]
      : ["src/artifact-state.ts"]);

  if (profile !== "review") {
    await mkdir(join(root, ".ai", "artifacts", "artifact-state", "events"), {
      recursive: true,
    });
  }

  if (profile === "review") {
    await writeWorkflowArtifactFiles(root, "artifact-state", {
      "state/workflow.json": {
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
      "implementation-map.md": "# Implementation Map\n\nN/A: workflow runner refactor.\n",
      "state/context.md": "# Context\n",
      "state/workflow.json": {
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
        planPath: ".ai/plans/artifact-state.md",
        owns: [".ai/scripts/workflow/runner/plan/state.ts"],
        released: [],
        resolvedFiles: [".ai/scripts/workflow/runner/plan/state.ts"],
        changedFiles: [".ai/scripts/workflow/runner/plan/state.ts"],
        headSha: "abc123",
        updatedAt: "2026-07-19T00:00:00.000Z",
      },
      "state/files.json": {
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
    "implementation-map.md": "# Implementation Map\n\nN/A: internal workflow automation only.\n",
    "state/context.md": "# Context\n\n(empty)\n",
    "state/workflow.json": {
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
      planPath: ".ai/plans/artifact-state.md",
      owns: overrides.owns ?? changedFiles,
      released: [],
      resolvedFiles: overrides.owns ?? changedFiles,
      changedFiles,
      headSha: "abc123",
      updatedAt: "2026-07-01T00:00:00.000Z",
    },
    "state/files.json": {
      created: overrides.created ?? [],
      modified: overrides.modified ?? ["src/artifact-state.ts"],
      deleted: overrides.deleted ?? [],
      changedFiles,
      released: [],
      headSha: "abc123",
    },
  });
};
