import path from "node:path";
import { isNextAction, isStatus } from "../runner/plan/parser.ts";
import {
  asRecord,
  type Failure,
  type FileOwnershipArtifact,
} from "../runner/types.ts";

const fileOwnershipArtifactRelativePath = (planName: string): string =>
  [".ai", "artifacts", planName, "state", "file-ownership.json"].join("/");

const asStringArray = (value: unknown): string[] | undefined =>
  Array.isArray(value) && value.every((item) => typeof item === "string")
    ? (value as string[])
    : undefined;

export const fileOwnershipArtifactAbsolutePath = (
  rootDir: string,
  planName: string,
): string => path.join(rootDir, fileOwnershipArtifactRelativePath(planName));

export const canonicalFileOwnershipArtifact = (
  artifact: FileOwnershipArtifact,
): FileOwnershipArtifact => ({
  planPath: artifact.planPath,
  owns: artifact.owns,
  released: artifact.released,
  resolvedFiles: artifact.resolvedFiles,
  changedFiles: artifact.changedFiles,
  headSha: artifact.headSha,
  updatedAt: artifact.updatedAt,
});

export const parseFileOwnershipArtifact = (
  raw: string,
  artifactPath: string,
): FileOwnershipArtifact | Failure => {
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    return {
      ok: false,
      reason: `file ownership artifact is malformed: ${artifactPath}`,
    };
  }

  const record = asRecord(parsed);
  const planPath = record?.planPath;
  const status = record?.status;
  const nextAction = record?.nextAction;
  const owns = asStringArray(record?.owns);
  const released = asStringArray(record?.released);
  const resolvedFiles = asStringArray(record?.resolvedFiles);
  const changedFiles = asStringArray(record?.changedFiles);
  const legacyOwnedFiles = asStringArray(record?.ownedFiles);
  const legacyReleasedFiles = asStringArray(record?.releasedFiles);
  const headSha = record?.headSha;
  const updatedAt = record?.updatedAt;
  const hasLegacyShape = !owns && !!legacyOwnedFiles;
  if (typeof planPath === "string" && hasLegacyShape) {
    const hasLegacyWorkflowState =
      status !== undefined || nextAction !== undefined;
    if (
      (hasLegacyWorkflowState &&
        (typeof status !== "string" ||
          !isStatus(status) ||
          typeof nextAction !== "string" ||
          !isNextAction(nextAction))) ||
      (record?.releasedFiles !== undefined && !legacyReleasedFiles)
    ) {
      return {
        ok: false,
        reason: `file ownership artifact is malformed: ${artifactPath}`,
      };
    }

    return {
      planPath,
      status: hasLegacyWorkflowState ? status : undefined,
      nextAction: hasLegacyWorkflowState ? nextAction : undefined,
      owns: legacyOwnedFiles,
      released: legacyReleasedFiles ?? [],
      resolvedFiles: resolvedFiles ?? [],
      changedFiles: changedFiles ?? [],
      headSha: typeof headSha === "string" ? headSha : "",
      updatedAt: typeof updatedAt === "string" ? updatedAt : "",
      migratedFromLegacy: true,
    };
  }
  if (
    typeof planPath !== "string" ||
    !owns ||
    !released ||
    !resolvedFiles ||
    !changedFiles ||
    typeof headSha !== "string" ||
    typeof updatedAt !== "string"
  ) {
    return {
      ok: false,
      reason: `file ownership artifact is malformed: ${artifactPath}`,
    };
  }
  const hasLegacyWorkflowState =
    status !== undefined || nextAction !== undefined;
  if (
    hasLegacyWorkflowState &&
    (typeof status !== "string" ||
      !isStatus(status) ||
      typeof nextAction !== "string" ||
      !isNextAction(nextAction))
  ) {
    return {
      ok: false,
      reason: `file ownership artifact is malformed: ${artifactPath}`,
    };
  }

  return {
    planPath,
    status: hasLegacyWorkflowState ? status : undefined,
    nextAction: hasLegacyWorkflowState ? nextAction : undefined,
    owns,
    released,
    resolvedFiles,
    changedFiles,
    headSha,
    updatedAt,
  };
};
