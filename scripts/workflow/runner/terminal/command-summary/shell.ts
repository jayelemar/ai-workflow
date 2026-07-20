import type { CommandTerminalSummary, FailedTestCommandSummary } from "../../types.ts";
import {
  summarizeGitDiffCommand,
  summarizeStagedGitShowPipeline,
} from "./git.ts";
import {
  summarizeFindCommand,
  summarizeReadCommand,
  summarizeReadCommandChain,
  summarizeSedCommand,
} from "./read.ts";
import {
  summarizePlanSectionReadCommand,
  summarizeRipgrepCommand,
} from "./search.ts";
import {
  firstCommandSegment,
  shellLikeTokens,
  unwrapShellCommand,
} from "./shell-utils.ts";
import {
  summarizeFailedTestCommand as summarizeFailedTestTokens,
  summarizeFilteredPnpmCommand,
  summarizeInlineTsxCommand,
  summarizeLineCountCommand,
} from "./workflow-commands.ts";
import {
  summarizeJestRunCommand,
  summarizeVitestRunCommand,
} from "./test-runs.ts";

export const commandTerminalSummary = (
  command: string,
): CommandTerminalSummary => {
  const readableCommand = unwrapShellCommand(command);
  const fullTokens = shellLikeTokens(readableCommand);
  const readChainSummary = summarizeReadCommandChain(fullTokens);
  if (readChainSummary) {
    return readChainSummary;
  }

  const stagedGitShowSummary = summarizeStagedGitShowPipeline(fullTokens);
  if (stagedGitShowSummary) {
    return stagedGitShowSummary;
  }

  const tokens = firstCommandSegment(fullTokens);
  const executable = tokens[0];
  const summaries = [
    summarizeInlineTsxCommand(tokens),
    summarizeFilteredPnpmCommand(tokens),
    summarizeVitestRunCommand(tokens),
    summarizeJestRunCommand(tokens),
    summarizeLineCountCommand(tokens),
    summarizeGitDiffCommand(tokens),
    summarizePlanSectionReadCommand(tokens),
  ];
  const summary = summaries.find(Boolean);
  if (summary) {
    return summary;
  }

  if (executable === "sed") {
    return (
      summarizeSedCommand(tokens) ?? {
        group: "Ran",
        description: readableCommand,
      }
    );
  }
  if (executable === "cat" || executable === "nl") {
    return (
      summarizeReadCommand(tokens) ?? {
        group: "Ran",
        description: readableCommand,
      }
    );
  }
  if (executable === "rg") {
    return summarizeRipgrepCommand(tokens);
  }
  if (executable === "find") {
    return summarizeFindCommand(tokens);
  }
  return { group: "Ran", description: readableCommand };
};

export const summarizeFailedTestCommand = (
  command: string,
): FailedTestCommandSummary | null =>
  summarizeFailedTestTokens(
    firstCommandSegment(shellLikeTokens(unwrapShellCommand(command))),
  );
