import path from "node:path";
import type { CommandTerminalSummary, FailedTestCommandSummary } from "../types.ts";

const TERMINAL_FILE_DETAIL_LIMIT = 3;

const normalizeCommandWhitespace = (value: string): string =>
  value.replace(/\s+/g, " ").trim();

const unquoteShellPayload = (payload: string): string => {
  const trimmed = payload.trim();
  if (trimmed.length < 2) {
    return trimmed;
  }
  if (trimmed.startsWith('"') && trimmed.endsWith('"')) {
    return trimmed.slice(1, -1).replace(/\\(["\\$`])/g, "$1");
  }
  if (trimmed.startsWith("'") && trimmed.endsWith("'")) {
    return trimmed.slice(1, -1).replace(/'\\''/g, "'");
  }
  return trimmed;
};

const unwrapShellCommand = (command: string): string => {
  const normalized = normalizeCommandWhitespace(command);
  const shellMatch = normalized.match(/^(?:\/bin\/)?(?:bash|sh)\s+-lc\s+(.+)$/);
  return shellMatch
    ? normalizeCommandWhitespace(unquoteShellPayload(shellMatch[1] ?? ""))
    : normalized;
};

const shellLikeTokens = (command: string): string[] => {
  const tokens: string[] = [];
  let current = "";
  let quote: "'" | '"' | null = null;

  const pushCurrent = () => {
    if (current.length > 0) {
      tokens.push(current);
      current = "";
    }
  };

  for (let index = 0; index < command.length; index += 1) {
    const char = command[index];
    if (quote) {
      if (char === quote) {
        quote = null;
        continue;
      }
      if (quote === '"' && char === "\\" && index + 1 < command.length) {
        index += 1;
        current += command[index] ?? "";
        continue;
      }
      current += char;
      continue;
    }

    if (char === "'" || char === '"') {
      quote = char;
      continue;
    }
    if (char === "\\" && index + 1 < command.length) {
      index += 1;
      current += command[index] ?? "";
      continue;
    }
    if ((char === "&" || char === "|") && command[index + 1] === char) {
      pushCurrent();
      tokens.push(`${char}${char}`);
      index += 1;
      continue;
    }
    if (char === "|" || char === ";") {
      pushCurrent();
      tokens.push(char);
      continue;
    }
    if (/\s/.test(char ?? "")) {
      pushCurrent();
      continue;
    }
    current += char;
  }
  pushCurrent();

  return tokens;
};

const firstCommandSegment = (tokens: string[]): string[] => {
  const separatorIndex = tokens.findIndex(
    (token) =>
      token === "|" || token === "&&" || token === "||" || token === ";",
  );
  const segment =
    separatorIndex >= 0 ? tokens.slice(0, separatorIndex) : tokens;
  return segment.filter((token) => !/^\d?>/.test(token));
};

const isSedExpression = (token: string): boolean =>
  /^[0-9,$]+(?:,[0-9,$]+)?[a-z]?$/.test(token);

const nonOptionArgs = (tokens: string[]): string[] =>
  tokens.filter((token) => token !== "--" && !token.startsWith("-"));

const summarizeSedCommand = (
  tokens: string[],
): CommandTerminalSummary | null => {
  const args = nonOptionArgs(tokens.slice(1)).filter(
    (token) => !isSedExpression(token),
  );
  return args.length > 0
    ? { group: "Explored", description: `Read ${args.join(" ")}` }
    : null;
};

const summarizeReadCommand = (
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

const summarizeReadCommandChain = (
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

const summarizeFindCommand = (tokens: string[]): CommandTerminalSummary => {
  const pathToken =
    tokens.slice(1).find((token) => token !== "--" && !token.startsWith("-")) ??
    ".";
  return { group: "Explored", description: `Explore ${pathToken}` };
};

const isWorkflowPlanMarkdownPath = (token: string): boolean =>
  /^\.ai\/plans\/[^/]+\.md$/.test(token);

const isPlanSectionHeadingSearchPattern = (pattern: string): boolean => {
  const normalized = pattern.replace(/\\\(/g, "(").replace(/\\\)/g, ")").trim();
  if (/^\^##\s+\(.+\)$/.test(normalized)) {
    return true;
  }

  const terms = normalized
    .split("|")
    .map((term) => term.trim())
    .filter(Boolean);
  return terms.length > 0 && terms.every((term) => /^\^#{2,3}\s+/.test(term));
};

const summarizePlanSectionReadCommand = (
  tokens: string[],
): CommandTerminalSummary | null => {
  const executable = tokens[0];
  if (executable !== "rg" && executable !== "awk") {
    return null;
  }
  if (!tokens.some(isWorkflowPlanMarkdownPath)) {
    return null;
  }

  if (executable === "rg") {
    const pattern = tokens
      .slice(1)
      .find(
        (token) =>
          token !== "--" &&
          !token.startsWith("-") &&
          !isWorkflowPlanMarkdownPath(token),
      );
    if (!pattern || !isPlanSectionHeadingSearchPattern(pattern)) {
      return null;
    }
  } else if (!tokens.some((token) => token.includes("^##"))) {
    return null;
  }

  return {
    group: "Explored",
    description: "Read plan sections",
    silent: true,
    failureLabel: "plan section read",
  };
};

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

const summarizeSearchTargets = (paths: string[]): string | null => {
  if (paths.length === 0) {
    return null;
  }
  return Array.from(
    new Set(paths.map((targetPath) => path.basename(targetPath))),
  ).join(", ");
};

const uniqueBasenameTargets = (paths: string[]): string[] =>
  Array.from(new Set(paths.map((targetPath) => path.basename(targetPath))));

const isLikelyFileSearchTarget = (targetPath: string): boolean =>
  path.extname(path.basename(targetPath)) !== "";

const summarizeSearchTargetDetails = (
  paths: string[],
): { headingTarget: string | null; bulletTargets: string[] } => {
  if (paths.length === 0) {
    return { headingTarget: null, bulletTargets: [] };
  }

  if (paths.length > 1 && paths.every(isLikelyFileSearchTarget)) {
    return {
      headingTarget: null,
      bulletTargets: uniqueBasenameTargets(paths),
    };
  }

  const fileTargets = paths
    .filter(isLikelyFileSearchTarget)
    .map((targetPath) => path.basename(targetPath));
  const uniqueFileTargets = Array.from(new Set(fileTargets));
  const directoryTargets = paths.filter(
    (targetPath) => !isLikelyFileSearchTarget(targetPath),
  );
  if (directoryTargets.length === 1 && fileTargets.length > 0) {
    return {
      headingTarget: path.basename(directoryTargets[0] ?? ""),
      bulletTargets: uniqueFileTargets,
    };
  }
  if (paths.length > 2) {
    return {
      headingTarget: null,
      bulletTargets: uniqueBasenameTargets(paths),
    };
  }

  return { headingTarget: summarizeSearchTargets(paths), bulletTargets: [] };
};

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

const formatLimitedSearchItems = (items: string[]): string[] => {
  const visibleItems = items.slice(0, TERMINAL_FILE_DETAIL_LIMIT);
  const hiddenItems = items.length - visibleItems.length;
  return [
    ...visibleItems.map((item) => `- ${item}`),
    ...(hiddenItems > 0 ? [`  +${hiddenItems} more`] : []),
  ];
};

const formatLimitedSearchFileItems = (items: string[]): string[] => {
  const visibleItems = items.slice(0, TERMINAL_FILE_DETAIL_LIMIT);
  const hiddenItems = items.length - visibleItems.length;
  return [
    ...visibleItems.map((item) => `- ${item}`),
    ...(hiddenItems > 0 ? [`  + ${hiddenItems} more`] : []),
  ];
};

const formatStructuredSearchDescription = (
  paths: string[],
  terms: string[],
): string => {
  const { headingTarget, bulletTargets } = summarizeSearchTargetDetails(paths);
  if (!headingTarget && bulletTargets.length > 0) {
    return [
      "Search in",
      ...formatLimitedSearchFileItems(bulletTargets),
      "",
      "terms:",
      ...formatLimitedSearchItems(terms),
    ].join("\n");
  }

  const visibleItems = [...bulletTargets, ...terms].slice(
    0,
    TERMINAL_FILE_DETAIL_LIMIT,
  );
  const hiddenItems = bulletTargets.length + terms.length - visibleItems.length;
  return [
    headingTarget ? `Search in ${headingTarget}` : "Search",
    ...visibleItems.map((item) => `- ${item}`),
    ...(hiddenItems > 0 ? [`  +${hiddenItems} more`] : []),
  ].join("\n");
};

const formatSimpleSearchDescription = (
  pattern: string,
  paths: string[],
): string => {
  if (paths.length > 1 && paths.every(isLikelyFileSearchTarget)) {
    return [
      `Search ${pattern}`,
      ...paths.map((targetPath) => `- ${path.basename(targetPath)}`),
    ].join("\n");
  }

  const summarizedTargets = summarizeSearchTargets(paths);
  return `Search ${pattern}${summarizedTargets ? ` in ${summarizedTargets}` : ""}`;
};

const summarizeRipgrepCommand = (tokens: string[]): CommandTerminalSummary => {
  const args = tokens.slice(1);
  if (args.includes("--files")) {
    const pathToken =
      args.find((token) => token !== "--files" && !token.startsWith("-")) ??
      ".";
    return { group: "Explored", description: `Explore ${pathToken}` };
  }

  let pattern: string | undefined;
  const paths: string[] = [];
  for (let index = 0; index < args.length; index += 1) {
    const token = args[index] ?? "";
    if (token === "--") {
      continue;
    }
    if (token === "-e" || token === "--regexp") {
      pattern ??= args[index + 1];
      index += 1;
      continue;
    }
    if (rgOptionsWithSkippedValue.has(token)) {
      index += 1;
      continue;
    }
    if (token.startsWith("-")) {
      continue;
    }
    if (!pattern) {
      pattern = token;
      continue;
    }
    paths.push(token);
  }

  const summarizedTargets = summarizeSearchTargets(paths);
  const alternationTerms = pattern
    ? splitAlternationSearchTerms(pattern)
    : null;
  const description =
    alternationTerms && alternationTerms.length > 2 && summarizedTargets
      ? formatStructuredSearchDescription(paths, alternationTerms)
      : pattern
        ? formatSimpleSearchDescription(pattern, paths)
        : `Search ${unwrapShellCommand(tokens.join(" "))}`;
  return { group: "Explored", description };
};

const looksLikeExplicitTestFile = (token: string): boolean =>
  /(?:^|\/)[^/\s]+\.(?:test|spec)\.[cm]?[jt]sx?$/.test(token);

const commandOptionValue = (
  tokens: string[],
  names: string[],
): string | undefined => {
  for (const name of names) {
    const optionIndex = tokens.indexOf(name);
    if (optionIndex >= 0) {
      return tokens[optionIndex + 1];
    }
    const prefix = `${name}=`;
    const inlineOption = tokens.find((token) => token.startsWith(prefix));
    if (inlineOption) {
      return inlineOption.slice(prefix.length);
    }
  }
  return undefined;
};

const commandTestFiles = (tokens: string[]): string[] =>
  tokens.filter((token) => looksLikeExplicitTestFile(token));

const summarizeVitestRunCommand = (
  tokens: string[],
): CommandTerminalSummary | null => {
  const vitestIndex = tokens.indexOf("vitest");
  if (vitestIndex < 0 || tokens[vitestIndex + 1] !== "run") {
    return null;
  }

  const files = tokens
    .slice(vitestIndex + 2)
    .filter(
      (token) =>
        token !== "--" &&
        !token.startsWith("-") &&
        looksLikeExplicitTestFile(token),
    );

  if (files.length === 0) {
    return null;
  }

  return {
    group: "Ran",
    description: "tests",
    files,
  };
};

const summarizeJestRunCommand = (
  tokens: string[],
): CommandTerminalSummary | null => {
  const jestIndex = tokens.indexOf("jest");
  if (jestIndex < 0) {
    return null;
  }

  const runTestsByPathIndex = tokens.indexOf("--runTestsByPath");
  if (runTestsByPathIndex < 0) {
    return null;
  }

  const files: string[] = [];
  for (let index = runTestsByPathIndex + 1; index < tokens.length; index += 1) {
    const token = tokens[index] ?? "";
    if (token === "--") {
      continue;
    }
    if (token.startsWith("-")) {
      break;
    }
    if (looksLikeExplicitTestFile(token)) {
      files.push(token);
    }
  }

  if (files.length === 0) {
    return null;
  }

  return {
    group: "Ran",
    description: "tests",
    files,
  };
};

const summarizeLineCountCommand = (
  tokens: string[],
): CommandTerminalSummary | null => {
  if (tokens[0] !== "wc") {
    return null;
  }

  const args = tokens.slice(1);
  const countsLines = args.some(
    (token) => token === "-l" || token === "--lines" || /^-[^-].*l/.test(token),
  );
  if (!countsLines) {
    return null;
  }

  const files = args.filter(
    (token) => token !== "--" && !token.startsWith("-"),
  );
  if (files.length === 0) {
    return null;
  }

  return {
    group: "Ran",
    description: `line count for ${files.length} ${files.length === 1 ? "file" : "files"}`,
  };
};

const summarizeFilteredPnpmCommand = (
  tokens: string[],
): CommandTerminalSummary | null => {
  if (tokens[0] !== "pnpm" || tokens[1] !== "--filter" || !tokens[2]) {
    return null;
  }

  const workspaceFilter = tokens[2];
  const commandToken = tokens[3];
  if (!commandToken) {
    return null;
  }

  if (commandToken === "exec") {
    const executable = tokens[4];
    const subcommand = tokens[5];
    if (!executable) {
      return null;
    }

    const description = [
      "pnpm",
      "--filter",
      workspaceFilter,
      "exec",
      executable,
      ...(subcommand && !subcommand.startsWith("-") ? [subcommand] : []),
    ].join(" ");
    const files = tokens
      .slice(subcommand && !subcommand.startsWith("-") ? 6 : 5)
      .filter(
        (token) =>
          token !== "--" &&
          !token.startsWith("-") &&
          looksLikeExplicitTestFile(token),
      );

    return {
      group: "Ran",
      description,
      files: files.length > 0 ? files : undefined,
    };
  }

  const description = ["pnpm", "--filter", workspaceFilter, commandToken].join(
    " ",
  );
  const separatorIndex = tokens.indexOf("--");
  const files =
    separatorIndex >= 0
      ? tokens
          .slice(separatorIndex + 1)
          .filter((token) => looksLikeExplicitTestFile(token))
      : [];

  return {
    group: "Ran",
    description,
    files: files.length > 0 ? files : undefined,
  };
};

const summarizeGitDiffCommand = (
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

const ripgrepPatternFromTokens = (tokens: string[]): string | undefined => {
  const args = tokens.slice(1);
  let pattern: string | undefined;
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
    if (token.startsWith("-")) {
      continue;
    }
    pattern = token;
    break;
  }
  return pattern;
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

const summarizeStagedGitShowPipeline = (
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
    const pathWithRange = rangeMatch
      ? `${stagedPath}:${rangeMatch[1]}-${rangeMatch[2]}`
      : stagedPath;
    return {
      group: "Ran",
      description: `git show\n- ${pathWithRange}`,
    };
  }

  return null;
};

export const commandTerminalSummary = (command: string): CommandTerminalSummary => {
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
  const inlineTsxSummary = summarizeInlineTsxCommand(tokens);
  const filteredPnpmSummary = summarizeFilteredPnpmCommand(tokens);
  const vitestSummary = summarizeVitestRunCommand(tokens);
  const jestSummary = summarizeJestRunCommand(tokens);
  const lineCountSummary = summarizeLineCountCommand(tokens);
  const gitDiffSummary = summarizeGitDiffCommand(tokens);
  const planSectionReadSummary = summarizePlanSectionReadCommand(tokens);

  if (inlineTsxSummary) {
    return inlineTsxSummary;
  }
  if (filteredPnpmSummary) {
    return filteredPnpmSummary;
  }
  if (vitestSummary) {
    return vitestSummary;
  }
  if (jestSummary) {
    return jestSummary;
  }
  if (lineCountSummary) {
    return lineCountSummary;
  }
  if (gitDiffSummary) {
    return gitDiffSummary;
  }
  if (planSectionReadSummary) {
    return planSectionReadSummary;
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
): FailedTestCommandSummary | null => {
  const tokens = firstCommandSegment(
    shellLikeTokens(unwrapShellCommand(command)),
  );
  const files = commandTestFiles(tokens);
  if (files.length === 0) {
    return null;
  }

  const testName = commandOptionValue(tokens, [
    "-t",
    "--testNamePattern",
    "--test-name-pattern",
  ]);
  if (tokens.includes("jest")) {
    return { label: "jest test", files, testName };
  }
  if (tokens.includes("vitest")) {
    return { label: "vitest test", files, testName };
  }
  return null;
};

const summarizeInlineTsxCommand = (
  tokens: string[],
): CommandTerminalSummary | null => {
  const tsxIndex = tokens.indexOf("tsx");
  if (tsxIndex < 0 || tokens[tsxIndex + 1] !== "-e") {
    return null;
  }
  if (!tokens.includes("exec")) {
    return null;
  }

  const filterIndex = tokens.indexOf("--filter");
  const packageName = filterIndex >= 0 ? tokens[filterIndex + 1] : undefined;
  const scopeLabel =
    packageName === "@gondoor/backend"
      ? "backend"
      : packageName === "@gondoor/web"
        ? "web"
        : (packageName?.replace(/^@gondoor\//, "") ?? "workspace");
  const prefixTokens = tokens.slice(0, tsxIndex + 2);
  return {
    group: "Ran",
    description: `${prefixTokens.join(" ")} <inline script>`,
    failureLabel: `${scopeLabel} inline tsx check`,
    failureCommand: `${prefixTokens.join(" ")} <inline script>`,
  };
};
