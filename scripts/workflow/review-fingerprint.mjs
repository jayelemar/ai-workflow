#!/usr/bin/env node

import { execFile } from "node:child_process";
import { createHash } from "node:crypto";
import { lstat, readFile, readlink, realpath } from "node:fs/promises";
import path from "node:path";
import { promisify } from "node:util";
import { fileURLToPath } from "node:url";

const execFileAsync = promisify(execFile);
const SAFE_REPOSITORY_ID = /^[A-Za-z0-9][A-Za-z0-9._-]*$/;
const UNSAFE_PATH_CHARACTERS = ["\0", "\\", "*", "?", "[", "]"];
const MAX_GIT_OUTPUT = 128 * 1024 * 1024;

const sanitizedGitEnvironment = () =>
  Object.fromEntries(
    Object.entries(process.env).filter(([key]) => !key.startsWith("GIT_")),
  );

const sha256 = (value) =>
  `sha256:${createHash("sha256").update(value).digest("hex")}`;

const updateField = (hash, label, value) => {
  const data = Buffer.isBuffer(value) ? value : Buffer.from(value);
  hash.update(Buffer.from(`${label}\0${data.length}\0`));
  hash.update(data);
};

const splitNullTerminated = (value) => {
  if (value.length === 0) return [];
  if (value.at(-1) !== 0) {
    throw new Error("git returned a malformed null-terminated path list");
  }
  return value
    .subarray(0, -1)
    .toString("utf8")
    .split("\0")
    .sort((left, right) =>
      Buffer.compare(Buffer.from(left), Buffer.from(right)),
    );
};

const normalizeOwnedPath = (value) => {
  if (
    !value ||
    path.isAbsolute(value) ||
    path.win32.isAbsolute(value) ||
    value.startsWith(":") ||
    UNSAFE_PATH_CHARACTERS.some((character) => value.includes(character))
  ) {
    throw new Error(`unsafe plan-owned path: ${value || "<empty>"}`);
  }
  const normalized = path.posix.normalize(value);
  if (
    normalized === ".." ||
    normalized.startsWith("../") ||
    normalized.split("/").includes("..")
  ) {
    throw new Error(`plan-owned path escapes the repository: ${value}`);
  }
  return normalized.replace(/\/$/, "") || ".";
};

const defaultRunGit = async ({ args, repositoryRoot }) => {
  try {
    const { stdout } = await execFileAsync(
      "git",
      ["--literal-pathspecs", "-C", repositoryRoot, ...args],
      {
        encoding: "buffer",
        env: sanitizedGitEnvironment(),
        maxBuffer: MAX_GIT_OUTPUT,
      },
    );
    return stdout;
  } catch (error) {
    const stderr = Buffer.isBuffer(error.stderr)
      ? error.stderr.toString("utf8").trim()
      : String(error.stderr || error.message).trim();
    throw new Error(`git ${args[0]} failed: ${stderr}`);
  }
};

const resolveCommit = async ({ label, ref, repositoryRoot, runGit }) => {
  const output = await runGit({
    args: ["rev-parse", "--verify", "--end-of-options", `${ref}^{commit}`],
    repositoryRoot,
  });
  const commit = output.toString("utf8").trim();
  if (!/^[0-9a-f]{40,64}$/.test(commit)) {
    throw new Error(`git returned an invalid ${label} commit: ${commit}`);
  }
  return commit;
};

const readUntrackedEntry = async ({ relativePath, repositoryRoot }) => {
  const absolutePath = path.join(repositoryRoot, relativePath);
  const metadata = await lstat(absolutePath);
  if (metadata.isSymbolicLink()) {
    return {
      content: await readlink(absolutePath, { encoding: "buffer" }),
      mode: "120000",
      path: relativePath,
    };
  }
  if (!metadata.isFile()) {
    throw new Error(`unsupported untracked entry: ${relativePath}`);
  }
  return {
    content: await readFile(absolutePath),
    mode: metadata.mode & 0o111 ? "100755" : "100644",
    path: relativePath,
  };
};

export const parseReviewFingerprintArgs = (args) => {
  if (args.length === 1 && ["-h", "--help"].includes(args[0])) {
    return { help: true };
  }
  const values = { ownedPaths: [] };
  const singleOptions = new Map([
    ["--repository-id", "repositoryId"],
    ["--repository-root", "repositoryRoot"],
    ["--integration-base", "integrationBase"],
  ]);
  for (let index = 0; index < args.length; index += 2) {
    const option = args[index];
    const value = args[index + 1];
    if (!value) {
      return { error: `Unknown or incomplete option: ${option || "<none>"}` };
    }
    if (option === "--owned-path") {
      values.ownedPaths.push(value);
      continue;
    }
    const key = singleOptions.get(option);
    if (!key) return { error: `Unknown option: ${option}` };
    if (values[key]) return { error: `Duplicate option: ${option}` };
    values[key] = value;
  }
  if (
    !values.repositoryId ||
    !values.repositoryRoot ||
    !values.integrationBase ||
    values.ownedPaths.length === 0
  ) {
    return {
      error:
        "--repository-id, --repository-root, --integration-base, and at least one --owned-path are required",
    };
  }
  return values;
};

