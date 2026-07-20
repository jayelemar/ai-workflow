import { existsSync } from "node:fs";
import { readFile, stat } from "node:fs/promises";
import path from "node:path";
import type { ThinPlanFailure, ThinPlanSuccess } from "./thin-plan-types.ts";

type WorkflowEventKind = "execution" | "validation" | "review" | "unblock" | "reopen";
const ENTRY_MAX_BYTES = 512;
const HISTORY_MAX_BYTES = 4 * 1024;
const WORKFLOW_EVENT_ARTIFACT_MAX_BYTES = 20 * 1024;
const WORKFLOW_EVENT_ARTIFACT_SUMMARY_MAX_BYTES = 1024;
const ALLOWED_FIELDS = new Set(["Summary", "Result", "Decision", "Status", "Evidence"]);
const STATE_FIELDS = ["Result", "Decision", "Status"] as const;
const FORBIDDEN_SECTIONS = ["## Review Required Fixes"];
const rel = (...segments: string[]) => segments.join("/");
const formatKilobytes = (bytes: number): string => `${(bytes / 1024).toFixed(1)} KB`;
const escapeRegExp = (value: string): string => value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

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

const versionedEntries = (content: string, heading: string): Array<{ heading: string; lines: string[] }> => {
  const lines = sectionLines(content, heading);
  if (lines === null) return [];
  const entries: Array<{ heading: string; lines: string[] }> = [];
  let current: { heading: string; lines: string[] } | undefined;
  for (const line of lines) {
    const trimmed = line.trim();
    if (!current && (trimmed.length === 0 || trimmed === "(empty)" || trimmed === "---")) continue;
    if (trimmed.startsWith("### ")) {
      current = { heading: trimmed, lines: [] };
      entries.push(current);
      continue;
    }
    if (current) current.lines.push(line);
  }
  return entries.filter((entry) => entry.lines.some((line) => line.trim().length > 0));
};

const events = [
  { section: "## Execution Log", label: "Execution", kind: "execution" },
  { section: "## Validation History", label: "Validation", kind: "validation" },
  { section: "## Review History", label: "Review", kind: "review" },
  { section: "## Unblock History", label: "Unblock", kind: "unblock" },
  { section: "## Reopen History", label: "Reopen", kind: "reopen" },
] as const satisfies ReadonlyArray<{ section: string; label: string; kind: WorkflowEventKind }>;

const evidencePath = (planName: string, kind: WorkflowEventKind, version: number): string =>
  rel(".ai", "artifacts", planName, "events", `${kind}-v${version}.md`);

const headingVersion = (heading: string, label: string): { ok: true; version: number } | ThinPlanFailure => {
  const match = heading.match(new RegExp(`^###\\s+${escapeRegExp(label)}\\s+v(\\d+)\\s*$`, "i"));
  if (!match) return { ok: false, reason: `thin-plan entry heading must be "### ${label} v<N>", got ${heading}` };
  const version = Number(match[1]);
  return Number.isInteger(version) && version > 0 ? { ok: true, version } : { ok: false, reason: `thin-plan entry version must be positive: ${heading}` };
};

const fieldValue = (lines: string[], fieldName: string): string | undefined => {
  const pattern = new RegExp(`^\\*\\s*${escapeRegExp(fieldName)}:\\s*(.+)$`, "i");
  for (const line of lines) {
    const match = line.trim().match(pattern);
    if (match) return match[1]?.trim();
  }
  return undefined;
};

const fieldNames = (lines: string[]): string[] => {
  const fields: string[] = [];
  for (const line of lines) {
    const trimmed = line.trim();
    const match = trimmed.match(/^\*\s*([^:]+):(?:\s*(.*))?$/);
    if (match) { fields.push(match[1]?.trim() ?? ""); continue; }
    if (trimmed.length === 0) continue;
    return [...fields, ""];
  }
  return fields;
};

