import type {
  ThinPlanContractVersion,
  ThinPlanFailure,
  ThinPlanSuccess,
} from "./thin-plan-types.ts";
import { validatePlanDocumentBundle } from "../document-formats.ts";

export type { ThinPlanContractVersion } from "./thin-plan-types.ts";

const THIN_PLAN = "thin-plan";
const FORBIDDEN_INLINE_SECTIONS = [
  "## Flow-to-File Mapping",
  "## Implementation Map",
  "## Execution Log",
  "## Validation History",
  "## Review History",
  "## Unblock History",
  "## Reopen History",
  "## Blockers",
  "## Ownership Scope",
  "## File Ownership Releases",
  "## Hunk Ownership",
  "## Files (MANDATORY)",
];

const sectionLines = (content: string, heading: string): string[] => {
  const lines = content.split(/\r?\n/);
  const start = lines.findIndex((line) => line.trim() === heading);
  if (start === -1) return [];
  const collected: string[] = [];
  for (const line of lines.slice(start + 1)) {
    if (line.trim().startsWith("## ")) break;
    collected.push(line);
  }
  return collected;
};

const normalizeInlineCodeValue = (value: string): string =>
  value.trim().replace(/^`+|`+$/g, "");

export const detectThinPlanContract = (
  content: string,
): ThinPlanContractVersion | undefined => {
  const contentRules = sectionLines(content, "## Workflow Content Rules");
  if (contentRules.some((line) => normalizeInlineCodeValue(line) === THIN_PLAN)) return THIN_PLAN;
  return undefined;
};

export const validateThinPlanContract = async ({
  rootDir,
  planName,
  content,
}: {
  rootDir: string;
  planName: string;
  content: string;
}): Promise<ThinPlanSuccess | ThinPlanFailure> => {
  const contract = detectThinPlanContract(content);
  if (!contract) return { ok: false, reason: `plan is missing ${THIN_PLAN}; thin-plan-v1 and thin-plan-v2 are unsupported. Run pnpm exec tsx .ai/scripts/workflow/migrate-document-formats.ts --plan .ai/plans/${planName}.md --apply` };
  for (const section of FORBIDDEN_INLINE_SECTIONS) {
    if (content.split(/\r?\n/).some((line) => line.trim() === section)) {
      return { ok: false, reason: `thin-plan contains forbidden inline section ${section.replace(/^##\s+/, "")}` };
    }
  }
  const bundle = await validatePlanDocumentBundle({
    rootDir,
    planPath: `.ai/plans/${planName}.md`,
    planName,
    planContent: content,
  });
  if (bundle.ok === false) return { ok: false, reason: bundle.reason };
  return { ok: true, warnings: [], contract: THIN_PLAN };
};
