import { readFile } from "node:fs/promises";

import { NO_CODEX_COMPLETING_STAGES, type LifecycleStage } from "./lifecycle.ts";

export type V7StagePolicy = {
  stage: LifecycleStage;
  codexRequired: boolean;
  zeroTokenCompletesStage: boolean;
};

const policyFile = (stage: LifecycleStage): URL => new URL(`../wrappers/stages/${stage}.md`, import.meta.url);
const field = (content: string, name: string): string | undefined => content.match(new RegExp(`^${name}:\\s*(.+)\\s*$`, "m"))?.[1]?.trim();

export const readV7StagePolicy = async (stage: LifecycleStage): Promise<V7StagePolicy> => {
  const content = await readFile(policyFile(stage), "utf8");
  const declaredStage = field(content, "stage");
  const codexRequired = field(content, "codexRequired");
  const zeroTokenCompletesStage = field(content, "zeroTokenCompletesStage");
  if (declaredStage !== stage || !["true", "false"].includes(codexRequired ?? "") || !["true", "false"].includes(zeroTokenCompletesStage ?? "")) {
    throw new Error(`invalid V7 stage wrapper contract: ${stage}`);
  }
  return { stage, codexRequired: codexRequired === "true", zeroTokenCompletesStage: zeroTokenCompletesStage === "true" };
};

export const assertV7StagePolicy = async (stage: LifecycleStage): Promise<V7StagePolicy> => {
  const policy = await readV7StagePolicy(stage);
  const noCodex = NO_CODEX_COMPLETING_STAGES.includes(stage);
  if (policy.codexRequired === noCodex || policy.zeroTokenCompletesStage !== noCodex) {
    throw new Error(`V7 stage wrapper contract conflicts with lifecycle policy: ${stage}`);
  }
  return policy;
};
