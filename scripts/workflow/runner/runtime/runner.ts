export { analyzeTokenUsageLedger } from "../../telemetry/token-ledger.ts";

import type { RunnerResult } from "../types.ts";
import type { RunWorkflowOptions } from "./lifecycle.ts";
import { runWorkflowRunnerLifecycle } from "./runner-lifecycle.ts";

export const runWorkflowRunner = async (
  options: RunWorkflowOptions = {},
): Promise<RunnerResult> => runWorkflowRunnerLifecycle(options);
