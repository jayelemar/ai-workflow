import type { CommandTerminalSummary } from "../../types.ts";

const isSedExpression = (token: string): boolean =>
  /^[0-9,$]+(?:,[0-9,$]+)?[a-z]?$/.test(token);

const nonOptionArgs = (tokens: string[]): string[] =>
  tokens.filter((token) => token !== "--" && !token.startsWith("-"));

export const summarizeSedCommand = (
  tokens: string[],
): CommandTerminalSummary | null => {
  const args = nonOptionArgs(tokens.slice(1)).filter(
    (token) => !isSedExpression(token),
  );
  return args.length > 0
    ? { group: "Explored", description: `Read ${args.join(" ")}` }
    : null;
};

export const summarizeReadCommand = (
  tokens: string[],
): CommandTerminalSummary | null => {
  const args = nonOptionArgs(tokens.slice(1));
  return args.length > 0
    ? { group: "Explored", description: `Read ${args.join(" ")}` }
    : null;
};

const splitShellCommandChain = (tokens: string[]): string[][] => {
  const segments: string[][] = [];
  let currentSegment: string[] = [];
  for (const token of tokens) {
    if (token === "&&" || token === ";") {
      if (currentSegment.length > 0) {
        segments.push(currentSegment);
        currentSegment = [];
      }
      continue;
    }
    if (token === "|" || token === "||") {
      return [];
    }
    currentSegment.push(token);
  }
  if (currentSegment.length > 0) {
    segments.push(currentSegment);
  }
  return segments;
};

export const summarizeReadCommandChain = (
  tokens: string[],
): CommandTerminalSummary | null => {
  if (!tokens.includes("&&") && !tokens.includes(";")) {
    return null;
  }

  const readLines: string[] = [];
  for (const segment of splitShellCommandChain(tokens)) {
    const executable = segment[0];
    const summary =
      executable === "sed"
        ? summarizeSedCommand(segment)
        : executable === "cat" || executable === "nl"
          ? summarizeReadCommand(segment)
          : null;
    if (!summary) {
      return null;
    }
    readLines.push(summary.description);
  }

  return readLines.length > 1
    ? { group: "Explored", description: readLines.join("\n") }
    : null;
};

export const summarizeFindCommand = (
  tokens: string[],
): CommandTerminalSummary => {
  const pathToken =
    tokens.slice(1).find((token) => token !== "--" && !token.startsWith("-")) ??
    ".";
  return { group: "Explored", description: `Explore ${pathToken}` };
};
