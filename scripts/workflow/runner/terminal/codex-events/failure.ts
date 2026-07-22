import type { FailureMetadataLogFields } from "../../types.ts";

export const classifyFailureForLog = (
  reason: string,
): FailureMetadataLogFields => {
  const stopMatch =
    /^(?<label>[A-Za-z0-9][A-Za-z0-9_-]* exec) output contained STOP:?\s*/.exec(
      reason,
    );
  if (stopMatch) {
    return {
      failureKind: "codex-stop",
      failureReason: reason.slice(stopMatch[0].length).trim() || "STOP",
      nextSuggestedAction:
        "inspect STOP reason, fix code or workflow evidence, then rerun workflow-runner",
    };
  }
  if (/^could not launch [A-Za-z0-9][A-Za-z0-9_-]* exec(?::|$)/.test(reason)) {
    return {
      failureKind: "codex-launch",
      failureReason: reason,
      nextSuggestedAction:
        "fix Codex launch environment, then rerun workflow-runner",
    };
  }
  if (/^[A-Za-z0-9][A-Za-z0-9_-]* exec exited with code\b/.test(reason)) {
    return {
      failureKind: "codex-exit",
      failureReason: reason,
      nextSuggestedAction:
        "inspect workflow log, fix runtime failure, then rerun workflow-runner",
    };
  }
  if (
    reason.startsWith("review preflight unstage git reset") ||
    reason.startsWith("could not launch review preflight unstage git reset")
  ) {
    return {
      failureKind: "review-unstage",
      failureReason: reason,
      nextSuggestedAction:
        "fix review preflight index cleanup, then rerun workflow-runner",
    };
  }
  if (
    reason.startsWith("review staging git add") ||
    reason.startsWith("could not launch review staging git add")
  ) {
    return {
      failureKind: "review-staging",
      failureReason: reason,
      nextSuggestedAction:
        "fix review staging paths or git error, then rerun workflow-runner",
    };
  }
  if (reason.startsWith("review hunk ownership incomplete")) {
    return {
      failureKind: "review-hunk-ownership",
      failureReason: reason,
      nextSuggestedAction:
        "update ## Hunk Ownership for shared-file hunks, then rerun workflow-runner",
    };
  }
  if (
    reason.startsWith("review cleanup git restore") ||
    reason.startsWith("could not launch review cleanup git restore")
  ) {
    return {
      failureKind: "review-unstage",
      failureReason: reason,
      nextSuggestedAction:
        "fix review cleanup git error or manually unstage plan paths, then rerun workflow-runner",
    };
  }
  if (reason.startsWith("plan-owned changes remain after commit-summary")) {
    return {
      failureKind: "dirty-plan-owned-paths",
      failureReason: reason,
      nextSuggestedAction:
        "fix commit preflight errors, then rerun workflow-runner; plan remains completed + commit-summary",
    };
  }
  if (reason.includes("may only hand off")) {
    return {
      failureKind: "invalid-transition",
      failureReason: reason,
      nextSuggestedAction:
        "fix plan workflowState, then rerun workflow-runner",
    };
  }
  if (reason.startsWith("maximum iterations ")) {
    return {
      failureKind: "max-iterations",
      failureReason: reason,
      nextSuggestedAction:
        "inspect plan progress, then resume with workflow-runner if still valid",
    };
  }
  return {
    failureKind: "runner-failure",
    failureReason: reason,
    nextSuggestedAction:
      "inspect workflow log, resolve failure, then rerun workflow-runner",
  };
};
