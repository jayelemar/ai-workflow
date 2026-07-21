import { readFile, writeFile } from "node:fs/promises";
import path from "node:path";

import {
  DOCUMENT_FORMATS,
  type DocumentKind,
  validateDocumentFormat,
  validatePlanDocumentBundle,
} from "./document-formats.ts";

type Cli = { planPath: string; apply: boolean } | { error: string };

const parseCli = (argv: string[]): Cli => {
  const planIndex = argv.indexOf("--plan");
  const planPath = planIndex >= 0 ? argv[planIndex + 1] : undefined;
  if (!planPath || !/^\.ai\/plans\/[^/]+\.md$/.test(planPath)) {
    return { error: "Usage: pnpm exec tsx .ai/scripts/workflow/migrate-document-formats.ts --plan .ai/plans/<name>.md [--apply]" };
  }
  return { planPath, apply: argv.includes("--apply") };
};

const planNameFromPath = (planPath: string): string => path.basename(planPath, ".md");
const insertMarkdownFormat = (content: string, format: string): string => {
  const lines = content.split(/\r?\n/);
  if (!lines[0]?.startsWith("# ")) throw new Error("document is missing a top-level title");
  const existingIndex = lines.findIndex((line) => line.trim() === "## Document Format");
  if (existingIndex >= 0) {
    const valueIndex = lines.findIndex((line, index) => index > existingIndex && line.trim().length > 0);
    if (valueIndex >= 0) lines[valueIndex] = format;
    return lines.join("\n");
  }
  lines.splice(1, 0, "", "## Document Format", "", format, "");
  return lines.join("\n");
};
const withJsonFormat = (content: string, format: string): string => {
  const parsed = JSON.parse(content) as Record<string, unknown>;
  return `${JSON.stringify({ ...parsed, documentFormat: format }, null, 2)}\n`;
};
const sectionValue = (content: string, heading: string): string | undefined => {
  const lines = content.split(/\r?\n/);
  const index = lines.findIndex((line) => line.trim() === heading);
  return index < 0 ? undefined : lines.slice(index + 1).find((line) => line.trim())?.trim();
};
const artifactPath = (content: string, label: string): string | undefined =>
  content.split(/\r?\n/).map((line) => line.trim()).find((line) => line.startsWith(`* ${label}:`))?.slice(label.length + 3).trim().replace(/^`|`$/g, "");

const main = async (): Promise<void> => {
  const cli = parseCli(process.argv.slice(2));
  if ("error" in cli) throw new Error(cli.error);
  const rootDir = process.cwd();
  const planName = planNameFromPath(cli.planPath);
  const absolutePlanPath = path.join(rootDir, cli.planPath);
  const originalPlan = await readFile(absolutePlanPath, "utf8");
  if (sectionValue(originalPlan, "## Workflow State") === "completed") throw new Error(`refusing to migrate completed plan: ${cli.planPath}`);
  if (!originalPlan.includes("thin-plan-v2") && !originalPlan.includes("thin-plan")) throw new Error(`migration only recognizes the draft thin-plan-v2 shape: ${cli.planPath}`);
  const specPath = originalPlan.match(/^\.ai\/specs\/[^\s`]+\.spec\.md$/m)?.[0];
  if (!specPath) throw new Error(`plan is missing a linked spec path: ${cli.planPath}`);
  const owned: Array<{ relativePath: string; kind: DocumentKind; transform: (value: string) => string }> = [
    { relativePath: cli.planPath, kind: "planManifest", transform: (value) => insertMarkdownFormat(value.replaceAll("thin-plan-v2", "thin-plan"), DOCUMENT_FORMATS.planManifest) },
    { relativePath: specPath, kind: "featureSpec", transform: (value) => insertMarkdownFormat(value, DOCUMENT_FORMATS.featureSpec) },
    { relativePath: `.ai/artifacts/${planName}/state/workflow.json`, kind: "workflowState", transform: (value) => withJsonFormat(value, DOCUMENT_FORMATS.workflowState) },
    { relativePath: `.ai/artifacts/${planName}/state/file-ownership.json`, kind: "fileOwnership", transform: (value) => withJsonFormat(value, DOCUMENT_FORMATS.fileOwnership) },
    { relativePath: `.ai/artifacts/${planName}/state/files.json`, kind: "filesState", transform: (value) => withJsonFormat(value, DOCUMENT_FORMATS.filesState) },
  ];
  for (const [label, kind, format] of [["User journey", "userJourney", DOCUMENT_FORMATS.userJourney], ["Implementation map", "implementationMap", DOCUMENT_FORMATS.implementationMap], ["Manual handoff", "manualHandoff", DOCUMENT_FORMATS.manualHandoff]] as const) {
    const relativePath = artifactPath(originalPlan, label);
    if (relativePath && !relativePath.startsWith("N/A:")) owned.push({ relativePath, kind, transform: (value) => insertMarkdownFormat(value, format) });
  }
  const prepared = await Promise.all(owned.map(async (entry) => ({ ...entry, before: await readFile(path.join(rootDir, entry.relativePath), "utf8") })));
  for (const entry of prepared) {
    const after = entry.transform(entry.before);
    const content = entry.kind === "workflowState" || entry.kind === "fileOwnership" || entry.kind === "filesState" ? JSON.parse(after) : after;
    const valid = validateDocumentFormat(entry.kind, content, entry.relativePath);
    if (valid.ok === false) throw new Error(`migration preflight failed: ${valid.reason}`);
  }
  if (!cli.apply) {
    console.log(`Migration preview: ${cli.planPath}`);
    console.log(`Would update ${owned.map((entry) => entry.relativePath).join(", ")}`);
    console.log("Re-run with --apply to write changes.");
    return;
  }
  for (const entry of prepared) {
    const after = entry.transform(entry.before);
    if (after !== entry.before) await writeFile(path.join(rootDir, entry.relativePath), after, "utf8");
  }
  const migratedPlan = await readFile(absolutePlanPath, "utf8");
  const validated = await validatePlanDocumentBundle({ rootDir, planPath: cli.planPath, planName, planContent: migratedPlan });
  if (validated.ok === false) throw new Error(`migration wrote an invalid bundle: ${validated.reason}`);
  console.log(`Migrated document formats for ${cli.planPath}.`);
};

main().catch((error) => {
  console.error(`FAILED: ${error instanceof Error ? error.message : String(error)}`);
  process.exitCode = 1;
});

export { insertMarkdownFormat, withJsonFormat, parseCli };
