#!/usr/bin/env node

import { access, copyFile, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const USAGE =
  "Usage: node .ai/scripts/workflow/ownership/reset-file-ownership.mjs .ai/plans/<plan-name>.md --force";

const okPlanPath = (planPath) =>
  typeof planPath === "string" &&
  planPath.startsWith(".ai/plans/") &&
  planPath.endsWith(".md") &&
  !path.isAbsolute(planPath) &&
  !planPath.includes("..") &&
  !planPath.includes("\\") &&
  !planPath.slice(".ai/plans/".length, -3).includes("/");

const backupTimestamp = (timestamp) => `${timestamp.replace(/\D/g, "")}Z`;

export const parseResetFileOwnershipArgs = (args) => {
  const force = args.includes("--force");
  const planArgs = args.filter((arg) => arg !== "--force");
  if (planArgs.length !== 1) {
    return { ok: false, reason: USAGE };
  }
  return { ok: true, planPath: planArgs[0], force };
};

export const resetFileOwnershipArtifact = async ({
  cwd = process.cwd(),
  planPath,
  force,
  now = () => new Date().toISOString(),
}) => {
  if (!okPlanPath(planPath)) {
    return {
      ok: false,
      reason: `plan path must be .ai/plans/<plan-name>.md: ${planPath}`,
    };
  }
  if (!force) {
    return {
      ok: false,
      reason:
        "resetting file ownership requires --force because it clears the owner plan boundary",
    };
  }

  const planName = planPath.slice(".ai/plans/".length, -3);
  const planFilePath = path.join(cwd, planPath);
  const artifactPath = path.join(
    cwd,
    ".ai",
    "artifacts",
    planName,
    "state",
    "file-ownership.json",
  );

  try {
    await access(planFilePath);
  } catch {
    return { ok: false, reason: `plan file not found: ${planPath}` };
  }

  let raw;
  try {
    raw = await readFile(artifactPath, "utf8");
  } catch (error) {
    return {
      ok: false,
      reason: `file-ownership.json cannot be read: ${artifactPath}: ${String(error)}`,
    };
  }

  let existing;
  try {
    existing = JSON.parse(raw);
  } catch {
    return {
      ok: false,
      reason: `file-ownership.json is malformed JSON: ${artifactPath}`,
    };
  }

  const timestamp = now();
  const backupPath = path.join(
    path.dirname(artifactPath),
    `file-ownership.backup-${backupTimestamp(timestamp)}.json`,
  );
  await copyFile(artifactPath, backupPath);

  const resetArtifact = {
    planPath,
    owns: [],
    released: [],
    resolvedFiles: [],
    changedFiles: [],
    headSha:
      existing && typeof existing === "object" && typeof existing.headSha === "string"
        ? existing.headSha
        : "",
    updatedAt: timestamp,
  };

  await writeFile(artifactPath, `${JSON.stringify(resetArtifact, null, 2)}\n`, "utf8");

  return { ok: true, artifactPath, backupPath };
};

const main = async () => {
  const parsed = parseResetFileOwnershipArgs(process.argv.slice(2));
  if (!parsed.ok) {
    console.error(parsed.reason);
    process.exitCode = 1;
    return;
  }

  const result = await resetFileOwnershipArtifact(parsed);
  if (!result.ok) {
    console.error(`FAILED: ${result.reason}`);
    console.error(USAGE);
    process.exitCode = 1;
    return;
  }

  console.log(`Reset file ownership: ${parsed.planPath}`);
  console.log(`Backup: ${path.relative(process.cwd(), result.backupPath)}`);
};

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  await main();
}
