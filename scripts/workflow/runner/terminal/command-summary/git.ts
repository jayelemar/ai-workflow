import type { CommandTerminalSummary } from "../../types.ts";

const TERMINAL_FILE_DETAIL_LIMIT = 3;

const rgOptionsWithSkippedValue = new Set([
  "-A",
  "-B",
  "-C",
  "-g",
  "-m",
  "-t",
  "--after-context",
  "--before-context",
  "--context",
  "--glob",
  "--iglob",
  "--max-count",
  "--type",
]);

const splitAlternationSearchTerms = (pattern: string): string[] | null => {
  if (!pattern.includes("|")) {
    return null;
  }

  const terms = pattern
    .split("|")
    .map((term) =>
      term
        .trim()
        .replace(/^'+/, "")
        .replace(/^\^/, "")
        .replace(/^\(+/, "")
        .replace(/\)+$/, "")
        .trim(),
    )
    .filter(Boolean);
  return terms.length > 1 &&
    terms.every((term) =>
      /^[#A-Za-z0-9_$][#A-Za-z0-9_$\s.,/:=*\-]*$/.test(term),
    )
    ? terms
    : null;
};

const ripgrepPatternFromTokens = (tokens: string[]): string | undefined => {
  const args = tokens.slice(1);
  for (let index = 0; index < args.length; index += 1) {
    const token = args[index] ?? "";
    if (token === "--") {
      continue;
    }
    if (token === "-e" || token === "--regexp") {
      return args[index + 1];
    }
    if (rgOptionsWithSkippedValue.has(token)) {
      index += 1;
      continue;
    }
    if (!token.startsWith("-")) {
      return token;
    }
  }
  return undefined;
};

const formatStagedSearchTerms = (terms: string[]): string => {
  const visibleTerms = terms.slice(0, TERMINAL_FILE_DETAIL_LIMIT);
  const remainingCount = terms.length - visibleTerms.length;
  return [
    "terms:",
    ...visibleTerms.map((term) => `- ${term}`),
    ...(remainingCount > 0 ? [`  +${remainingCount} more`] : []),
  ].join("\n");
};

export const summarizeGitDiffCommand = (
  tokens: string[],
): CommandTerminalSummary | null => {
  if (tokens[0] !== "git" || tokens[1] !== "diff") {
    return null;
  }

  const separatorIndex = tokens.indexOf("--");
  if (separatorIndex < 0) {
    return null;
  }

  const paths = tokens
    .slice(separatorIndex + 1)
    .filter((token) => token.length > 0 && token !== "--");

  if (paths.length === 0) {
    return null;
  }

  const isSummaryDiff =
    tokens.includes("--name-status") ||
    tokens.includes("--name-only") ||
    tokens.includes("--stat");
  return {
    group: "Ran",
    description: tokens.includes("--staged")
      ? isSummaryDiff
        ? "staged diff summary"
        : "staged diff"
      : isSummaryDiff
        ? "git diff summary"
        : "git diff",
    files: paths,
  };
};

export const summarizeStagedGitShowPipeline = (
  tokens: string[],
): CommandTerminalSummary | null => {
  if (tokens[0] !== "git" || tokens[1] !== "show") {
    return null;
  }
  const stagedPathToken = tokens[2] ?? "";
  if (!stagedPathToken.startsWith(":") || stagedPathToken.length === 1) {
    return null;
  }

  const stagedPath = stagedPathToken.slice(1);
  const rgIndex = tokens.indexOf("rg");
  if (rgIndex >= 0) {
    const pattern = ripgrepPatternFromTokens(tokens.slice(rgIndex));
    const terms = pattern ? splitAlternationSearchTerms(pattern) : null;
    const termsLine = terms ? `\n${formatStagedSearchTerms(terms)}` : "";
    return {
      group: "Ran",
      description: `git show search\n- ${stagedPath}${termsLine}`,
    };
  }

  const sedIndex = tokens.indexOf("sed");
  if (sedIndex >= 0) {
    const rangeToken = tokens
      .slice(sedIndex + 1)
      .find((token) => /^\d+,\d+p$/.test(token));
    const rangeMatch = rangeToken?.match(/^(\d+),(\d+)p$/);
    return {
      group: "Ran",
      description: `git show\n- ${
        rangeMatch
          ? `${stagedPath}:${rangeMatch[1]}-${rangeMatch[2]}`
          : stagedPath
      }`,
    };
  }

  return null;
};
