import { readFile } from "node:fs/promises";
import path from "node:path";

export const DOCUMENT_FORMATS = {
  featureSpec: "feature-spec@1",
  planManifest: "plan-manifest@1",
  userJourney: "user-journey@1",
  implementationMap: "implementation-map@1",
  manualHandoff: "manual-handoff@1",
  workflowState: "workflow-state@1",
  fileOwnership: "file-ownership@1",
  filesState: "files-state@1",
} as const;

export type DocumentKind = keyof typeof DOCUMENT_FORMATS;
export type DocumentFormatFailure = { ok: false; reason: string };
export type DocumentFormatSuccess = { ok: true };
export type DocumentFormatResult = DocumentFormatSuccess | DocumentFormatFailure;

const markdownRequirements: Record<
  Extract<DocumentKind, "featureSpec" | "planManifest" | "userJourney" | "implementationMap" | "manualHandoff">,
  string[]
> = {
  featureSpec: ["## Version", "## Goal", "## Inputs / Outputs", "## Behavior", "## Edge Cases", "## Constraints", "## Acceptance Criteria"],
  planManifest: ["## Workflow Content Rules", "## Execution Mode", "## Spec", "## Artifacts", "## Phases"],
  userJourney: ["## Goal", "## Actors", "## Entry Points", "## User Flows", "## Mermaid Diagram", "## States", "## Failures", "## Acceptance Scenarios", "## Open Decisions"],
  implementationMap: ["## Source Versions"],
  manualHandoff: ["## Plan", "## Repository State", "## Verified Progress", "## Decisions", "## Blockers", "## Next Action"],
};

const markdownKinds = new Set<DocumentKind>([
  "featureSpec",
  "planManifest",
  "userJourney",
  "implementationMap",
  "manualHandoff",
]);

const valueAfterHeading = (lines: string[], heading: string): string | undefined => {
  const index = lines.findIndex((line) => line.trim() === heading);
  if (index < 0) return undefined;
  return lines.slice(index + 1).find((line) => line.trim().length > 0)?.trim();
};

const markdownFormat = (
  kind: Extract<DocumentKind, "featureSpec" | "planManifest" | "userJourney" | "implementationMap" | "manualHandoff">,
  content: string,
  documentPath: string,
): DocumentFormatResult => {
  const lines = content.split(/\r?\n/);
  if (!lines[0]?.startsWith("# ")) {
    return { ok: false, reason: `document format requires a top-level title: ${documentPath}` };
  }
  const firstMeaningfulAfterTitle = lines.findIndex((line, index) => index > 0 && line.trim().length > 0);
  if (firstMeaningfulAfterTitle < 0 || lines[firstMeaningfulAfterTitle]?.trim() !== "## Document Format") {
    return { ok: false, reason: `document format declaration must immediately follow the title: ${documentPath}` };
  }
  const actual = valueAfterHeading(lines, "## Document Format");
  const expected = DOCUMENT_FORMATS[kind];
  if (actual !== expected) {
    return { ok: false, reason: `unsupported document format in ${documentPath}: expected ${expected}, got ${actual ?? "(missing)"}` };
  }
  for (const heading of markdownRequirements[kind]) {
    if (!lines.some((line) => line.trim() === heading)) {
      return { ok: false, reason: `${expected} is missing required section ${heading}: ${documentPath}` };
    }
  }
  if (kind === "implementationMap") {
    const body = lines.slice(firstMeaningfulAfterTitle + 1).join("\n").trim();
    if (!/^N\/A:\s+\S/m.test(body) && !lines.some((line) => /^### User Action:\s+\S/.test(line.trim()))) {
      return { ok: false, reason: `${expected} requires a User Action or a concrete N/A reason: ${documentPath}` };
    }
  }
  return { ok: true };
};

const jsonFormat = (kind: Exclude<DocumentKind, keyof typeof markdownRequirements>, raw: unknown, documentPath: string): DocumentFormatResult => {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) {
    return { ok: false, reason: `document must be a JSON object: ${documentPath}` };
  }
  const record = raw as Record<string, unknown>;
  const expected = DOCUMENT_FORMATS[kind];
  if (record.documentFormat !== expected) {
    return { ok: false, reason: `unsupported document format in ${documentPath}: expected ${expected}, got ${typeof record.documentFormat === "string" ? record.documentFormat : "(missing)"}` };
  }
  const arrays = (names: string[]) => names.every((name) => Array.isArray(record[name]) && record[name].every((item) => typeof item === "string"));
  if (kind === "workflowState" && (typeof record.planPath !== "string" || typeof record.workflowState !== "string" || typeof record.updatedAt !== "string" || !record.latest || typeof record.latest !== "object" || Array.isArray(record.latest) || !Array.isArray(record.history) || !arrays(["unresolvedBlockers"]))) {
    return { ok: false, reason: `${expected} is malformed: ${documentPath}` };
  }
  if (kind === "fileOwnership" && (typeof record.planPath !== "string" || typeof record.headSha !== "string" || typeof record.updatedAt !== "string" || !arrays(["owns", "released", "resolvedFiles", "changedFiles"]))) {
    return { ok: false, reason: `${expected} is malformed: ${documentPath}` };
  }
  if (kind === "filesState" && (typeof record.headSha !== "string" || !arrays(["created", "modified", "deleted", "changedFiles", "released"]))) {
    return { ok: false, reason: `${expected} is malformed: ${documentPath}` };
  }
  return { ok: true };
};

