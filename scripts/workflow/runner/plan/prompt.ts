import path from 'node:path';
import { existsSync } from 'node:fs';
import { readFile } from 'node:fs/promises';
import {
  EXECUTE_PLAN_PROMPT_PATH,
  PLAN_VALIDATOR_PROMPT_PATH,
  REVIEW_CHANGES_PROMPT_PATH,
  SCOPE_CLEANUP_PROMPT_PATH,
  workflowStageContractForPrompt,
} from '../../contracts/stage.ts';
import { WORKFLOW_REVIEW_FULL_DIFF_BYTE_LIMIT } from '../../telemetry/token-warnings.ts';
import { type Failure, type ReviewScopeMetadata, type WorkflowTaskContext, type WorkflowTokenGuardrail } from '../types.ts';
import { uniquePaths } from './parser.ts';
import { activeContextPacket, workflowContextSnapshotRelativePath } from './context-snapshot.ts';

const rel = (...segments: string[]) => segments.join('/');

export const shellQuote = (value: string): string => {
  if (/^[A-Za-z0-9_./:@%+=,-]+$/.test(value)) return value;
  return `'${value.replace(/'/g, "'\\''")}'`;
};

export const shellPathspecs = (paths: string[]): string => paths.map(shellQuote).join(' ');

const taskArtifactsRelativeDir = (planName: string): string =>
  rel('.ai', 'artifacts', planName, 'tasks');
export const isReviewPrompt = (promptPath: string): boolean =>
  promptPath === REVIEW_CHANGES_PROMPT_PATH;

const WORKFLOW_TOKEN_GUARDED_PROMPT_PATHS = new Set([
  PLAN_VALIDATOR_PROMPT_PATH,
  EXECUTE_PLAN_PROMPT_PATH,
  REVIEW_CHANGES_PROMPT_PATH,
]);

export const isWorkflowTokenGuardedPrompt = (promptPath: string): boolean =>
  WORKFLOW_TOKEN_GUARDED_PROMPT_PATHS.has(promptPath);

export const readPrompt = async (
  rootDir: string,
  promptPath: string,
): Promise<{ ok: true; content: string } | Failure> => {
  const absolutePromptPath = path.join(rootDir, promptPath);
  if (!existsSync(absolutePromptPath)) {
    return { ok: false, reason: `prompt file does not exist: ${promptPath}` };
  }
  try {
    return { ok: true, content: await readFile(absolutePromptPath, "utf8") };
  } catch (error) {
    return {
      ok: false,
      reason: `prompt file cannot be read: ${promptPath}: ${String(error)}`,
    };
  }
};

