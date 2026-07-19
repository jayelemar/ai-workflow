import path from "node:path";
import { fileURLToPath } from "node:url";

export {
  parseRunnerCliArgs,
  normalizePlanArgument,
} from "./runner/cli.ts";
export { workflowFileLockPath } from "./ownership/file-locks.ts";
export {
  codexWorkEnvironment,
  processStdioForInput,
  writeProcessInput,
} from "./runner/process.ts";
export {
  codexOutputContainsStop,
  codexOutputStopReason,
  createCodexLiveOutputFormatter,
  formatCodexJsonlEventForTerminal,
} from "./runner/terminal/codex-events.ts";
export {
  WORKFLOW_WAIT_NOTICE_INTERVAL_MS,
  createWorkflowWaitNotice,
  formatCommitProgressLine,
  formatWorkflowElapsedTime,
  formatWorkflowOwnershipResetHint,
  formatWorkflowProgressLine,
  formatWorkflowWaitLine,
  supportsWorkflowAnsiColor,
} from "./runner/terminal/formatters.ts";
export type { ProcessRunner } from "./runner/types.ts";
export {
  parsePlanTasks,
  validateTaskCommitBoundaries,
} from "./runner/plan/parser.ts";
export {
  generateWorkflowContextSnapshot,
  workflowContextSnapshotRelativePath,
} from "./runner/plan/context-snapshot.ts";
export {
  generateScopeCleanupPrompt,
  generateWorkflowPrompt,
} from "./runner/plan/prompt.ts";
export { parsePlan } from "./runner/plan/state.ts";
export { estimateBossSummaryPercent } from "./runner/tasks/summaries.ts";
export { parseCommitSummaryPathsForPlan } from "./runner/review/commit.ts";
export {
  parseReviewStagingPaths,
  runReviewStagingForPaths,
  stagedStatusHasMixedReviewPath,
} from "./runner/review/staging.ts";
export {
  buildReviewScopeMetadata,
  runScopeCleanupForPathBatches,
  runScopeCleanupForPaths,
  selectReviewPrimaryPaths,
} from "./runner/review/scope.ts";
export {
  parseContextUsage,
  parseCodexTokenUsage,
} from "./telemetry/token-usage.ts";
export { analyzeTokenUsageLedger } from "./telemetry/token-ledger.ts";
export {
  codexExecutionConfig,
  WORKFLOW_RUNNER_CODEX_FALLBACK_MODEL,
  WORKFLOW_RUNNER_CODEX_PROFILE,
} from "./config/codex.ts";
export { runWorkflowRunner } from "./runner/runtime.ts";

import { runWorkflowRunner } from "./runner/runtime.ts";

const isMain =
  process.argv[1] &&
  fileURLToPath(import.meta.url) === path.resolve(process.argv[1]);

if (isMain) {
  const abortController = new AbortController();
  let requestedSignal: NodeJS.Signals | undefined;
  let interruptCount = 0;
  const handleInterrupt = (signal: NodeJS.Signals) => {
    interruptCount += 1;
    requestedSignal = signal;
    if (interruptCount === 1) {
      abortController.abort(signal);
      return;
    }
    process.exit(signal === "SIGINT" ? 130 : 143);
  };

  process.on("SIGINT", handleInterrupt);
  process.on("SIGTERM", handleInterrupt);
  void runWorkflowRunner({
    argv: process.argv.slice(2),
    abortSignal: abortController.signal,
    interruptSignal: () => requestedSignal,
  })
    .then((result) => {
      process.exitCode = result.exitCode;
    })
    .finally(() => {
      process.off("SIGINT", handleInterrupt);
      process.off("SIGTERM", handleInterrupt);
    });
}
