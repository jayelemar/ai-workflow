import { WORKFLOW_RUNNER_CODEX_PROFILE } from "../../../config/codex.ts";
import { boundedInlineExcerpt } from "../../types.ts";
import { codexAgentMessageTexts } from "./output-analysis.ts";

const workflowRunnerCodexExecLabel = (codexProfile: string): string => `${codexProfile} exec`;

const normalizeStopDirectiveLine = (line: string): string => {
  const trimmed = line.trim().replace(/ΓÇö/g, "—");
  const inlineCodeMatch = /^`([^`]+)`(.*)$/.exec(trimmed);
  if (!inlineCodeMatch) return trimmed;
  const [, inlineCodeText, suffix] = inlineCodeMatch;
  return `${inlineCodeText.trim()}${suffix}`.trim();
};

const containsStopDirective = (text: string): boolean => text.split(/\r?\n/).some((line) => {
  const trimmed = normalizeStopDirectiveLine(line);
  return trimmed === "STOP" || trimmed.startsWith("STOP:") || trimmed.startsWith("STOP (") || trimmed.startsWith("STOP `") || trimmed.startsWith("STOP -") || trimmed.startsWith("STOP –") || trimmed.startsWith("STOP —");
});

const stripStopDirectivePrefix = (line: string): string | undefined => {
  const trimmed = normalizeStopDirectiveLine(line);
  if (!containsStopDirective(trimmed)) return undefined;
  if (trimmed === "STOP") return undefined;
  let excerpt = trimmed.replace(/^STOP\b/, "").trim().replace(/^[:\-–—\s]+/, "").trim();
  if (excerpt.startsWith("(") && excerpt.endsWith(")")) excerpt = excerpt.slice(1, -1).trim();
  if (excerpt.startsWith("`") && excerpt.endsWith("`")) excerpt = excerpt.slice(1, -1).trim();
  if (excerpt.startsWith("`") && excerpt.endsWith("`)")) excerpt = excerpt.slice(1, -2).trim();
  return boundedInlineExcerpt(excerpt);
};

const plainStopExcerpt = (text: string): string | undefined => {
  const stopLine = text.split(/\r?\n/).find((line) => line.includes("STOP"));
  return stopLine ? stripStopDirectivePrefix(stopLine) ?? boundedInlineExcerpt(stopLine) : undefined;
};

const formatStopReason = (excerpt?: string, codexExecLabel = workflowRunnerCodexExecLabel(WORKFLOW_RUNNER_CODEX_PROFILE)): string =>
  `${codexExecLabel} output contained STOP${excerpt ? `: ${excerpt}` : ""}`;

export const codexOutputStopReason = (
  stdout: string,
  stderr: string,
  codexExecLabel = workflowRunnerCodexExecLabel(WORKFLOW_RUNNER_CODEX_PROFILE),
): string | undefined => {
  if (stderr.includes("STOP")) return formatStopReason(plainStopExcerpt(stderr), codexExecLabel);
  const agentMessages = codexAgentMessageTexts(stdout);
  if (agentMessages.length > 0) {
    for (const message of agentMessages) {
      if (containsStopDirective(message)) {
        const excerpt = message.split(/\r?\n/).map(stripStopDirectivePrefix).find((value): value is string => typeof value === "string");
        return formatStopReason(excerpt, codexExecLabel);
      }
    }
    return undefined;
  }
  const sawJsonLine = stdout.split(/\r?\n/).some((line) => {
    const trimmed = line.trim();
    if (!trimmed) return false;
    try {
      JSON.parse(trimmed);
      return true;
    } catch {
      return false;
    }
  });
  if (sawJsonLine) return undefined;
  return stdout.includes("STOP") ? formatStopReason(plainStopExcerpt(stdout), codexExecLabel) : undefined;
};

export const codexOutputContainsStop = (stdout: string, stderr: string): boolean =>
  codexOutputStopReason(stdout, stderr) !== undefined;

export const isReviewNeedsFixStopReason = (stopReason: string | undefined): boolean =>
  /output contained STOP:\s*NEEDS FIX\.?$/i.test(stopReason ?? "");
