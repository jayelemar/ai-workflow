export {
  appendManualTokenUsageCheckpoint,
  detectLatestSessionSnapshot,
  parseSessionTokenSnapshot,
} from './manual-token-ledger.ts';
export { runManualTokenUsageCli } from './manual-token-cli.ts';
export type { AppendManualTokenUsageResult, ManualTokenUsageStage } from './manual-token-ledger.ts';

import { runManualTokenUsageCli } from './manual-token-cli.ts';

if (import.meta.url === `file://${process.argv[1]}`) {
  void runManualTokenUsageCli(process.argv.slice(2)).then((exitCode) => {
    process.exitCode = exitCode;
  });
}
