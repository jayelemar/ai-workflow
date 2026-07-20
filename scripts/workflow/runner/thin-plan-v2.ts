import { existsSync } from "node:fs";
import { stat } from "node:fs/promises";
import path from "node:path";
import type { ThinPlanFailure, ThinPlanSuccess } from "./thin-plan-types.ts";

const FORBIDDEN_INLINE_SECTIONS = [
  "## Flow-to-File Mapping", "## Implementation Map", "## Execution Log",
  "## Validation History", "## Review History", "## Unblock History",
  "## Reopen History", "## Blockers", "## Ownership Scope",
  "## File Ownership Releases", "## Hunk Ownership", "## Files (MANDATORY)",
];
const rel = (...segments: string[]) => segments.join("/");
const sectionLines = (content: string, heading: string): string[] | null => {
  const lines = content.split(/\r?\n/);
  const start = lines.findIndex((line) => line.trim() === heading);
  if (start === -1) return null;
  const collected: string[] = [];
  for (const line of lines.slice(start + 1)) {
    if (line.trim().startsWith("## ")) break;
    collected.push(line);
  }
  return collected;
};
const expectedArtifacts = (planName: string): Array<{ path: string; kind: "file" | "dir" }> => [
  { path: rel(".ai", "artifacts", planName, "implementation-map.md"), kind: "file" },
  { path: rel(".ai", "artifacts", planName, "state", "workflow.json"), kind: "file" },
  { path: rel(".ai", "artifacts", planName, "state", "file-ownership.json"), kind: "file" },
  { path: rel(".ai", "artifacts", planName, "state", "files.json"), kind: "file" },
  { path: rel(".ai", "artifacts", planName, "state", "context.md"), kind: "file" },
  { path: rel(".ai", "artifacts", planName, "events"), kind: "dir" },
];

export const validateThinPlanV2 = async ({ rootDir, planName, content }: { rootDir: string; planName: string; content: string }): Promise<ThinPlanSuccess | ThinPlanFailure> => {
  for (const section of FORBIDDEN_INLINE_SECTIONS) {
    if (content.split(/\r?\n/).some((line) => line.trim() === section)) return { ok: false, reason: `thin-plan-v2 contains forbidden inline section ${section.replace(/^##\s+/, "")}` };
  }
  const artifactsBody = sectionLines(content, "## Artifacts");
  if (artifactsBody === null) return { ok: false, reason: "thin-plan-v2 is missing ## Artifacts" };
  const artifactText = artifactsBody.join("\n");
  for (const artifact of expectedArtifacts(planName)) {
    if (!artifactText.includes(artifact.path)) return { ok: false, reason: `thin-plan-v2 ## Artifacts is missing ${artifact.path}` };
    const absolutePath = path.join(rootDir, artifact.path);
    if (!existsSync(absolutePath)) return { ok: false, reason: `thin-plan-v2 artifact does not exist: ${artifact.path}` };
    const artifactStat = await stat(absolutePath).catch(() => undefined);
    if (!artifactStat) return { ok: false, reason: `thin-plan-v2 artifact cannot be read: ${artifact.path}` };
    if (artifact.kind === "file" && !artifactStat.isFile()) return { ok: false, reason: `thin-plan-v2 artifact is not a file: ${artifact.path}` };
    if (artifact.kind === "dir" && !artifactStat.isDirectory()) return { ok: false, reason: `thin-plan-v2 artifact is not a directory: ${artifact.path}` };
  }
  return { ok: true, warnings: [], contract: "thin-plan-v2" };
};
