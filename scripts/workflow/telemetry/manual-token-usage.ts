export {
  appendManualTokenUsageCheckpoint,
  detectLatestSessionSnapshot,
  parseSessionTokenSnapshot,
  runManualTokenUsageCli,
} from "./manual-token-ledger.ts";
export type {
  AppendManualTokenUsageResult,
  ManualTokenUsageStage,
} from "./manual-token-ledger.ts";

import { runManualTokenUsageCli } from "./manual-token-ledger.ts";

if (import.meta.url === `file://${process.argv[1]}`) {
  void runManualTokenUsageCli(process.argv.slice(2)).then((exitCode) => {
    process.exitCode = exitCode;
  });
}