export const computeReviewFingerprint = async ({
  integrationBase,
  ownedPaths,
  repositoryId,
  repositoryRoot,
  runGit = defaultRunGit,
}) => {
  if (!SAFE_REPOSITORY_ID.test(repositoryId || "")) {
    throw new Error(`unsafe repository ID: ${repositoryId || "<empty>"}`);
  }
  if (!repositoryRoot || !integrationBase || !ownedPaths?.length) {
    throw new Error(
      "repository root, integration base, and plan-owned paths are required",
    );
  }

  const resolvedRoot = await realpath(path.resolve(repositoryRoot));
  const gitRoot = (
    await runGit({
      args: ["rev-parse", "--show-toplevel"],
      repositoryRoot: resolvedRoot,
    })
  )
    .toString("utf8")
    .trim();
  if ((await realpath(gitRoot)) !== resolvedRoot) {
    throw new Error(
      `repository root is not a Git worktree root: ${resolvedRoot}`,
    );
  }

  const normalizedPaths = [...new Set(ownedPaths.map(normalizeOwnedPath))].sort(
    (left, right) => Buffer.compare(Buffer.from(left), Buffer.from(right)),
  );
  const baseSha = await resolveCommit({
    label: "integration-base",
    ref: integrationBase,
    repositoryRoot: resolvedRoot,
    runGit,
  });
  const headSha = await resolveCommit({
    label: "HEAD",
    ref: "HEAD",
    repositoryRoot: resolvedRoot,
    runGit,
  });
  const trackedDiff = await runGit({
    args: [
      "diff",
      "--binary",
      "--full-index",
      "--no-ext-diff",
      "--no-textconv",
      "--no-renames",
      baseSha,
      "--",
      ...normalizedPaths,
    ],
    repositoryRoot: resolvedRoot,
  });
  const untrackedPaths = splitNullTerminated(
    await runGit({
      args: [
        "ls-files",
        "--others",
        "--exclude-standard",
        "-z",
        "--",
        ...normalizedPaths,
      ],
      repositoryRoot: resolvedRoot,
    }),
  );
  const untrackedEntries = await Promise.all(
    untrackedPaths.map((relativePath) =>
      readUntrackedEntry({ relativePath, repositoryRoot: resolvedRoot }),
    ),
  );

  const untrackedHash = createHash("sha256");
  for (const entry of untrackedEntries) {
    updateField(untrackedHash, "path", entry.path);
    updateField(untrackedHash, "mode", entry.mode);
    updateField(untrackedHash, "content", entry.content);
  }
  const untrackedDigest = `sha256:${untrackedHash.digest("hex")}`;

  const aggregateHash = createHash("sha256");
  updateField(aggregateHash, "format", "review-input-fingerprint@1");
  updateField(aggregateHash, "repository", repositoryId);
  updateField(aggregateHash, "base", baseSha);
  for (const ownedPath of normalizedPaths) {
    updateField(aggregateHash, "owned-path", ownedPath);
  }
  updateField(aggregateHash, "tracked-diff", trackedDiff);
  updateField(aggregateHash, "untracked", untrackedDigest);

  return {
    baseSha,
    format: "review-input-fingerprint@1",
    headSha,
    ownedPathCount: normalizedPaths.length,
    planOwnedDigest: `sha256:${aggregateHash.digest("hex")}`,
    repositoryId,
    trackedDiffDigest: sha256(trackedDiff),
    untrackedDigest,
    untrackedFileCount: untrackedEntries.length,
  };
};

export const runReviewFingerprint = async ({
  args = process.argv.slice(2),
  output = console.log,
} = {}) => {
  const options = parseReviewFingerprintArgs(args);
  if (options.help) {
    output(
      "Usage: review-fingerprint.mjs --repository-id <id> --repository-root <path> --integration-base <ref> --owned-path <repo-relative-path> [--owned-path <path> ...]",
    );
    return { ok: true };
  }
  if (options.error) {
    output(`FAIL review:fingerprint: ${options.error}`);
    return { ok: false };
  }
  try {
    const fingerprint = await computeReviewFingerprint(options);
    output(JSON.stringify(fingerprint, null, 2));
    return { fingerprint, ok: true };
  } catch (error) {
    output(`FAIL review:fingerprint: ${error.message}`);
    return { ok: false };
  }
};

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const result = await runReviewFingerprint();
  process.exitCode = result.ok ? 0 : 1;
}
