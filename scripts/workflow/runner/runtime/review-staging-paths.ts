import {
  defaultIsIgnored,
  parseReviewStagingPaths,
  validateConcretePlanFilePath,
} from "../review/staging.ts";
import type { FileOwnershipPreflight } from "../types.ts";

const uniquePaths = (paths: string[]): string[] => [...new Set(paths)];

const latestReviewRemediationPaths = async ({
  planContent,
  rootDir,
  isIgnored,
}: {
  planContent: string;
  rootDir: string;
  isIgnored: (relativePath: string) => Promise<boolean>;
}): Promise<string[]> => {
  const lines = planContent.split(/\r?\n/);
  const latestReviewStart = lines.findIndex(
    (line) => line.trim().startsWith("### Latest Review Event (generated)"),
  );
  if (latestReviewStart < 0) {
    return [];
  }

  const paths: string[] = [];
  let inRemediation = false;
  for (const line of lines.slice(latestReviewStart + 1)) {
    const trimmed = line.trim();
    if (trimmed.startsWith("### ") || trimmed.startsWith("## ")) {
      break;
    }
    if (trimmed === "* Remediation:") {
      inRemediation = true;
      continue;
    }
    if (!inRemediation || !trimmed.startsWith("*")) {
      continue;
    }
    for (const match of trimmed.matchAll(/`([^`]+)`/g)) {
      const candidate = match[1]?.trim() ?? "";
      // Remediation is agent-authored evidence. Accept only a literal
      // repo-relative file path, never a git pathspec or a command fragment.
      if (
        candidate.length === 0 ||
        !candidate.includes("/") ||
        candidate.endsWith("/") ||
        /\s/.test(candidate) ||
        /[\[\]{}*?:]/.test(candidate)
      ) {
        continue;
      }
      const validated = await validateConcretePlanFilePath({
        value: candidate,
        rootDir,
        reasonPrefix: "review remediation path",
      });
      if (!validated.ok || (await isIgnored(validated.path))) {
        continue;
      }
      paths.push(validated.path);
    }
  }
  return uniquePaths(paths);
};

const nonIgnoredPaths = async (
  paths: string[],
  isIgnored: (relativePath: string) => Promise<boolean>,
): Promise<string[]> => {
  const included: string[] = [];
  for (const candidate of paths) {
    if (!(await isIgnored(candidate))) {
      included.push(candidate);
    }
  }
  return uniquePaths(included);
};

export const resolveReviewStagingPaths = async ({
  rootDir,
  planContent,
  ownershipPreflight,
  isIgnored,
}: {
  rootDir: string;
  planContent: string;
  ownershipPreflight?: FileOwnershipPreflight;
  isIgnored?: (relativePath: string) => Promise<boolean>;
}) => {
  const ignored =
    isIgnored ?? ((relativePath) => defaultIsIgnored(rootDir, relativePath));
  const remediationPaths = await latestReviewRemediationPaths({
    planContent,
    rootDir,
    isIgnored: ignored,
  });
  if (
    ownershipPreflight?.hasOwnershipScope &&
    ownershipPreflight.reviewStagingPaths
  ) {
    // The task file inventory can lag an execution repair. Include every
    // concrete path already owned by this plan; runReviewStagingForPaths later
    // filters this candidate list down to files that are actually dirty.
    const planOwnedPaths = await nonIgnoredPaths(
      ownershipPreflight.artifact.resolvedFiles,
      ignored,
    );
    const paths = uniquePaths([
      ...ownershipPreflight.reviewStagingPaths,
      ...planOwnedPaths,
      ...remediationPaths,
    ]);
    return paths.length > 0
      ? { ok: true as const, paths }
      : {
          ok: false as const,
          reason: "plan has no changed ownership or review-remediation files to stage for review",
        };
  }
  const parsed = await parseReviewStagingPaths({
    content: planContent,
    rootDir,
    isIgnored: ignored,
  });
  if (!parsed.ok) {
    return parsed;
  }
  return { ok: true as const, paths: uniquePaths([...parsed.paths, ...remediationPaths]) };
};
