import { boundedInlineExcerpt } from "../types.ts";

const sectionLines = (content: string, heading: string): string[] | null => {
  const lines = content.split(/\r?\n/);
  const start = lines.findIndex((line) => line.trim() === heading);
  if (start === -1) {
    return null;
  }
  const collected: string[] = [];
  for (const line of lines.slice(start + 1)) {
    if (line.trim().startsWith("## ")) {
      break;
    }
    collected.push(line);
  }
  return collected;
};

const extractLatestUnresolvedBlockerDetail = (
  content: string,
): string | undefined => {
  const lines = sectionLines(content, "## Blockers");
  if (lines === null) {
    return undefined;
  }

  const blockerSections: Array<{ heading: string; lines: string[] }> = [];
  let current: { heading: string; lines: string[] } | undefined;
  for (const line of lines) {
    const trimmed = line.trim();
    if (/^###\s+Blocker\b/i.test(trimmed)) {
      current = { heading: trimmed, lines: [] };
      blockerSections.push(current);
      continue;
    }
    current?.lines.push(line);
  }

  const sections =
    blockerSections.length > 0
      ? blockerSections
      : [{ heading: "## Blockers", lines }];
  for (const blocker of sections.slice().reverse()) {
    const resolved =
      /\bresolved\b/i.test(blocker.heading) ||
      blocker.lines.some((line) =>
        /^\*\s*Status:\s*resolved\b/i.test(line.trim()),
      );
    if (resolved) {
      continue;
    }

    const values = new Map<string, string>();
    for (const line of blocker.lines) {
      const match = line
        .trim()
        .match(/^\*\s*(Description|Required Action|Next Step):\s*(.+)$/i);
      if (match) {
        values.set(match[1].toLowerCase(), match[2]);
      }
    }
    for (const field of ["description", "required action", "next step"]) {
      const value = values.get(field);
      const excerpt = value ? boundedInlineExcerpt(value) : undefined;
      if (excerpt) {
        return excerpt;
      }
    }
  }

  return undefined;
};

const hasBrowserValidationBlockerSignal = (content: string): boolean => {
  const lines = sectionLines(content, "## Blockers");
  if (lines === null) {
    return false;
  }
  return /\b(browser|manual|viewport|devtools|computed-style|computed style)\b/i.test(
    lines.join("\n"),
  );
};

const simplifyBrowserValidationDetail = (detail: string): string =>
  detail
    .replace(/^mandatory\s+/i, "")
    .replace(/^browser validation cannot be performed because\s+/i, "")
    .replace(/^validation cannot be performed because\s+/i, "")
    .replace(/\.$/, "")
    .trim();

export const blockedPlanDetail = (content: string): string => {
  const detail =
    extractLatestUnresolvedBlockerDetail(content) ??
    "Plan needs unblock evidence before execution can continue";
  if (
    !hasBrowserValidationBlockerSignal(content) ||
    /^browser validation:/i.test(detail)
  ) {
    return detail;
  }
  return `Browser validation: ${simplifyBrowserValidationDetail(detail)}`;
};

export const blockedReasonSummary = (
  detail: string,
): { category: string; detail: string } => {
  const browserPrefix = "Browser validation:";
  if (detail.toLowerCase().startsWith(browserPrefix.toLowerCase())) {
    return {
      category: "BROWSER VALIDATION",
      detail: detail.slice(browserPrefix.length).trim(),
    };
  }
  return {
    category: "BLOCKED",
    detail,
  };
};
