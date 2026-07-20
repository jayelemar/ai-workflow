export type ThinPlanContractVersion = "thin-plan-v1" | "thin-plan-v2";

export type ThinPlanFailure = { ok: false; reason: string };
export type ThinPlanSuccess = {
  ok: true;
  warnings: string[];
  contract: ThinPlanContractVersion;
};
