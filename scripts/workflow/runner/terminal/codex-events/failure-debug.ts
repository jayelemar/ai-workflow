import type {
  FailureMetadataLogFields,
  ReviewCleanupProcess,
  ReviewStagingProcess,
  WorkflowFailureDebugRecord,
} from "../../types.ts";
import { boundedInlineExcerpt } from "../../types.ts";
import { failureDebugOutputSummary } from "../formatters.ts";
import { codexRecentCommandRecords, commandRecordFromProcessCapture } from "./command-records.ts";
import { codexAgentMessageTexts, stdoutContainsJsonEvents } from "./output-analysis.ts";

const failureStopExcerpt = (stopReason: string): string | undefined => {
  const match = /^(?<label>[A-Za-z0-9][A-Za-z0-9_-]* exec) output contained STOP:?\s*/.exec(stopReason);
  return match ? boundedInlineExcerpt(stopReason.slice(match[0].length).trim() || "STOP") : undefined;
};

export const createWorkflowFailureDebugRecord = ({ timestamp, iteration, planPath, workflowState, promptPath, result, exitCode, stopReason, failureMetadata, stdout, stderr, staging, cleanup }: {
  timestamp: string;
  iteration: number;
  planPath: string;
  workflowState: import("../../contracts/stage.ts").WorkflowState;
  promptPath: string;
  result: string;
  exitCode?: number;
  stopReason: string;
  failureMetadata: FailureMetadataLogFields;
  stdout: string;
  stderr: string;
  staging?: ReviewStagingProcess;
  cleanup?: ReviewCleanupProcess;
}): WorkflowFailureDebugRecord => {
  const stdoutSummary = !stdoutContainsJsonEvents(stdout) ? failureDebugOutputSummary(stdout) : undefined;
  const stderrSummary = failureDebugOutputSummary(stderr);
  const agentMessages = codexAgentMessageTexts(stdout);
  const recentCommands = [
    ...codexRecentCommandRecords(stdout),
    ...(staging ? [commandRecordFromProcessCapture("review-staging", staging.command, staging.exitCode ?? "unknown", staging.stdout, staging.stderr)] : []),
    ...(cleanup ? [commandRecordFromProcessCapture("review-cleanup", cleanup.command, cleanup.exitCode ?? "unknown", cleanup.stdout, cleanup.stderr)] : []),
  ];
  return {
    timestamp, iteration, planPath, workflowState, promptPath, result,
    exitCode: exitCode ?? null, stopReason,
    failureKind: failureMetadata.failureKind, failureReason: failureMetadata.failureReason,
    stdoutByteCount: Buffer.byteLength(stdout, "utf8"), stdoutLineCount: stdout ? stdout.split(/\r?\n/).length : 0,
    stderrByteCount: Buffer.byteLength(stderr, "utf8"), stderrLineCount: stderr ? stderr.split(/\r?\n/).length : 0,
    stdoutExcerpt: stdoutSummary?.excerpt, stdoutTruncated: stdoutSummary?.truncated,
    stderrExcerpt: stderrSummary?.excerpt, stderrTruncated: stderrSummary?.truncated,
    stopExcerpt: failureStopExcerpt(stopReason),
    lastAgentMessageExcerpt: agentMessages.length > 0 ? boundedInlineExcerpt(agentMessages.at(-1) ?? "") : undefined,
    recentCommands,
  };
};
