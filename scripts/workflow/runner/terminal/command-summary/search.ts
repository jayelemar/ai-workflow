import path from "node:path";
import type { CommandTerminalSummary } from "../../types.ts";
import { unwrapShellCommand } from "./shell-utils.ts";

const TERMINAL_FILE_DETAIL_LIMIT = 3;

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

export const summarizePlanSectionReadCommand = (
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
  "-A", "-B", "-C", "-g", "-m", "-t", "--after-context", "--before-context",
  "--context", "--glob", "--iglob", "--max-count", "--type",
]);

const summarizeSearchTargets = (paths: string[]): string | null =>
  paths.length === 0
    ? null
    : Array.from(new Set(paths.map((targetPath) => path.basename(targetPath)))).join(", ");

const uniqueBasenameTargets = (paths: string[]): string[] =>
  Array.from(new Set(paths.map((targetPath) => path.basename(targetPath))));

const isLikelyFileSearchTarget = (targetPath: string): boolean =>
  path.extname(path.basename(targetPath)) !== "";

const summarizeSearchTargetDetails = (
  paths: string[],
): { headingTarget: string | null; bulletTargets: string[] } => {
  if (paths.length === 0) return { headingTarget: null, bulletTargets: [] };
  if (paths.length > 1 && paths.every(isLikelyFileSearchTarget)) {
    return { headingTarget: null, bulletTargets: uniqueBasenameTargets(paths) };
  }
  const fileTargets = paths.filter(isLikelyFileSearchTarget).map((targetPath) => path.basename(targetPath));
  const uniqueFileTargets = Array.from(new Set(fileTargets));
  const directoryTargets = paths.filter((targetPath) => !isLikelyFileSearchTarget(targetPath));
  if (directoryTargets.length === 1 && fileTargets.length > 0) {
    return { headingTarget: path.basename(directoryTargets[0] ?? ""), bulletTargets: uniqueFileTargets };
  }
  if (paths.length > 2) return { headingTarget: null, bulletTargets: uniqueBasenameTargets(paths) };
  return { headingTarget: summarizeSearchTargets(paths), bulletTargets: [] };
};

const splitAlternationSearchTerms = (pattern: string): string[] | null => {
  if (!pattern.includes("|")) return null;
  const terms = pattern.split("|").map((term) => term.trim().replace(/^'+/, "").replace(/^\^/, "").replace(/^\(+/, "").replace(/\)+$/, "").trim()).filter(Boolean);
  return terms.length > 1 && terms.every((term) => /^[#A-Za-z0-9_$][#A-Za-z0-9_$\s.,/:=*\-]*$/.test(term)) ? terms : null;
};

const formatLimitedSearchItems = (items: string[]): string[] => {
  const visibleItems = items.slice(0, TERMINAL_FILE_DETAIL_LIMIT);
  const hiddenItems = items.length - visibleItems.length;
  return [...visibleItems.map((item) => `- ${item}`), ...(hiddenItems > 0 ? [`  +${hiddenItems} more`] : [])];
};

const formatLimitedSearchFileItems = (items: string[]): string[] => {
  const visibleItems = items.slice(0, TERMINAL_FILE_DETAIL_LIMIT);
  const hiddenItems = items.length - visibleItems.length;
  return [...visibleItems.map((item) => `- ${item}`), ...(hiddenItems > 0 ? [`  + ${hiddenItems} more`] : [])];
};

const formatStructuredSearchDescription = (paths: string[], terms: string[]): string => {
  const { headingTarget, bulletTargets } = summarizeSearchTargetDetails(paths);
  if (!headingTarget && bulletTargets.length > 0) {
    return ["Search in", ...formatLimitedSearchFileItems(bulletTargets), "", "terms:", ...formatLimitedSearchItems(terms)].join("\n");
  }
  const visibleItems = [...bulletTargets, ...terms].slice(0, TERMINAL_FILE_DETAIL_LIMIT);
  const hiddenItems = bulletTargets.length + terms.length - visibleItems.length;
  return [headingTarget ? `Search in ${headingTarget}` : "Search", ...visibleItems.map((item) => `- ${item}`), ...(hiddenItems > 0 ? [`  +${hiddenItems} more`] : [])].join("\n");
};

const formatSimpleSearchDescription = (pattern: string, paths: string[]): string => {
  if (paths.length > 1 && paths.every(isLikelyFileSearchTarget)) {
    return [`Search ${pattern}`, ...paths.map((targetPath) => `- ${path.basename(targetPath)}`)].join("\n");
  }
  const summarizedTargets = summarizeSearchTargets(paths);
  return `Search ${pattern}${summarizedTargets ? ` in ${summarizedTargets}` : ""}`;
};

export const summarizeRipgrepCommand = (tokens: string[]): CommandTerminalSummary => {
  const args = tokens.slice(1);
  if (args.includes("--files")) {
    const pathToken = args.find((token) => token !== "--files" && !token.startsWith("-")) ?? ".";
    return { group: "Explored", description: `Explore ${pathToken}` };
  }
  let pattern: string | undefined;
  const paths: string[] = [];
  for (let index = 0; index < args.length; index += 1) {
    const token = args[index] ?? "";
    if (token === "--") continue;
    if (token === "-e" || token === "--regexp") {
      pattern ??= args[index + 1];
      index += 1;
      continue;
    }
    if (rgOptionsWithSkippedValue.has(token)) {
      index += 1;
      continue;
    }
    if (token.startsWith("-")) continue;
    if (!pattern) {
      pattern = token;
      continue;
    }
    paths.push(token);
  }
  const summarizedTargets = summarizeSearchTargets(paths);
  const alternationTerms = pattern ? splitAlternationSearchTerms(pattern) : null;
  const description = alternationTerms && alternationTerms.length > 2 && summarizedTargets
    ? formatStructuredSearchDescription(paths, alternationTerms)
    : pattern ? formatSimpleSearchDescription(pattern, paths) : `Search ${unwrapShellCommand(tokens.join(" "))}`;
  return { group: "Explored", description };
};
