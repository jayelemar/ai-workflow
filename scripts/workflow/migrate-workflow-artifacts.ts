import { readFile, writeFile } from "node:fs/promises";
import path from "node:path";

import { normalizePlanArgument } from "./runner/cli.ts";
import { thinPlanArtifactPath } from "./runner/plan/thin-plan-sidecars.ts";

type Cli = { planPath: string; apply: boolean };

const usage =
  "Usage: pnpm exec tsx .ai/scripts/workflow/migrate-workflow-artifacts.ts --plan .ai/plans/<name>.md --apply";

const parseCli = (argv: string[]): Cli => {
  const planIndex = argv.indexOf("--plan");
  const planPath = planIndex >= 0 ? argv[planIndex + 1] : undefined;
  if (!planPath || argv.some((arg) => !["--plan", planPath, "--apply"].includes(arg))) {
    throw new Error(usage);
  }
  if (!argv.includes("--apply")) {
    throw new Error(`${usage}\nRefusing to modify files without --apply.`);
  }
  return { planPath, apply: true };
};

const sectionLines = (content: string, heading: string): string[] => {
  const lines = content.split(/\r?\n/);
  const start = lines.findIndex((line) => line.trim() === heading);
  if (start < 0) return [];
  const section: string[] = [];
  for (const line of lines.slice(start + 1)) {
    if (line.trim().startsWith("## ")) break;
    section.push(line);
  }
  return section;
};

const field = (lines: string[], name: string): string | undefined =>
  lines
    .map((line) => new RegExp(`^\\s*\\*\\s*${name}:\\s*(.+)$`, "i").exec(line)?.[1]?.trim())
    .find((value): value is string => Boolean(value));

const removeSection = (content: string, heading: string): string => {
  const lines = content.split(/\r?\n/);
  const start = lines.findIndex((line) => line.trim() === heading);
  if (start < 0) return content;
  let end = start + 1;
  while (end < lines.length && !lines[end].trim().startsWith("## ")) end += 1;
  lines.splice(start, end - start);
  return lines.join("\n").replace(/\n{3,}/g, "\n\n");
};

const eventSection = (content: string, heading: string): string[] =>
  sectionLines(content, heading)
    .map((line) => line.trim())
    .filter(Boolean);

const migration = async ({ rootDir, cli }: { rootDir: string; cli: Cli }): Promise<void> => {
  const normalized = normalizePlanArgument(cli.planPath);
  if (!normalized.ok) throw new Error(normalized.reason);
  const planAbsolute = path.join(rootDir, normalized.planPath);
  const manifest = await readFile(planAbsolute, "utf8");
  const reviewHistory = sectionLines(manifest, "## Review History");
  if (reviewHistory.length === 0) {
    throw new Error("migration requires an existing inline ## Review History section");
  }
  const evidencePath = field(reviewHistory, "Evidence");
  const decision = field(reviewHistory, "Decision")?.toLowerCase();
  const workflowPath = thinPlanArtifactPath(normalized.planName, "state", "workflow.json");
  const workflowAbsolute = path.join(rootDir, workflowPath);
  const workflowRaw = JSON.parse(await readFile(workflowAbsolute, "utf8")) as Record<string, unknown>;
  const latest = workflowRaw.latest && typeof workflowRaw.latest === "object"
    ? workflowRaw.latest as Record<string, unknown>
    : undefined;
  const oldReview = latest?.review && typeof latest.review === "object"
    ? latest.review as Record<string, unknown>
    : undefined;
  if (!evidencePath || !decision || !oldReview) {
    throw new Error("migration proof is incomplete: inline evidence, decision, and latest.review are required");
  }
  const version = /^\.ai\/artifacts\/[a-z0-9-]+\/events\/review-v(\d+)\.md$/.exec(evidencePath)?.[1];
  if (!version || Number(version) <= 0) {
    throw new Error("migration proof is incomplete: review evidence path must be a positive sequential review-vN artifact");
  }
  if (typeof oldReview.version === "number" && oldReview.version !== Number(version)) {
    throw new Error("migration proof is incomplete: latest.review version does not match the evidence artifact");
  }
  const target = workflowRaw.workflowState;
  if ((target !== "active" && target !== "completed") || decision !== target || oldReview.decision !== target) {
    throw new Error("migration proof is incomplete: manifest decision, latest.review decision, and target workflow state must match active or completed");
  }
  const event = await readFile(path.join(rootDir, evidencePath), "utf8");
  if (!event.split(/\r?\n/).some((line) => line.trim() === `# Review v${version}`)) {
    throw new Error("migration proof is incomplete: event title does not match review version");
  }
  const summary = eventSection(event, "## Summary").join(" ").trim();
  const evidence = eventSection(event, "## Evidence").join(" ").trim();
  const outcome = eventSection(event, "## Outcome").join(" ").trim().toLowerCase();
  if (!summary || !evidence || !outcome) {
    throw new Error("migration proof is incomplete: event requires non-empty Outcome, Summary, and Evidence");
  }
  if (outcome !== target) {
    throw new Error("migration proof is incomplete: event outcome does not match the target workflow state");
  }
  const remediation = [
    ...eventSection(event, "## Remediation"),
    ...eventSection(event, "## Issues"),
  ].map((line) => line.replace(/^[*-]\s*/, "").trim()).filter(Boolean);
  if (target === "active" && remediation.length === 0) {
    throw new Error("migration proof is incomplete: active failed review requires remediation in its event artifact");
  }
  const history = Array.isArray(workflowRaw.history) && workflowRaw.history.every((item) => typeof item === "string")
    ? workflowRaw.history as string[]
    : [];
  const nextWorkflow = {
    ...workflowRaw,
    documentFormat: "workflow-state@1",
    workflowState: target,
    latest: {
      ...latest,
      review: {
        version: Number(version),
        outcome: target,
        summary,
        evidence: evidencePath,
        ...(target === "active" ? { unresolvedFindings: remediation } : {}),
      },
    },
    history: history.includes(evidencePath) ? history : [...history, evidencePath],
    unresolvedBlockers: target === "active" ? remediation : [],
    updatedAt: new Date().toISOString(),
  };
  if (!cli.apply) return;
  await writeFile(planAbsolute, removeSection(manifest, "## Review History"), "utf8");
  await writeFile(workflowAbsolute, `${JSON.stringify(nextWorkflow, null, 2)}\n`, "utf8");
  process.stdout.write(`Migrated provable inline review history for ${normalized.planPath}.\n`);
};

const main = async (): Promise<void> => {
  const cli = parseCli(process.argv.slice(2));
  await migration({ rootDir: process.cwd(), cli });
};

if (import.meta.url === `file://${process.argv[1]}`) {
  main().catch((error) => {
    process.stderr.write(`${String(error)}\n`);
    process.exitCode = 1;
  });
}

export { migration };
