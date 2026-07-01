import { existsSync } from 'node:fs';
import { readFile, stat } from 'node:fs/promises';
import path from 'node:path';

type Failure = {
  ok: false;
  reason: string;
};

type Success = {
  ok: true;
  warnings: string[];
  contract: ThinPlanContractVersion;
};

type WorkflowEventKind =
  | 'execution'
  | 'validation'
  | 'review'
  | 'unblock'
  | 'reopen';

export type ThinPlanContractVersion = 'thin-plan-v1' | 'thin-plan-v2';

const THIN_PLAN_V1_CONTRACT = 'thin-plan-v1';
const THIN_PLAN_V2_CONTRACT = 'thin-plan-v2';
const THIN_PLAN_ENTRY_MAX_BYTES = 512;
const THIN_PLAN_HISTORY_MAX_BYTES = 4 * 1024;
const WORKFLOW_EVENT_ARTIFACT_MAX_BYTES = 20 * 1024;
const WORKFLOW_EVENT_ARTIFACT_SUMMARY_MAX_BYTES = 1024;
const THIN_PLAN_ALLOWED_EVENT_FIELDS = new Set(['Summary', 'Result', 'Decision', 'Status', 'Evidence']);
const THIN_PLAN_STATE_EVENT_FIELDS = ['Result', 'Decision', 'Status'] as const;
const THIN_PLAN_FORBIDDEN_NARRATIVE_SECTIONS = ['## Review Required Fixes'];
const THIN_PLAN_V2_FORBIDDEN_INLINE_SECTIONS = [
  '## Flow-to-File Mapping',
  '## Implementation Map',
  '## Execution Log',
  '## Validation History',
  '## Review History',
  '## Unblock History',
  '## Reopen History',
  '## Blockers',
  '## Ownership Scope',
  '## File Ownership Releases',
  '## Hunk Ownership',
  '## Files (MANDATORY)',
];

const rel = (...segments: string[]) => segments.join('/');
const formatKilobytes = (bytes: number): string => `${(bytes / 1024).toFixed(1)} KB`;

const normalizeInlineCodeValue = (value: string): string => value.trim().replace(/^`+|`+$/g, '');

export const detectThinPlanContract = (content: string): ThinPlanContractVersion | undefined => {
  const contentRules = planSectionLines(content, '## Workflow Content Rules');
  if (contentRules.some((line) => normalizeInlineCodeValue(line) === THIN_PLAN_V2_CONTRACT)) {
    return THIN_PLAN_V2_CONTRACT;
  }
  if (contentRules.some((line) => normalizeInlineCodeValue(line) === THIN_PLAN_V1_CONTRACT)) {
    return THIN_PLAN_V1_CONTRACT;
  }
  return undefined;
};

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

const expectedThinPlanV2Artifacts = (planName: string): Array<{ path: string; kind: 'file' | 'dir' }> => [
  { path: rel('.ai', 'artifacts', planName, 'implementation-map.md'), kind: 'file' },
  { path: rel('.ai', 'artifacts', planName, 'state', 'workflow.json'), kind: 'file' },
  { path: rel('.ai', 'artifacts', planName, 'state', 'file-ownership.json'), kind: 'file' },
  { path: rel('.ai', 'artifacts', planName, 'state', 'files.json'), kind: 'file' },
  { path: rel('.ai', 'artifacts', planName, 'state', 'context.md'), kind: 'file' },
  { path: rel('.ai', 'artifacts', planName, 'events'), kind: 'dir' },
];

const validateThinPlanV2Manifest = async ({
  rootDir,
  planName,
  content,
}: {
  rootDir: string;
  planName: string;
  content: string;
}): Promise<Success | Failure> => {
  for (const section of THIN_PLAN_V2_FORBIDDEN_INLINE_SECTIONS) {
    if (content.split(/\r?\n/).some((line) => line.trim() === section)) {
      return {
        ok: false,
        reason: `thin-plan-v2 contains forbidden inline section ${section.replace(/^##\s+/, '')}`,
      };
    }
  }

  const artifactsBody = sectionLines(content, '## Artifacts');
  if (artifactsBody === null) {
    return { ok: false, reason: 'thin-plan-v2 is missing ## Artifacts' };
  }
  const artifactText = artifactsBody.join('\n');

  for (const artifact of expectedThinPlanV2Artifacts(planName)) {
    if (!artifactText.includes(artifact.path)) {
      return { ok: false, reason: `thin-plan-v2 ## Artifacts is missing ${artifact.path}` };
    }
    const absolutePath = path.join(rootDir, artifact.path);
    if (!existsSync(absolutePath)) {
      return { ok: false, reason: `thin-plan-v2 artifact does not exist: ${artifact.path}` };
    }
    const artifactStat = await stat(absolutePath).catch(() => undefined);
    if (!artifactStat) {
      return { ok: false, reason: `thin-plan-v2 artifact cannot be read: ${artifact.path}` };
    }
    if (artifact.kind === 'file' && !artifactStat.isFile()) {
      return { ok: false, reason: `thin-plan-v2 artifact is not a file: ${artifact.path}` };
    }
    if (artifact.kind === 'dir' && !artifactStat.isDirectory()) {
      return { ok: false, reason: `thin-plan-v2 artifact is not a directory: ${artifact.path}` };
    }
  }

  return { ok: true, warnings: [], contract: THIN_PLAN_V2_CONTRACT };
};

export const validateThinPlanContract = async ({
  rootDir,
  planName,
  content,
}: {
  rootDir: string;
  planName: string;
  content: string;
}): Promise<Success | Failure> => {
  const contract = detectThinPlanContract(content);
  if (!contract) {
    return { ok: false, reason: `plan is missing ${THIN_PLAN_V1_CONTRACT} or ${THIN_PLAN_V2_CONTRACT}` };
  }
  if (contract === THIN_PLAN_V2_CONTRACT) {
    return await validateThinPlanV2Manifest({ rootDir, planName, content });
  }

  const warnings: string[] = [];

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
    warnings.push(
      `Thin-plan workflow history is ${formatKilobytes(workflowHistoryBytes)} > 4 KB; keep only current inline history and leave details in .ai/artifacts/<plan-name>/events/.`,
    );
  }

  return { ok: true, warnings, contract: THIN_PLAN_V1_CONTRACT };
};