const sectionBody = (content: string, heading: string): string | undefined => {
  const lines = content.split(/\r?\n/);
  const start = lines.findIndex((line) => line.trim() === heading);
  if (start === -1) return undefined;
  const collected: string[] = [];
  for (const line of lines.slice(start + 1)) {
    if (/^##\s+/.test(line.trim())) break;
    collected.push(line);
  }
  return collected.join("\n").trim();
};

const validateArtifact = async (rootDir: string, relativePath: string): Promise<{ ok: true } | ThinPlanFailure> => {
  const absolutePath = path.join(rootDir, relativePath);
  if (!existsSync(absolutePath)) return { ok: false, reason: `workflow event artifact does not exist: ${relativePath}` };
  let artifactStat; let content: string;
  try { artifactStat = await stat(absolutePath); content = await readFile(absolutePath, "utf8"); } catch (error) { return { ok: false, reason: `workflow event artifact cannot be read: ${relativePath}: ${String(error)}` }; }
  if (artifactStat.size > WORKFLOW_EVENT_ARTIFACT_MAX_BYTES) return { ok: false, reason: `workflow event artifact exceeds 20 KB: ${relativePath}` };
  if (!/^#\s+.+$/m.test(content)) return { ok: false, reason: `workflow event artifact is missing a top-level heading: ${relativePath}` };
  const summary = sectionBody(content, "## Summary");
  if (!summary) return { ok: false, reason: `workflow event artifact is missing ## Summary: ${relativePath}` };
  if (Buffer.byteLength(summary, "utf8") > WORKFLOW_EVENT_ARTIFACT_SUMMARY_MAX_BYTES) return { ok: false, reason: `workflow event artifact summary exceeds 1 KB: ${relativePath}` };
  if (!sectionBody(content, "## Evidence")) return { ok: false, reason: `workflow event artifact is missing ## Evidence: ${relativePath}` };
  return { ok: true };
};

export const validateThinPlanV1 = async ({ rootDir, planName, content }: { rootDir: string; planName: string; content: string }): Promise<ThinPlanSuccess | ThinPlanFailure> => {
  for (const section of FORBIDDEN_SECTIONS) if (content.split(/\r?\n/).some((line) => line.trim() === section)) return { ok: false, reason: `thin-plan contains forbidden narrative section ${section.replace(/^##\s+/, "")}` };
  let historyBytes = 0;
  for (const { section, label, kind } of events) for (const entry of versionedEntries(content, section)) {
    const parsed = headingVersion(entry.heading, label);
    if (!parsed.ok) return parsed;
    const entryContent = [entry.heading, ...entry.lines].join("\n").trim();
    if (Buffer.byteLength(entryContent, "utf8") > ENTRY_MAX_BYTES) return { ok: false, reason: `thin-plan ${label} v${parsed.version} entry exceeds 512 bytes` };
    historyBytes += Buffer.byteLength(entryContent, "utf8");
    const unsupported = fieldNames(entry.lines).find((fieldName) => !fieldName || ![...ALLOWED_FIELDS].some((allowed) => allowed.toLowerCase() === fieldName.toLowerCase()));
    if (unsupported !== undefined) return { ok: false, reason: `thin-plan ${label} v${parsed.version} has unsupported field ${unsupported || "<inline detail>"}` };
    if (!fieldValue(entry.lines, "Summary")) return { ok: false, reason: `thin-plan ${label} v${parsed.version} is missing Summary` };
    const states = STATE_FIELDS.filter((field) => fieldValue(entry.lines, field));
    if (states.length !== 1) return { ok: false, reason: `thin-plan ${label} v${parsed.version} must contain exactly one of Result, Decision, or Status` };
    const evidence = fieldValue(entry.lines, "Evidence");
    if (!evidence) return { ok: false, reason: `thin-plan ${label} v${parsed.version} is missing Evidence` };
    const expected = evidencePath(planName, kind, parsed.version);
    if (evidence !== expected) return { ok: false, reason: `thin-plan ${label} v${parsed.version} evidence path must be ${expected}` };
    const artifact = await validateArtifact(rootDir, evidence);
    if (!artifact.ok) return artifact;
  }
  const warnings = historyBytes > HISTORY_MAX_BYTES ? [`Thin-plan workflow history is ${formatKilobytes(historyBytes)} > 4 KB; keep only current inline history and leave details in .ai/artifacts/<plan-name>/events/.`] : [];
  return { ok: true, warnings, contract: "thin-plan-v1" };
};
