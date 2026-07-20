import { mkdirSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";

export const writeWorkflowEventArtifactSync = ({
  root,
  planName,
  kind,
  version,
  summary = "Artifact summary.",
  evidence = "Artifact evidence.",
}: {
  root: string;
  planName: string;
  kind: string;
  version: number;
  summary?: string;
  evidence?: string;
}) => {
  const artifactPath = join(
    root,
    ".ai",
    "artifacts",
    planName,
    "events",
    `${kind}-v${version}.md`,
  );
  mkdirSync(dirname(artifactPath), { recursive: true });
  writeFileSync(
    artifactPath,
    `# ${kind} v${version}

## Summary

${summary}

## Evidence

${evidence}
`,
    "utf8",
  );
};

export const writeWorkflowEventArtifact = async (
  options: Parameters<typeof writeWorkflowEventArtifactSync>[0],
) => {
  writeWorkflowEventArtifactSync(options);
};
