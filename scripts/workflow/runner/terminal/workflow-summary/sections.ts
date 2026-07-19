export const trimBlankLines = (lines: string[]): string[] => {
  let start = 0;
  let end = lines.length;
  while (start < end && lines[start]?.trim() === "") {
    start += 1;
  }
  while (end > start && lines[end - 1]?.trim() === "") {
    end -= 1;
  }
  return lines.slice(start, end);
};

export const workflowSummarySectionHeading = (
  line: string,
): string | null => {
  const match = line.match(/^\*\*(.+)\*\*$/);
  return match?.[1] ?? null;
};

export const parseWorkflowSections = (
  text: string,
  headingForLine: (line: string) => string | null,
): Map<string, string[]> => {
  const sections = new Map<string, string[]>();
  let currentSection: string | null = null;
  for (const line of text.split(/\r?\n/)) {
    const heading = headingForLine(line);
    if (heading) {
      currentSection = heading;
      sections.set(currentSection, []);
      continue;
    }
    if (currentSection) {
      sections.get(currentSection)?.push(line);
    }
  }
  return sections;
};
