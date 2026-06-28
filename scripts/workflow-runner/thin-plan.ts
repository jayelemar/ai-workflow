import { existsSync } from 'node:fs';
import { readFile, stat } from 'node:fs/promises';
import path from 'node:path';

type Failure = {
  ok: false;
  reason: string;
};

type WorkflowEventKind =
  | 'execution'
  | 'validation'
  | 'review'
  | 'unblock'
  | 'reopen'
  | 'deployment-validation';

const THIN_PLAN_CONTRACT = 'thin-plan-v1';
const THIN_PLAN_ENTRY_MAX_BYTES = 512;
const THIN_PLAN_HISTORY_MAX_BYTES = 4 * 1024;
const WORKFLOW_EVENT_ARTIFACT_MAX_BYTES = 20 * 1024;
const WORKFLOW_EVENT_ARTIFACT_SUMMARY_MAX_BYTES = 1024;
const THIN_PLAN_ALLOWED_EVENT_FIELDS = new Set(['Summary', 'Result', 'Decision', 'Status', 'Evidence']);
const THIN_PLAN_STATE_EVENT_FIELDS = ['Result', 'Decision', 'Status'] as const;
const THIN_PLAN_FORBIDDEN_NARRATIVE_SECTIONS = ['## Review Required Fixes'];

const rel = (...segments: string[]) => segments.join('/');

const planSectionLines = (content: string, heading: string): string[] => {
  const lines = content.split(/\r?\n/);
  const start = lines.findIndex((line) => line.trim() === heading);
  if (start === -1) {
    return [];
  }
  const collected: string[] = [];
  for (const line of lines.slice(start + 1)) {
    if (line.trim().startsWith('## ')) {
      break;
    }
    collected.push(line);
  }
  return collected;
};

const sectionLines = (content: string, heading: string): string[] | null => {
  const lines = content.split(/\r?\n/);
  const start = lines.findIndex((line) => line.trim() === heading);
  if (start === -1) {
    return null;
  }
  const collected: string[] = [];
  for (const line of lines.slice(start + 1)) {
    if (line.trim().startsWith('## ')) {
      break;
    }
    collected.push(line);
  }
  return collected;
};

const escapeRegExp = (value: string): string => value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

const extractVersionedSectionEntries = (
  content: string,
  heading: string,
): Array<{ heading: string; lines: string[] }> => {
  const lines = sectionLines(content, heading);
  if (lines === null) {
    return [];
  }

  const entries: Array<{ heading: string; lines: string[] }> = [];
  let current: { heading: string; lines: string[] } | undefined;
  for (const line of lines) {
    const trimmed = line.trim();
    if (!current && (trimmed.length === 0 || trimmed === '(empty)' || trimmed === '---')) {
      continue;
    }
    if (trimmed.startsWith('### ')) {
      current = { heading: trimmed, lines: [] };
      entries.push(current);
      continue;
    }
    if (!current) {
      continue;
    }
    current.lines.push(line);
  }

  return entries.filter((entry) => entry.lines.some((line) => line.trim().length > 0));
};

const workflowEventSections = [
  { section: '## Execution Log', label: 'Execution', kind: 'execution' },
  { section: '## Validation History', label: 'Validation', kind: 'validation' },
  { section: '## Review History', label: 'Review', kind: 'review' },
  { section: '## Unblock History', label: 'Unblock', kind: 'unblock' },
  { section: '## Reopen History', label: 'Reopen', kind: 'reopen' },
  {
    section: '## Deployment Validation',
    label: 'Deployment Validation',
    kind: 'deployment-validation',
  },
] as const satisfies ReadonlyArray<{
  section: string;
  label: string;
  kind: WorkflowEventKind;
}>;

const expectedWorkflowEventArtifactPath = (
  planName: string,
  kind: WorkflowEventKind,
  version: number,
): string => rel('.ai', 'artifacts', planName, 'events', `${kind}-v${version}.md`);

const parseWorkflowEventHeading = (
  heading: string,
  label: string,
): { ok: true; version: number } | Failure => {
  const match = heading.match(new RegExp(`^###\\s+${escapeRegExp(label)}\\s+v(\\d+)\\s*$`, 'i'));
  if (!match) {
    return {
      ok: false,
      reason: `thin-plan entry heading must be "### ${label} v<N>", got ${heading}`,
    };
  }
  const version = Number(match[1]);
  if (!Number.isInteger(version) || version <= 0) {
    return { ok: false, reason: `thin-plan entry version must be positive: ${heading}` };
  }
  return { ok: true, version };
};

const rawFieldValue = (lines: string[], fieldName: string): string | undefined => {
  const pattern = new RegExp(`^\\*\\s*${escapeRegExp(fieldName)}:\\s*(.+)$`, 'i');
  for (const line of lines) {
    const match = line.trim().match(pattern);
    if (match) {
      return match[1]?.trim();
    }
  }
  return undefined;
};

const workflowEventFieldNames = (lines: string[]): string[] => {
  const fields: string[] = [];
  for (const line of lines) {
    const trimmed = line.trim();
    const match = trimmed.match(/^\*\s*([^:]+):(?:\s*(.*))?$/);
    if (match) {
      fields.push(match[1]?.trim() ?? '');
      continue;
    }
    if (trimmed.length === 0) {
      continue;
    }
    return [...fields, ''];
  }
  return fields;
};

const markdownSectionBody = (content: string, heading: string): string | undefined => {
  const lines = content.split(/\r?\n/);
  const start = lines.findIndex((line) => line.trim() === heading);
  if (start === -1) {
    return undefined;
  }
  const collected: string[] = [];
  for (const line of lines.slice(start + 1)) {
    if (/^##\s+/.test(line.trim())) {
      break;
    }
    collected.push(line);
  }
  return collected.join('\n').trim();
};