export const validateDocumentFormat = (kind: DocumentKind, content: string | unknown, documentPath: string): DocumentFormatResult => {
  if (markdownKinds.has(kind)) {
    return markdownFormat(kind as keyof typeof markdownRequirements, String(content), documentPath);
  }
  return jsonFormat(kind as Exclude<DocumentKind, keyof typeof markdownRequirements>, content, documentPath);
};

export const parseAndValidateJsonDocument = (kind: Exclude<DocumentKind, keyof typeof markdownRequirements>, raw: string, documentPath: string): unknown | DocumentFormatFailure => {
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    return { ok: false, reason: `document is malformed JSON: ${documentPath}` };
  }
  const valid = validateDocumentFormat(kind, parsed, documentPath);
  return valid.ok ? parsed : valid;
};

const artifactValue = (planContent: string, label: string): string | undefined =>
  planContent.split(/\r?\n/).map((line) => line.trim()).find((line) => line.startsWith(`* ${label}:`))?.slice(label.length + 3).trim();

const readAndValidate = async (rootDir: string, relativePath: string, kind: DocumentKind): Promise<DocumentFormatResult> => {
  let content: string;
  try {
    content = await readFile(path.join(rootDir, relativePath), "utf8");
  } catch {
    return { ok: false, reason: `required ${DOCUMENT_FORMATS[kind]} document cannot be read: ${relativePath}` };
  }
  if (markdownKinds.has(kind)) return validateDocumentFormat(kind, content, relativePath);
  let parsed: unknown;
  try {
    parsed = JSON.parse(content);
  } catch {
    return { ok: false, reason: `document is malformed JSON: ${relativePath}` };
  }
  return validateDocumentFormat(kind, parsed, relativePath);
};

export const migrationCommandFor = (planPath: string): string =>
  `pnpm exec tsx .ai/scripts/workflow/migrate-document-formats.ts --plan ${planPath} --apply`;

export const validatePlanDocumentBundle = async ({ rootDir, planPath, planName, planContent }: { rootDir: string; planPath: string; planName: string; planContent: string }): Promise<DocumentFormatResult> => {
  const fail = (reason: string): DocumentFormatFailure => ({ ok: false, reason: `${reason}. Run ${migrationCommandFor(planPath)}` });
  const manifest = validateDocumentFormat("planManifest", planContent, planPath);
  if (manifest.ok === false) return fail(manifest.reason);
  const specPath = planContent.match(/^\.ai\/specs\/[^\s`]+\.spec\.md$/m)?.[0];
  if (!specPath) return fail(`plan is missing a linked spec path: ${planPath}`);
  const spec = await readAndValidate(rootDir, specPath, "featureSpec");
  if (spec.ok === false) return fail(spec.reason);
  const artifactKinds: Array<[string, DocumentKind, string]> = [
    ["User journey", "userJourney", `.ai/artifacts/${planName}/user-journey.md`],
    ["Implementation map", "implementationMap", `.ai/artifacts/${planName}/implementation-map.md`],
    ["Manual handoff", "manualHandoff", `.ai/artifacts/${planName}/manual-handoff.md`],
  ];
  for (const [label, kind] of artifactKinds) {
    const value = artifactValue(planContent, label)?.replace(/^`|`$/g, "");
    if (!value) return fail(`plan is missing required ${label.toLowerCase()} artifact entry: ${planPath}`);
    if (value.startsWith("N/A:")) continue;
    const relativePath = value;
    const artifact = await readAndValidate(rootDir, relativePath, kind);
    if (artifact.ok === false) return fail(artifact.reason);
  }
  for (const [label, kind] of [
    ["Workflow state", "workflowState"],
    ["File ownership", "fileOwnership"],
    ["Files", "filesState"],
  ] as const) {
    const value = artifactValue(planContent, label)?.replace(/^`|`$/g, "");
    if (!value) return fail(`plan is missing required ${label.toLowerCase()} artifact entry: ${planPath}`);
    if (value.startsWith("N/A:")) return fail(`plan cannot mark required ${label.toLowerCase()} artifact N/A: ${planPath}`);
    const artifact = await readAndValidate(rootDir, value, kind);
    if (artifact.ok === false) return fail(artifact.reason);
  }
  return { ok: true };
};
