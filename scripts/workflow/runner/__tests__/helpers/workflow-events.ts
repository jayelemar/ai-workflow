import { mkdirSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";

export const writeWorkflowEventArtifactSync = ({
  root,
  planName,
  kind,
  version,
  outcome = kind === "sync"
    ? "ready"
    : kind === "validation"
      ? "approved"
      : kind === "review"
        ? "completed"
        : kind === "reopen" || kind === "unblock"
          ? "active"
          : "review-ready",
  summary = "Artifact summary.",
  evidence = "Artifact evidence.",
  remediation = [],
}: {
  root: string;
  planName: string;
  kind: string;
  version: number;
  outcome?: string;
  summary?: string;
  evidence?: string;
  remediation?: string[];
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
    `# ${kind.slice(0, 1).toUpperCase()}${kind.slice(1)} v${version}

## Outcome

${outcome}

## Summary

${summary}

## Evidence

${evidence}
${remediation.length > 0 ? `
## Remediation

${remediation.map((item) => `* ${item}`).join("\n")}
` : ""}
`,
    "utf8",
  );
};

export const writeWorkflowEventArtifact = async (
  options: Parameters<typeof writeWorkflowEventArtifactSync>[0],
) => {
  writeWorkflowEventArtifactSync(options);
};
