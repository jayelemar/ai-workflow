import { formatWorkflowElapsedTime } from "../terminal/formatters.ts";
import type { RunnerResult } from "../types.ts";
import { blockedReasonSummary } from "./outcomes.ts";
import { failure, success } from "./lifecycle.ts";

type WorkflowLogger = Pick<Console, "error" | "log">;

export const createWorkflowOutcomeReporter = ({
  logger,
  now,
  startedAt,
  workflowLogPath,
  tokenUsageLogPath,
  failureDebugPath,
}: {
  logger: WorkflowLogger;
  now: () => number;
  startedAt: number;
  workflowLogPath: () => string | undefined;
  tokenUsageLogPath: () => string | undefined;
  failureDebugPath: () => string | undefined;
}) => {
  const elapsedLine = () =>
    `- Worked for ${formatWorkflowElapsedTime(Math.max(0, now() - startedAt))}`;
  const logSpacedFailurePath = (label: string, value: string): true => {
    logger.error("");
    logger.error(`- ${label}:`);
    logger.error(`  ${value}`);
    return true;
  };

  const finishFailure = async (
    reason: string,
    completedIterations: number,
    exitCode = 1,
  ): Promise<RunnerResult> => {
    logger.error(`FAILED: ${reason}`);
    let loggedSpacedFailurePath = false;
    const logPath = workflowLogPath();
    const debugPath = failureDebugPath();
    const tokenPath = tokenUsageLogPath();
    if (logPath) {
      loggedSpacedFailurePath = logSpacedFailurePath("Workflow log", logPath);
    }
    if (debugPath) {
      loggedSpacedFailurePath = logSpacedFailurePath(
        "Failure details",
        debugPath,
      );
    }
    if (tokenPath) {
      loggedSpacedFailurePath = logSpacedFailurePath(
        "Token usage ledger",
        tokenPath,
      );
    }
    if (loggedSpacedFailurePath) {
      logger.error("");
    }
    logger.error(elapsedLine());
    return failure(reason, completedIterations, exitCode);
  };

  const finishSuccess = async (
    reason: string,
    completedIterations: number,
  ): Promise<RunnerResult> => {
    logger.log("SUCCESS");
    const logPath = workflowLogPath();
    const tokenPath = tokenUsageLogPath();
    if (logPath) {
      logger.log(`- Workflow log: ${logPath}`);
    }
    if (tokenPath) {
      logger.log(`- Token usage ledger: ${tokenPath}`);
    }
    logger.log(elapsedLine());
    return success(reason, completedIterations);
  };

  const finishBlocked = async (
    reason: string,
    detail: string,
    planPath: string,
    completedIterations: number,
  ): Promise<RunnerResult> => {
    const summary = blockedReasonSummary(detail);
    logger.error("BLOCKED");
    logger.error(`- Reason: ${summary.category}`);
    logger.error(`-> ${summary.detail}`);
    logger.error("-> Next: Run Codex CLI with this:");
    logger.error("`use unblock-plan.md`");
    logger.error("`evidence: ...`");
    logger.error(`\`${planPath}\``);
    logger.error("");
    const logPath = workflowLogPath();
    const tokenPath = tokenUsageLogPath();
    if (logPath) {
      logger.error(`- Workflow log: ${logPath}`);
    }
    if (tokenPath) {
      logger.error(`- Token usage ledger: ${tokenPath}`);
    }
    logger.error(elapsedLine());
    return failure(reason, completedIterations);
  };

  return { finishBlocked, finishFailure, finishSuccess };
};
