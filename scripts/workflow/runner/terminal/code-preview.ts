import { trimBlankLines } from "./workflow-summary/sections.ts";
import { ANSI_RESET } from "./ansi.ts";

export type CodePreviewHighlightState = {
  inBlockComment: boolean;
};

const codePreviewAnsiStyles = {
  comment: "\u001b[90m",
  string: "\u001b[32m",
  keyword: "\u001b[34m",
  jsxTag: "\u001b[36m",
  jsxAttribute: "\u001b[35m",
  number: "\u001b[33m",
} as const;

type CodePreviewAnsiStyle = keyof typeof codePreviewAnsiStyles;

type CodePreviewSegment = {
  text: string;
  style?: CodePreviewAnsiStyle;
};

const tsxCodePreviewKeywords = [
  "abstract", "as", "async", "await", "boolean", "break", "case", "catch",
  "class", "const", "continue", "default", "do", "else", "enum", "export",
  "extends", "false", "finally", "for", "from", "function", "if", "implements",
  "import", "in", "interface", "keyof", "let", "never", "new", "null", "number",
  "of", "private", "protected", "public", "readonly", "return", "satisfies", "static",
  "string", "switch", "throw", "true", "try", "type", "typeof", "undefined",
  "unknown", "var", "void", "while",
] as const;

const tsxCodePreviewKeywordPattern = new RegExp(
  `\\b(?:${tsxCodePreviewKeywords.join("|")})\\b`,
  "g",
);

const styledCodePreviewSegment = (
  text: string,
  style: CodePreviewAnsiStyle,
): CodePreviewSegment => ({ text, style });

const applyCodePreviewRule = (
  segments: CodePreviewSegment[],
  pattern: RegExp,
  replacement: (match: RegExpExecArray) => CodePreviewSegment[],
): CodePreviewSegment[] =>
  segments.flatMap((segment) => {
    if (segment.style) return [segment];
    const output: CodePreviewSegment[] = [];
    let lastIndex = 0;
    pattern.lastIndex = 0;
    for (let match = pattern.exec(segment.text); match; match = pattern.exec(segment.text)) {
      if (match.index > lastIndex) output.push({ text: segment.text.slice(lastIndex, match.index) });
      output.push(...replacement(match));
      lastIndex = match.index + match[0].length;
      if (match[0].length === 0) pattern.lastIndex += 1;
    }
    if (lastIndex < segment.text.length) output.push({ text: segment.text.slice(lastIndex) });
    return output;
  });

const renderCodePreviewSegments = (segments: CodePreviewSegment[]): string =>
  segments.map((segment) => segment.style
    ? `${codePreviewAnsiStyles[segment.style]}${segment.text}${ANSI_RESET}`
    : segment.text).join("");

const highlightPlainTsxCodePreviewText = (text: string, isJsxLine: boolean): string => {
  let segments: CodePreviewSegment[] = [{ text }];
  if (isJsxLine) {
    segments = applyCodePreviewRule(segments, /(<\/?)([A-Za-z][\w.]*)/g, (match) => [
      { text: match[1] ?? "" }, styledCodePreviewSegment(match[2] ?? "", "jsxTag"),
    ]);
    segments = applyCodePreviewRule(segments, /(\s)([A-Za-z_$][\w$:-]*)(?==)/g, (match) => [
      { text: match[1] ?? "" }, styledCodePreviewSegment(match[2] ?? "", "jsxAttribute"),
    ]);
  }
  segments = applyCodePreviewRule(segments, tsxCodePreviewKeywordPattern, (match) => [styledCodePreviewSegment(match[0], "keyword")]);
  segments = applyCodePreviewRule(segments, /\b\d+(?:\.\d+)?\b/g, (match) => [styledCodePreviewSegment(match[0], "number")]);
  return renderCodePreviewSegments(segments);
};

export const highlightTsxCodePreviewLine = (
  line: string,
  state: CodePreviewHighlightState,
): string => {
  const isJsxLine = /<\/?[A-Za-z][\w.]*/.test(line);
  const segments: CodePreviewSegment[] = [];
  let plainText = "";
  let index = 0;
  const flushPlainText = () => {
    if (!plainText) return;
    segments.push({ text: highlightPlainTsxCodePreviewText(plainText, isJsxLine) });
    plainText = "";
  };
  while (index < line.length) {
    if (state.inBlockComment) {
      flushPlainText();
      const endIndex = line.indexOf("*/", index);
      const commentEnd = endIndex >= 0 ? endIndex + 2 : line.length;
      segments.push(styledCodePreviewSegment(line.slice(index, commentEnd), "comment"));
      state.inBlockComment = endIndex < 0;
      index = commentEnd;
      continue;
    }
    if (line.startsWith("//", index)) {
      flushPlainText();
      segments.push(styledCodePreviewSegment(line.slice(index), "comment"));
      break;
    }
    if (line.startsWith("/*", index) || line.startsWith("{/*", index)) {
      flushPlainText();
      const openerLength = line.startsWith("{/*", index) ? 3 : 2;
      const endIndex = line.indexOf("*/", index + openerLength);
      const commentEnd = endIndex >= 0
        ? endIndex + (line.startsWith("*/}", endIndex) ? 3 : 2)
        : line.length;
      segments.push(styledCodePreviewSegment(line.slice(index, commentEnd), "comment"));
      state.inBlockComment = endIndex < 0;
      index = commentEnd;
      continue;
    }
    const char = line[index];
    if (char === '"' || char === "'" || char === "`") {
      flushPlainText();
      let endIndex = index + 1;
      while (endIndex < line.length) {
        if (line[endIndex] === "\\") { endIndex += 2; continue; }
        if (line[endIndex] === char) { endIndex += 1; break; }
        endIndex += 1;
      }
      segments.push(styledCodePreviewSegment(line.slice(index, endIndex), "string"));
      index = endIndex;
      continue;
    }
    plainText += char;
    index += 1;
  }
  flushPlainText();
  return renderCodePreviewSegments(segments);
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
