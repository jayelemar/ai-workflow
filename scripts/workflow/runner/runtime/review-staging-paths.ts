import {
  defaultIsIgnored,
  parseReviewStagingPaths,
} from "../review/staging.ts";
import type { FileOwnershipPreflight } from "../types.ts";

export const resolveReviewStagingPaths = async ({
  rootDir,
  planContent,
  ownershipPreflight,
  isIgnored,
}: {
  rootDir: string;
  planContent: string;
  ownershipPreflight?: FileOwnershipPreflight;
  isIgnored?: (relativePath: string) => boolean;
}) => {
  if (
    ownershipPreflight?.hasOwnershipScope &&
    ownershipPreflight.reviewStagingPaths
  ) {
    return ownershipPreflight.reviewStagingPaths.length > 0
      ? { ok: true as const, paths: ownershipPreflight.reviewStagingPaths }
      : {
          ok: false as const,
          reason: "plan has no changed ownership files to stage for review",
        };
  }
  return await parseReviewStagingPaths({
    content: planContent,
    rootDir,
    isIgnored:
      isIgnored ?? ((relativePath) => defaultIsIgnored(rootDir, relativePath)),
  });
};