const validateWorkflowEventArtifact = async ({
  rootDir,
  relativePath,
}: {
  rootDir: string;
  relativePath: string;
}): Promise<{ ok: true } | Failure> => {
  const absolutePath = path.join(rootDir, relativePath);
  if (!existsSync(absolutePath)) {
    return { ok: false, reason: `workflow event artifact does not exist: ${relativePath}` };
  }

  let artifactStat;
  let content: string;
  try {
    artifactStat = await stat(absolutePath);
    content = await readFile(absolutePath, 'utf8');
  } catch (error) {
    return { ok: false, reason: `workflow event artifact cannot be read: ${relativePath}: ${String(error)}` };
  }

  if (artifactStat.size > WORKFLOW_EVENT_ARTIFACT_MAX_BYTES) {
    return { ok: false, reason: `workflow event artifact exceeds 20 KB: ${relativePath}` };
  }
  if (!/^#\s+.+$/m.test(content)) {
    return { ok: false, reason: `workflow event artifact is missing a top-level heading: ${relativePath}` };
  }
  const summary = markdownSectionBody(content, '## Summary');
  if (!summary) {
    return { ok: false, reason: `workflow event artifact is missing ## Summary: ${relativePath}` };
  }
  if (Buffer.byteLength(summary, 'utf8') > WORKFLOW_EVENT_ARTIFACT_SUMMARY_MAX_BYTES) {
    return { ok: false, reason: `workflow event artifact summary exceeds 1 KB: ${relativePath}` };
  }
  const evidence = markdownSectionBody(content, '## Evidence');
  if (!evidence) {
    return { ok: false, reason: `workflow event artifact is missing ## Evidence: ${relativePath}` };
  }

  return { ok: true };
};

export const validateThinPlanContract = async ({
  rootDir,
  planName,
  content,
}: {
  rootDir: string;
  planName: string;
  content: string;
}): Promise<{ ok: true } | Failure> => {
  const contentRules = planSectionLines(content, '## Workflow Content Rules');
  if (!contentRules.some((line) => line.trim() === THIN_PLAN_CONTRACT)) {
    return { ok: false, reason: `plan is missing ${THIN_PLAN_CONTRACT}` };
  }

  for (const section of THIN_PLAN_FORBIDDEN_NARRATIVE_SECTIONS) {
    if (content.split(/\r?\n/).some((line) => line.trim() === section)) {
      return {
        ok: false,
        reason: `thin-plan contains forbidden narrative section ${section.replace(/^##\s+/, '')}`,
      };
    }
  }

  let workflowHistoryBytes = 0;
  for (const { section, label, kind } of workflowEventSections) {
    const entries = extractVersionedSectionEntries(content, section);
    for (const entry of entries) {
      const parsedHeading = parseWorkflowEventHeading(entry.heading, label);
      if (!parsedHeading.ok) {
        return parsedHeading;
      }

      const entryContent = [entry.heading, ...entry.lines].join('\n').trim();
      if (Buffer.byteLength(entryContent, 'utf8') > THIN_PLAN_ENTRY_MAX_BYTES) {
        return {
          ok: false,
          reason: `thin-plan ${label} v${parsedHeading.version} entry exceeds 512 bytes`,
        };
      }
      workflowHistoryBytes += Buffer.byteLength(entryContent, 'utf8');

      const fieldNames = workflowEventFieldNames(entry.lines);
      const unsupportedField = fieldNames.find((fieldName) => {
        if (!fieldName) {
          return true;
        }
        return ![...THIN_PLAN_ALLOWED_EVENT_FIELDS].some(
          (allowedField) => allowedField.toLowerCase() === fieldName.toLowerCase(),
        );
      });
      if (unsupportedField !== undefined) {
        return {
          ok: false,
          reason: `thin-plan ${label} v${parsedHeading.version} has unsupported field ${unsupportedField || '<inline detail>'}`,
        };
      }

      const summary = rawFieldValue(entry.lines, 'Summary');
      if (!summary) {
        return {
          ok: false,
          reason: `thin-plan ${label} v${parsedHeading.version} is missing Summary`,
        };
      }
      const stateFields = THIN_PLAN_STATE_EVENT_FIELDS.filter((fieldName) =>
        rawFieldValue(entry.lines, fieldName),
      );
      if (stateFields.length !== 1) {
        return {
          ok: false,
          reason: `thin-plan ${label} v${parsedHeading.version} must contain exactly one of Result, Decision, or Status`,
        };
      }
      const evidencePath = rawFieldValue(entry.lines, 'Evidence');
      const expectedPath = expectedWorkflowEventArtifactPath(
        planName,
        kind,
        parsedHeading.version,
      );
      if (!evidencePath) {
        return {
          ok: false,
          reason: `thin-plan ${label} v${parsedHeading.version} is missing Evidence`,
        };
      }
      if (evidencePath !== expectedPath) {
        return {
          ok: false,
          reason: `thin-plan ${label} v${parsedHeading.version} evidence path must be ${expectedPath}`,
        };
      }

      const artifact = await validateWorkflowEventArtifact({ rootDir, relativePath: evidencePath });
      if (!artifact.ok) {
        return artifact;
      }
    }
  }

  if (workflowHistoryBytes > THIN_PLAN_HISTORY_MAX_BYTES) {
    return { ok: false, reason: `thin-plan workflow history exceeds 4 KB` };
  }

  return { ok: true };
};
