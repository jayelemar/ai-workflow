import { V7_USAGE, runV7Cli } from "./cli/cli.ts";

export { V7_USAGE } from "./cli/cli.ts";

/**
 * Isolated V7 runner. It composes only `.ai/v7` modules and never imports or
 * invokes the active legacy workflow runner.
 */
export const runV7WorkflowRunner = runV7Cli;

if (import.meta.url === `file://${process.argv[1]}`) {
  void runV7WorkflowRunner(process.argv.slice(2)).then((result) => {
    (result.exitCode === 0 ? process.stdout : process.stderr).write(`${result.message}\n`);
    process.exitCode = result.exitCode;
  });
}
