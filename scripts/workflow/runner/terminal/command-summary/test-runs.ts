export { summarizeFailedTestCommand } from "./shell.ts";
import type { CommandTerminalSummary } from "../../types.ts";

const looksLikeExplicitTestFile = (token: string): boolean =>
  /(?:^|\/)[^/\s]+\.(?:test|spec)\.[cm]?[jt]sx?$/.test(token);

export const summarizeVitestRunCommand = (
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

export const summarizeJestRunCommand = (
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
