import path from "node:path";
import {
  appendManualTokenUsageCheckpoint,
  defaultCodexHome,
  type ManualTokenUsageStage,
} from "./manual-token-ledger.ts";

const parseArgs = (
  argv: string[],
): {
  planName?: string;
  stage?: ManualTokenUsageStage;
  sessionId?: string;
  codexHome?: string;
  rootDir?: string;
} => {
  const parsed: {
    planName?: string;
    stage?: ManualTokenUsageStage;
    sessionId?: string;
    codexHome?: string;
    rootDir?: string;
  } = {};

  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    const next = argv[index + 1];
    switch (arg) {
      case "--plan":
        parsed.planName = next;
        index += 1;
        break;
      case "--stage":
        if (next === "spec" || next === "plan" || next === "execute") {
          parsed.stage = next;
        }
        index += 1;
        break;
      case "--session":
        parsed.sessionId = next;
        index += 1;
        break;
      case "--codex-home":
        parsed.codexHome = next;
        index += 1;
        break;
      case "--root-dir":
        parsed.rootDir = next;
        index += 1;
        break;
      default:
        break;
    }
  }

  return parsed;
};

export const runManualTokenUsageCli = async (
  argv: string[],
  stdout: Pick<typeof process.stdout, "write"> = process.stdout,
  stderr: Pick<typeof process.stderr, "write"> = process.stderr,
): Promise<number> => {
  const args = parseArgs(argv);
  if (!args.planName || !args.stage) {
    stderr.write(
      "Usage: pnpm exec tsx .ai/scripts/workflow/telemetry/manual-token-usage.ts --plan <plan-name> --stage <spec|plan|execute> [--session <session-id>] [--codex-home <path>] [--root-dir <path>]\n",
    );
    return 1;
  }

  const result = await appendManualTokenUsageCheckpoint({
    rootDir: path.resolve(args.rootDir ?? process.cwd()),
    planName: args.planName,
    stage: args.stage,
    sessionId: args.sessionId,
    codexHome: args.codexHome ? path.resolve(args.codexHome) : defaultCodexHome(),
  });

  if (!result.ok) {
    stderr.write(`${result.reason}\n`);
    return 1;
  }

  if (result.status === "skipped") {
    stdout.write(`Skipped: ${result.reason}\n`);
    return 0;
  }

  stdout.write(
    `Appended manual ${args.stage} token checkpoint to ${result.ledgerPath} (${result.entry.stageTotalTokens} tokens)\n`,
  );
  return 0;
};
