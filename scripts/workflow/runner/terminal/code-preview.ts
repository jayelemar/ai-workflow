import { trimBlankLines } from "./workflow-summary/sections.ts";

export type CodePreviewHighlightState = {
  inBlockComment: boolean;
};

const codePreviewFenceLanguage = (line: string): string | null => {
  const match = line.match(/^```([A-Za-z0-9_-]*)\s*$/);
  return match ? (match[1] ?? "").toLowerCase() : null;
};

export const formatCodePreviewLines = ({
  lines,
  color,
  highlightTsxLine,
}: {
  lines: string[];
  color: boolean;
  highlightTsxLine: (line: string, state: CodePreviewHighlightState) => string;
}): string[] => {
  if (!color) {
    return trimBlankLines(lines);
  }

  const output: string[] = [];
  let activeFenceLanguage: string | null = null;
  let highlightState: CodePreviewHighlightState = {
    inBlockComment: false,
  };

  for (const line of trimBlankLines(lines)) {
    const fenceLanguage = codePreviewFenceLanguage(line);
    if (fenceLanguage !== null) {
      activeFenceLanguage = activeFenceLanguage === null ? fenceLanguage : null;
      highlightState = { inBlockComment: false };
      output.push(line);
      continue;
    }

    output.push(
      activeFenceLanguage === "ts" || activeFenceLanguage === "tsx"
        ? highlightTsxLine(line, highlightState)
        : line,
    );
  }

  return output;
};
