import type {
  ThinPlanContractVersion,
  ThinPlanFailure,
  ThinPlanSuccess,
} from "./thin-plan-types.ts";
import { validateThinPlanV1 } from "./thin-plan-v1.ts";
import { validateThinPlanV2 } from "./thin-plan-v2.ts";

export type { ThinPlanContractVersion } from "./thin-plan-types.ts";

const V1 = "thin-plan-v1";
const V2 = "thin-plan-v2";

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
  if (contentRules.some((line) => normalizeInlineCodeValue(line) === V2)) return V2;
  if (contentRules.some((line) => normalizeInlineCodeValue(line) === V1)) return V1;
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
  if (!contract) return { ok: false, reason: `plan is missing ${V1} or ${V2}` };
  return contract === V2
    ? await validateThinPlanV2({ rootDir, planName, content })
    : await validateThinPlanV1({ rootDir, planName, content });
};
