export type ThinPlanContractVersion = "thin-plan";

export type ThinPlanFailure = { ok: false; reason: string };
export type ThinPlanSuccess = {
  ok: true;
  warnings: string[];
  contract: ThinPlanContractVersion;
};