export const generateWorkflowPrompt = ({
  promptPath,
  planPath,
  promptContent,
  planContent = "",
  contextSnapshotPath = workflowContextSnapshotRelativePath(
    path.posix.basename(planPath, ".md"),
  ),
  reviewStagingPaths = [],
  reviewPrimaryPaths,
  reviewScopeMetadata,
  commitSummaryPaths = [],
  unblockNote,
  workflowTokenGuardrail,
  taskContext,
  taskSavepointAggregateSummary = false,
}: {
  promptPath: string;
  planPath: string;
  promptContent: string;
  planContent?: string;
  contextSnapshotPath?: string;
  reviewStagingPaths?: string[];
  reviewPrimaryPaths?: string[];
  reviewScopeMetadata?: ReviewScopeMetadata;
  commitSummaryPaths?: string[];
  unblockNote?: string;
  workflowTokenGuardrail?: WorkflowTokenGuardrail;
  taskContext?: WorkflowTaskContext;
  taskSavepointAggregateSummary?: boolean;
}): string => {
  const actionLabel = workflowStageContractForPrompt(promptPath)?.humanLabel;
  if (!actionLabel) {
    throw new Error(`unknown workflow prompt path: ${promptPath}`);
  }

  const reviewAllPaths = uniquePaths(reviewStagingPaths);
  const resolvedReviewPrimaryPaths = uniquePaths(
    reviewPrimaryPaths ?? reviewScopeMetadata?.reviewPrimaryPaths ?? [],
  ).filter((primaryPath) => reviewAllPaths.includes(primaryPath));
  const reviewScopeLines =
    reviewScopeMetadata && isReviewPrompt(promptPath)
      ? [
          `Narrow pass: ${reviewScopeMetadata.narrowPass}`,
          `Review all path count: ${reviewScopeMetadata.reviewAllPaths.length}`,
          `Review primary path count: ${reviewScopeMetadata.reviewPrimaryPaths.length}`,
          `Full diff byte limit: ${WORKFLOW_REVIEW_FULL_DIFF_BYTE_LIMIT}`,
          `Full diff bytes: ${reviewScopeMetadata.diffBytes ?? "unknown"}`,
          reviewScopeMetadata.autoNarrowReason
            ? `Auto-narrow reason: ${reviewScopeMetadata.autoNarrowReason}`
            : undefined,
        ]
          .filter(Boolean)
          .join("\n")
      : "";
  const reviewPrimaryBlock =
    resolvedReviewPrimaryPaths.length > 0
      ? `
Use only these narrowed primary paths for full diff reads:
${resolvedReviewPrimaryPaths.map((stagingPath) => `- ${stagingPath}`).join("\n")}

Run this full diff command only for the narrowed primary paths:
git diff --staged -- ${shellPathspecs(resolvedReviewPrimaryPaths)}
Stop reading full diff output after ${WORKFLOW_REVIEW_FULL_DIFF_BYTE_LIMIT} bytes. Use name-status/stat for non-primary paths unless exact evidence is required for a finding.
`
      : `
No narrowed primary full-diff paths for this pass.
Do not run full \`git diff --staged\` across all review paths. Use name-status/stat summaries first and request another narrowed pass by returning \`STOP\` with exact suspicious paths if full diff evidence is required.
`;
  const reviewSummaryOnlyBlock =
    reviewScopeMetadata?.summaryOnlyPaths &&
    reviewScopeMetadata.summaryOnlyPaths.length > 0
      ? `
These generated artifacts are summary-only for this review pass:
${reviewScopeMetadata.summaryOnlyPaths
  .map((stagingPath) => `- ${stagingPath}`)
  .join("\n")}

Verify them through the all-path name-status/stat output and the source migration or schema changes that generated them. Do not spend the primary full-diff budget on generated output unless a concrete type/API mismatch requires exact evidence.
`
      : "";
  const reviewBoundary =
    isReviewPrompt(promptPath) && reviewAllPaths.length > 0
      ? `
Plan-scoped diff boundary:
Use only these plan-owned staged paths:
${reviewAllPaths.map((stagingPath) => `- ${stagingPath}`).join("\n")}

${reviewScopeLines ? `Review scope metadata:\n${reviewScopeLines}\n` : ""}

Run these exact summary commands for all review paths:
git diff --staged --name-status -- ${shellPathspecs(reviewAllPaths)}
git diff --staged --stat -- ${shellPathspecs(reviewAllPaths)}

${reviewPrimaryBlock}

${reviewSummaryOnlyBlock}

Ignore staged files outside this path list. Do not run bare \`git diff --staged\` as the primary review source.
The runner may auto-unstage clearly unrelated staged hunks from these paths before review. Review the remaining path-scoped staged diff only.
Do not unstage or alter unrelated files.
If the path-scoped staged diff is empty, output \`STOP\` with reason \`no staged changes to review\`.
If unrelated changes remain after runner cleanup, output \`STOP\` with reason \`non plan-scoped changes detected\`.
`
      : "";
  const commitBoundary =
    promptPath === rel(".ai", "prompts", "commit-summary.md") &&
    commitSummaryPaths.length > 0 &&
    !taskSavepointAggregateSummary
      ? `
Plan-scoped commit boundary:
Use only these non-ignored plan-owned implementation paths:
${commitSummaryPaths.map((stagingPath) => `- ${stagingPath}`).join("\n")}

Run these exact commands before generating the commit message and summary:
git status --short -- ${shellPathspecs(commitSummaryPaths)}
git diff --name-status -- ${shellPathspecs(commitSummaryPaths)}
git add --all -- ${shellPathspecs(commitSummaryPaths)}
pnpm lint-staged
git add --all -- ${shellPathspecs(commitSummaryPaths)}
git diff --staged --name-status -- ${shellPathspecs(commitSummaryPaths)}
git diff --staged --name-status
SKIP_LINT_STAGED=1 git commit --cleanup=verbatim -F - <<'EOF'
<generated subject>

<generated body>
EOF
git status --short -- ${shellPathspecs(commitSummaryPaths)}

Do not stage .ai files. Do not stage unrelated paths as commit candidates.
Before committing, the full staged path list must contain only paths from the plan-owned implementation list above.
If any staged path falls outside this path list, output \`STOP\` with reason \`non plan-scoped staged changes detected\`.
If no files are staged by the path-scoped git add, output \`STOP\` with reason \`no plan-related files to stage\`.
Run \`pnpm lint-staged\` once and wait or poll that same command until it exits; do not start a second lint or commit command while it is still running. After it succeeds and the same paths are restaged, \`SKIP_LINT_STAGED=1\` on the final commit skips only the duplicate formatter/linter pass; the pre-commit hook still enforces branch, ignored-file, environment-file, and secret checks. Do not use \`HUSKY=0\` or \`--no-verify\`.
After the commit, the path-scoped status must be clean. If the only remaining changes are mechanical formatter or linter output from this commit path, repeat the scoped add/lint-staged/restage sequence, amend the just-created commit with \`SKIP_LINT_STAGED=1 git commit --amend --no-edit\`, then rerun the path-scoped status check. Do not amend product behavior that was edited after review; output \`STOP\` with reason \`plan-owned changes remain after commit-summary\` instead.
`
      : "";
  const taskSavepointBoundary = taskContext
    ? `
Task savepoint current task:
- Task ID: ${taskContext.task.id}
- Task Words: ${taskContext.task.words}
- Task Name: ${taskContext.task.name}
- Task Stage: ${taskContext.stage}
- Task Artifact: ${taskContext.artifactPath}

Task savepoint rules:
- Work only on the current task above.
- Do not start another \`[task:...]\` item in the same run.
- If the current task changed a shared contract, service invariant, schema, payload shape, generated type, or backend enforcement rule, fix the smallest compatibility path needed to keep existing later-task call sites from submitting invalid data.
- Do not output \`STOP\` solely because that minimal compatibility fix touches a file named in a later \`[task:...]\` item.
- If review feedback identifies a missing backend RPC, migration, generated database type, or database regression test required to uphold the current task's access/security invariant, treat it as that smallest compatibility repair.
- If such a file is not currently listed in the plan file inventory, add the exact file to the current plan's ownership/inventory artifacts and continue.
- Do not output \`STOP\` solely because the required minimal backend contract repair touches a migration, generated database contract file, or database test outside the original current-task file list.
- Keep \`.ai/\` artifacts out of git commits.
- The runner owns .ai/artifacts/<plan-name>/execution-summary.md; do not edit it directly.
- If this stage cannot complete for the current task, output \`STOP\` and keep the same current task active for remediation.
`
    : "";
  const taskAggregateBoundary =
    promptPath === rel(".ai", "prompts", "commit-summary.md") &&
    taskSavepointAggregateSummary
      ? `
Task savepoint aggregate summary:
All named plan tasks already have task artifacts under ${taskArtifactsRelativeDir(
          path.posix.basename(planPath, ".md"),
        )}.
The runner refreshes .ai/artifacts/<plan-name>/execution-summary.md from those task artifacts after this stage.
Do not create a git commit in this aggregate summary stage.
Verify no remaining plan-owned changes exist, then summarize the task commits and artifacts.
`
      : "";
  const unblockEvidence =
    promptPath === rel(".ai", "prompts", "unblock-plan.md")
      ? `
Unblock evidence note:
${unblockNote?.trim() ? unblockNote.trim() : "(none provided)"}
`
      : "";
  const workflowGuardrail =
    isWorkflowTokenGuardedPrompt(promptPath) && workflowTokenGuardrail
      ? `
Workflow token guardrail:
The previous stage exceeded token thresholds.
- Use ${contextSnapshotPath} as the first current-state source for this run.
- Open exact plan sections or exact event artifacts only when needed for the current fix, execution, or review.
- Do not broadly load \`.ai/artifacts/**\`.
- Do not load full historical plan sections unless the current fix, execution, or review needs exact detail.
- This guardrail does not override required spec reads, path-scoped staged diff reads, latest validation evidence, workflow state reads, or other correctness-critical prompt inputs.
`
      : "";
  const terminalOutputRequirement =
    promptPath === EXECUTE_PLAN_PROMPT_PATH
      ? `
End-of-stage output requirement:
- Before completing this execute stage, emit the controlling prompt's \`## Output (MANDATORY)\` response as the final agent message.
- Include the \`**Plan**\`, \`**Summary**\`, \`**Key Details**\`, \`**Validation**\`, and \`**Next**\` sections with this stage's actual results.
- This terminal summary is required even when tool events already reported edited files or validation commands.
- Do not end the turn with only a tool-style change list, an empty response, or a bare completion acknowledgement.
`
      : "";
  const promptIsReview = isReviewPrompt(promptPath);
  const reviewPolicy = promptIsReview
    ? `
Harness review policy:
- Use the harness review prompt as the only review system for this stage.
- Do not spawn subagents.
- Do not load plugin skills for review.
- Do not run a separate spec-review or code-quality review system.`
    : "";
  void promptContent;

  return `Use ${promptPath}

load: .ai/instructions/shared/reasoning-quality.md
load: .ai/instructions/shared/debugging.md
Apply native shared reasoning and debugging guidance for assumption validation, edge-case checks, root-cause analysis, and scope discipline.
${reviewPolicy}

${activeContextPacket({ promptPath, planPath, planContent, contextSnapshotPath })}
${workflowGuardrail}
${terminalOutputRequirement}

${taskSavepointBoundary}${taskAggregateBoundary}

${actionLabel}:
${planPath}${reviewBoundary}${commitBoundary}${unblockEvidence}

Workflow prompt controller:
- The controlling workflow prompt file is already warm-loaded above.
- Follow ${promptPath} exactly.
- Do not restate or duplicate the full prompt text in this stage response.
`;
};

