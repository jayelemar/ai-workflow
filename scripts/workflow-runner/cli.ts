import path from 'node:path';

type Failure = {
  ok: false;
  reason: string;
};

export type ParsedRunnerCliArgs =
  | {
      ok: true;
      planArgument: string;
      compactOutput: boolean;
      codexProfile?: string;
      unblockNote?: string;
    }
  | Failure;

const rel = (...segments: string[]) => segments.join('/');

export const parseRunnerCliArgs = (argv: string[] = []): ParsedRunnerCliArgs => {
  let compactOutput = false;
  let codexProfile: string | undefined;
  let unblockNote: string | undefined;
  let planArgument = '';

  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    if (arg === '--compact') {
      if (index !== 0 || planArgument) {
        return { ok: false, reason: '--compact must appear before the plan argument' };
      }
      compactOutput = true;
      continue;
    }
    if (arg === '--unblock-note') {
      const note = argv[index + 1];
      if (!note || note.startsWith('--')) {
        return { ok: false, reason: '--unblock-note requires a value' };
      }
      unblockNote = note;
      index += 1;
      continue;
    }
    if (arg === '--profile') {
      const profile = argv[index + 1];
      if (!profile || profile.startsWith('--')) {
        return { ok: false, reason: '--profile requires a value' };
      }
      codexProfile = profile;
      index += 1;
      continue;
    }
    if (arg.startsWith('--')) {
      return { ok: false, reason: `unknown workflow runner flag: ${arg}` };
    }
    if (planArgument) {
      return { ok: false, reason: `unexpected extra workflow runner argument: ${arg}` };
    }
    planArgument = arg;
  }

  return {
    ok: true,
    planArgument,
    compactOutput,
    codexProfile,
    unblockNote,
  };
};

export const normalizePlanArgument = (
  planName: string,
): { ok: true; planName: string; planPath: string } | Failure => {
  const trimmed = planName.trim();
  if (trimmed.length === 0) {
    return { ok: false, reason: 'plan name is required' };
  }
  if (path.isAbsolute(trimmed)) {
    return {
      ok: false,
      reason: `plan argument must be a repo-relative .ai/plans/<plan-name>.md path: ${trimmed}`,
    };
  }
  if (!trimmed.startsWith('.ai/plans/') || !trimmed.endsWith('.md')) {
    return {
      ok: false,
      reason: `plan argument must be a repo-relative .ai/plans/<plan-name>.md path: ${trimmed}`,
    };
  }

  const fileName = trimmed.slice('.ai/plans/'.length);
  if (fileName.includes('/') || fileName.includes('..')) {
    return {
      ok: false,
      reason: `plan argument must not contain nested paths or parent traversal: ${trimmed}`,
    };
  }

  const normalizedPlanName = fileName.slice(0, -'.md'.length);
  if (normalizedPlanName.length === 0) {
    return { ok: false, reason: `plan argument must include a plan name: ${trimmed}` };
  }

  return {
    ok: true,
    planName: normalizedPlanName,
    planPath: rel('.ai', 'plans', `${normalizedPlanName}.md`),
  };
};
