import type { CommandTerminalSummary, FailedTestCommandSummary } from "../../types.ts";

const looksLikeExplicitTestFile = (token: string): boolean =>
  /(?:^|\/)[^/\s]+\.(?:test|spec)\.[cm]?[jt]sx?$/.test(token);

const commandOptionValue = (tokens: string[], names: string[]): string | undefined => {
  for (const name of names) {
    const optionIndex = tokens.indexOf(name);
    if (optionIndex >= 0) return tokens[optionIndex + 1];
    const prefix = `${name}=`;
    const inlineOption = tokens.find((token) => token.startsWith(prefix));
    if (inlineOption) return inlineOption.slice(prefix.length);
  }
  return undefined;
};

const commandTestFiles = (tokens: string[]): string[] =>
  tokens.filter((token) => looksLikeExplicitTestFile(token));

export const summarizeFailedTestCommand = (tokens: string[]): FailedTestCommandSummary | null => {
  const files = commandTestFiles(tokens);
  if (files.length === 0) return null;
  const testName = commandOptionValue(tokens, ["-t", "--testNamePattern", "--test-name-pattern"]);
  if (tokens.includes("jest")) return { label: "jest test", files, testName };
  if (tokens.includes("vitest")) return { label: "vitest test", files, testName };
  return null;
};

export const summarizeLineCountCommand = (tokens: string[]): CommandTerminalSummary | null => {
  if (tokens[0] !== "wc") return null;
  const args = tokens.slice(1);
  const countsLines = args.some((token) => token === "-l" || token === "--lines" || /^-[^-].*l/.test(token));
  if (!countsLines) return null;
  const files = args.filter((token) => token !== "--" && !token.startsWith("-"));
  if (files.length === 0) return null;
  return { group: "Ran", description: `line count for ${files.length} ${files.length === 1 ? "file" : "files"}` };
};

export const summarizeFilteredPnpmCommand = (tokens: string[]): CommandTerminalSummary | null => {
  if (tokens[0] !== "pnpm" || tokens[1] !== "--filter" || !tokens[2]) return null;
  const workspaceFilter = tokens[2];
  const commandToken = tokens[3];
  if (!commandToken) return null;
  if (commandToken === "exec") {
    const executable = tokens[4];
    const subcommand = tokens[5];
    if (!executable) return null;
    const description = ["pnpm", "--filter", workspaceFilter, "exec", executable, ...(subcommand && !subcommand.startsWith("-") ? [subcommand] : [])].join(" ");
    const files = tokens.slice(subcommand && !subcommand.startsWith("-") ? 6 : 5).filter((token) => token !== "--" && !token.startsWith("-") && looksLikeExplicitTestFile(token));
    return { group: "Ran", description, files: files.length > 0 ? files : undefined };
  }
  const description = ["pnpm", "--filter", workspaceFilter, commandToken].join(" ");
  const separatorIndex = tokens.indexOf("--");
  const files = separatorIndex >= 0 ? tokens.slice(separatorIndex + 1).filter(looksLikeExplicitTestFile) : [];
  return { group: "Ran", description, files: files.length > 0 ? files : undefined };
};

export const summarizeInlineTsxCommand = (tokens: string[]): CommandTerminalSummary | null => {
  const tsxIndex = tokens.indexOf("tsx");
  if (tsxIndex < 0 || tokens[tsxIndex + 1] !== "-e" || !tokens.includes("exec")) return null;
  const filterIndex = tokens.indexOf("--filter");
  const packageName = filterIndex >= 0 ? tokens[filterIndex + 1] : undefined;
  const scopeLabel = packageName === "@gondoor/backend" ? "backend" : packageName === "@gondoor/web" ? "web" : (packageName?.replace(/^@gondoor\//, "") ?? "workspace");
  const prefixTokens = tokens.slice(0, tsxIndex + 2);
  return { group: "Ran", description: `${prefixTokens.join(" ")} <inline script>`, failureLabel: `${scopeLabel} inline tsx check`, failureCommand: `${prefixTokens.join(" ")} <inline script>` };
};