export const generateScopeCleanupPrompt = ({
  promptContent,
  planPath,
  contextSnapshotPath,
  specPaths,
  paths,
  diff,
  mode,
  previousNonPlanScopedStopEvidence,
}: {
  promptContent: string;
  planPath: string;
  contextSnapshotPath: string;
  specPaths: string[];
  paths: string[];
  diff: string;
  mode: "review" | "commit-summary";
  previousNonPlanScopedStopEvidence?: string;
}): string => `Use ${SCOPE_CLEANUP_PROMPT_PATH} to clean staged scope for ${mode}.

Support prompt content:
${promptContent.trim()}

Rules for this run:
- Never output STOP.
- Output exactly one JSON object and nothing else.
- Use {"action":"keep"} when every staged hunk in the diff is clearly related to the current plan/spec.
- Use {"action":"unstage","patch":"<exact unified diff>"} when any staged hunk is not clearly related to the current plan/spec.
- If a hunk is ambiguous or not provably owned by the plan, treat it as unrelated and unstage it.
- When returning a patch, copy the unrelated hunks exactly from the staged diff, including diff headers and @@ headers, with newline escapes in JSON.

Plan path: ${planPath}

Snapshot path: ${contextSnapshotPath}

Spec paths:
${specPaths.length > 0 ? specPaths.map((specPath) => `- ${specPath}`).join("\n") : "(none)"}

Plan-owned staged paths:
${paths.map((stagingPath) => `- ${stagingPath}`).join("\n")}

${previousNonPlanScopedStopEvidence ? `Previous non-plan-scoped review STOP evidence:\n${previousNonPlanScopedStopEvidence}\n\nUse this reviewer evidence to identify hunks that must be unstaged before review runs again.\n\n` : ""}\
Path-scoped staged diff:
${diff}
`;
