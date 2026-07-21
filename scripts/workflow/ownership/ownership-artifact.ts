import path from "node:path";
import {
  asRecord,
  type Failure,
  type FileOwnershipArtifact,
} from "../runner/types.ts";
import { DOCUMENT_FORMATS, validateDocumentFormat } from "../document-formats.ts";

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
  documentFormat: DOCUMENT_FORMATS.fileOwnership,
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
  const format = validateDocumentFormat("fileOwnership", parsed, artifactPath);
  if (format.ok === false) return { ok: false, reason: format.reason };
  const planPath = record?.planPath;
  const owns = asStringArray(record?.owns);
  const released = asStringArray(record?.released);
  const resolvedFiles = asStringArray(record?.resolvedFiles);
  const changedFiles = asStringArray(record?.changedFiles);
  const headSha = record?.headSha;
  const updatedAt = record?.updatedAt;
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
  return {
    documentFormat: DOCUMENT_FORMATS.fileOwnership,
    planPath,
    owns,
    released,
    resolvedFiles,
    changedFiles,
    headSha,
    updatedAt,
  };
};
